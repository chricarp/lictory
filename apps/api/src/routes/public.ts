import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import {
  analyticsRelayPath,
  relayToPosthog,
} from "@lictory/core/lib/analytics/relay";
import { posthogServerConfig } from "@lictory/core/lib/analytics/config";
import { siteUrl } from "@lictory/core/lib/auth-base-url";
import { env } from "@lictory/core/lib/env";
import {
  analyticsSettings,
  legalLinks,
  publicConfigTag,
} from "@lictory/core/lib/public-config";
import { socialPreviewHead } from "@lictory/core/lib/social-preview-kind";

// First-party relay for the PostHog browser SDK (see relayToPosthog). The
// visitor's IP comes from the reverse proxy in front of the API.
function relay(request: Request) {
  const host = posthogServerConfig()?.host;
  if (!host) return new Response(null, { status: 404 });
  return relayToPosthog(
    request,
    host,
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
      request.headers.get("x-real-ip") ??
      undefined,
  );
}

export function relayRoutes() {
  const app = new Hono();
  app.on(["GET", "POST", "HEAD"], `${analyticsRelayPath}/*`, (c) =>
    relay(c.req.raw),
  );
  return app;
}

// The SPA document. The reverse proxy serves hashed assets itself and sends
// every other page request here; the response is the built index.html with
// path-derived social preview tags and this installation's public runtime
// configuration (lib/public-config), so one build serves any domain. Path
// and environment only: no session or database reads, so the document never
// reveals workspace data and is never cached.
const placeholder = "<!--app-head-->";
let template: Promise<string> | undefined;
function documentTemplate() {
  const directory =
    env("PLATFORM_DIST_DIR") ??
    path.resolve(process.cwd(), "apps/platform/dist");
  template ??= readFile(path.join(directory, "index.html"), "utf8").catch(
    (error: unknown) => {
      template = undefined;
      throw error;
    },
  );
  return template;
}

export function documentRoutes() {
  const app = new Hono();
  app.get("*", async (c) => {
    let html: string;
    try {
      html = await documentTemplate();
    } catch {
      return c.text("The application is not built.", 503, {
        "Cache-Control": "no-store",
      });
    }
    const url = new URL(c.req.url);
    const site = siteUrl();
    const head =
      socialPreviewHead(url.pathname, site) +
      publicConfigTag({
        siteUrl: site,
        legal: legalLinks({
          LEGAL_TERMS_URL: process.env.LEGAL_TERMS_URL,
          LEGAL_PRIVACY_URL: process.env.LEGAL_PRIVACY_URL,
        }),
        analytics: analyticsSettings({
          POSTHOG_PROJECT_TOKEN: process.env.POSTHOG_PROJECT_TOKEN,
          POSTHOG_HOST: process.env.POSTHOG_HOST,
          ANALYTICS_CONSENT: process.env.ANALYTICS_CONSENT,
        }),
      });
    return c.html(
      html.replace(placeholder, () => head),
      200,
      {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    );
  });
  return app;
}
