import { sql } from "drizzle-orm";
import postgres from "postgres";
import type { Tx } from "@lictory/core/domain/service";

// Wakes runner long-polls when a session is queued or receives a steering
// input. Signals are sent with NOTIFY (delivered on commit, to every API
// process); a lost signal only delays a runner until its next check, which
// the long-polls do every few seconds regardless.

export const FACTORY_CHANNEL = "lictory_factory";
type Signal = { organizationId: string; sessionId?: string };
type Waiter = { match: (signal: Signal) => boolean; wake: () => void };

const waiters = new Set<Waiter>();
let listening: Promise<unknown> | undefined;

function listen() {
  if (listening) return;
  const url = process.env.DATABASE_URL_UNPOOLED?.trim()
    ? process.env.DATABASE_URL_UNPOOLED
    : process.env.DATABASE_URL;
  if (!url) return;
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  listening = client
    .listen(FACTORY_CHANNEL, (payload) => {
      let signal: Signal;
      try {
        signal = JSON.parse(payload) as Signal;
      } catch {
        return;
      }
      for (const waiter of waiters) if (waiter.match(signal)) waiter.wake();
    })
    .catch((error: unknown) => {
      // Long-polls fall back to their periodic checks.
      listening = undefined;
      void client.end({ timeout: 1 });
      console.warn(
        JSON.stringify({
          event: "factory.listen_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
}

export async function signalFactory(tx: Tx, signal: Signal) {
  await tx.execute(
    sql`select pg_notify(${FACTORY_CHANNEL}, ${JSON.stringify(signal)})`,
  );
}

// Resolves after `ms`, or earlier when a matching signal arrives or the
// request is aborted.
export function waitForSignal(
  match: (signal: Signal) => boolean,
  ms: number,
  abort?: AbortSignal,
) {
  listen();
  return new Promise<void>((resolve) => {
    const waiter: Waiter = { match, wake: () => done() };
    const timer = setTimeout(() => done(), ms);
    const done = () => {
      clearTimeout(timer);
      waiters.delete(waiter);
      abort?.removeEventListener("abort", done);
      resolve();
    };
    waiters.add(waiter);
    abort?.addEventListener("abort", done, { once: true });
  });
}
