"use client";

import type { MomentOccurrence } from "@lictory/contracts";

import {
  KIND_META,
  WEEKDAY_LABELS,
  dayKey,
  formatTime,
  monthGridDays,
} from "@/lib/moments";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 3;

/**
 * A month at a glance.
 *
 * The grid is always six weeks tall so paging between months never reflows the
 * page, and a day never grows to fit its contents: overflow becomes "+N" and
 * the day panel carries the detail. A cell that can push the whole layout down
 * is how a calendar stops being scannable.
 */
export function MonthGrid({
  month,
  occurrences,
  selected,
  onSelect,
  now,
}: {
  month: Date;
  occurrences: MomentOccurrence[];
  selected: string;
  onSelect: (key: string) => void;
  now: number;
}) {
  const days = monthGridDays(month);
  const todayKey = dayKey(now);

  const byDay = new Map<string, MomentOccurrence[]>();
  for (const occurrence of occurrences) {
    const at = new Date(occurrence.startsAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKey(at);
    const list = byDay.get(key);
    if (list) list.push(occurrence);
    else byDay.set(key, [occurrence]);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-hairline">
      <div className="grid grid-cols-7 border-b border-hairline bg-surface">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-[0.6875rem] font-medium uppercase tracking-wider text-subtle"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const items = byDay.get(key) ?? [];
          const outside = day.getMonth() !== month.getMonth();
          const isToday = key === todayKey;
          const isSelected = key === selected;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className={cn(
                "group relative flex min-h-[5.5rem] flex-col gap-1 border-b border-r border-hairline p-1.5 text-left transition-colors duration-150 sm:min-h-[7rem]",
                "[&:nth-child(7n)]:border-r-0 [&:nth-child(n+36)]:border-b-0",
                outside ? "bg-transparent" : "bg-surface/40",
                "hover:bg-surface-strong",
                isSelected &&
                  "bg-surface-strong ring-1 ring-inset ring-ember/60",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                  outside ? "text-subtle/60" : "text-muted",
                  isToday && "bg-ember font-semibold text-white",
                )}
              >
                {day.getDate()}
              </span>

              {/* Below `sm` a chip cannot be read, so density becomes dots. */}
              <span className="flex flex-wrap gap-1 sm:hidden">
                {items.slice(0, 4).map((occurrence) => (
                  <span
                    key={occurrence.occurrenceId}
                    className={cn(
                      "size-1.5 rounded-full",
                      KIND_META[occurrence.kind].dot,
                    )}
                  />
                ))}
              </span>

              <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {items.slice(0, MAX_CHIPS).map((occurrence) => (
                  <span
                    key={occurrence.occurrenceId}
                    // A month cell is roughly a dozen characters wide, so it
                    // carries the name alone — the time belongs in the day
                    // panel and the agenda, where there is room to read it.
                    title={`${formatTime(occurrence)} · ${occurrence.name}`}
                    className={cn(
                      "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.6875rem] leading-tight",
                      KIND_META[occurrence.kind].chip,
                      outside && "opacity-60",
                    )}
                  >
                    <span className="truncate">{occurrence.name}</span>
                  </span>
                ))}
                {items.length > MAX_CHIPS ? (
                  <span className="px-1.5 text-[0.6875rem] text-subtle">
                    +{items.length - MAX_CHIPS} more
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
