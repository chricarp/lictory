import "server-only";

import { after } from "next/server";
import { PostHog } from "posthog-node";
import type { AnalyticsProperties } from "./events";
import { publicationProperties } from "./publication";
import { analyticsEventId } from "./identity";

let client: PostHog | undefined;
function getClient() {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!token || !host) return;
  client ??= new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 5000,
    disableGeoip: true,
  });
  return client;
}

export function trackServer(
  userId: string,
  event: string,
  properties: AnalyticsProperties = {},
  requestHeaders?: Headers,
  deduplicationKey?: string,
) {
  if (
    !process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
    !process.env.NEXT_PUBLIC_POSTHOG_HOST
  )
    return;
  // Headers correlate sessions only. Authenticated identity always comes from Better Auth.
  const sessionId = requestHeaders?.get("X-POSTHOG-SESSION-ID");
  const validSessionId =
    sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : undefined;
  const timestamp = new Date();
  const uuid = deduplicationKey
    ? analyticsEventId(userId, event, deduplicationKey)
    : undefined;
  try {
    after(async () => {
      try {
        const sdk = getClient();
        if (!sdk) return;
        await sdk.captureImmediate({
          distinctId: userId,
          event,
          timestamp,
          uuid,
          groups:
            typeof properties.organization_id === "string"
              ? { organization: properties.organization_id }
              : undefined,
          properties: {
            ...properties,
            analytics_version: 1,
            source: "server",
            ...(validSessionId ? { $session_id: validSessionId } : {}),
            ...(uuid ? { $insert_id: uuid } : {}),
          },
        });
      } catch {
        console.warn("PostHog event delivery failed.");
      }
    });
  } catch {
    // A missing request lifecycle or SDK failure must not fail an already committed action.
    console.warn("PostHog event scheduling failed.");
  }
}

export function trackServerFailure(
  userId: string,
  operation: string,
  error: unknown,
  headers?: Headers,
) {
  // Raw exceptions can contain SQL values, credentials and document contents.
  const category =
    error && typeof error === "object" && "category" in error
      ? String(error.category)
      : "server";
  trackServer(
    userId,
    "action_failed",
    { operation, error_category: category },
    headers,
  );
}

export function trackPublicationCompleted(
  publication: {
    id: string;
    organizationId: string;
    requestedById: string;
    status: string;
    results: Record<string, { outcome: string }>;
  },
  headers?: Headers,
) {
  trackServer(
    publication.requestedById,
    "delivery_publish_completed",
    {
      ...publicationProperties(publication),
      organization_id: publication.organizationId,
      provider: "jira",
    },
    headers,
    publication.id,
  );
}
