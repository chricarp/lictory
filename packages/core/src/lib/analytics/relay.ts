// The browser SDK talks to PostHog through this first-party path, so ad and
// tracker blockers that match PostHog domains do not drop product analytics.
// The path is deliberately generic; "/ingest" and "/posthog" are on block lists.
export const analyticsRelayPath = "/relay";

const cloudIngestion = /^https:\/\/(eu|us)\.i\.posthog\.com$/;

/**
 * PostHog hosts derived from the configured ingestion host
 * (`NEXT_PUBLIC_POSTHOG_HOST`). Cloud serves SDK assets from a separate host;
 * self-hosted instances serve everything from one origin.
 */
export function posthogHosts(ingestionHost: string) {
  const api = ingestionHost.replace(/\/+$/, "");
  const region = cloudIngestion.exec(api)?.[1];
  return {
    api,
    assets: region ? `https://${region}-assets.i.posthog.com` : api,
    ui: region ? `https://${region}.posthog.com` : api,
  };
}

/**
 * Maps a relay request path (after `/relay`) to the PostHog URL it proxies.
 * Returns null for anything that is not a plain relative PostHog path.
 */
export function relayTarget(
  relativePath: string,
  search: string,
  ingestionHost: string,
): string | null {
  if (!/^\/[A-Za-z0-9._~\-/]*$/.test(relativePath)) return null;
  if (
    relativePath.includes("//") ||
    relativePath.split("/").some((part) => part === ".." || part === ".")
  )
    return null;
  const hosts = posthogHosts(ingestionHost);
  const base =
    relativePath.startsWith("/static/") || relativePath.startsWith("/array/")
      ? hosts.assets
      : hosts.api;
  return `${base}${relativePath}${search}`;
}

// What a relay forwards: only what PostHog needs. Lictory cookies and auth
// headers never leave the relaying origin, and PostHog cookies are never set
// on it. The visitor's IP is forwarded explicitly because PostHog's cookieless
// mode hashes IP + user agent. `origin` is the relaying site's own origin;
// PostHog's flags service uses it as the site host.
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

/**
 * Forwards a relay request (its path starting with `/relay`) to PostHog. Used
 * by the application's API and the website's Cloudflare Worker, so both
 * origins forward the same headers and strip the same cookies. The caller
 * decides whether analytics is configured and supplies the visitor's IP from
 * the header its own edge trusts.
 */
export async function relayToPosthog(
  request: Request,
  ingestionHost: string,
  clientIp: string | undefined,
): Promise<Response> {
  const url = new URL(request.url);
  const target = relayTarget(
    url.pathname.slice(analyticsRelayPath.length),
    url.search,
    ingestionHost,
  );
  if (!target || !["GET", "HEAD", "POST"].includes(request.method))
    return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = clientIp?.trim();
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
