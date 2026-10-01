"use client";

import type { AnalyticsProperties } from "./events";

export const analyticsConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
  process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

// The PostHog SDK is loaded by the consent provider only after measurement
// consent. Until then (and after withdrawal, which reloads the page) the global
// is absent or a queue stub, and these helpers do nothing.
type PostHogClient = {
  __loaded?: boolean;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  captureException: (
    error: Error,
    properties?: Record<string, unknown>,
  ) => void;
  identify: (distinctId: string) => void;
  group: (type: string, key: string) => void;
  register: (properties: Record<string, unknown>) => void;
  unregister: (property: string) => void;
  resetGroups: () => void;
  reset: () => void;
};

function loadedPostHog(): PostHogClient | null {
  if (!analyticsConfigured || typeof window === "undefined") return null;
  const client = (window as unknown as { posthog?: PostHogClient }).posthog;
  return client?.__loaded ? client : null;
}

// Who is signed in and which workspace is open. This is current app state, not
// collected analytics: it is applied when PostHog loads after consent so later
// events are attributed correctly. No events are buffered before consent.
const context: { userId: string | null; organizationId: string | null } = {
  userId: null,
  organizationId: null,
};

function applyContext(client: PostHogClient) {
  if (context.userId) client.identify(context.userId);
  if (context.organizationId) {
    client.group("organization", context.organizationId);
    client.register({ organization_id: context.organizationId });
  }
}

/** PostHog `loaded` init callback, passed through the consent script config. */
export function onPostHogLoaded(client: unknown) {
  try {
    applyContext(client as PostHogClient);
  } catch {
    // Analytics must never interrupt collaboration.
  }
}

export function track(event: string, properties: AnalyticsProperties = {}) {
  try {
    loadedPostHog()?.capture(event, {
      ...properties,
      analytics_version: 1,
      source: "client",
    });
  } catch {
    // Analytics must never interrupt collaboration.
  }
}

export function trackRenderFailure(digest: string | undefined) {
  try {
    loadedPostHog()?.captureException(new Error("Application render failed"), {
      digest,
    });
  } catch {
    // The error boundary must render even when analytics fails.
  }
}

export function identifyUser(userId: string) {
  context.userId = userId;
  try {
    loadedPostHog()?.identify(userId);
  } catch {
    // Authentication remains usable when analytics is unavailable.
  }
}

export function setAnalyticsOrganization(organizationId: string) {
  context.organizationId = organizationId;
  try {
    const client = loadedPostHog();
    client?.group("organization", organizationId);
    client?.register({ organization_id: organizationId });
  } catch {
    // Analytics must not prevent opening a workspace.
  }
}

export function clearAnalyticsOrganization() {
  context.organizationId = null;
  try {
    const client = loadedPostHog();
    client?.unregister("organization_id");
    client?.resetGroups();
  } catch {
    // Workspace navigation must not depend on analytics.
  }
}

/**
 * Removes PostHog's first-party identifiers after measurement consent is
 * withdrawn. c15t reloads the page next, so the SDK is not loaded again.
 */
export function clearAnalyticsStorage() {
  const isPostHogKey = (key: string) =>
    key.startsWith("ph_") || key.startsWith("__ph_");
  try {
    for (const key of Object.keys(localStorage)) {
      if (isPostHogKey(key)) localStorage.removeItem(key);
    }
    for (const key of Object.keys(sessionStorage)) {
      if (isPostHogKey(key)) sessionStorage.removeItem(key);
    }
    // PostHog may scope its cookie to a parent domain; expire every candidate.
    const labels = location.hostname.split(".");
    const domains = [""];
    for (let i = 0; i < labels.length - 1; i++) {
      domains.push(`; domain=.${labels.slice(i).join(".")}`);
    }
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (!name || !isPostHogKey(name)) continue;
      for (const domain of domains) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
      }
    }
  } catch {
    // Storage may be unavailable; the SDK still will not load without consent.
  }
}

export function resetAnalytics() {
  context.userId = null;
  context.organizationId = null;
  try {
    loadedPostHog()?.reset();
  } catch {
    // Signing out must not depend on analytics.
  }
}
