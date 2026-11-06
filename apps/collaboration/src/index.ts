// First: stops with every configuration problem before other modules load.
import "@lictory/collaboration/configuration";

import { closeDatabase, db } from "@lictory/core/db";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { auth } from "@lictory/core/lib/auth";
import { env, envInteger } from "@lictory/core/lib/env";
import { describeError, jsonLog as log } from "@lictory/collaboration/log";
import { OwnerBusy } from "@lictory/collaboration/owner";
import {
  sessionAuthenticator,
  startCollaboration,
} from "@lictory/collaboration/service";

// The Lictory collaboration service: live draft editing for Lictory Spaces
// behind the public `/collaboration` WebSocket. One instance per
// installation (an advisory lock enforces it). Every change is stored in
// PostgreSQL before other editors see it, so stopping or killing it loses
// nothing that was saved; editors reconnect and resend what was not.

const port = envInteger("COLLABORATION_PORT") ?? 3004;
const host = env("COLLABORATION_HOST") ?? "0.0.0.0";
// LISTEN and the owner lock need a session: a direct connection.
const directUrl = env("DATABASE_URL_UNPOOLED") ?? env("DATABASE_URL")!;
// Bounded by the container's stop_grace_period (30 s).
const SHUTDOWN_MS = 20_000;

// Better Auth reads its providers once; do it before taking connections.
await auth.$context;

let service: Awaited<ReturnType<typeof startCollaboration>> | undefined;
try {
  service = await startCollaboration({
    db,
    directUrl,
    port,
    host,
    allowedOrigin: platformUrl(),
    authenticate: sessionAuthenticator((headers) =>
      auth.api.getSession({ headers }),
    ),
    log,
    onOwnershipLost: () => void shutdown("owner_lost", 1),
  });
} catch (error) {
  if (error instanceof OwnerBusy)
    log("error", "collaboration.owner_busy", { reason: error.message });
  else log("error", "collaboration.start_failed", { ...describeError(error) });
  await closeDatabase(1).catch(() => undefined);
  process.exit(1);
}
log("info", "collaboration.started", {
  pid: process.pid,
  port: service.port,
  host,
  origin: platformUrl(),
});

let stopping = false;
async function shutdown(reason: string, code = 0) {
  if (stopping) return;
  stopping = true;
  const started = Date.now();
  log(code ? "error" : "info", "collaboration.stopping", {
    reason,
    connections: service?.connections(),
  });
  const forced = setTimeout(() => {
    log("error", "collaboration.shutdown_timeout", {});
    process.exit(1);
  }, SHUTDOWN_MS);
  forced.unref();
  await service
    ?.stop()
    .catch((error: unknown) =>
      log("warn", "collaboration.stop_failed", { ...describeError(error) }),
    );
  await closeDatabase(5).catch(() => undefined);
  log("info", "collaboration.stopped", {
    reason,
    durationMs: Date.now() - started,
  });
  process.exit(code);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// Anything unexpected ends the process; Docker restarts it and editors
// reconnect with their unsaved changes.
process.on("unhandledRejection", (error) => {
  log("error", "collaboration.crashed", { ...describeError(error) });
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  log("error", "collaboration.crashed", { ...describeError(error) });
  process.exit(1);
});
