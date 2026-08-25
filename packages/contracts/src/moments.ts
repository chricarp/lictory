import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*                                 Recurrence                                 */
/* -------------------------------------------------------------------------- */

/**
 * How a moment repeats.
 *
 * A birthday is not a fifth kind of moment — it is a yearly, all-day moment
 * whose anchor happens to be a year in the past. Modelling repetition instead
 * of enumerating occasions is what lets one row answer "when is this next?"
 * forever, and it is why the free-text `recurrence` column this replaces was
 * never usable: nothing could interpret it.
 */
export const recurrenceFreqSchema = z.enum([
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
export type RecurrenceFreq = z.infer<typeof recurrenceFreqSchema>;

export const momentRecurrenceSchema = z.object({
  freq: recurrenceFreqSchema,
  /** Repeat every N periods. 1 means every period. */
  interval: z.number().int().min(1).max(365).default(1),
  /** Inclusive last date the series may produce, or null for open-ended. */
  until: z.string().nullable().default(null),
});
export type MomentRecurrence = z.infer<typeof momentRecurrenceSchema>;

/**
 * Ordered most specific first. The plural forms matter more than they look:
 * "every 3 months" contains "mon", so a lazy weekday pattern silently turns a
 * quarterly schedule into a weekly one.
 */
const FREQ_WORDS: [RegExp, RecurrenceFreq][] = [
  [/\b(years?|yearly|annual(ly)?|birthdays?|anniversar(y|ies))\b/, "yearly"],
  [/\b(months?|monthly)\b/, "monthly"],
  [
    /\b(weeks?|weekly|mon(day)?s?|tue(s|sday)?s?|wed(nesday)?s?|thu(r|rs|rsday)?s?|fri(day)?s?|sat(urday)?s?|sun(day)?s?)\b/,
    "weekly",
  ],
  [
    /\b(days?|daily|every\s+day|each\s+day|every\s+morning|every\s+night)\b/,
    "daily",
  ],
];

const INTERVAL_WORDS: Record<string, number> = {
  other: 2,
  second: 2,
  two: 2,
  three: 3,
  four: 4,
};

/**
 * Reads the model's free-text schedule into something that can be evaluated.
 *
 * The extractor emits prose because prose is what notes contain. Parsing it at
 * the boundary keeps a single interpretation of "every other Tuesday" in the
 * database, rather than one per reader.
 */
export function parseRecurrence(
  text: string | null | undefined,
): MomentRecurrence | null {
  if (!text) return null;
  const value = text.toLowerCase().trim();
  if (!value || /\b(never|once|one[- ]?off|no repeat)\b/.test(value))
    return null;

  // "biweekly"/"bimonthly" are ambiguous in English; treat the common reading.
  const prefixed = /\bbi[- ]?(week|month|annual|year)/.exec(value);

  let freq: RecurrenceFreq | null = null;
  for (const [pattern, candidate] of FREQ_WORDS) {
    if (pattern.test(value)) {
      freq = candidate;
      break;
    }
  }
  if (prefixed) {
    freq = prefixed[1]?.startsWith("week")
      ? "weekly"
      : prefixed[1]?.startsWith("month")
        ? "monthly"
        : "yearly";
  }
  if (!freq) return null;

  let interval = prefixed ? 2 : 1;
  const numeric = /every\s+(\d{1,3})\s/.exec(value);
  if (numeric?.[1]) interval = Math.min(365, Math.max(1, Number(numeric[1])));
  else {
    const worded = /every\s+([a-z]+)\s/.exec(value);
    const mapped = worded?.[1] ? INTERVAL_WORDS[worded[1]] : undefined;
    if (mapped) interval = mapped;
  }

  const until = /\b(until|through|till)\s+(\d{4}-\d{2}-\d{2})/.exec(value);

  return { freq, interval, until: until?.[2] ?? null };
}

/** A human sentence for a schedule, shared by every surface that shows one. */
export function formatRecurrence(
  recurrence: MomentRecurrence | null | undefined,
): string | null {
  if (!recurrence) return null;
  const { freq, interval } = recurrence;
  const noun =
    freq === "daily"
      ? "day"
      : freq === "weekly"
        ? "week"
        : freq === "monthly"
          ? "month"
          : "year";
  if (interval === 1) return `Every ${noun}`;
  if (interval === 2) return `Every other ${noun}`;
  return `Every ${interval} ${noun}s`;
}

/* -------------------------------------------------------------------------- */
/*                                Occurrences                                 */
/* -------------------------------------------------------------------------- */

const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})(.*)$/;

/**
 * Milliseconds for an ISO string, treating a bare date as UTC midnight so that
 * date-only and instant-precision moments can be compared with one another.
 */
export function momentInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed,
  );
  return Number.isNaN(parsed) ? null : parsed;
}

/** Days in a Gregorian month, so a monthly series never falls off the end. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Shifts a moment's calendar date by whole periods while leaving its clock time
 * and UTC offset exactly as written.
 *
 * Working on the string rather than a `Date` is deliberate: a birthday at
 * 09:00 in Rome must stay 09:00 in Rome across a daylight-saving boundary, and
 * round-tripping through an absolute instant is precisely what breaks that.
 */
function shift(
  value: string,
  freq: RecurrenceFreq,
  steps: number,
): string | null {
  const match = DATE_PARTS.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, rest = ""] = match;
  let year = Number(y);
  let month = Number(m) - 1;
  let day = Number(d);

  if (freq === "yearly") year += steps;
  else if (freq === "monthly") {
    const total = year * 12 + month + steps;
    year = Math.floor(total / 12);
    month = ((total % 12) + 12) % 12;
    day = Math.min(day, daysInMonth(year, month));
  } else {
    const days = freq === "weekly" ? steps * 7 : steps;
    const shifted = new Date(Date.UTC(year, month, day + days));
    year = shifted.getUTCFullYear();
    month = shifted.getUTCMonth();
    day = shifted.getUTCDate();
  }

  if (year < 1 || year > 9999) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month + 1)}-${pad(day)}${rest}`;
}

/** How many whole periods separate two instants, as a lower bound. */
function periodsBetween(
  fromMs: number,
  toMs: number,
  freq: RecurrenceFreq,
): number {
  const days = (toMs - fromMs) / 86_400_000;
  const per =
    freq === "daily"
      ? 1
      : freq === "weekly"
        ? 7
        : freq === "monthly"
          ? 30
          : 365;
  return Math.floor(days / per);
}

/** Guard against a pathological interval turning one row into a hot loop. */
const MAX_STEPS = 4_000;

/**
 * The first occurrence at or after `from`.
 *
 * For a moment that does not repeat this is simply its own start, which is what
 * makes `next_occurrence_at` a single column the calendar can sort by without
 * caring whether a row recurs.
 */
export function nextOccurrence(
  startsAt: string | null | undefined,
  recurrence: MomentRecurrence | null | undefined,
  from: string | number | Date = Date.now(),
): string | null {
  if (!startsAt) return null;
  const anchor = startsAt.trim();
  const anchorMs = momentInstant(anchor);
  if (anchorMs === null) return null;

  const fromMs =
    typeof from === "number"
      ? from
      : from instanceof Date
        ? from.getTime()
        : (momentInstant(from) ?? Date.now());

  // A one-off has exactly one occurrence, so it is always its own answer —
  // callers that only want the future compare the result themselves.
  if (!recurrence) return anchor;
  if (anchorMs >= fromMs) return anchor;

  const untilMs = momentInstant(recurrence.until);
  const { freq, interval } = recurrence;

  // Jump most of the way in one arithmetic step, then walk the remainder so
  // month-length and leap-day clamping stay correct.
  const guess = Math.max(
    0,
    Math.floor(periodsBetween(anchorMs, fromMs, freq) / interval),
  );
  let candidate = shift(anchor, freq, guess * interval) ?? anchor;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const candidateMs = momentInstant(candidate);
    if (candidateMs === null) return null;
    if (untilMs !== null && candidateMs > untilMs) return null;
    if (candidateMs >= fromMs) return candidate;
    const advanced = shift(candidate, freq, interval);
    if (!advanced) return null;
    candidate = advanced;
  }
  return null;
}

export type MomentOccurrenceWindow = {
  startsAt: string;
  endsAt: string | null;
};

/**
 * Every occurrence that falls inside `[from, to)`.
 *
 * The calendar asks for a month at a time, so expansion is bounded by the
 * window rather than materialised into rows. A recurring moment stays one row
 * and one edit; there is no occurrence table to keep in step with it.
 */
export function occurrencesBetween(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  recurrence: MomentRecurrence | null | undefined,
  from: string | number | Date,
  to: string | number | Date,
  cap = 400,
): MomentOccurrenceWindow[] {
  const anchorMs = momentInstant(startsAt);
  if (!startsAt || anchorMs === null) return [];

  const fromMs =
    typeof from === "number"
      ? from
      : from instanceof Date
        ? from.getTime()
        : (momentInstant(from) ?? 0);
  const toMs =
    typeof to === "number"
      ? to
      : to instanceof Date
        ? to.getTime()
        : (momentInstant(to) ?? 0);
  if (toMs <= fromMs) return [];

  // The span is carried forward so a multi-day occurrence keeps its length.
  const endMs = momentInstant(endsAt);
  const spanMs = endMs !== null && endMs > anchorMs ? endMs - anchorMs : null;

  const windows: MomentOccurrenceWindow[] = [];
  let cursor = nextOccurrence(startsAt, recurrence, fromMs);

  while (cursor && windows.length < cap) {
    const cursorMs = momentInstant(cursor);
    if (cursorMs === null || cursorMs >= toMs) break;
    // `nextOccurrence` hands back the anchor for a one-off even when it has
    // already passed, so the lower bound is enforced here rather than there.
    if (cursorMs >= fromMs) {
      windows.push({
        startsAt: cursor,
        endsAt:
          spanMs === null
            ? cursor === startsAt.trim()
              ? (endsAt ?? null)
              : null
            : new Date(cursorMs + spanMs).toISOString(),
      });
    }
    if (!recurrence) break;
    const advanced = shift(cursor, recurrence.freq, recurrence.interval);
    if (!advanced) break;
    const untilMs = momentInstant(recurrence.until);
    const advancedMs = momentInstant(advanced);
    if (advancedMs === null) break;
    if (untilMs !== null && advancedMs > untilMs) break;
    cursor = advanced;
  }

  return windows;
}

/* -------------------------------------------------------------------------- */
/*                              Calendar contract                             */
/* -------------------------------------------------------------------------- */

/**
 * One dated cell in the calendar. A recurring moment produces several of these
 * from a single entity, which is why `entityId` is not unique in a range
 * response and `occurrenceId` exists to key a list.
 */
export const momentOccurrenceSchema = z.object({
  occurrenceId: z.string(),
  entityId: z.string(),
  name: z.string(),
  kind: z.enum(["date", "event", "deadline", "reminder"]),
  precision: z.enum(["minute", "day", "month", "year", "unknown"]),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  allDay: z.boolean(),
  timezone: z.string().nullable(),
  recurrence: momentRecurrenceSchema.nullable(),
  /** True when this cell came from a repeat rather than the anchor itself. */
  repeated: z.boolean(),
  remindAt: z.string().nullable(),
  armed: z.boolean(),
  reminderReason: z.string().nullable(),
  color: z.string().nullable(),
  origin: z.enum(["ai", "user"]),
  noteCount: z.number().int().nonnegative(),
});
export type MomentOccurrence = z.infer<typeof momentOccurrenceSchema>;

export const momentRangeResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  occurrences: z.array(momentOccurrenceSchema),
});
export type MomentRangeResponse = z.infer<typeof momentRangeResponseSchema>;
