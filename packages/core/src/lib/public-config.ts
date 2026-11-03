// The platform's public runtime configuration: the few settings the browser
// application needs that differ per installation. Whoever serves the SPA
// document (the API's document handler, or the Cloudflare Worker in front of
// it) writes them into index.html, so one build runs on any domain and only
// the environment changes. Nothing here is secret: it is visible to every
// visitor, signed in or not.

export type PublicConfig = {
  /**
   * The operator's public website (SITE_URL): legal pages and the home link.
   * Null for an installation without one; the platform then links nowhere
   * outside itself.
   */
  siteUrl: string | null;
  /** Browser analytics, or null when analytics are not configured. */
  analytics: { projectToken: string; host: string } | null;
};

// Empty variables count as unset.
function setting(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Browser analytics settings from POSTHOG_PROJECT_TOKEN and POSTHOG_HOST. */
export function analyticsSettings(env: {
  readonly POSTHOG_PROJECT_TOKEN?: string;
  readonly POSTHOG_HOST?: string;
}): PublicConfig["analytics"] {
  const projectToken = setting(env.POSTHOG_PROJECT_TOKEN);
  const host = setting(env.POSTHOG_HOST);
  return projectToken && host ? { projectToken, host } : null;
}

const elementId = "lictory-config";

// A JSON data block, not a script: browsers never execute it, so no
// Content-Security-Policy has to allow it. `<` is escaped so a value can never
// close the element.
export function publicConfigTag(config: PublicConfig): string {
  const json = JSON.stringify(config)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  return `<script type="application/json" id="${elementId}">${json}</script>`;
}

function httpUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the configuration the document carries. A document without it (a
 * misconfigured host) gets safe defaults: no website and no analytics.
 */
export function readPublicConfig(
  document: Pick<Document, "getElementById">,
): PublicConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(document.getElementById(elementId)?.textContent ?? "null");
  } catch {
    raw = null;
  }
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const analytics = (
    value.analytics && typeof value.analytics === "object"
      ? value.analytics
      : {}
  ) as Record<string, unknown>;
  const projectToken =
    typeof analytics.projectToken === "string" ? analytics.projectToken : "";
  const host = httpUrl(analytics.host)
    ? String(analytics.host).replace(/\/+$/, "")
    : undefined;
  return {
    siteUrl: httpUrl(value.siteUrl)?.origin ?? null,
    analytics: projectToken && host ? { projectToken, host } : null,
  };
}
