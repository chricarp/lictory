import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import type { Database, Tx } from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";
import { assertOrganizationAccess } from "@lictory/core/domain/organization-access";
import type { AgentScope } from "@lictory/core/factory/authority";
import type { QueuedNotice } from "@lictory/core/db/notification-schema";
import { signalWork } from "@lictory/core/jobs/signal";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { notificationHref } from "@lictory/core/notifications/format";
import {
  agentEventTypeOf,
  eventSubject,
  type AgentEventType,
} from "@lictory/core/agent-events/catalog";

// The durable agent event feed (docs/internals/agent-events.md).
//
// Written by the notification fan-out, in the transaction that consumes the
// notification event the domain change queued: an agent event exists
// exactly when its change committed, once. Read through a commit-safe
// cursor and authorized again on every read.

const AGENT_EVENT_CHANNEL = "lictory_agent_event";
// Events are kept this long; a cursor older than that may have missed some.
export const AGENT_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;

type Draft = Omit<QueuedNotice, "userIds"> & { userId: string; slot: string };

// The commit-safe cursor. Sequence numbers are drawn when a row is
// inserted, but become visible when its transaction commits; two writers
// committing in the other order would let a reader pass a number that
// appears later. So every writer takes this lock before drawing numbers
// and holds it until it commits: numbers become visible in order, and a
// cursor never skips an event. Only the notification fan-out writes events
// (database work, never under an organization lock), so it serializes
// fan-out batches with each other and nothing else.
//
// (Ordering by transaction id below `pg_snapshot_xmin` would avoid the
// lock, but the xmin is the cluster's: any long write transaction, in any
// database of the server, would hold every feed back for its duration.)
export async function lockFeed(tx: Tx) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('lictory_agent_event_feed', 0))`,
  );
}

// Writes the agent events of one fanned-out notification event: one per
// person (and agent) and slot, the first notice that maps to an agent event
// winning. Recipients were already checked (membership, space and channel
// access); preferences do not apply. Returns how many were written.
export async function writeAgentEvents(
  tx: Tx,
  event: { organizationId: string; createdAt: Date },
  drafts: readonly Draft[],
) {
  const slots = new Set<string>();
  const rows: (typeof s.agentEvent.$inferInsert)[] = [];
  for (const d of drafts) {
    const type = agentEventTypeOf(d.kind);
    if (!type) continue;
    const slot = `${d.slot}:${d.agentId ?? ""}`;
    if (slots.has(slot)) continue;
    slots.add(slot);
    rows.push({
      organizationId: event.organizationId,
      userId: d.userId,
      agentId: d.agentId ?? null,
      type,
      sourceKind: d.kind,
      actorId: d.actorId,
      projectId: d.projectId ?? null,
      workItemId: d.workItemId ?? null,
      channelId: d.channelId ?? null,
      spaceId: d.spaceId ?? null,
      pageId: d.pageId ?? null,
      data: eventSubject({
        ...d.detail,
        ...(d.workItemId ? { workItemId: d.workItemId } : {}),
        ...(d.channelId ? { channelId: d.channelId } : {}),
        ...(d.pageId ? { pageId: d.pageId } : {}),
        ...(d.spaceId ? { spaceId: d.spaceId } : {}),
      }),
      dedupeKey: d.dedupeKey ? `${d.dedupeKey}:${d.agentId ?? ""}` : null,
      createdAt: event.createdAt,
    });
  }
  if (!rows.length) return 0;
  await lockFeed(tx);
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000)
    written += (
      await tx
        .insert(s.agentEvent)
        .values(rows.slice(i, i + 1000))
        .onConflictDoNothing()
        .returning({ id: s.agentEvent.id })
    ).length;
  const userIds = [...new Set(rows.map((r) => r.userId))];
  // Wakes waiting MCP calls (on commit; content-free).
  for (let i = 0; i < userIds.length; i += 100)
    await tx.execute(
      sql`select pg_notify(${AGENT_EVENT_CHANNEL}, ${JSON.stringify({ userIds: userIds.slice(i, i + 100) })})`,
    );
  // And the delivery worker, when someone has an active destination.
  const [subscribed] = await tx
    .select({ id: s.agentEventSubscription.id })
    .from(s.agentEventSubscription)
    .where(
      and(
        inArray(s.agentEventSubscription.userId, userIds),
        eq(s.agentEventSubscription.status, "active"),
      ),
    )
    .limit(1);
  if (subscribed) await signalWork(tx, "agent-events");
  return written;
}

// ------------------------------------------------------------ the cursor

// A position in a person's feed: after the event with this sequence.
// Opaque to clients.
export type Cursor = { seq: number };

export function encodeCursor(cursor: Cursor) {
  return String(cursor.seq);
}

export function decodeCursor(value: string): Cursor {
  const match = /^(\d{1,18})$/.exec(value.trim());
  if (!match)
    throw new DomainError(
      "validation",
      "Unknown event cursor. Use the cursor a previous call returned, or omit it.",
    );
  return { seq: Number(match[1]) };
}

// The cursor that skips everything written so far for this person.
export async function latestCursor(
  db: Database | Tx,
  userId: string,
): Promise<Cursor> {
  const [row] = await db
    .select({ seq: sql<string | null>`max(${s.agentEvent.seq})` })
    .from(s.agentEvent)
    .where(eq(s.agentEvent.userId, userId));
  return { seq: Number(row?.seq ?? 0) };
}

// ------------------------------------------------------------ reading

// Who reads: the person, and the agent their token is bound to (if any).
export type FeedReader = {
  userId: string;
  agent?: AgentScope | null;
};

type FeedQuery = {
  after?: string | null;
  limit?: number;
  organizationId?: string | null;
  types?: readonly AgentEventType[] | null;
  projectIds?: readonly string[] | null;
  // Narrow to events addressed to this agent (or to the person).
  agentId?: string | null;
};

export type AgentEventView = {
  id: string;
  type: AgentEventType;
  occurredAt: string;
  organizationId: string;
  organizationSlug: string;
  projectId: string | null;
  agentId: string | null;
  actorId: string | null;
  subject: Record<string, string | number | boolean>;
  url: string;
  cursor: string;
};

// Organizations whose events this reader may receive: current
// memberships that pass the organization's access rules (two-factor
// requirement, scheduled deletion), and only the agent's own for an agent.
async function readableOrganizations(
  db: Database | Tx,
  reader: FeedReader,
  organizationId?: string | null,
) {
  const memberships = await db
    .select({
      id: s.organization.id,
      slug: s.organization.slug,
    })
    .from(s.member)
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
    .where(
      and(
        eq(s.member.userId, reader.userId),
        ...(organizationId
          ? [eq(s.member.organizationId, organizationId)]
          : []),
        ...(reader.agent
          ? [eq(s.member.organizationId, reader.agent.organizationId)]
          : []),
      ),
    );
  const open: { id: string; slug: string }[] = [];
  for (const m of memberships) {
    try {
      await assertOrganizationAccess(db, reader.userId, m.id);
      open.push(m);
    } catch {
      // Locked (two-factor, deletion): its events wait until it opens.
    }
  }
  return new Map(open.map((m) => [m.id, m.slug]));
}

// Is this event still readable by the person (and inside the agent's
// scope)? Space and channel access are re-checked on every read, like the
// inbox; the event's subject itself is then read through ordinary tools.
function readable(reader: FeedReader) {
  const agent = reader.agent;
  const e = s.agentEvent;
  return and(
    sql`(${e.spaceId} is null or exists (
      select 1 from ${s.spaceReader}
      where ${s.spaceReader.organizationId} = ${e.organizationId}
        and ${s.spaceReader.spaceId} = ${e.spaceId}
        and ${s.spaceReader.userId} = ${e.userId}))`,
    sql`(${e.channelId} is null or exists (
      select 1 from ${s.channel} c
      where c.organization_id = ${e.organizationId}
        and c.id = ${e.channelId}
        and (c.kind = 'public' or exists (
          select 1 from ${s.channelMember} cm
          where cm.channel_id = c.id and cm.user_id = ${e.userId}))))`,
    // An agent sees the person's events and its own, never another
    // agent's; limited to projects, it sees only theirs (and its own).
    agent ? or(isNull(e.agentId), eq(e.agentId, agent.id)) : undefined,
    agent?.projectIds
      ? or(eq(e.agentId, agent.id), inArray(e.projectId, [...agent.projectIds]))
      : undefined,
  )!;
}

const MAX_LIMIT = 100;

// Reads a person's events after a cursor, oldest first. Events the reader
// may no longer see are dropped but still advance the cursor, so a reader
// never reads them again and never stalls on them.
export async function readAgentEvents(
  db: Database | Tx,
  reader: FeedReader,
  query: FeedQuery = {},
): Promise<{ events: AgentEventView[]; cursor: string; hasMore: boolean }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT);
  if (query.after === "latest")
    return {
      events: [],
      cursor: encodeCursor(await latestCursor(db, reader.userId)),
      hasMore: false,
    };
  const from = query.after ? decodeCursor(query.after) : null;
  const organizations = await readableOrganizations(
    db,
    reader,
    query.organizationId,
  );
  if (query.organizationId && !organizations.size)
    throw new DomainError(
      "not_found",
      "Organization not found among your memberships.",
    );
  if (!organizations.size)
    return {
      events: [],
      cursor: query.after ?? encodeCursor({ seq: 0 }),
      hasMore: false,
    };
  const rows = await db
    .select({
      event: s.agentEvent,
      readable: sql<boolean>`${readable(reader)}`,
    })
    .from(s.agentEvent)
    .where(
      and(
        eq(s.agentEvent.userId, reader.userId),
        ...(from ? [gt(s.agentEvent.seq, from.seq)] : []),
        inArray(s.agentEvent.organizationId, [...organizations.keys()]),
        ...(query.types?.length
          ? [inArray(s.agentEvent.type, [...query.types])]
          : []),
        ...(query.projectIds?.length
          ? [inArray(s.agentEvent.projectId, [...query.projectIds])]
          : []),
        ...(query.agentId
          ? [
              or(
                isNull(s.agentEvent.agentId),
                eq(s.agentEvent.agentId, query.agentId),
              ),
            ]
          : []),
      ),
    )
    .orderBy(s.agentEvent.seq)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const cursor = last
    ? encodeCursor({ seq: last.event.seq })
    : (query.after ?? encodeCursor({ seq: 0 }));
  const base = platformUrl().replace(/\/$/, "");
  return {
    events: page
      .filter((r) => r.readable)
      .map((r) =>
        view(r.event, organizations.get(r.event.organizationId) ?? "", base),
      ),
    cursor,
    hasMore: rows.length > limit,
  };
}

function view(
  e: typeof s.agentEvent.$inferSelect,
  organizationSlug: string,
  base: string,
): AgentEventView {
  const subject = e.data as Record<string, string | number | boolean>;
  return {
    id: e.id,
    type: e.type as AgentEventType,
    occurredAt: e.createdAt.toISOString(),
    organizationId: e.organizationId,
    organizationSlug,
    projectId: e.projectId,
    agentId: e.agentId,
    actorId: e.actorId,
    subject,
    url: `${base}${notificationHref(organizationSlug, { kind: e.sourceKind, detail: subject })}`,
    cursor: encodeCursor({ seq: e.seq }),
  };
}

// ------------------------------------------------------------ waiting

type Waiter = { userId: string; wake: () => void };
const waiters = new Set<Waiter>();
let listening: Promise<unknown> | undefined;
let listener: postgres.Sql | undefined;

// Closes the wake-up connection (process shutdown, tests).
export async function stopAgentEventListener() {
  const current = listener;
  listening = undefined;
  listener = undefined;
  await current?.end({ timeout: 1 });
}

function listen() {
  if (listening) return;
  const url = process.env.DATABASE_URL_UNPOOLED?.trim()
    ? process.env.DATABASE_URL_UNPOOLED
    : process.env.DATABASE_URL;
  if (!url) return;
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  listener = client;
  listening = client
    .listen(AGENT_EVENT_CHANNEL, (payload) => {
      let userIds: unknown;
      try {
        userIds = (JSON.parse(payload) as { userIds?: unknown }).userIds;
      } catch {
        return;
      }
      if (!Array.isArray(userIds)) return;
      for (const waiter of waiters)
        if (userIds.includes(waiter.userId)) waiter.wake();
    })
    .catch((error: unknown) => {
      // Waits fall back to their periodic checks.
      listening = undefined;
      void client.end({ timeout: 1 });
      console.warn(
        JSON.stringify({
          event: "agent_events.listen_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
}

function waitForSignal(userId: string, ms: number, abort?: AbortSignal) {
  listen();
  return new Promise<void>((resolve) => {
    const waiter: Waiter = { userId, wake: () => done() };
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

export const MAX_WAIT_SECONDS = 25;
// Re-check this often without a signal: a signal sent while the listener
// reconnects (or before it first connected) is lost.
const RECHECK_MS = 3_000;

// Waits until the reader has events after the cursor, or the timeout
// passes. Returns as soon as there is something to read.
export async function waitForAgentEvents(
  db: Database,
  reader: FeedReader,
  query: FeedQuery & { after: string; timeoutSeconds?: number },
  options: { signal?: AbortSignal } = {},
) {
  const timeout =
    Math.min(
      Math.max(query.timeoutSeconds ?? MAX_WAIT_SECONDS, 0),
      MAX_WAIT_SECONDS,
    ) * 1000;
  const deadline = Date.now() + timeout;
  let cursor = query.after;
  for (;;) {
    const result = await readAgentEvents(db, reader, {
      ...query,
      after: cursor,
    });
    // Dropped events advance the cursor even when nothing is returned.
    cursor = result.cursor;
    if (result.events.length || result.hasMore) return result;
    const left = deadline - Date.now();
    if (left <= 0 || options.signal?.aborted) return result;
    // A signal arrives on commit; the loop reads again at once.
    await waitForSignal(
      reader.userId,
      Math.min(left, RECHECK_MS),
      options.signal,
    );
  }
}

// ------------------------------------------------------------ retention

// Removes events past the retention period, in batches.
export async function purgeAgentEvents(
  db: Database,
  options: { now?: Date; batch?: number } = {},
) {
  const before = new Date(
    (options.now ?? new Date()).getTime() - AGENT_EVENT_RETENTION_MS,
  );
  const batch = options.batch ?? 5000;
  let removed = 0;
  for (;;) {
    const rows = await db.execute<{ id: string }>(
      sql`delete from ${s.agentEvent} where ${s.agentEvent.id} in (
        select ${s.agentEvent.id} from ${s.agentEvent}
        where ${lt(s.agentEvent.createdAt, before)} limit ${batch})
        returning ${s.agentEvent.id}`,
    );
    removed += rows.length;
    if (rows.length < batch) return removed;
  }
}
