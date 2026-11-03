import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import {
  analyticsRelayPath,
  relayTarget,
} from "@lictory/core/lib/analytics/relay";
import { platformUrl, siteUrl } from "@lictory/core/lib/auth-base-url";
import {
  analyticsSettings,
  publicConfigTag,
} from "@lictory/core/lib/public-config";
import { socialPreviewHead } from "@lictory/core/lib/social-preview-kind";

// First-party relay for the PostHog browser SDK. It forwards only what PostHog
// needs: Lictory cookies and auth headers never leave this origin, and PostHog
// cookies are never set on it. The visitor's IP is forwarded explicitly
// because PostHog's cookieless mode hashes IP + user agent. `origin` is
// Lictory's own origin; PostHog's flags service uses it as the site host.
const forwardedRequestHeaders = [
  "accept",
  "accept-language",
  "content-encoding",
  "content-type",
  "origin",
  "user-agent",
];
const droppedResponseHeaders = [
  "set-cookie",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
];

function posthogHost() {
  const host =
    process.env.POSTHOG_HOST ??
    process.env.VITE_POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST;
  const token =
    process.env.POSTHOG_PROJECT_TOKEN ??
    process.env.VITE_POSTHOG_PROJECT_TOKEN ??
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  return host && token ? host : undefined;
}

async function relay(request: Request) {
  const host = posthogHost();
  if (!host) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const target = relayTarget(
    url.pathname.slice(analyticsRelayPath.length),
    url.search,
    host,
  );
  if (!target) return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = (
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    request.headers.get("x-real-ip") ??
    ""
  ).trim();
  if (ip) headers.set("x-forwarded-for", ip);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of droppedResponseHeaders) responseHeaders.delete(name);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    // Analytics delivery is best effort; the SDK retries on its own.
    return new Response(null, { status: 502 });
  }
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
    process.env.PLATFORM_DIST_DIR ??
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
    const head =
      socialPreviewHead(url.pathname, platformUrl()) +
      publicConfigTag({
        siteUrl: siteUrl(),
        analytics: analyticsSettings({
          POSTHOG_PROJECT_TOKEN: process.env.POSTHOG_PROJECT_TOKEN,
          POSTHOG_HOST: process.env.POSTHOG_HOST,
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
