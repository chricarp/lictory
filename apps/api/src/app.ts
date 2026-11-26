import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { authenticateAccessToken } from "@lictory/core/capabilities/access-tokens";
import {
  serverContext,
  serverEffects,
} from "@lictory/core/capabilities/server";
import { trackCommitted } from "@lictory/core/capabilities/workspace";
import { db } from "@lictory/core/db";
import { auth } from "@lictory/core/lib/auth";
import { matchesPlatformOrigin } from "@lictory/core/lib/auth-base-url";
import { handleMcpHttp } from "@lictory/core/mcp/server";
import { limit, MB, sameOriginWrites } from "@lictory/api/middleware";
import { eventRoutes } from "@lictory/api/routes/events";
import { intelligenceRoutes } from "@lictory/api/routes/intelligence";
import { documentRoutes, relayRoutes } from "@lictory/api/routes/public";
import { DEFAULT_BODY_LIMIT, webRoutes } from "@lictory/api/routes/web";
import { adminRoutes } from "@lictory/api/routes/admin";
import { runnerRoutes } from "@lictory/api/routes/runner";
import { codeWebhookRoutes } from "@lictory/api/routes/code";
import { slackRoutes } from "@lictory/api/routes/slack";
import { createZeroEndpoints, validApiKey } from "@lictory/api/zero/server";

function rpcError(status: number, message: string, headers?: HeadersInit) {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message } },
    { status, headers },
  );
}
// Header values are ASCII: no arrows here.
const mcpChallenge = {
  "WWW-Authenticate":
    'Bearer realm="lictory", error="invalid_token", error_description="Use an agent\'s token from Factory > Agents > the agent > Connection, or a personal access token from Account settings > Integrations."',
};

export function createApp(options: { draining?: () => boolean } = {}) {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));
  // Ready while the database answers and the process is not draining.
  app.get("/readyz", async (c) => {
    if (options.draining?.()) return c.text("draining", 503);
    try {
      await db.execute(sql`select 1`);
      return c.text("ready");
    } catch {
      return c.text("database unavailable", 503);
    }
  });

  app.use("/api/*", sameOriginWrites);

  app.on(["GET", "POST"], "/api/auth/*", limit(1 * MB), (c) =>
    auth.handler(c.req.raw),
  );

  // Model Context Protocol (Streamable HTTP, stateless JSON responses).
  // External agents authenticate with a personal access token and act with
  // exactly that person's permissions.
  app.post("/api/mcp", limit(8 * MB, "Request too large."), async (c) => {
    const request = c.req.raw;
    // Browsers must not drive this endpoint from other sites (DNS
    // rebinding); non-browser MCP clients send no Origin.
    const origin = request.headers.get("origin");
    if (origin && !matchesPlatformOrigin(origin))
      return rpcError(403, "Invalid request origin.");
    const secret = /^Bearer\s+(.+)$/i
      .exec(request.headers.get("authorization") ?? "")?.[1]
      ?.trim();
    const token = secret ? await authenticateAccessToken(db, secret) : null;
    if (!token)
      return rpcError(
        401,
        "A valid Lictory access token is required. An agent's token comes from Factory → Agents → the agent → Connection (a new token is shown once); a person's own from Account settings → Integrations → Personal access tokens. Revoked and expired tokens are refused.",
        mcpChallenge,
      );
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        { status: 400 },
      );
    }
    const ctx = serverContext(
      {
        userId: token.userId,
        surface: "mcp",
        tokenId: token.tokenId,
        agentName: token.name,
        agent: token.agent,
        access: token.access,
        client: request.headers.get("user-agent"),
      },
      request.headers,
    );
    const { body, status } = await handleMcpHttp(ctx, payload, {
      headers: request.headers,
    });
    if (body === null) return new Response(null, { status });
    return Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  });
  // No server-initiated streams or sessions.
  app.on(
    ["GET", "DELETE"],
    "/api/mcp",
    () => new Response(null, { status: 405, headers: { Allow: "POST" } }),
  );

  // Zero's query and mutate endpoints, called by zero-cache only (the
  // reverse proxy blocks them publicly). Production requires the shared API
  // keys so a proxy misconfiguration cannot expose them.
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.ZERO_QUERY_API_KEY || !process.env.ZERO_MUTATE_API_KEY)
  )
    throw new Error(
      "ZERO_QUERY_API_KEY and ZERO_MUTATE_API_KEY are required in production.",
    );
  const zero = createZeroEndpoints(db, {
    onCommitted: (outcome, request) =>
      trackCommitted(
        serverEffects(
          { userId: outcome.userId, surface: "web" },
          request.headers,
        ),
        outcome,
      ),
  });
  const zeroSession = async (request: Request, key: string | undefined) => {
    if (!validApiKey(key, request.headers.get("x-api-key"))) return null;
    return (await auth.api.getSession({ headers: request.headers }))?.user.id;
  };
  app.post("/api/zero/query", limit(1 * MB), async (c) => {
    const userID = await zeroSession(c.req.raw, process.env.ZERO_QUERY_API_KEY);
    if (!userID) return c.json({ error: "unauthorized" }, 401);
    return c.json(await zero.query(c.req.raw, userID));
  });
  app.post("/api/zero/mutate", limit(16 * MB), async (c) => {
    const userID = await zeroSession(
      c.req.raw,
      process.env.ZERO_MUTATE_API_KEY,
    );
    if (!userID) return c.json({ error: "unauthorized" }, 401);
    return c.json(await zero.mutate(c.req.raw, userID));
  });

  // The runner protocol: bearer runner credentials, its own body limits.
  app.route("/", runnerRoutes());
  // Code host webhooks: their own body limit, signature authentication.
  app.route("/", codeWebhookRoutes());
  // Slack's Events API, interactivity and OAuth redirect: signed by Slack.
  app.route("/", slackRoutes());

  app.use("/api/*", limit(DEFAULT_BODY_LIMIT));
  app.route("/", webRoutes());
  app.route("/", adminRoutes());
  app.route("/", intelligenceRoutes());
  app.route("/", eventRoutes());
  app.all("/api/*", (c) =>
    c.json({ error: { category: "unavailable", message: "Not found." } }, 404),
  );
  app.route("/", relayRoutes());
  app.route("/", documentRoutes());

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        event: "api.unhandled",
        path: c.req.path,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }),
    );
    return c.json(
      {
        error: {
          category: "server",
          message: "The operation failed unexpectedly. Retry shortly.",
        },
      },
      500,
    );
  });

  return app;
}
