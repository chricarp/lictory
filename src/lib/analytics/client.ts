"use client";

import posthog from "posthog-js";
import type { AnalyticsProperties } from "./events";

export const analyticsConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
  process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export function track(event: string, properties: AnalyticsProperties = {}) {
  if (!analyticsConfigured) return;
  try {
    posthog.capture(event, {
      ...properties,
      analytics_version: 1,
      source: "client",
    });
  } catch {
    // Analytics must never interrupt collaboration.
  }
}

export function identifyUser(userId: string) {
  if (!analyticsConfigured) return;
  try {
    posthog.identify(userId);
  } catch {
    // Authentication remains usable when analytics is unavailable.
  }
}

export function resetAnalytics() {
  if (!analyticsConfigured) return;
  try {
    posthog.reset();
  } catch {
    // Signing out must not depend on analytics.
  }
}
