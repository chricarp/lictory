import type { Hono } from "hono";

import type { AppBindings } from "../bindings";

export function errorBody(
  code: string,
  message: string,
  requestId?: string,
  details?: unknown,
) {
  return { error: { code, message, requestId, details } };
}

export function registerErrorHandlers(app: Hono<AppBindings>) {
  app.notFound((c) =>
    c.json(errorBody("not_found", "Not found", c.get("requestId")), 404),
  );

  app.onError((error, c) => {
    console.error(error);
    return c.json(
      errorBody(
        "internal_error",
        c.env.ENVIRONMENT === "development"
          ? error.message
          : "An unexpected error occurred",
        c.get("requestId"),
      ),
      500,
    );
  });
}
