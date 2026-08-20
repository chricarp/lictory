import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import type { AppBindings } from "../bindings";
import { authenticate } from "../features/auth/service";
import { errorBody } from "./errors";

export const requestContext: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
  await next();
  c.header("x-request-id", c.get("requestId"));
};

export const allowedOrigins: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  return cors({
    origin: (origin) =>
      allowed.includes(origin) ? origin : (allowed[0] ?? ""),
    allowHeaders: ["authorization", "content-type", "x-upload-token"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["set-auth-token", "x-request-id"],
    credentials: true,
    maxAge: 86_400,
  })(c, next);
};

export const requireUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  const userId = await authenticate(c.req.raw.headers, c.env);
  if (!userId) {
    return c.json(
      errorBody(
        "unauthorized",
        "A valid bearer token is required",
        c.get("requestId"),
      ),
      401,
    );
  }

  c.set("userId", userId);
  await next();
};
