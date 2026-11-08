// First: stops with every configuration problem before other modules load.
import "@lictory/worker/configuration";

import { createJobDatabase, listenForWork } from "@lictory/core/jobs";
import {
  refreshAiState,
  watchAiSettings,
} from "@lictory/core/domain/ai-settings";
import { flushAnalytics } from "@lictory/core/lib/analytics/server";
import { mailTransportSummary } from "@lictory/core/lib/mailer";
import { flushPosthogLogs } from "@lictory/core/lib/posthog-logs";
import { startHealthServer } from "@lictory/worker/health";
import { workerConfig, workerJobs } from "@lictory/worker/jobs";
import { describeError, jsonLog as log } from "@lictory/worker/log";
import { createSupervisor } from "@lictory/worker/supervisor";

// The Lictory worker: AI runs, notification email, delivery exports and
// status sync, and automatic cycles. Work is durable in PostgreSQL; the
// worker is woken by `lictory_work` signals and also polls, so it can be
// restarted, run in several copies, or killed at any point. Claimed work is
// protected by leases and resumed by the next worker after they expire.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
// LISTEN needs a session: a direct connection, never a transaction pooler.
const listenUrl = process.env.DATABASE_URL_UNPOOLED?.trim()
  ? process.env.DATABASE_URL_UNPOOLED.trim()
  : databaseUrl;
const config = workerConfig(process.env);
// Partial mail settings stop the worker (configuration rules); without any
// transport it starts and email jobs fail with the settings to add.
const mail = mailTransportSummary();

const database = createJobDatabase(databaseUrl, { max: config.poolMax });
// AI provider settings stored from the admin console. The AI and chat jobs
// wait for the first successful load, including runs a work signal starts
// before startup reaches it; a failed load is retried by the next run.
let aiSettingsLoaded: Promise<void> | undefined;
const aiSettings = () =>
  (aiSettingsLoaded ??= refreshAiState(database.db).then(
    () => undefined,
    (error: unknown) => {
      aiSettingsLoaded = undefined;
      throw error;
    },
  ));
const supervisor = createSupervisor(
  workerJobs(database.db, config, { aiSettings }),
  {
    log,
    stuckMs: config.stuckMs,
  },
);
const listener = listenForWork(listenUrl, {
  onSignal: (kind) => supervisor.signal(kind),
  onListening: (reconnected) => {
    log("info", "worker.listening", { reconnected });
    // Signals sent while the connection was down are gone.
    if (reconnected) supervisor.wakeAll();
  },
  onLost: (error) =>
    log("warn", "worker.listen_lost", { ...describeError(error) }),
});
const health = startHealthServer(
  supervisor,
  () => listener.listening(),
  { port: config.healthPort, host: config.healthHost },
  (port) => log("info", "worker.health", { port, host: config.healthHost }),
);

log("info", "worker.started", {
  pid: process.pid,
  intervals: {
    ai: config.aiIntervalMs,
    email: config.emailIntervalMs,
    delivery: config.deliveryIntervalMs,
    deliveryStatus: config.deliveryRefreshIntervalMs,
    schedules: config.schedulesIntervalMs,
  },
  shutdownTimeoutMs: config.shutdownTimeoutMs,
  mail,
});
// Kept current while the worker runs, so a change applies to the next run
// without a restart.
await aiSettings().catch((error: unknown) =>
  log("warn", "worker.ai_settings_load_failed", { ...describeError(error) }),
);
watchAiSettings(database.db, {
  log: (event, detail) => log("info", event, detail as Record<string, unknown>),
});
supervisor.start();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  const started = Date.now();
  log("info", "worker.stopping", {
    signal,
    running: supervisor
      .status()
      .filter((j) => j.running)
      .map((j) => j.name),
  });
  await listener.close();
  const finished = await supervisor.stop({
    timeoutMs: config.shutdownTimeoutMs,
    cancelAfterMs: config.cancelAfterMs,
  });
  if (!finished)
    log("warn", "worker.shutdown_timeout", {
      running: supervisor
        .status()
        .filter((j) => j.running)
        .map((j) => j.name),
      // Their leases expire and another worker resumes them.
    });
  health.closeAllConnections();
  await new Promise<void>((resolve) => health.close(() => resolve()));
  await Promise.allSettled([flushAnalytics(2_000), flushPosthogLogs()]);
  await database.close(finished ? 5 : 1).catch(() => undefined);
  log("info", "worker.stopped", {
    signal,
    durationMs: Date.now() - started,
    clean: finished,
  });
  process.exit(finished ? 0 : 1);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// Anything unexpected ends the process; the supervisor (Docker) restarts it
// and leases make the restart safe.
process.on("unhandledRejection", (error) => {
  log("error", "worker.crashed", { ...describeError(error) });
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  log("error", "worker.crashed", { ...describeError(error) });
  process.exit(1);
});
