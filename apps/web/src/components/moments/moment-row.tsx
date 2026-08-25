"use client";

import type { MomentOccurrence } from "@lictory/contracts";
import { formatRecurrence } from "@lictory/contracts";
import Link from "next/link";

import { BellIcon, RefreshIcon, StickyNoteIcon } from "@/components/ui/icons";
import { entityHref } from "@/lib/entities";
import { KIND_META, distanceLabel, formatTime } from "@/lib/moments";
import { cn } from "@/lib/utils";

/**
 * One occurrence in a list.
 *
 * Everything the moment model now knows is visible here — its objective, its
 * schedule, whether a notification is really armed, and how many notes it came
 * from — because a field the user cannot see is a field they cannot correct.
 */
export function MomentRow({
  occurrence,
  /**
   * "Now" is passed in rather than read here: the React Compiler rules forbid
   * calling an impure function during render, and one clock shared by the whole
   * view also stops two rows disagreeing about what today is.
   */
  now,
  showDistance = false,
  compact = false,
}: {
  occurrence: MomentOccurrence;
  now: number;
  showDistance?: boolean;
  compact?: boolean;
}) {
  const meta = KIND_META[occurrence.kind];
  const repeat = formatRecurrence(occurrence.recurrence);
  const past = new Date(occurrence.startsAt).getTime() < now;

  return (
    <Link
      href={entityHref(occurrence.entityId)}
      className={cn(
        "group relative flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 transition-[background-color,border-color,transform] duration-150",
        "hover:border-hairline hover:bg-surface active:scale-[0.995]",
        compact ? "py-2" : "py-2.5",
        past && "opacity-70 hover:opacity-100",
      )}
    >
      <span
        aria-hidden
        className={cn("h-8 w-[3px] shrink-0 rounded-full", meta.accent)}
      />

      <span
        className={cn(
          "shrink-0 text-[0.8125rem] tabular-nums",
          // The narrow panel gives its width to the name instead of reserving a
          // column that is empty for every all-day moment.
          compact ? "w-[3.75rem]" : "w-[4.5rem]",
          occurrence.allDay || occurrence.precision !== "minute"
            ? "text-subtle"
            : "font-medium text-foreground",
        )}
      >
        {formatTime(occurrence)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {occurrence.name}
          </span>
          {occurrence.repeated || repeat ? (
            <RefreshIcon
              className="size-3 shrink-0 text-subtle"
              aria-label={repeat ?? "Repeats"}
            />
          ) : null}
        </span>
        {occurrence.reminderReason || repeat ? (
          <span className="mt-0.5 block truncate text-xs text-subtle">
            {occurrence.reminderReason ?? repeat}
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {showDistance ? (
          <span className="hidden text-xs text-subtle sm:inline">
            {distanceLabel(occurrence.startsAt, new Date(now))}
          </span>
        ) : null}
        {occurrence.armed ? (
          <span
            title="A reminder is scheduled"
            className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--ember)/0.3)] bg-[rgb(var(--ember)/0.12)] px-1.5 py-0.5 text-[0.6875rem] text-ember-bright"
          >
            <BellIcon className="size-3" aria-hidden />
          </span>
        ) : null}
        {compact ? (
          <span
            aria-label={meta.label}
            className={cn("size-1.5 rounded-full", meta.dot)}
          />
        ) : (
          <span
            className={cn(
              "hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] sm:inline-flex",
              meta.chip,
            )}
          >
            {meta.label}
          </span>
        )}
        {occurrence.noteCount > 0 && !compact ? (
          <span className="hidden items-center gap-1 text-xs text-subtle md:inline-flex">
            <StickyNoteIcon className="size-3" aria-hidden />
            {occurrence.noteCount}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
