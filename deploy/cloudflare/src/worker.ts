import {
  analyticsRelayPath,
  relayToPosthog,
} from "../../../packages/core/src/lib/analytics/relay";

interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** marketing (lictory.com) or docs (docs.lictory.com: static files,
   * headers and the analytics relay). Lictory itself is self-hosted; no
   * Worker serves it. */
  SITE_KIND: "marketing" | "docs";
  SITE_URL: string;
  /** PostHog ingestion host for the websites' analytics relay (passed with
   * `wrangler deploy --var`); unset, the relay answers 404 and nothing leaves. */
  POSTHOG_HOST?: string;
}

function destinationUrl(base: string, path: string, search: string) {
  const url = new URL(base);
  url.pathname = path;
  url.search = search;
  return url;
}

// The websites' first-party analytics relay goes straight to PostHog, with
// the same forwarded headers and stripped cookies as the application's API.
// Cloudflare's client IP header is the only one this edge trusts.
function relay(request: Request, env: Environment) {
  const host = env.POSTHOG_HOST?.trim();
  if (!host) return new Response(null, { status: 404 });
  return relayToPosthog(
    request,
    host,
    request.headers.get("cf-connecting-ip") ?? undefined,
  );
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const relayPath =
      path === analyticsRelayPath || path.startsWith(`${analyticsRelayPath}/`);
    if (env.SITE_KIND === "marketing") {
      let destination: URL | undefined;
      if (url.hostname === `www.${new URL(env.SITE_URL).hostname}`) {
        destination = destinationUrl(env.SITE_URL, path, url.search);
      } else if (path === "/home") {
        destination = destinationUrl(env.SITE_URL, "/", url.search);
      }
      if (destination) return Response.redirect(destination.toString(), 308);
      if (relayPath) return relay(request, env);
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
    } else if (relayPath) {
      // The documentation has no redirects; only its analytics relay.
      return relay(request, env);
    }
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
    headers.set("X-Frame-Options", "SAMEORIGIN");
    if (/^\/(assets|_next\/static|illustrations)\//.test(path) && asset.ok)
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    // Static export preserves extensionless route handlers, but object storage
    // cannot infer their media types from a filename.
    if (/\/(og\/|opengraph-image$|twitter-image$)/.test(path) && asset.ok)
      headers.set("Content-Type", "image/png");
    if (path === "/guides/feed.xml" && asset.ok)
      headers.set("Content-Type", "application/rss+xml; charset=utf-8");
    return new Response(asset.body, { status: asset.status, headers });
  },
};
