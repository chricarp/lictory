// The platform's public runtime configuration: the few settings the browser
// application needs that differ per installation. Whoever serves the SPA
// document (the API's document handler, or the Cloudflare Worker in front of
// it) writes them into index.html, so one build runs on any domain and only
// the environment changes. Nothing here is secret: it is visible to every
// visitor, signed in or not.
// Relative: the Cloudflare Worker and the Vite config bundle this file
// without the workspace path aliases.
import {
  analyticsConsentMode,
  type AnalyticsConsentMode,
} from "./analytics/consent";

export type PublicConfig = {
  /** Public website origin: the home link. */
  siteUrl: string;
  /**
   * The installation operator's own legal notices (LEGAL_TERMS_URL,
   * LEGAL_PRIVACY_URL), or null where none is configured. Lictory never
   * links to someone else's terms: without them the app shows no legal links.
   */
  legal: LegalLinks;
  /** Browser analytics, or null when analytics are not configured. */
  analytics: {
    projectToken: string;
    host: string;
    /** ANALYTICS_CONSENT; see lib/analytics/consent. */
    consent: AnalyticsConsentMode;
  } | null;
};

export type LegalLinks = {
  termsUrl: string | null;
  privacyUrl: string | null;
};

// Empty variables count as unset.
function setting(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The operator's legal notices from LEGAL_TERMS_URL and LEGAL_PRIVACY_URL.
 * Only absolute http(s) URLs count; anything else is treated as unset, so a
 * typo hides a link rather than pointing it somewhere unexpected.
 */
export function legalLinks(env: {
  readonly LEGAL_TERMS_URL?: string;
  readonly LEGAL_PRIVACY_URL?: string;
}): LegalLinks {
  return {
    termsUrl: httpUrl(setting(env.LEGAL_TERMS_URL))?.href ?? null,
    privacyUrl: httpUrl(setting(env.LEGAL_PRIVACY_URL))?.href ?? null,
  };
}

/**
 * Browser analytics settings from POSTHOG_PROJECT_TOKEN, POSTHOG_HOST and
 * ANALYTICS_CONSENT. Without a token and host, analytics are off.
 */
export function analyticsSettings(env: {
  readonly POSTHOG_PROJECT_TOKEN?: string;
  readonly POSTHOG_HOST?: string;
  readonly ANALYTICS_CONSENT?: string;
}): PublicConfig["analytics"] {
  const projectToken = setting(env.POSTHOG_PROJECT_TOKEN);
  const host = setting(env.POSTHOG_HOST);
  return projectToken && host
    ? {
        projectToken,
        host,
        consent: analyticsConsentMode(env.ANALYTICS_CONSENT),
      }
    : null;
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
 * Reads the configuration the document carries. A document without it (the
 * Vite development server, or a misconfigured host) gets safe defaults: the
 * page's own origin as the site, no legal links and no analytics.
 */
export function readPublicConfig(
  document: Pick<Document, "getElementById">,
  pageOrigin: string,
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
  const legal = (
    value.legal && typeof value.legal === "object" ? value.legal : {}
  ) as Record<string, unknown>;
  const projectToken =
    typeof analytics.projectToken === "string" ? analytics.projectToken : "";
  const host = httpUrl(analytics.host)
    ? String(analytics.host).replace(/\/+$/, "")
    : undefined;
  return {
    siteUrl: httpUrl(value.siteUrl)?.origin ?? pageOrigin,
    legal: {
      termsUrl: httpUrl(legal.termsUrl)?.href ?? null,
      privacyUrl: httpUrl(legal.privacyUrl)?.href ?? null,
    },
    analytics:
      projectToken && host
        ? {
            projectToken,
            host,
            consent: analyticsConsentMode(
              typeof analytics.consent === "string"
                ? analytics.consent
                : undefined,
            ),
          }
        : null,
  };
}
