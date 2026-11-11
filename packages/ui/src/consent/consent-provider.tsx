"use client";

import { ConsentManagerProvider } from "@c15t/react/headless";
import { posthog } from "@c15t/scripts/posthog";
import { useState, type ReactNode } from "react";

import { ConsentBanner, ConsentDialog } from "@lictory/ui/consent/consent-ui";
import type { SharedConsent } from "@lictory/ui/consent/shared-consent";
import {
  analyticsConfigured,
  browserAnalyticsSettings,
  clearAnalyticsStorage,
  hasAnalyticsConsent,
  onMeasurementConsentGranted,
  onPostHogLoaded,
  recordAnalyticsConsent,
} from "@lictory/core/lib/analytics/client";
import {
  minimizeAnonymousAnalyticsProperties,
  sanitizeAnalyticsProperties,
} from "@lictory/core/lib/analytics/events";
import {
  analyticsRelayPath,
  posthogHosts,
} from "@lictory/core/lib/analytics/relay";

// Without analytics settings there is nothing to consent to: no banner, no
// consent storage and no PostHog. With them, PostHog loads through the
// first-party relay according to the consent mode (lib/analytics/consent):
// - Default ("cookieless"): PostHog always loads.
//   - Analytics consent granted: normal capture with PostHog's first-party
//     cookie, identified users and organization groups.
//   - Not decided or rejected: c15t keeps PostHog opted out and `on_reject`
//     switches it to cookieless capture. Only PostHog's opt-out flag
//     (`__ph_opt_in_out_<token>`) is stored on the device, events stay
//     anonymous (no identify, groups or tracing headers), and PostHog derives
//     a daily-rotating server-side hash from IP and user agent.
//     This requires "Cookieless server hash mode" in the PostHog project
//     settings; without it, PostHog discards these events.
//   Server-side events (posthog-node) are not governed by this browser choice.
// - Strict (ANALYTICS_CONSENT=strict): PostHog loads only after Analytics
//   consent, and server events are sent only for people who granted it.
// Withdrawing consent clears PostHog storage and c15t reloads the page.
// Shared consent (the public websites): one choice and one PostHog identity
// for a domain and its subdomains, so lictory.com and docs.lictory.com ask
// once and a consenting visitor is the same browser on both. c15t keeps the
// choice in a `.lictory.com` cookie under its own key, PostHog keeps its
// identity and its opt-in flag in `.lictory.com` cookies, and the cookie wins
// over each origin's localStorage. Off those hosts (development, the browser
// suite) the cookies are host-only. Installations never share consent.
// `site` is a super property on every event, so PostHog can tell the public
// websites apart in one project. Opting out in cookieless mode (every visit
// before a choice, and after rejecting) resets PostHog, which clears super
// properties, so `before_send` also adds it to each event.
function consentScripts(
  site: "marketing" | "docs" | undefined,
  shared: boolean,
) {
  const analytics = browserAnalyticsSettings();
  if (!analytics) return [];
  const strict = analytics.consent === "strict";
  return [
    posthog({
      id: analytics.projectToken,
      apiHost: analyticsRelayPath,
      uiHost: posthogHosts(analytics.host).ui,
      loadMode: strict ? "after-consent" : "always",
      initOptions: {
        defaults: "2026-01-30",
        ...(strict ? {} : { cookieless_mode: "on_reject" }),
        ...(shared
          ? {
              cross_subdomain_cookie: true,
              cookieWinsOnConflict: true,
              opt_out_capturing_persistence_type: "cookie",
            }
          : {}),
        capture_pageview: "history_change",
        autocapture: false,
        // Both record DOM elements and text, like autocapture.
        capture_dead_clicks: false,
        enable_heatmaps: false,
        disable_session_recording: true,
        capture_exceptions: false,
        person_profiles: "identified_only",
        mask_personal_data_properties: true,
        custom_personal_data_properties: [
          "token",
          "email",
          "q",
          "next",
          "invitationId",
        ],
        // Enabled after consent: they link server events to the browser session.
        tracing_headers: [],
        before_send: (
          event: { properties: Record<string, unknown> } | null,
        ) => {
          if (!event) return event;
          if (site) event.properties.site = site;
          sanitizeAnalyticsProperties(event.properties);
          if (!hasAnalyticsConsent()) {
            minimizeAnonymousAnalyticsProperties(event.properties);
          }
          return event;
        },
        loaded: (client: {
          register: (p: Record<string, unknown>) => void;
        }) => {
          if (site) client.register({ site });
          onPostHogLoaded(client);
        },
      },
    }),
  ];
}

// Where shared consent is stored. A new key, so a choice made per website
// before consent was shared is never stretched to cover the other one.
const sharedConsentKey = "lictory_consent";

/** `.domain` when the page is served from the domain or a subdomain of it. */
function sharedCookieDomain(domain: string) {
  const host = window.location.hostname;
  return host === domain || host.endsWith(`.${domain}`)
    ? `.${domain}`
    : undefined;
}

function hasCookie(name: string) {
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith(`${name}=`));
}

/**
 * Removes the per-website consent record kept before consent was shared, and
 * the PostHog state that belonged to it, so the visitor is asked once more,
 * for every website the shared choice covers.
 */
function removeUnsharedConsent() {
  try {
    if (localStorage.getItem("c15t") === null && !hasCookie("c15t")) return;
    localStorage.removeItem("c15t");
    document.cookie = "c15t=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    // Already chosen for every website on another one: PostHog's shared
    // cookies belong to that choice, so only this website's storage goes.
    if (hasCookie(sharedConsentKey)) {
      clearAnalyticsStorage({ cookies: false });
      return;
    }
    recordAnalyticsConsent(false);
    clearAnalyticsStorage();
  } catch {
    // Without storage there is no earlier choice to remove.
  }
}

function storageConfig(shared: SharedConsent | undefined) {
  if (!shared || typeof window === "undefined") return undefined;
  const domain = sharedCookieDomain(shared.domain);
  // Only the public hosts ever kept a per-website choice.
  if (domain) removeUnsharedConsent();
  return {
    storageKey: sharedConsentKey,
    ...(domain ? { defaultDomain: domain } : {}),
  };
}

export function ConsentProvider({
  children,
  privacyHref,
  site,
  sharedConsent,
}: {
  children: ReactNode;
  privacyHref?: string;
  site?: "marketing" | "docs";
  sharedConsent?: SharedConsent;
}) {
  // Storage first: it removes the per-website record before c15t reads it.
  const [storage] = useState(() => storageConfig(sharedConsent));
  const [scripts] = useState(() => consentScripts(site, !!sharedConsent));
  if (!analyticsConfigured()) return children;
  return (
    <ConsentManagerProvider
      options={{
        mode: "offline",
        consentCategories: ["necessary", "measurement"],
        scripts,
        storageConfig: storage,
        callbacks: {
          // Also runs at startup with the stored choice.
          onConsentSet: ({ preferences }) => {
            recordAnalyticsConsent(preferences.measurement === true);
          },
          onConsentChanged: ({ allowedCategories }) => {
            if (allowedCategories.includes("measurement")) {
              onMeasurementConsentGranted();
            }
          },
          onBeforeConsentRevocationReload: ({ preferences }) => {
            if (!preferences.measurement) {
              recordAnalyticsConsent(false);
              clearAnalyticsStorage();
            }
          },
        },
      }}
    >
      <ConsentBanner privacyHref={privacyHref} sites={sharedConsent?.sites} />
      <ConsentDialog sites={sharedConsent?.sites} />
      {children}
    </ConsentManagerProvider>
  );
}
