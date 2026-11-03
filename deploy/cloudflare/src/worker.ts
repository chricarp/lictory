import {
  analyticsSettings,
  publicConfigTag,
} from "../../../packages/core/src/lib/public-config";
import { socialPreviewHead } from "../../../packages/core/src/lib/social-preview-kind";

interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** marketing (lictory.com), platform (app.lictory.com) or docs
   * (docs.lictory.com: static files and headers only, no backend). */
  SITE_KIND: "marketing" | "platform" | "docs";
  SITE_URL: string;
  PLATFORM_URL: string;
  BACKEND_ORIGIN: string;
  /** Browser analytics for the platform document; unset disables them. */
  POSTHOG_PROJECT_TOKEN?: string;
  POSTHOG_HOST?: string;
  ANALYTICS_CONSENT?: string;
}

const accountPages = new Set([
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/welcome",
  "/auth-error",
]);

function destinationUrl(base: string, path: string, search: string) {
  const url = new URL(base);
  url.pathname = path;
  url.search = search;
  return url;
}

async function backend(request: Request, env: Environment) {
  const incoming = new URL(request.url);
  if (/^\/api\/zero(\/|$)/.test(incoming.pathname))
    return new Response(null, { status: 404 });
  if (
    incoming.pathname.startsWith("/zero/") &&
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    request.headers.get("origin") !== env.PLATFORM_URL
  )
    return new Response(null, { status: 403 });
  const target = new URL(env.BACKEND_ORIGIN);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", "https");
  const clientIp = request.headers.get("cf-connecting-ip");
  headers.delete("x-forwarded-for");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  // A same-zone fetch from a Worker Route reaches the DNS-configured VPS
  // origin without invoking this route again. Do not use a Custom Domain here.
  // Return the response directly: cloning would break WebSocket upgrades.
  return fetch(new Request(target, request), { headers, redirect: "manual" });
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (env.SITE_KIND === "marketing") {
      let destination: URL | undefined;
      if (url.hostname === `www.${new URL(env.SITE_URL).hostname}`) {
        destination = destinationUrl(env.SITE_URL, path, url.search);
      } else if (path === "/home") {
        destination = destinationUrl(env.SITE_URL, "/", url.search);
      } else if (path === "/app" || path.startsWith("/app/")) {
        destination = destinationUrl(
          env.PLATFORM_URL,
          path.slice(4) || "/",
          url.search,
        );
      } else if (accountPages.has(path)) {
        destination = destinationUrl(env.PLATFORM_URL, path, url.search);
      }
      if (destination) return Response.redirect(destination.toString(), 308);
      if (path === "/relay" || path.startsWith("/relay/"))
        return backend(request, env);
      if (path.startsWith("/markdown/"))
        return new Response(null, { status: 404 });
      if (
        path === "/guides.md" ||
        /^\/(guides|compare)\/[^/]+\.md$/.test(path)
      ) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = `/markdown${path}`;
        const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
        if (!asset.ok) return asset;
        const headers = new Headers(asset.headers);
        headers.set("Content-Type", "text/markdown; charset=utf-8");
        headers.set(
          "Link",
          `<${new URL(path.slice(0, -3), env.SITE_URL)}>; rel="canonical"`,
        );
        return new Response(asset.body, { status: asset.status, headers });
      }
    } else if (
      env.SITE_KIND === "platform" &&
      (/^\/(api|zero|relay)(\/|$)/.test(path) ||
        path === "/healthz" ||
        path === "/readyz")
    ) {
      return backend(request, env);
    }
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
    headers.set(
      "X-Frame-Options",
      env.SITE_KIND === "platform" ? "DENY" : "SAMEORIGIN",
    );
    const platformDocument =
      env.SITE_KIND === "platform" &&
      headers.get("Content-Type")?.includes("text/html");
    if (env.SITE_KIND === "platform") {
      headers.set("Content-Security-Policy", "frame-ancestors 'none'");
      headers.set("X-Robots-Tag", "noindex, nofollow");
      if (platformDocument) headers.set("Cache-Control", "no-store");
    }
    if (/^\/(assets|_next\/static|illustrations)\//.test(path) && asset.ok)
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    // Static export preserves extensionless route handlers, but object storage
    // cannot infer their media types from a filename.
    if (/\/(og\/|opengraph-image$|twitter-image$)/.test(path) && asset.ok)
      headers.set("Content-Type", "image/png");
    if (path === "/guides/feed.xml" && asset.ok)
      headers.set("Content-Type", "application/rss+xml; charset=utf-8");
    if (platformDocument) {
      headers.delete("Content-Length");
      headers.delete("ETag");
      const html =
        request.method === "HEAD"
          ? null
          : (await asset.text()).replace(
              "<!--app-head-->",
              () =>
                socialPreviewHead(path, env.SITE_URL) +
                publicConfigTag({
                  siteUrl: new URL(env.SITE_URL).origin,
                  analytics: analyticsSettings(env),
                }),
            );
      return new Response(html, { status: asset.status, headers });
    }
    return new Response(asset.body, { status: asset.status, headers });
  },
};
