import { bodyLimit } from "hono/body-limit";
import type { MiddlewareHandler } from "hono";
import { CapabilityError } from "@lictory/core/capabilities/core";
import { errorResponse } from "@lictory/core/capabilities/http";
import { matchesPlatformOrigin } from "@lictory/core/lib/auth-base-url";

export const MB = 1024 * 1024;

// Rejects bodies over `max` bytes with the shared error shape (413), whether
// or not the client declared Content-Length.
export function limit(
  max: number,
  message = "The request is too large.",
  shape: "object" | "string" = "object",
): MiddlewareHandler {
  return bodyLimit({
    maxSize: max,
    onError: () =>
      errorResponse(
        new CapabilityError("validation", message, { status: 413 }),
        shape,
      ),
  });
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
// Better Auth checks its own origins, MCP authenticates with bearer tokens and
// the Zero endpoints are internal (API key, cookies forwarded by zero-cache).
const ownOriginPolicy = [/^\/api\/auth\//, /^\/api\/mcp$/, /^\/api\/zero\//];

// Cookie-authenticated writes must come from the platform's exact origin.
export const sameOriginWrites: MiddlewareHandler = async (c, next) => {
  if (
    !safeMethods.has(c.req.method) &&
    !ownOriginPolicy.some((pattern) => pattern.test(c.req.path)) &&
    !matchesPlatformOrigin(c.req.header("origin") ?? null)
  )
    return errorResponse(
      new CapabilityError("forbidden", "Invalid request origin."),
    );
  await next();
};

export const noStore = { "Cache-Control": "no-store" };
