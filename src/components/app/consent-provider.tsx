"use client";

import {
  ConsentBanner,
  ConsentDialog,
  ConsentManagerProvider,
  type Theme,
} from "@c15t/nextjs";
import { posthog } from "@c15t/scripts/posthog";
import { useState, type ReactNode } from "react";

import { clearAnalyticsStorage, onPostHogLoaded } from "~/lib/analytics/client";
import { sanitizeAnalyticsProperties } from "~/lib/analytics/events";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

// PostHog is requested only after measurement consent. Rejecting or withdrawing
// consent opts out and c15t reloads the page, so the SDK is gone afterwards.
// Server-side events (posthog-node) are not governed by this browser consent.
function consentScripts() {
  if (!posthogToken || !posthogHost) return [];
  return [
    posthog({
      id: posthogToken,
      apiHost: posthogHost,
      loadMode: "after-consent",
      initOptions: {
        defaults: "2026-01-30",
        // Opting out must stop capture, not switch to cookieless capture.
        cookieless_mode: undefined,
        capture_pageview: "history_change",
        autocapture: false,
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
        tracing_headers:
          typeof window === "undefined" ? [] : [window.location.hostname],
        before_send: (
          event: { properties: Record<string, unknown> } | null,
        ) => {
          if (event) sanitizeAnalyticsProperties(event.properties);
          return event;
        },
        loaded: onPostHogLoaded,
      },
    }),
  ];
}

// The app swaps these variables under `.dark`, so one token set covers both.
const theme: Theme = {
  colors: {
    primary: "var(--primary)",
    primaryHover: "var(--primary)",
    surface: "var(--popover)",
    surfaceHover: "var(--muted)",
    border: "var(--border)",
    borderHover: "var(--input)",
    text: "var(--popover-foreground)",
    textMuted: "var(--muted-foreground)",
    textOnPrimary: "var(--primary-foreground)",
    switchTrack: "var(--input)",
    switchTrackActive: "var(--primary)",
    switchThumb: "var(--background)",
  },
  typography: { fontFamily: "var(--font-sans)" },
};

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [scripts] = useState(consentScripts);
  return (
    <ConsentManagerProvider
      options={{
        mode: "offline",
        consentCategories: ["necessary", "measurement"],
        scripts,
        callbacks: {
          onBeforeConsentRevocationReload: ({ preferences }) => {
            if (!preferences.measurement) clearAnalyticsStorage();
          },
        },
        theme,
      }}
    >
      <ConsentBanner />
      <ConsentDialog />
      {children}
    </ConsentManagerProvider>
  );
}
