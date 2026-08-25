import { type MomentOccurrence, occurrencesBetween } from "@lictory/contracts";
import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import type { EntityMomentRow } from "../../infrastructure/database/rows";
import { errorBody } from "../../http/errors";
import { advanceMoment, recurrenceOf } from "../entities/moments";

const moments = new Hono<AppBindings>();

/** A moment plus the presentation bits that live on its entity. */
type MomentQueryRow = EntityMomentRow & {
  name: string;
  color: string | null;
  origin: "ai" | "user";
  note_count: number;
  trigger_status: "active" | "triggered" | "cancelled" | null;
};

/**
 * A calendar month with a week of bleed on either side is the widest thing the
 * UI asks for; anything larger is a client bug, not a use case.
 */
const MAX_RANGE_DAYS = 400;

/**
 * Every occurrence in a window.
 *
 * A repeating moment is one row, so the range cannot be answered by a `BETWEEN`
 * alone: repeating rows are always candidates and are expanded in memory, while
 * one-offs are filtered in SQL by the indexed `next_occurrence_at`. A personal
 * graph has tens of repeating moments, not thousands, which is what makes
 * expansion cheaper than materialising an occurrence table that would then have
 * to be kept in step with every edit.
 */
moments.get("/", async (c) => {
  const userId = c.get("userId");
  const now = Date.now();

  const from = parseBound(c.req.query("from"), startOfMonth(now, -1));
  const to = parseBound(c.req.query("to"), startOfMonth(now, 2));
  if (from === null || to === null || to <= from) {
    return c.json(errorBody("invalid_range", "from must come before to"), 400);
  }
  if (to - from > MAX_RANGE_DAYS * 86_400_000) {
    return c.json(
      errorBody("range_too_wide", `Ask for at most ${MAX_RANGE_DAYS} days`),
      400,
    );
  }

  const { results } = await c.env.DB.prepare(
    `SELECT m.*, e.name, e.color, e.origin, t.status AS trigger_status, (
       SELECT COUNT(*) FROM note_entities ne
        WHERE ne.entity_id = m.entity_id AND ne.status <> 'rejected'
     ) AS note_count
       FROM entity_moments m
       JOIN entities e ON e.id = m.entity_id
       LEFT JOIN triggers t ON t.id = m.trigger_id
      WHERE m.user_id = ?
        AND m.starts_at IS NOT NULL
        AND (
          m.recurrence_freq IS NOT NULL
          OR (m.starts_at < ? AND COALESCE(m.ends_at, m.starts_at) >= ?)
          OR (m.starts_at >= ? AND m.starts_at < ?)
        )
      LIMIT 2000`,
  )
    .bind(
      userId,
      new Date(to).toISOString(),
      new Date(from).toISOString(),
      new Date(from).toISOString(),
      new Date(to).toISOString(),
    )
    .all<MomentQueryRow>();

  const occurrences: MomentOccurrence[] = [];
  for (const row of results ?? []) {
    const recurrence = recurrenceOf(row);

    // Self-healing: a repeating moment whose stored answer has been overtaken
    // by time is corrected here, so the column an index depends on cannot rot.
    if (recurrence) await advanceMoment(c.env, row, now);

    const windows = occurrencesBetween(
      row.starts_at,
      row.ends_at,
      recurrence,
      from,
      to,
    );
    const anchor = row.starts_at?.trim();
    for (const window of windows) {
      occurrences.push({
        occurrenceId: `${row.entity_id}:${window.startsAt}`,
        entityId: row.entity_id,
        name: row.name,
        kind: row.kind,
        precision: row.precision,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        allDay: row.all_day === 1,
        timezone: row.timezone,
        recurrence,
        repeated: window.startsAt !== anchor,
        remindAt: row.remind_at,
        armed: row.trigger_status === "active",
        reminderReason: row.reminder_reason,
        color: row.color,
        origin: row.origin,
        noteCount: row.note_count ?? 0,
      });
    }
  }

  occurrences.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.name.localeCompare(b.name),
  );

  return c.json({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    occurrences,
  });
});

/** Accepts an ISO instant or a bare date, both of which the client sends. */
function parseBound(
  value: string | undefined,
  fallback: number,
): number | null {
  if (!value) return fallback;
  const parsed = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value,
  );
  return Number.isNaN(parsed) ? null : parsed;
}

function startOfMonth(at: number, monthOffset: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1);
}

export { moments as momentRoutes };
