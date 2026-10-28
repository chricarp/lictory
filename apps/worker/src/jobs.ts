import type { Database } from "@lictory/core/domain/service";
import {
  advanceSchedules,
  dispatchNotificationEmails,
  processAiRuns,
  processDeliveryPublications,
  refreshDeliveryStatuses,
} from "@lictory/core/jobs";
import type { Analyzer } from "@lictory/core/ai/analyzer";
import { processChatRuns } from "@lictory/core/intelligence/chat/runner";
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

const EMAIL_BATCH = 20;
const DELIVERY_BATCH = 10;

export function workerJobs(
  db: Database,
  config: WorkerConfig,
  options: { analyzer?: Analyzer } = {},
): Job[] {
  return [
    ...Array.from({ length: 4 }, (_, index): Job => ({
      name: `chat-${index + 1}`,
      kind: "chat",
      intervalMs: 5_000,
      async run({ cancel }) {
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
