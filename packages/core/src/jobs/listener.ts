import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@lictory/core/db/schema";
import {
  WORK_CHANNEL,
  workKinds,
  type WorkKind,
} from "@lictory/core/jobs/signal";

// A database pool for background work, sized by the worker.
export function createJobDatabase(url: string, options: { max: number }) {
  const client = postgres(url, {
    max: options.max,
    onnotice: () => undefined,
  });
  return {
    db: drizzle(client, { schema }),
    close: (timeoutSeconds = 5) => client.end({ timeout: timeoutSeconds }),
  };
}

const connectionError = (what: string, code: string) =>
  Object.assign(new Error(`The work signal connection ${what}.`), { code });

export type WorkListener = {
  listening(): boolean;
  close(): Promise<void>;
};

// Holds a dedicated connection LISTENing on the work channel. Every time the
// LISTEN is (re-)established `onListening` fires: signals sent while it was
// down are lost, so the caller should look for work once. A lost connection
// or a failed liveness probe reconnects with backoff, for ever.
export function listenForWork(
  url: string,
  handlers: {
    onSignal(kind: WorkKind): void;
    onListening(reconnected: boolean): void;
    onLost(error: unknown): void;
  },
  options: { probeMs?: number; probeTimeoutMs?: number } = {},
): WorkListener {
  const probeMs = options.probeMs ?? 30_000;
  const probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
  let client: postgres.Sql | null = null;
  let active = false;
  let closed = false;
  let failures = 0;
  let established = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const lost = (c: postgres.Sql, error: unknown) => {
    if (client !== c) return;
    client = null;
    active = false;
    void c.end({ timeout: 0 }).catch(() => undefined);
    if (closed) return;
    handlers.onLost(error);
    const delay = Math.min(1_000 * 2 ** failures, 30_000);
    failures++;
    retry = setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (closed) return;
    const c = postgres(url, {
      max: 1,
      idle_timeout: 0,
      max_lifetime: null,
      fetch_types: false,
      connect_timeout: 10,
      onnotice: () => undefined,
      onclose: () => lost(c, connectionError("closed", "CONNECTION_CLOSED")),
      // Supported by postgres.js but missing from its option types.
      ...({
        onnotify: (channel: string, payload: string) => {
          if (
            channel === WORK_CHANNEL &&
            (workKinds as readonly string[]).includes(payload)
          )
            handlers.onSignal(payload as WorkKind);
        },
      } as object),
    });
    client = c;
    try {
      await c.unsafe(`listen "${WORK_CHANNEL}"`);
    } catch (error) {
      lost(c, error);
      return;
    }
    if (client !== c) return;
    active = true;
    failures = 0;
    handlers.onListening(established);
    established = true;
  };

  // A half-open TCP connection never reports itself closed; a probe that
  // does not answer in time counts as a lost connection.
  const probe = setInterval(() => {
    const c = client;
    if (!c || !active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      c`select 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(connectionError("stopped answering", "CONNECT_TIMEOUT")),
          probeTimeoutMs,
        );
      }),
    ])
      .catch((error: unknown) => lost(c, error))
      .finally(() => clearTimeout(timer));
  }, probeMs);
  probe.unref();

  void connect();
  return {
    listening: () => active,
    async close() {
      closed = true;
      clearInterval(probe);
      clearTimeout(retry);
      const c = client;
      client = null;
      active = false;
      await c?.end({ timeout: 2 }).catch(() => undefined);
    },
  };
}
