import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { db } from "@lictory/core/db";
import { auth } from "@lictory/core/lib/auth";
import { paths } from "@lictory/core/lib/paths";
import { DomainError } from "@lictory/core/domain/errors";
import {
  defaultSlackClient,
  SlackError,
} from "@lictory/core/channels/slack/api";
import { completeSlackInstall } from "@lictory/core/channels/slack/installation";
import { receiveSlackRequest } from "@lictory/core/channels/slack/inbound";
import { limit, MB, noStore } from "@lictory/api/middleware";

// Slack's side of the Slack integration (docs/internals/channels.md#slack):
// the Events API and interactivity URLs of an organization's Slack app,
// authenticated by Slack's request signature (no cookies, no Origin), and
// the OAuth redirect, which needs the signed-in administrator who started
// the install. Events are stored and answered at once; the worker does the
// work.

export function slackRoutes() {
  const app = new Hono();
  const slack =
    (kind: "events" | "interactivity") =>
    async (c: { req: { raw: Request; param(name: string): string } }) => {
      const body = await c.req.raw.text();
      const result = await receiveSlackRequest(db, {
        organizationId: c.req.param("organizationId"),
        kind,
        headers: c.req.raw.headers,
        body,
      });
      return new Response(result.body, {
        status: result.status,
        headers: {
          ...noStore,
          "Content-Type": result.contentType ?? "text/plain; charset=utf-8",
        },
      });
    };
  app.post(
    "/api/slack/events/:organizationId",
    limit(1 * MB, "Slack event too large.", "string"),
    slack("events"),
  );
  app.post(
    "/api/slack/interactivity/:organizationId",
    limit(1 * MB, "Slack payload too large.", "string"),
    slack("interactivity"),
  );

  app.get("/api/slack/oauth/callback", async (c) => {
    const back = (organizationSlug: string | null, query: string) =>
      c.redirect(
        `${organizationSlug ? paths.settings(organizationSlug, "integrations") : "/"}?${query}`,
        303,
      );
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    const denied = c.req.query("error");
    if (!session)
      return c.redirect(
        `/sign-in?returnTo=${encodeURIComponent(c.req.url.replace(/^https?:\/\/[^/]+/, ""))}`,
        303,
      );
    if (denied || !code)
      return back(
        null,
        `slack=error&message=${encodeURIComponent("The Slack installation was cancelled.")}`,
      );
    try {
      const { organizationId } = await completeSlackInstall(
        db,
        defaultSlackClient(),
        { userId: session.user.id, state, code },
      );
      const [org] = await db
        .select({ slug: s.organization.slug })
        .from(s.organization)
        .where(eq(s.organization.id, organizationId));
      return back(org?.slug ?? null, "slack=connected");
    } catch (error) {
      const message =
        error instanceof DomainError || error instanceof SlackError
          ? error.message
          : "Slack could not be connected. Try again.";
      if (!(error instanceof DomainError || error instanceof SlackError))
        console.error(
          JSON.stringify({
            event: "slack.install_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return back(null, `slack=error&message=${encodeURIComponent(message)}`);
    }
  });
  return app;
}
