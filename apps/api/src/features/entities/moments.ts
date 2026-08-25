import {
  type EntityMoment,
  type MomentPrecision,
  type MomentRecurrence,
  type TimeKind,
  deriveReminderAt,
  momentInstant,
  momentPrecision,
  nextOccurrence,
  parseRecurrence,
} from "@lictory/contracts";
import { eq } from "drizzle-orm";

import type { Env } from "../../bindings";
import { database } from "../../infrastructure/database/client";
import type {
  EntityMomentRow,
  EntityRow,
} from "../../infrastructure/database/rows";
import {
  entities as entitiesTable,
  entityMoments,
  triggers,
} from "../../infrastructure/database/schema";

export type MomentFacts = {
  kind: TimeKind | null | undefined;
  startsAt: string | null | undefined;
  endsAt?: string | null;
  allDay?: boolean | null;
  timezone?: string | null;
  /** Free-text schedule, as extracted or typed. */
  recurrenceText?: string | null;
  /** Structured schedule. Wins over the text when both are present. */
  recurrence?: MomentRecurrence | null;
  needsReminder?: boolean | null;
  reminderReason?: string | null;
};

export type ResolvedMoment = {
  kind: TimeKind;
  precision: MomentPrecision;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  timezone: string | null;
  recurrence: MomentRecurrence | null;
  recurrenceText: string | null;
  nextOccurrenceAt: string | null;
  needsReminder: boolean;
  reminderReason: string | null;
  remindAt: string | null;
};

/**
 * Normalizes an extracted moment into the four things the product needs to
 * know about it: what it is for, how precisely it was written, when it next
 * happens, and whether that implies a notification.
 *
 * The objective is the point: a plain date is context you can browse by, an
 * event is something that happens, a deadline is something that must be done
 * before a time, and a reminder is an explicit ask. Repetition is orthogonal to
 * all four — a birthday is a yearly all-day event, not a fifth kind of thing —
 * which is why it lives in `recurrence` rather than in `kind`.
 */
export function resolveMoment(
  facts: MomentFacts,
  now: number = Date.now(),
): ResolvedMoment {
  const kind: TimeKind = facts.kind ?? "date";
  const startsAt = facts.startsAt?.trim() || null;
  const allDay = facts.allDay === true;
  const recurrence =
    facts.recurrence ?? parseRecurrence(facts.recurrenceText ?? null);
  const needsReminder = facts.needsReminder === true;

  return {
    kind,
    precision: momentPrecision(startsAt, allDay),
    startsAt,
    endsAt: facts.endsAt?.trim() || null,
    allDay,
    timezone: facts.timezone?.trim() || null,
    recurrence,
    recurrenceText: facts.recurrenceText?.trim() || null,
    nextOccurrenceAt: nextOccurrence(startsAt, recurrence, now) ?? startsAt,
    needsReminder,
    reminderReason: facts.reminderReason?.trim() || null,
    remindAt: deriveReminderAt({
      kind,
      startsAt,
      allDay,
      needsReminder,
      timezone: facts.timezone,
      recurrence,
      from: now,
    }),
  };
}

/**
 * Stores the moment and keeps its armed notification in step.
 *
 * Re-processing a note must never stack a second reminder on the same moment,
 * so the existing trigger is retimed in place when the moment moves and
 * cancelled when the moment stops warranting one. A trigger the user has
 * already cancelled stays cancelled — re-processing is not a way to resurrect
 * a notification someone deliberately turned off.
 */
export async function upsertMomentFacet(
  env: Env,
  userId: string,
  entity: EntityRow,
  resolved: ResolvedMoment,
  context: { noteId: string | null; title: string; body: string },
): Promise<{ armed: boolean }> {
  const db = database(env);
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(entityMoments)
    .where(eq(entityMoments.entity_id, entity.id))
    .get();

  const previousTrigger = existing?.trigger_id ?? null;
  let triggerId = previousTrigger;
  let armed = false;

  // Never schedule into the past: a reminder that has already elapsed by the
  // time the note finishes processing is noise, not help.
  const shouldArm =
    resolved.remindAt !== null && Date.parse(resolved.remindAt) > Date.now();

  if (previousTrigger) {
    const current = await db
      .select()
      .from(triggers)
      .where(eq(triggers.id, previousTrigger))
      .get();

    if (!current || current.status === "cancelled") {
      // The user turned this off, or it is gone. Respect that.
      triggerId = current?.status === "cancelled" ? previousTrigger : null;
      if (current?.status === "cancelled") {
        await writeMoment(env, userId, entity, resolved, triggerId, now);
        return { armed: false };
      }
    } else if (!shouldArm) {
      await db
        .update(triggers)
        .set({ status: "cancelled" })
        .where(eq(triggers.id, previousTrigger));
      triggerId = null;
    } else if (
      current.scheduled_for !== resolved.remindAt ||
      current.status === "triggered"
    ) {
      // A repeating moment reuses one trigger row forever: the last firing is
      // rewound to the next occurrence rather than leaving a graveyard of
      // spent triggers behind it.
      await db
        .update(triggers)
        .set({
          scheduled_for: resolved.remindAt,
          status: "active",
          triggered_at: null,
          title: context.title,
          body: context.body,
        })
        .where(eq(triggers.id, previousTrigger));
      await scheduleTrigger(env, previousTrigger, resolved.remindAt as string);
      armed = true;
    } else {
      armed = current.status === "active";
    }
  }

  if (shouldArm && !triggerId) {
    triggerId = crypto.randomUUID();
    await db.insert(triggers).values({
      id: triggerId,
      user_id: userId,
      type: "time",
      status: "active",
      title: context.title,
      body: context.body,
      scheduled_for: resolved.remindAt,
      timezone: resolved.timezone,
      origin: "ai",
      note_id: context.noteId,
      entity_id: entity.id,
      created_at: now,
    });
    await scheduleTrigger(env, triggerId, resolved.remindAt as string);
    armed = true;
  }

  await writeMoment(env, userId, entity, resolved, triggerId, now);
  return { armed };
}

/**
 * The single writer for a moment.
 *
 * The facet is authoritative and the columns on `entities` are a mirror kept
 * for clients that still read them. Writing both here, and only here, is what
 * makes "which one is right?" a question nobody has to ask.
 */
async function writeMoment(
  env: Env,
  userId: string,
  entity: EntityRow,
  resolved: ResolvedMoment,
  triggerId: string | null,
  now: string,
): Promise<void> {
  const db = database(env);
  const values = {
    kind: resolved.kind,
    precision: resolved.precision,
    starts_at: resolved.startsAt,
    ends_at: resolved.endsAt,
    all_day: Number(resolved.allDay),
    timezone: resolved.timezone,
    recurrence_freq: resolved.recurrence?.freq ?? null,
    recurrence_interval: resolved.recurrence?.interval ?? 1,
    recurrence_until: resolved.recurrence?.until ?? null,
    recurrence_text: resolved.recurrenceText,
    next_occurrence_at: resolved.nextOccurrenceAt,
    needs_reminder: Number(resolved.needsReminder),
    reminder_reason: resolved.reminderReason,
    remind_at: resolved.remindAt,
    trigger_id: triggerId,
    updated_at: now,
  };

  await db.batch([
    db
      .insert(entityMoments)
      .values({
        entity_id: entity.id,
        user_id: userId,
        ...values,
        created_at: now,
      })
      .onConflictDoUpdate({ target: entityMoments.entity_id, set: values }),
    db
      .update(entitiesTable)
      .set({
        starts_at: resolved.startsAt,
        ends_at: resolved.endsAt,
        all_day: Number(resolved.allDay),
        timezone: resolved.timezone,
        recurrence: resolved.recurrenceText,
        time_kind: resolved.kind,
        needs_reminder: Number(resolved.needsReminder),
        reminder_reason: resolved.reminderReason,
        updated_at: now,
      })
      .where(eq(entitiesTable.id, entity.id)),
  ]);
}

/**
 * Rolls a repeating moment on to its next occurrence.
 *
 * Called after a reminder fires and lazily whenever the calendar reads a row
 * whose stored answer has gone stale, so `next_occurrence_at` stays a column
 * you can trust an index on rather than a value that quietly rots.
 */
export async function advanceMoment(
  env: Env,
  row: EntityMomentRow,
  now: number = Date.now(),
): Promise<string | null> {
  const recurrence = recurrenceOf(row);
  const next = nextOccurrence(row.starts_at, recurrence, now);
  if (!next || next === row.next_occurrence_at) return row.next_occurrence_at;

  const remindAt = deriveReminderAt({
    kind: row.kind,
    startsAt: row.starts_at,
    allDay: row.all_day === 1,
    needsReminder: row.needs_reminder === 1,
    timezone: row.timezone,
    recurrence,
    from: now,
  });

  await database(env)
    .update(entityMoments)
    .set({ next_occurrence_at: next, remind_at: remindAt })
    .where(eq(entityMoments.entity_id, row.entity_id));

  row.next_occurrence_at = next;
  row.remind_at = remindAt;
  return next;
}

/** Row → structured schedule, or null when the moment happens once. */
export function recurrenceOf(row: EntityMomentRow): MomentRecurrence | null {
  if (!row.recurrence_freq) return null;
  return {
    freq: row.recurrence_freq,
    interval: row.recurrence_interval || 1,
    until: row.recurrence_until,
  };
}

/**
 * Hands the trigger to a durable workflow that sleeps until it is due. A
 * failure to schedule must not fail the note: the row is the source of truth
 * and can be re-armed, whereas a note that refuses to finish processing is a
 * visible defect.
 */
async function scheduleTrigger(
  env: Env,
  triggerId: string,
  scheduledFor: string,
): Promise<void> {
  try {
    await env.FIRE_TRIGGER.create({ params: { triggerId, scheduledFor } });
  } catch {
    // Left active in the database so it can be re-armed or inspected.
  }
}

/** Row → contract shape for the moment facet. */
export function momentRecord(row: EntityMomentRow): EntityMoment {
  return {
    kind: row.kind,
    precision: row.precision,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day === 1,
    timezone: row.timezone,
    recurrence: recurrenceOf(row),
    nextOccurrenceAt: row.next_occurrence_at,
    needsReminder: row.needs_reminder === 1,
    remindAt: row.remind_at,
    triggerId: row.trigger_id,
    armed: row.trigger_status === "active",
    reminderReason: row.reminder_reason,
  };
}

/**
 * Rolls a repeating moment forward after its notification has fired.
 *
 * Without this a birthday reminds you once and never again. The trigger row is
 * reused rather than replaced so the moment keeps pointing at the same
 * notification — which is also what lets a user switch the series off for good
 * by cancelling it.
 */
export async function rearmRecurringMoment(
  env: Env,
  triggerId: string,
): Promise<boolean> {
  const db = database(env);
  const row = await db
    .select()
    .from(entityMoments)
    .where(eq(entityMoments.trigger_id, triggerId))
    .get();
  if (!row?.recurrence_freq) return false;

  // Step past the occurrence that just fired, otherwise the roll-forward finds
  // the same one again — a deadline reminder fires a day *before* its moment.
  const firedAt = momentInstant(row.next_occurrence_at) ?? Date.now();
  const next = await advanceMoment(env, row, firedAt + 1);
  if (!next || !row.remind_at) return false;
  if (Date.parse(row.remind_at) <= Date.now()) return false;

  await db
    .update(triggers)
    .set({
      status: "active",
      triggered_at: null,
      scheduled_for: row.remind_at,
    })
    .where(eq(triggers.id, triggerId));
  await scheduleTrigger(env, triggerId, row.remind_at);
  return true;
}
