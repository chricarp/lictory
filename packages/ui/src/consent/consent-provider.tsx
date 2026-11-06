"use client";

import { ConsentManagerProvider } from "@c15t/react/headless";
import { posthog } from "@c15t/scripts/posthog";
import { useState, type ReactNode } from "react";

import { ConsentBanner, ConsentDialog } from "@lictory/ui/consent/consent-ui";
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
//     switches it to cookieless capture. Nothing is stored on the device,
//     events stay anonymous (no identify, groups or tracing headers), and
//     PostHog derives a daily-rotating server-side hash from IP and user agent.
//     This requires "Cookieless server hash mode" in the PostHog project
//     settings; without it, PostHog discards these events.
//   Server-side events (posthog-node) are not governed by this browser choice.
// - Strict (ANALYTICS_CONSENT=strict): PostHog loads only after Analytics
//   consent, and server events are sent only for people who granted it.
// Withdrawing consent clears PostHog storage and c15t reloads the page.
// `site` is a super property on every event, so PostHog can tell the public
// websites apart in one project. Opting out in cookieless mode (every visit
// before a choice, and after rejecting) resets PostHog, which clears super
// properties, so `before_send` also adds it to each event.
function consentScripts(site: "marketing" | "docs" | undefined) {
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

export function ConsentProvider({
  children,
  privacyHref,
  site,
}: {
  children: ReactNode;
  privacyHref?: string;
  site?: "marketing" | "docs";
}) {
  const [scripts] = useState(() => consentScripts(site));
  if (!analyticsConfigured()) return children;
  return (
    <ConsentManagerProvider
      options={{
        mode: "offline",
        consentCategories: ["necessary", "measurement"],
        scripts,
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
      <ConsentBanner privacyHref={privacyHref} />
      <ConsentDialog />
      {children}
    </ConsentManagerProvider>
  );
}
