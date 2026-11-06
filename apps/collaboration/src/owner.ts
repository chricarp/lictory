import postgres from "postgres";

// One collaboration service per installation. Rooms (the editors of one
// draft) live in this process's memory, so two copies would split a page's
// editors into groups that do not see each other's edits. Storage would stay
// correct, live editing would not. The owner holds a session-level advisory
// lock on a dedicated direct connection for as long as it serves; PostgreSQL
// releases it when that connection ends, including when the process dies.

export const OWNER_LOCK = "lictory:collaboration-owner";

export class OwnerBusy extends Error {
  constructor(waitedMs: number) {
    super(
      `Another collaboration service holds the owner lock (waited ${Math.round(waitedMs / 1000)} s). ` +
        "Only one may run per installation: stop the other copy. A replaced container releases it when it exits.",
    );
  }
}

export type Ownership = { release(): Promise<void> };

// Takes the lock, waiting up to `waitMs` (a replaced container may still be
// shutting down). `onLost` fires once if the lock's connection ends or stops
// answering while held: the caller must stop serving, because another copy
// may take over.
export async function claimOwnership(
  url: string,
  options: {
    waitMs: number;
    onLost: (error: unknown) => void;
    onWaiting?: () => void;
    probeMs?: number;
    probeTimeoutMs?: number;
  },
): Promise<Ownership> {
  let held = false;
  let released = false;
  let reported = false;
  const lost = (error: unknown) => {
    if (!held || released || reported) return;
    reported = true;
    options.onLost(error);
  };
  const client = postgres(url, {
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    fetch_types: false,
    connect_timeout: 10,
    // Operators find the holder in pg_stat_activity by this name.
    connection: { application_name: "lictory-collaboration-owner" },
    onnotice: () => undefined,
    onclose: () =>
      lost(
        Object.assign(new Error("The owner lock connection closed."), {
          code: "CONNECTION_CLOSED",
        }),
      ),
  });
  const started = Date.now();
  try {
    for (let attempt = 0; ; attempt++) {
      const [row] = await client<{ locked: boolean }[]>`
        select pg_try_advisory_lock(hashtextextended(${OWNER_LOCK}, 0)) as locked`;
      if (row?.locked) break;
      if (attempt === 0) options.onWaiting?.();
      if (Date.now() - started >= options.waitMs)
        throw new OwnerBusy(Date.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } catch (error) {
    await client.end({ timeout: 1 }).catch(() => undefined);
    throw error;
  }
  held = true;

  // A half-open connection never reports itself closed; a probe that does
  // not answer in time counts as lost.
  const probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
  const probe = setInterval(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([
      client`select 1`,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(
                new Error("The owner lock connection stopped answering."),
                { code: "CONNECT_TIMEOUT" },
              ),
            ),
          probeTimeoutMs,
        );
      }),
    ])
      .catch(lost)
      .finally(() => clearTimeout(timer));
  }, options.probeMs ?? 15_000);
  probe.unref();

  return {
    async release() {
      released = true;
      clearInterval(probe);
      // Ending the session releases the lock.
      await client.end({ timeout: 2 }).catch(() => undefined);
    },
  };
}
