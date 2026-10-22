import { sql } from "drizzle-orm";
import type { Tx } from "@lictory/core/domain/service";

// Background work is durable: the rows that describe it (queued AI runs,
// pending notification email, running delivery publications) commit with the
// domain change, and this signal, delivered by PostgreSQL only on commit,
// wakes the worker. The worker also polls, so a lost signal only delays work.
export const WORK_CHANNEL = "lictory_work";
export const workKinds = ["ai", "email", "delivery"] as const;
export type WorkKind = (typeof workKinds)[number];

export async function signalWork(tx: Tx, kind: WorkKind) {
  await tx.execute(sql`select pg_notify(${WORK_CHANNEL}, ${kind})`);
}
