import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Database, Tx } from "@lictory/core/domain/service";
import {
  agentEntity,
  runnerEntity,
  sessionEntity,
} from "@lictory/core/factory/entities";
import {
  boundEvent,
  type SessionEventType,
} from "@lictory/core/factory/protocol";

// The Factory's write path (docs/internals/factory.md#writes). Factory
// writes are frequent (event batches, heartbeats) and touch only Factory
// tables, so like the conversation and live draft writers they take the
// organization lock in shared mode (organization deletion and other
// organization-wide writers still exclude them) and lock the rows they
// change. They maintain `factory_entity` in the same transaction and never
// write `sync_entity`.

export type SessionRow = typeof s.agentSession.$inferSelect;

// Trimmed text, or null when blank.
export function present(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

export async function sharedLock(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${organizationId}, 0))`,
  );
}

// Runs `write` in a transaction under the shared organization lock.
export function factoryWrite<T>(
  db: Database,
  organizationId: string,
  write: (tx: Tx) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await sharedLock(tx, organizationId);
    return write(tx);
  });
}

async function upsertEntity(
  tx: Tx,
  organizationId: string,
  type: string,
  id: string,
  data: Record<string, unknown>,
) {
  const now = new Date();
  await tx
    .insert(s.factoryEntity)
    .values({
      key: `${type}:${id}`,
      organizationId,
      type,
      data,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: s.factoryEntity.key,
      set: { data, updatedAt: now },
      // A projection never moves to another organization.
      setWhere: eq(s.factoryEntity.organizationId, organizationId),
    });
}

export async function projectAgent(tx: Tx, row: typeof s.agent.$inferSelect) {
  await upsertEntity(tx, row.organizationId, "agent", row.id, agentEntity(row));
}

export async function projectRunner(tx: Tx, row: typeof s.runner.$inferSelect) {
  await upsertEntity(
    tx,
    row.organizationId,
    "runner",
    row.id,
    runnerEntity(row),
  );
}

export async function projectSession(tx: Tx, row: SessionRow) {
  const approvals = await tx
    .select()
    .from(s.agentApproval)
    .where(
      and(
        eq(s.agentApproval.sessionId, row.id),
        eq(s.agentApproval.status, "pending"),
      ),
    );
  await upsertEntity(
    tx,
    row.organizationId,
    "session",
    row.id,
    sessionEntity(row, approvals),
  );
}

// Appends server-written events to the session's log. The session row must
// be locked by the caller; returns the new last sequence.
export async function appendEvents(
  tx: Tx,
  session: Pick<SessionRow, "id" | "organizationId" | "eventSequence">,
  events: { type: SessionEventType; data: unknown; at?: Date }[],
) {
  if (!events.length) return session.eventSequence;
  let sequence = session.eventSequence;
  await tx.insert(s.agentSessionEvent).values(
    events.map((event) => ({
      organizationId: session.organizationId,
      sessionId: session.id,
      sequence: ++sequence,
      type: event.type,
      data: boundEvent(event.data),
      createdAt: event.at ?? new Date(),
    })),
  );
  return sequence;
}

// Locks and reads one session of the organization.
export async function lockSession(
  tx: Tx,
  organizationId: string,
  sessionId: string,
) {
  const [row] = await tx
    .select()
    .from(s.agentSession)
    .where(
      and(
        eq(s.agentSession.organizationId, organizationId),
        eq(s.agentSession.id, sessionId),
      ),
    )
    .for("update");
  return row;
}

export async function updateSession(
  tx: Tx,
  id: string,
  values: Partial<typeof s.agentSession.$inferInsert>,
) {
  const [row] = await tx
    .update(s.agentSession)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(s.agentSession.id, id))
    .returning();
  return row!;
}

// Expires every pending approval of a session that stopped.
export async function expireApprovals(tx: Tx, sessionId: string) {
  await tx
    .update(s.agentApproval)
    .set({ status: "expired", decidedAt: new Date() })
    .where(
      and(
        eq(s.agentApproval.sessionId, sessionId),
        eq(s.agentApproval.status, "pending"),
      ),
    );
}

// Revokes the session-scoped Lictory token (and any older one).
export async function revokeSessionTokens(tx: Tx, sessionId: string) {
  await tx
    .update(s.accessToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(s.accessToken.agentSessionId, sessionId),
        sql`${s.accessToken.revokedAt} is null`,
      ),
    );
}

// The latest events of a session, oldest first (for agents reading a
// session through capabilities; browsers read the synchronized log).
export async function latestEvents(
  db: Database | Tx,
  sessionId: string,
  options: { limit: number; before?: number },
) {
  const rows = await db
    .select()
    .from(s.agentSessionEvent)
    .where(
      and(
        eq(s.agentSessionEvent.sessionId, sessionId),
        options.before !== undefined
          ? sql`${s.agentSessionEvent.sequence} < ${options.before}`
          : undefined,
      ),
    )
    .orderBy(desc(s.agentSessionEvent.sequence))
    .limit(options.limit);
  return rows.reverse();
}

export async function sessionsByIds(tx: Tx | Database, ids: string[]) {
  if (!ids.length) return [];
  return tx
    .select()
    .from(s.agentSession)
    .where(inArray(s.agentSession.id, ids));
}
