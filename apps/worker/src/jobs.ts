import type { Database } from "@lictory/core/domain/service";
import {
  advanceSchedules,
  dispatchNotificationEmails,
  processAiRuns,
  processDataExports,
  processDeliveryPublications,
  processDueOrganizationDeletions,
  processNotificationEvents,
  recoverExpiredSessions,
  processCodeWork,
  reconcileCodeRepositories,
  refreshDeliveryStatuses,
} from "@lictory/core/jobs";
import type { Analyzer } from "@lictory/core/ai/analyzer";
import { processChatRuns } from "@lictory/core/intelligence/chat/runner";
import { runDispatcher } from "@lictory/core/claims/dispatcher";
import { pruneSlackEvents } from "@lictory/core/channels/slack/inbound";
import { slackChatProvider } from "@lictory/core/channels/slack/provider";
import { processAgentEventDeliveries } from "@lictory/core/agent-events/delivery";
import { purgeAgentEvents } from "@lictory/core/agent-events/feed";
import type { Job } from "@lictory/worker/supervisor";

export type WorkerConfig = ReturnType<typeof workerConfig>;

function milliseconds(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  minimum = 1,
) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  return value;
}

export function workerConfig(env: Record<string, string | undefined>) {
  const shutdownTimeoutMs = milliseconds(
    env,
    "WORKER_SHUTDOWN_TIMEOUT_MS",
    25_000,
  );
  return {
    aiIntervalMs: milliseconds(env, "WORKER_AI_INTERVAL_MS", 30_000),
    emailIntervalMs: milliseconds(env, "WORKER_EMAIL_INTERVAL_MS", 30_000),
    deliveryIntervalMs: milliseconds(
      env,
      "WORKER_DELIVERY_INTERVAL_MS",
      30_000,
    ),
    deliveryRefreshIntervalMs: milliseconds(
      env,
      "WORKER_DELIVERY_REFRESH_INTERVAL_MS",
      10 * 60_000,
    ),
    deliveryRefreshLimit: milliseconds(
      env,
      "WORKER_DELIVERY_REFRESH_LIMIT",
      200,
    ),
    schedulesIntervalMs: milliseconds(
      env,
      "WORKER_SCHEDULES_INTERVAL_MS",
      5 * 60_000,
    ),
    factoryIntervalMs: milliseconds(env, "WORKER_FACTORY_INTERVAL_MS", 60_000),
    shutdownTimeoutMs,
    // External calls in flight are cancelled with this much budget left, so
    // interrupted work can still be handed back before the process exits.
    cancelAfterMs: Math.max(0, shutdownTimeoutMs - 5_000),
    stuckMs: milliseconds(env, "WORKER_STUCK_MS", 30 * 60_000),
    healthPort: milliseconds(env, "WORKER_HEALTH_PORT", 3003, 0),
    healthHost: env.WORKER_HEALTH_HOST?.trim()
      ? env.WORKER_HEALTH_HOST.trim()
      : "127.0.0.1",
    poolMax: milliseconds(env, "WORKER_DB_POOL_MAX", 4),
  };
}

// Notification events are woken by their signal; polling only picks up
// retries and signals lost while the connection was down.
const NOTIFICATION_INTERVAL_MS = 30_000;
const NOTIFICATION_BATCH = 50;
const EMAIL_BATCH = 20;
const DELIVERY_BATCH = 10;
// Exports are rare and woken by their signal; polling only recovers leases.
const EXPORT_INTERVAL_MS = 60_000;
// Deletions fall due after a grace period of days; a few minutes' delay
// does not matter.
const DELETION_INTERVAL_MS = 5 * 60_000;
// Agent event webhooks are woken by their signal; polling picks up retries
// (30 seconds and up) and expiring MCP subscriptions.
const AGENT_EVENT_INTERVAL_MS = 30_000;
const AGENT_EVENT_BATCH = 20;
const AGENT_EVENT_PURGE_MS = 60 * 60_000;
// Leases last 90 seconds; checking twice a minute bounds the delay.
const FACTORY_LEASE_INTERVAL_MS = 30_000;
const FACTORY_LEASE_BATCH = 20;
// Code host webhooks and writes are woken by their signal; polling picks up
// retries. Reconciliation runs often but only reads repositories that are
// due (every ten minutes each, at once after a link).
const CODE_INTERVAL_MS = 15_000;
const CODE_RECONCILE_INTERVAL_MS = 60_000;
// Slack: woken by stored events and queued messages; polling picks up
// retries whose backoff or Retry-After has passed.
const SLACK_INTERVAL_MS = 15_000;
const SLACK_BATCH = 25;
const SLACK_PRUNE_INTERVAL_MS = 60 * 60_000;

export function workerJobs(
  db: Database,
  config: WorkerConfig,
  options: {
    analyzer?: Analyzer;
    /**
     * Resolves once the AI provider settings are loaded. The AI and chat jobs
     * claim nothing before it does: a run claimed without its provider would
     * fail. A rejection fails the run, so the job backs off and tries again.
     */
    aiSettings?: () => Promise<void>;
  } = {},
): Job[] {
  let purgedAt = 0;
  return [
    ...Array.from({ length: 4 }, (_, index): Job => ({
      name: `chat-${index + 1}`,
      kind: "chat",
      intervalMs: 5_000,
      async run({ cancel }) {
        await options.aiSettings?.();
        const counts = await processChatRuns(db, { signal: cancel });
        return { more: counts.claimed > 0 && !cancel.aborted, counts };
      },
    })),
    {
      name: "ai",
      kind: "ai",
      intervalMs: config.aiIntervalMs,
      // One run at a time: model calls are long, and the loop keeps going
      // while runs are queued.
      async run({ cancel }) {
        await options.aiSettings?.();
        const r = await processAiRuns(db, {
          analyzer: options.analyzer,
          limit: 1,
          signal: cancel,
        });
        return {
          more: r.completed + r.failed + r.superseded > 0 && !r.interrupted,
          counts: r,
        };
      },
    },
    {
      name: "notification",
      kind: "notification",
      intervalMs: NOTIFICATION_INTERVAL_MS,
      // Database work only: a batch commits or rolls back as a whole.
      async run() {
        const { claimed, ...counts } = await processNotificationEvents(db, {
          limit: NOTIFICATION_BATCH,
        });
        return { more: claimed === NOTIFICATION_BATCH, counts };
      },
    },
    {
      name: "email",
      kind: "email",
      intervalMs: config.emailIntervalMs,
      async run({ stopping }) {
        const { claimed, ...counts } = await dispatchNotificationEmails(db, {
          limit: EMAIL_BATCH,
          signal: stopping,
        });
        return { more: claimed === EMAIL_BATCH, counts };
      },
    },
    {
      name: "delivery",
      kind: "delivery",
      intervalMs: config.deliveryIntervalMs,
      async run({ stopping }) {
        const { more, publications } = await processDeliveryPublications(db, {
          limit: DELIVERY_BATCH,
          signal: stopping,
        });
        return { more: more && !stopping.aborted, counts: { publications } };
      },
    },
    {
      name: "export",
      kind: "export",
      intervalMs: EXPORT_INTERVAL_MS,
      // A large organization's export can take a while; it renews its lease.
      stuckMs: 6 * 60 * 60_000,
      // One export at a time; a long export renews its lease as it goes.
      async run({ stopping }) {
        const { claimed, ...counts } = await processDataExports(db, {
          signal: stopping,
        });
        return { more: claimed > 0 && !stopping.aborted, counts };
      },
    },
    {
      name: "organization-deletion",
      intervalMs: DELETION_INTERVAL_MS,
      // One large organization's deletion is one long transaction.
      stuckMs: 6 * 60 * 60_000,
      async run({ stopping }) {
        const { claimed, ...counts } = await processDueOrganizationDeletions(
          db,
          { signal: stopping },
        );
        return { more: claimed > 0 && !stopping.aborted, counts };
      },
    },
    {
      name: "code",
      kind: "code",
      intervalMs: CODE_INTERVAL_MS,
      async run({ stopping }) {
        const { more, webhooks, writes } = await processCodeWork(db, {
          signal: stopping,
        });
        return {
          more: more && !stopping.aborted,
          counts: {
            webhooks: webhooks.processed,
            webhookFailures: webhooks.failed,
            writes: writes.succeeded,
            writeFailures: writes.failed,
          },
        };
      },
    },
    {
      name: "code-reconcile",
      // A reconciliation is woken with the code signal too, so a newly
      // linked repository is backfilled right away.
      kind: "code",
      intervalMs: CODE_RECONCILE_INTERVAL_MS,
      async run({ stopping }) {
        const counts = await reconcileCodeRepositories(db, {
          signal: stopping,
        });
        return { more: counts.due === 5 && !stopping.aborted, counts };
      },
    },
    {
      name: "delivery-status",
      intervalMs: config.deliveryRefreshIntervalMs,
      async run() {
        return {
          counts: await refreshDeliveryStatuses(
            db,
            config.deliveryRefreshLimit,
          ),
        };
      },
    },
    {
      // The factory dispatcher (docs/internals/claims.md): expires claims,
      // completes work by its Definition of Done and starts claimable work
      // in Build and Autopilot projects. Woken by policy and claim changes.
      name: "factory",
      kind: "factory",
      intervalMs: config.factoryIntervalMs,
      async run({ stopping }) {
        const { failedOrganizations, ...counts } = await runDispatcher(db, {
          signal: stopping,
        });
        if (failedOrganizations)
          throw Object.assign(
            new Error(
              `${failedOrganizations} organizations could not be dispatched.`,
            ),
            { name: "DispatchError" },
          );
        return { counts };
      },
    },
    {
      // Agent event deliveries to webhooks and MCP Events subscriptions
      // (docs/internals/agent-events.md), and the feed's retention.
      name: "agent-events",
      kind: "agent-events",
      intervalMs: AGENT_EVENT_INTERVAL_MS,
      async run({ stopping }) {
        const counts = await processAgentEventDeliveries(db, {
          limit: AGENT_EVENT_BATCH,
          signal: stopping,
        });
        let purged = 0;
        if (Date.now() - purgedAt > AGENT_EVENT_PURGE_MS) {
          purged = await purgeAgentEvents(db);
          purgedAt = Date.now();
        }
        return {
          more: counts.claimed === AGENT_EVENT_BATCH && !stopping.aborted,
          counts: { ...counts, purged },
        };
      },
    },
    {
      // Agent sessions whose runner stopped renewing its lease return to the
      // queue or fail after their attempts (claims also recover them).
      name: "factory-leases",
      intervalMs: FACTORY_LEASE_INTERVAL_MS,
      async run() {
        const counts = await recoverExpiredSessions(db, {
          limit: FACTORY_LEASE_BATCH,
        });
        return {
          more: counts.requeued + counts.failed === FACTORY_LEASE_BATCH,
          counts,
        };
      },
    },
    {
      // Slack sync (docs/internals/channels.md#slack): stored Events API
      // deliveries in, queued Lictory messages out, then bounded imports.
      name: "slack",
      kind: "slack",
      intervalMs: SLACK_INTERVAL_MS,
      async run({ stopping }) {
        const inbound = await slackChatProvider.processInbound(db, {
          limit: SLACK_BATCH,
          signal: stopping,
        });
        const outbound = await slackChatProvider.processOutbound(db, {
          limit: SLACK_BATCH,
          signal: stopping,
        });
        return {
          more:
            (inbound.claimed === SLACK_BATCH ||
              outbound.claimed === SLACK_BATCH) &&
            !stopping.aborted,
          counts: {
            events: inbound.processed ?? 0,
            eventRetries: inbound.retried ?? 0,
            eventFailures: inbound.failed ?? 0,
            imported: inbound.imported ?? 0,
            sent: outbound.sent ?? 0,
            sendRetries: outbound.retried ?? 0,
            sendFailures: outbound.failed ?? 0,
          },
        };
      },
    },
    {
      name: "slack-prune",
      intervalMs: SLACK_PRUNE_INTERVAL_MS,
      async run() {
        return { counts: { removed: await pruneSlackEvents(db) } };
      },
    },
    {
      name: "schedules",
      intervalMs: config.schedulesIntervalMs,
      async run() {
        const { changedOrganizations, failedOrganizations } =
          await advanceSchedules(db);
        if (failedOrganizations)
          throw Object.assign(
            new Error(
              `${failedOrganizations} organization schedules could not be advanced.`,
            ),
            { name: "ScheduleError" },
          );
        return { counts: { changedOrganizations } };
      },
    },
  ];
}
