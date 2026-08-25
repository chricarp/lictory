import type { MomentOccurrence, TimeKind } from "@lictory/contracts";

/**
 * Calendar arithmetic for the moments view.
 *
 * Everything here works in the viewer's local timezone, because a calendar is
 * about the day a person is living in rather than the instant a moment was
 * recorded at. Kept pure and separate from the components so the grouping rules
 * can be reasoned about — and corrected — without touching layout.
 */

export type KindMeta = {
  label: string;
  /** Border + background + text for a chip on the month grid. */
  chip: string;
  /** A solid dot, used where a chip would be too heavy. */
  dot: string;
  accent: string;
};

/**
 * One hue per objective, used consistently so colour carries meaning: a
 * deadline is the only red thing on the page and an explicit reminder is the
 * only ember one.
 */
export const KIND_META: Record<TimeKind, KindMeta> = {
  date: {
    label: "Date",
    chip: "border-hairline bg-surface text-muted",
    dot: "bg-[rgb(var(--subtle-foreground))]",
    accent: "bg-[rgb(var(--subtle-foreground))]",
  },
  event: {
    label: "Event",
    chip: "border-[rgb(var(--entity-time)/0.3)] bg-[rgb(var(--entity-time)/0.12)] text-[rgb(var(--entity-time))]",
    dot: "bg-[rgb(var(--entity-time))]",
    accent: "bg-[rgb(var(--entity-time))]",
  },
  deadline: {
    label: "Deadline",
    chip: "border-[rgb(var(--danger)/0.3)] bg-[rgb(var(--danger)/0.12)] text-[rgb(var(--danger))]",
    dot: "bg-[rgb(var(--danger))]",
    accent: "bg-[rgb(var(--danger))]",
  },
  reminder: {
    label: "Reminder",
    chip: "border-[rgb(var(--ember)/0.35)] bg-[rgb(var(--ember)/0.14)] text-ember-bright",
    dot: "bg-[rgb(var(--ember))]",
    accent: "bg-[rgb(var(--ember))]",
  },
};

/* ------------------------------- Day keys -------------------------------- */

/** `YYYY-MM-DD` in local time — the key every grouping in this view uses. */
export function dayKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfDay(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(value: Date, months: number): Date {
  const next = new Date(value.getFullYear(), value.getMonth() + months, 1);
  return next;
}

/** Monday-first, matching the week the rest of the world outside the US uses. */
export function startOfWeek(value: Date): Date {
  const date = startOfDay(value);
  const weekday = (date.getDay() + 6) % 7;
  return addDays(date, -weekday);
}

/**
 * The six-week block a month grid draws. Fixed at 42 cells so the grid never
 * changes height between months — a calendar that reflows as you page through
 * it is disorienting.
 */
export function monthGridDays(month: Date): Date[] {
  const first = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

/* ------------------------------- Grouping -------------------------------- */

export type DayBucket = {
  key: string;
  date: Date;
  occurrences: MomentOccurrence[];
};

export type Section = {
  id: "today" | "tomorrow" | "week" | "month" | "later";
  title: string;
  /** Shown when the section is empty, so the shape of the page never changes. */
  emptyHint: string;
  days: DayBucket[];
  count: number;
};

export function groupByDay(occurrences: MomentOccurrence[]): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (const occurrence of occurrences) {
    const date = new Date(occurrence.startsAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    const bucket = buckets.get(key);
    if (bucket) bucket.occurrences.push(occurrence);
    else
      buckets.set(key, {
        key,
        date: startOfDay(date),
        occurrences: [occurrence],
      });
  }
  return [...buckets.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

/**
 * Splits the agenda into the horizons a person actually plans against.
 *
 * "Complete picture" is the requirement, so the sections are exhaustive and
 * ordered: nothing in the window can fall between two of them, and an empty
 * section still renders with a hint rather than vanishing.
 */
export function sectionize(
  occurrences: MomentOccurrence[],
  now: Date = new Date(),
): Section[] {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const weekEnd = addDays(startOfWeek(today), 7);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const sections: Section[] = [
    {
      id: "today",
      title: "Today",
      emptyHint: "Nothing scheduled today.",
      days: [],
      count: 0,
    },
    {
      id: "tomorrow",
      title: "Tomorrow",
      emptyHint: "Tomorrow is clear.",
      days: [],
      count: 0,
    },
    {
      id: "week",
      title: "Rest of this week",
      emptyHint: "Nothing else this week.",
      days: [],
      count: 0,
    },
    {
      id: "month",
      title: "Later this month",
      emptyHint: "Nothing else this month.",
      days: [],
      count: 0,
    },
    {
      id: "later",
      title: "Further ahead",
      emptyHint: "Nothing on the horizon.",
      days: [],
      count: 0,
    },
  ];
  const byId = new Map(sections.map((section) => [section.id, section]));

  for (const bucket of groupByDay(occurrences)) {
    const at = bucket.date.getTime();
    // `weekEnd` can already be behind `dayAfter` late in the week, which is why
    // the comparisons cascade rather than testing ranges independently.
    const id: Section["id"] =
      at < tomorrow.getTime()
        ? "today"
        : at < dayAfter.getTime()
          ? "tomorrow"
          : at < weekEnd.getTime()
            ? "week"
            : at < monthEnd.getTime()
              ? "month"
              : "later";
    const section = byId.get(id);
    if (!section) continue;
    section.days.push(bucket);
    section.count += bucket.occurrences.length;
  }

  return sections;
}

/* ------------------------------ Formatting ------------------------------- */

export function formatTime(occurrence: MomentOccurrence): string {
  if (occurrence.allDay || occurrence.precision !== "minute") return "All day";
  return new Date(occurrence.startsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDayLabel(date: Date, now: Date = new Date()): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(addDays(startOfDay(now), 1))) return "Tomorrow";
  if (key === dayKey(addDays(startOfDay(now), -1))) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function formatMonthLabel(month: Date): string {
  return month.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** "in 3 days" / "2 hours ago" — the distance a person reads at a glance. */
export function distanceLabel(iso: string, now: Date = new Date()): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "";
  const days = Math.round(
    (startOfDay(target).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  if (days === 0) {
    const minutes = Math.round((target - now.getTime()) / 60_000);
    if (minutes > 0 && minutes < 60) return `in ${minutes} min`;
    if (minutes >= 60) return `in ${Math.round(minutes / 60)} h`;
    return "today";
  }
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1 && days < 30) return `in ${days} days`;
  if (days < -1 && days > -30) return `${Math.abs(days)} days ago`;
  const months = Math.round(days / 30);
  return months > 0 ? `in ${months} mo` : `${Math.abs(months)} mo ago`;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
