"use client";

import { ConsentManagerProvider } from "@c15t/react/headless";
import { posthog } from "@c15t/scripts/posthog";
import { useState, type ReactNode } from "react";

import { ConsentBanner, ConsentDialog } from "@lictory/ui/consent/consent-ui";
import {
  browserAnalyticsSettings,
  clearAnalyticsStorage,
  hasAnalyticsConsent,
  onMeasurementConsentGranted,
  onPostHogLoaded,
} from "@lictory/core/lib/analytics/client";
import {
  minimizeAnonymousAnalyticsProperties,
  sanitizeAnalyticsProperties,
} from "@lictory/core/lib/analytics/events";
import {
  analyticsRelayPath,
  posthogHosts,
} from "@lictory/core/lib/analytics/relay";

// PostHog always loads, through the first-party relay, in one of two modes:
// - Analytics consent granted: normal capture with PostHog's first-party cookie,
//   identified users and organization groups.
// - Not decided or rejected: c15t keeps PostHog opted out and `on_reject` switches
//   it to cookieless capture. Nothing is stored on the device, events stay
//   anonymous (no identify, groups or tracing headers), and PostHog derives a
//   daily-rotating server-side hash from IP and user agent. This requires
//   "Cookieless server hash mode" in the PostHog project settings; without it,
//   PostHog discards these events.
// Withdrawing consent clears PostHog storage and c15t reloads the page, which
// starts again in cookieless mode. Server-side events (posthog-node) are not
// governed by this browser choice.
function consentScripts() {
  const analytics = browserAnalyticsSettings();
  if (!analytics) return [];
  return [
    posthog({
      id: analytics.projectToken,
      apiHost: analyticsRelayPath,
      uiHost: posthogHosts(analytics.host).ui,
      loadMode: "always",
      initOptions: {
        defaults: "2026-01-30",
        cookieless_mode: "on_reject",
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
          sanitizeAnalyticsProperties(event.properties);
          if (!hasAnalyticsConsent()) {
            minimizeAnonymousAnalyticsProperties(event.properties);
          }
          return event;
        },
        loaded: onPostHogLoaded,
      },
    }),
  ];
}

export function ConsentProvider({
  children,
  privacyHref,
}: {
  children: ReactNode;
  privacyHref?: string | null;
}) {
  const [scripts] = useState(consentScripts);
  return (
    <ConsentManagerProvider
      options={{
        mode: "offline",
        consentCategories: ["necessary", "measurement"],
        scripts,
        callbacks: {
          onConsentChanged: ({ allowedCategories }) => {
            if (allowedCategories.includes("measurement")) {
              onMeasurementConsentGranted();
            }
          },
          onBeforeConsentRevocationReload: ({ preferences }) => {
            if (!preferences.measurement) clearAnalyticsStorage();
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
