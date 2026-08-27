import { Hono } from "hono";

import type { AppBindings } from "./bindings";
import { askRoutes } from "./features/ask/routes";
import { createAuth } from "./features/auth/service";
import { entityRoutes } from "./features/entities/routes";
import { graphRoutes } from "./features/graph/routes";
import { momentRoutes } from "./features/moments/routes";
import { mediaRoutes, publicMediaRoutes } from "./features/media/routes";
import { noteRoutes } from "./features/notes/routes";
import { searchRoutes } from "./features/search/routes";
import { triggerRoutes } from "./features/triggers/routes";
import { registerErrorHandlers } from "./http/errors";
import { allowedOrigins, requestContext, requireUser } from "./http/middleware";

/**
 * HTTP composition root. Feature routers own behavior; this module only makes
 * cross-cutting policy and the public URL structure explicit.
 */
export function createApp() {
  const app = new Hono<AppBindings>();

  app.use("*", requestContext);
  app.use("*", allowedOrigins);

  app.on(["GET", "POST"], "/api/auth/*", (c) =>
    createAuth(c.env).handler(c.req.raw),
  );
  app.get("/health", (c) =>
    c.json({
      ok: true as const,
      service: "lictory-api",
      environment: c.env.ENVIRONMENT,
    }),
  );
  app.route("/", publicMediaRoutes);

  const api = new Hono<AppBindings>();
  api.use("*", requireUser);
  api.route("/notes", noteRoutes);
  api.route("/asks", askRoutes);
  api.route("/entities", entityRoutes);
  api.route("/moments", momentRoutes);
  api.route("/graph", graphRoutes);
  api.route("/search", searchRoutes);
  api.route("/", mediaRoutes);
  api.route("/", triggerRoutes);
  app.route("/v1", api);

  registerErrorHandlers(app);
  return app;
}
