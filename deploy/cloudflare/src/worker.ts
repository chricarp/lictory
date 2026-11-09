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

/**
 * The one public form of a page path, or undefined when `path` already is it.
 * The asset server answers `/page/`, `/page.html` and `/index` with temporary
 * (307) redirects, which leave search engines holding two URLs for one page;
 * the Worker answers them first, with one permanent redirect.
 */
function canonicalPath(path: string) {
  let canonical = path.replace(/\.html$/, "").replace(/(^|\/)index$/, "$1");
  if (canonical.length > 1) canonical = canonical.replace(/\/+$/, "") || "/";
  return canonical === path ? undefined : canonical;
}

// Next.js exports its not-found page twice as ordinary files (/404.html,
// /_not-found.html). Fetched directly, the asset server would answer 200 with
// a noindex page, which search engines report as "Excluded by 'noindex' tag".
const notFoundPages = /^\/(404|_not-found)(\.txt)?$/;

// Text files people and crawlers read. Every other exported `.txt` is a React
// Server Components payload the router fetches: data, not a page.
const textDocuments = new Set(["/robots.txt", "/llms.txt", "/llms-full.txt"]);

function isPagePayload(path: string) {
  return path.endsWith(".txt") && !textDocuments.has(path);
}

function permanentRedirect(destination: URL) {
  return Response.redirect(destination.toString(), 301);
}

/** `<page>.md`: the Markdown version of a page, exported at /markdown/<page>.md. */
async function markdown(request: Request, env: Environment, path: string) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = `/markdown${path}`;
  const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!asset.ok) return asset;
  const headers = new Headers(asset.headers);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  const page = path.slice(0, -3).replace(/^\/index$/, "/");
  headers.set("Link", `<${new URL(page, env.SITE_URL)}>; rel="canonical"`);
  return new Response(asset.body, { status: asset.status, headers });
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const relayPath =
      path === analyticsRelayPath || path.startsWith(`${analyticsRelayPath}/`);
    // PostHog posts to paths with a trailing slash; the relay keeps them.
    if (relayPath) return relay(request, env);
    const siteHost = new URL(env.SITE_URL).hostname;
    const wwwHost =
      env.SITE_KIND === "marketing" && url.hostname === `www.${siteHost}`;
    // The landing page used to be reachable at /home as well.
    const page =
      env.SITE_KIND === "marketing" && path === "/home"
        ? "/"
        : (canonicalPath(path) ?? path);
    if (wwwHost || page !== path)
      return permanentRedirect(destinationUrl(env.SITE_URL, page, url.search));
    if (path.startsWith("/markdown/"))
      return new Response(null, { status: 404 });
    if (path.endsWith(".md")) return markdown(request, env, path);
    let asset: Response;
    if (notFoundPages.test(path)) {
      const notFound = await env.ASSETS.fetch(
        new Request(new URL("/404", request.url), request),
      );
      asset = new Response(notFound.body, {
        status: 404,
        headers: notFound.headers,
      });
    } else {
      asset = await env.ASSETS.fetch(request);
    }
    const headers = new Headers(asset.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
    headers.set("X-Frame-Options", "SAMEORIGIN");
    // Router payloads stay fetchable but never appear in search results as
    // plain-text copies of the pages.
    if (isPagePayload(path)) headers.set("X-Robots-Tag", "noindex");
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
