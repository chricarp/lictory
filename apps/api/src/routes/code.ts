import { Hono } from "hono";
import { receiveWebhook } from "@lictory/core/code/ingest";
import { db } from "@lictory/core/db";
import { limit, MB } from "@lictory/api/middleware";

// Code host webhooks (docs/internals/code-hosts.md#ingest). The host's
// signature is the only authentication: no cookie, no session. The route
// verifies it, stores the delivery once and answers at once; the worker
// processes it. Errors say nothing about the organization or connection.
export function codeWebhookRoutes() {
  const app = new Hono();
  app.post(
    "/api/code/webhooks/:connectionId",
    limit(10 * MB, "The webhook payload is too large."),
    async (c) => {
      const body = await c.req.text();
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const result = await receiveWebhook(db, {
        connectionId: c.req.param("connectionId"),
        headers,
        body,
      });
      if (result.status === "rejected")
        return c.json(
          {
            error:
              result.reason === "payload"
                ? "The payload is not JSON."
                : "The signature does not match this webhook.",
          },
          result.reason === "payload" ? 400 : 401,
        );
      return c.json(
        { ok: true, duplicate: result.status === "duplicate" },
        202,
      );
    },
  );
  return app;
}
