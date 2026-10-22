import { serve } from "@hono/node-server";
import { closeDatabase } from "@lictory/core/db";
import { realtime } from "@lictory/core/domain/realtime";
import { flushAnalytics } from "@lictory/core/lib/analytics/server";
import { createApp } from "@lictory/api/app";
import { closeEventStreams } from "@lictory/api/routes/events";

// The Lictory API on Node: Better Auth, capabilities, MCP, Zero's query and
// mutate endpoints, event streams and the SPA document. Background work runs
// in the worker, never here.

const port = Number(process.env.PORT ?? 3002);
const hostname = process.env.HOST ?? "0.0.0.0";
const DRAIN_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);

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
      JSON.stringify({ event: "api.listening", port: info.port, hostname }),
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
