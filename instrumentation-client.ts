import posthog from "posthog-js";
import { sanitizeAnalyticsProperties } from "./src/lib/analytics/events";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
if (projectToken && host) {
  try {
    posthog.init(projectToken, {
      api_host: host,
      defaults: "2026-01-30",
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
      tracing_headers: [window.location.hostname],
      before_send: (event) => {
        if (!event) return event;
        sanitizeAnalyticsProperties(event.properties);
        return event;
      },
    });
  } catch {
    // Analytics cannot prevent hydration or navigation.
  }
}
