import { authenticateAccessToken } from "~/capabilities/access-tokens";
import { serverContext } from "~/capabilities/server";
import { db } from "~/db";
import { handleMcp } from "~/mcp/server";

// Model Context Protocol endpoint (Streamable HTTP, stateless JSON responses).
// External agents authenticate with a personal access token created in
// Account settings and act with exactly that person's permissions.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY = 8 * 1024 * 1024;

function rpcError(status: number, message: string, headers?: HeadersInit) {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message } },
    { status, headers },
  );
}

const challenge = {
  "WWW-Authenticate":
    'Bearer realm="lictory", error="invalid_token", error_description="Create a personal access token in Lictory account settings."',
};

export async function POST(request: Request) {
  // Browsers must not drive this endpoint from other sites (DNS rebinding);
  // non-browser MCP clients send no Origin.
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(request.url).origin &&
    origin !== process.env.BETTER_AUTH_URL
  )
    return rpcError(403, "Invalid request origin.");
  const header = request.headers.get("authorization") ?? "";
  const secret = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  const token = secret ? await authenticateAccessToken(db, secret) : null;
  if (!token)
    return rpcError(
      401,
      "A valid Lictory access token is required.",
      challenge,
    );
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    return rpcError(413, "Request too large.");
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
      access: token.access,
      client: request.headers.get("user-agent"),
    },
    request.headers,
  );
  const result = await handleMcp(ctx, payload);
  if (result === null) return new Response(null, { status: 202 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

// This server does not open server-initiated streams or sessions.
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
