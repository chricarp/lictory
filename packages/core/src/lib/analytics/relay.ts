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
