// First: stops with every configuration problem before other modules load.
import "@lictory/api/configuration";

import { serve } from "@hono/node-server";
import { closeDatabase, db } from "@lictory/core/db";
import { refreshAiAvailability } from "@lictory/core/domain/ai";
import { realtime } from "@lictory/core/domain/realtime";
import { flushAnalytics } from "@lictory/core/lib/analytics/server";
import { env, envInteger } from "@lictory/core/lib/env";
import { mailTransportSummary } from "@lictory/core/lib/mailer";
import { storageConfiguration } from "@lictory/core/storage";
import { createApp } from "@lictory/api/app";
import { closeEventStreams } from "@lictory/api/routes/events";

// The Lictory API on Node: Better Auth, capabilities, MCP, Zero's query and
// mutate endpoints, event streams and the SPA document. Background work runs
// in the worker, never here.

const port = envInteger("PORT") ?? 3002;
const hostname = env("HOST") ?? "0.0.0.0";
const DRAIN_MS = envInteger("SHUTDOWN_TIMEOUT_MS") ?? 25_000;
// Partial mail settings stop the API (configuration rules); without any
// transport it starts with email disabled and a startup warning.
const mail = mailTransportSummary();

// File storage is optional: without it attachments are disabled. A partial or
// malformed configuration stops the API with the variables to fix.
try {
  const files = storageConfiguration();
  console.info(
    JSON.stringify(
      files
        ? {
            event: "api.storage",
            preset: files.preset,
            endpoint: files.endpoint ?? `aws:${files.region}`,
            bucket: files.bucket,
          }
        : {
            event: "api.storage",
            attachments: "disabled",
            reason: "No S3_* or R2_* storage settings.",
          },
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "api.storage_invalid",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
}

let draining = false;
let inflight = 0;
const app = createApp({ draining: () => draining });

const server = serve(
  {
    fetch: async (request, env) => {
      inflight++;
      try {
        return await app.fetch(request, env);
      } finally {
        inflight--;
      }
    },
    port,
    hostname,
  },
  (info) =>
    console.info(
      JSON.stringify({
        event: "api.listening",
        port: info.port,
        hostname,
        mail,
      }),
    ),
);

// Organizations still showing the AI provider state from before this start.
void refreshAiAvailability(db).then(
  (refreshed) =>
    refreshed &&
    console.info(
      JSON.stringify({ event: "api.ai_availability_refreshed", refreshed }),
    ),
  (error: unknown) =>
    console.warn(
      JSON.stringify({
        event: "api.ai_availability_refresh_failed",
        reason: error instanceof Error ? error.message : String(error),
      }),
    ),
);

// SIGTERM: stop accepting, end event streams (clients reconnect elsewhere),
// let running requests finish, then close analytics, LISTEN and the pool.
async function shutdown(signal: string) {
  if (draining) return;
  draining = true;
  console.info(JSON.stringify({ event: "api.shutdown", signal, inflight }));
  const forced = setTimeout(() => {
    console.error(JSON.stringify({ event: "api.shutdown_timeout", inflight }));
    process.exit(1);
  }, DRAIN_MS + 5_000);
  forced.unref();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  closeEventStreams();
  if ("closeIdleConnections" in server) server.closeIdleConnections();
  const deadline = Date.now() + DRAIN_MS;
  while (inflight > 0 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  await Promise.race([closed, new Promise((r) => setTimeout(r, 1_000))]);
  await flushAnalytics().catch(() => undefined);
  await realtime.close().catch(() => undefined);
  await closeDatabase().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
