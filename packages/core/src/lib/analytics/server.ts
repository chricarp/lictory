import { PostHog } from "posthog-node";
import type { AnalyticsProperties } from "@lictory/core/lib/analytics/events";
import { publicationProperties } from "@lictory/core/lib/analytics/publication";
import { analyticsEventId } from "@lictory/core/lib/analytics/identity";
import {
  analyticsConsentMode,
  serverEventAllowed,
} from "@lictory/core/lib/analytics/consent";
import { posthogServerConfig } from "@lictory/core/lib/analytics/config";

// Server events use POSTHOG_PROJECT_TOKEN/POSTHOG_HOST only.
const configuration = () => posthogServerConfig();

let client: PostHog | undefined;
function getClient() {
  const config = configuration();
  if (!config) return;
  const { token, host } = config;
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
  if (!configuration()) return;
  // ANALYTICS_CONSENT=strict: only for people who granted Analytics consent.
  if (
    !serverEventAllowed(
      analyticsConsentMode(process.env.ANALYTICS_CONSENT),
      requestHeaders,
    )
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
  // Fire and forget: delivery never delays or fails the action it describes.
  // Pending deliveries are awaited on shutdown by `flushAnalytics`.
  const delivery = (async () => {
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
  })();
  pending.add(delivery);
  void delivery.finally(() => pending.delete(delivery));
}

const pending = new Set<Promise<void>>();

// Waits for in-flight events (bounded) and shuts the client down. Hosts call
// it on graceful shutdown.
export async function flushAnalytics(timeoutMs = 5000) {
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
  ]);
  await client?.shutdown(timeoutMs).catch(() => undefined);
  client = undefined;
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
