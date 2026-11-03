// How browser and server analytics relate to the visitor's Analytics choice.
//
// - "cookieless" (default): PostHog loads before a choice, cookieless and
//   anonymous, and switches to full tracking after consent. Server events are
//   sent regardless of the browser choice.
// - "strict" (ANALYTICS_CONSENT=strict): nothing loads and no server event is
//   sent for a person until they grant Analytics consent in that browser.
//
// The browser mirrors a granted choice into a first-party cookie, which
// reaches the API with every request (including Zero mutations, which
// zero-cache forwards with their cookies). In strict mode the server sends an
// event only for requests that carry it; events without a request, such as
// background jobs, are not sent.

export type AnalyticsConsentMode = "strict" | "cookieless";

export function analyticsConsentMode(
  value: string | undefined,
): AnalyticsConsentMode {
  return value?.trim().toLowerCase() === "strict" ? "strict" : "cookieless";
}

export const ANALYTICS_CONSENT_COOKIE = "lictory_analytics_consent";

// The consent record itself is strictly necessary; it carries no identity.
const maxAgeSeconds = 365 * 24 * 60 * 60;

/** A `document.cookie` string recording (or clearing) Analytics consent. */
export function analyticsConsentCookie(granted: boolean, secure: boolean) {
  return [
    `${ANALYTICS_CONSENT_COOKIE}=${granted ? "1" : ""}`,
    "Path=/",
    `Max-Age=${granted ? maxAgeSeconds : 0}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Whether a `Cookie` header carries granted Analytics consent. */
export function hasAnalyticsConsentCookie(cookies: string | null | undefined) {
  return (cookies ?? "")
    .split(";")
    .some((cookie) => cookie.trim() === `${ANALYTICS_CONSENT_COOKIE}=1`);
}

/** Whether a server event may be sent for the request it describes. */
export function serverEventAllowed(
  mode: AnalyticsConsentMode,
  requestHeaders: Headers | undefined,
) {
  return (
    mode === "cookieless" ||
    hasAnalyticsConsentCookie(requestHeaders?.get("cookie"))
  );
}
