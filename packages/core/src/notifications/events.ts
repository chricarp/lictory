import { and, asc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import type { QueuedNotice } from "@lictory/core/db/notification-schema";
import { signalWork } from "@lictory/core/jobs/signal";
import type { Database, Tx } from "@lictory/core/domain/service";
import {
  isNotificationKind,
  resolveChannels,
  type NotificationKind,
  type PreferenceRule,
} from "@lictory/core/notifications/catalog";

// The notification queue (docs/internals/notifications.md). A command only
// records what happened and who might care: one `notification_event` row in
// its own transaction. Deciding who is told (membership, space access, watch
// state, preferences) and writing the per-recipient rows, queued emails and
// realtime signals is the worker's job, so none of it runs while a command
// holds the organization lock.

export type NotificationNotice = Omit<QueuedNotice, "userIds" | "kind"> & {
  userIds: Iterable<string>;
  kind: NotificationKind;
};

// Queues one event, in the caller's transaction: the event exists exactly
// when the change committed. Order notices most specific first; when one
// event names the same person for the same item several times, only the
// first notice reaches them (a mention beats "new discussion" for the same
// message). `detail.group` makes notices of different kinds share that slot.
export async function queueNotifications(
  tx: Tx,
  organizationId: string,
  notices: NotificationNotice[],
) {
  const queued: QueuedNotice[] = notices.flatMap((notice) => {
    const userIds = [...new Set(notice.userIds)].filter(
      (userId) => userId !== notice.actorId,
    );
    if (!userIds.length && !(notice.watchers && notice.workItemId)) return [];
    return [{ ...notice, userIds }];
  });
  if (!queued.length) return;
  await tx
    .insert(s.notificationEvent)
    .values({ organizationId, notices: queued });
  await signalWork(tx, "notification");
}

const MAX_ATTEMPTS = 5;
// Events that could not be fanned out are kept this long for inspection.
const FAILED_RETENTION_MS = 7 * 24 * 60 * 60_000;

const text = z.string().min(1);
const noticesSchema = z.array(
  z.object({
    userIds: z.array(text),
    kind: z.string(),
    actorId: text.nullable(),
    projectId: text.nullish(),
    teamId: text.nullish(),
    workItemId: text.nullish(),
    spaceId: text.nullish(),
    pageId: text.nullish(),
    detail: z.record(z.string(), z.unknown()).optional(),
    dedupeKey: text.optional(),
    watchers: z.boolean().optional(),
    skipUnwatched: z.boolean().optional(),
  }),
);

type Draft = Omit<QueuedNotice, "userIds" | "kind"> & {
  userId: string;
  kind: NotificationKind;
  // One event tells a person at most once per slot (item and group).
  slot: string;
};

// Rows per insert statement: PostgreSQL binds at most 65,535 values in one.
const INSERT_CHUNK = 1000;

// Writes one event's notifications. Recipients are current organization
// members (and, for Spaces notifications, current readers of the space) whose
// preferences keep the kind on; the actor is never notified of their own
// action. Of several notices naming a person for the same item, the first
// one they can receive wins.
async function fanOut(tx: Tx, event: typeof s.notificationEvent.$inferSelect) {
  const { organizationId } = event;
  const notices = noticesSchema.parse(event.notices);
  const watchedItemIds = [
    ...new Set(
      notices.flatMap((n) =>
        n.workItemId && (n.watchers || n.skipUnwatched) ? [n.workItemId] : [],
      ),
    ),
  ];
  const watchRows = watchedItemIds.length
    ? await tx
        .select({
          workItemId: s.workItemWatcher.workItemId,
          userId: s.workItemWatcher.userId,
          watching: s.workItemWatcher.watching,
        })
        .from(s.workItemWatcher)
        .where(
          and(
            eq(s.workItemWatcher.organizationId, organizationId),
            inArray(s.workItemWatcher.workItemId, watchedItemIds),
          ),
        )
    : [];
  const watch = (workItemId: string, watching: boolean) =>
    watchRows
      .filter((w) => w.workItemId === workItemId && w.watching === watching)
      .map((w) => w.userId);

  const drafts: Draft[] = [];
  for (const { userIds, kind, ...notice } of notices) {
    // A kind this version does not know was queued by a newer one during a
    // rollout. The event fails and is retried, so the worker that knows the
    // kind delivers it; dropping the notice would lose it silently.
    if (!isNotificationKind(kind))
      throw new Error(`Unknown notification kind: ${kind}`);
    const item = notice.workItemId;
    const unwatched = new Set(
      item && notice.skipUnwatched ? watch(item, false) : [],
    );
    const group =
      typeof notice.detail?.group === "string" ? notice.detail.group : kind;
    for (const userId of new Set([
      ...userIds,
      ...(item && notice.watchers ? watch(item, true) : []),
    ])) {
      if (userId === notice.actorId || unwatched.has(userId)) continue;
      const slot = `${userId}:${item ?? notice.pageId ?? ""}:${group}`;
      drafts.push({ ...notice, userId, kind, slot });
    }
  }
  if (!drafts.length) return { notifications: 0, emails: 0 };

  const userIds = [...new Set(drafts.map((d) => d.userId))];
  const actorIds = [
    ...new Set(drafts.flatMap((d) => (d.actorId ? [d.actorId] : []))),
  ];
  // Recipients must still be members; an actor only has to still exist (the
  // notification references their account).
  const people = await tx
    .select({ id: s.user.id, memberId: s.member.id })
    .from(s.user)
    .leftJoin(
      s.member,
      and(
        eq(s.member.userId, s.user.id),
        eq(s.member.organizationId, organizationId),
      ),
    )
    .where(inArray(s.user.id, [...new Set([...userIds, ...actorIds])]));
  const existing = new Set(people.map((p) => p.id));
  const members = new Set(people.filter((p) => p.memberId).map((p) => p.id));
  const spaceIds = [
    ...new Set(drafts.flatMap((d) => (d.spaceId ? [d.spaceId] : []))),
  ];
  const readers = new Set(
    spaceIds.length
      ? (
          await tx
            .select({
              spaceId: s.spaceReader.spaceId,
              userId: s.spaceReader.userId,
            })
            .from(s.spaceReader)
            .where(
              and(
                eq(s.spaceReader.organizationId, organizationId),
                inArray(s.spaceReader.spaceId, spaceIds),
                inArray(s.spaceReader.userId, userIds),
              ),
            )
        ).map((r) => `${r.spaceId}:${r.userId}`)
      : [],
  );
  const rules = await tx
    .select()
    .from(s.notificationPreference)
    .where(
      and(
        eq(s.notificationPreference.organizationId, organizationId),
        inArray(s.notificationPreference.userId, userIds),
      ),
    );
  const rulesByUser = new Map<string, PreferenceRule[]>();
  for (const r of rules) {
    if (!isNotificationKind(r.kind)) continue;
    const list = rulesByUser.get(r.userId) ?? [];
    list.push({ ...r, kind: r.kind });
    rulesByUser.set(r.userId, list);
  }
  const rows: (typeof s.notification.$inferInsert)[] = [];
  const emailIds = new Set<string>();
  const told = new Set<string>();
  for (const d of drafts) {
    if (told.has(d.slot)) continue;
    if (!members.has(d.userId)) continue;
    if (d.spaceId && !readers.has(`${d.spaceId}:${d.userId}`)) continue;
    const channels = resolveChannels(rulesByUser.get(d.userId) ?? [], d.kind, {
      organizationId,
      projectId: d.projectId,
      teamId: d.teamId,
    });
    if (!channels.inApp) continue;
    told.add(d.slot);
    const id = crypto.randomUUID();
    const { group, ...detail } = d.detail ?? {};
    void group;
    rows.push({
      id,
      organizationId,
      userId: d.userId,
      kind: d.kind,
      actorId: d.actorId && existing.has(d.actorId) ? d.actorId : null,
      projectId: d.projectId ?? null,
      teamId: d.teamId ?? null,
      workItemId: d.workItemId ?? null,
      spaceId: d.spaceId ?? null,
      pageId: d.pageId ?? null,
      detail,
      dedupeKey: d.dedupeKey ?? null,
      createdAt: event.createdAt,
    });
    if (channels.email) emailIds.add(id);
  }
  if (!rows.length) return { notifications: 0, emails: 0 };
  const inserted: { id: string; userId: string }[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK)
    inserted.push(
      ...(await tx
        .insert(s.notification)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoNothing()
        .returning({ id: s.notification.id, userId: s.notification.userId })),
    );
  const emails = inserted.filter((r) => emailIds.has(r.id));
  for (let i = 0; i < emails.length; i += INSERT_CHUNK)
    await tx.insert(s.notificationEmail).values(
      emails.slice(i, i + INSERT_CHUNK).map((r) => ({
        notificationId: r.id,
        organizationId,
        userId: r.userId,
      })),
    );
  // Delivered on commit; carries only who should refetch, never content.
  const recipients = [...new Set(inserted.map((r) => r.userId))];
  for (let i = 0; i < recipients.length; i += 100) {
    const payload = JSON.stringify({
      organizationId,
      userIds: recipients.slice(i, i + 100),
    });
    await tx.execute(sql`select pg_notify('lictory_notification', ${payload})`);
  }
  return { notifications: inserted.length, emails: emails.length };
}

// Fans out queued notification events. Safe to run concurrently and
// repeatedly: a batch is claimed with SKIP LOCKED and its events are fanned
// out and deleted in the claiming transaction, so each event is delivered
// exactly once and a runner that dies leaves its batch untouched. Each event
// has its own savepoint: one that fails is retried with backoff (1, 2, 4, 8
// minutes) and marked failed after five attempts, without holding back the
// others. Everything here is database work; the organization lock is never
// taken.
export async function processNotificationEvents(
  db: Database,
  options: { limit?: number; now?: () => Date } = {},
) {
  const at = (options.now ?? (() => new Date()))();
  return db.transaction(async (tx) => {
    await tx
      .delete(s.notificationEvent)
      .where(
        lt(
          s.notificationEvent.failedAt,
          new Date(at.getTime() - FAILED_RETENTION_MS),
        ),
      );
    const events = await tx
      .select()
      .from(s.notificationEvent)
      .where(
        and(
          isNull(s.notificationEvent.failedAt),
          lte(s.notificationEvent.nextAttemptAt, at),
        ),
      )
      .orderBy(asc(s.notificationEvent.nextAttemptAt))
      .limit(options.limit ?? 50)
      .for("update", { skipLocked: true });
    const outcome = { notifications: 0, emails: 0, retrying: 0, failed: 0 };
    for (const event of events) {
      const one = eq(s.notificationEvent.id, event.id);
      try {
        const written = await tx.transaction((savepoint) =>
          fanOut(savepoint, event),
        );
        await tx.delete(s.notificationEvent).where(one);
        outcome.notifications += written.notifications;
        outcome.emails += written.emails;
      } catch (error) {
        const attempts = event.attempts + 1;
        const final = attempts >= MAX_ATTEMPTS;
        const message = error instanceof Error ? error.message : String(error);
        await tx
          .update(s.notificationEvent)
          .set({
            attempts,
            lastError: message.slice(0, 1000),
            nextAttemptAt: new Date(
              at.getTime() + 60_000 * 2 ** (attempts - 1),
            ),
            failedAt: final ? at : null,
          })
          .where(one);
        if (final) outcome.failed++;
        else outcome.retrying++;
      }
    }
    if (outcome.emails) await signalWork(tx, "email");
    return { ...outcome, claimed: events.length };
  });
}
