"use client";

import type { MomentOccurrence } from "@lictory/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { EntityPicker } from "@/components/entities/entity-picker";
import { MomentRow } from "@/components/moments/moment-row";
import { MonthGrid } from "@/components/moments/month-grid";
import { Button } from "@/components/ui/button";
import {
  BellIcon,
  CalendarClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
  CloseIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useResource } from "@/lib/api";
import {
  addDays,
  addMonths,
  dayKey,
  formatDayLabel,
  formatMonthLabel,
  monthGridDays,
  sectionize,
  startOfDay,
} from "@/lib/moments";
import { cn } from "@/lib/utils";

type View = "upcoming" | "month";

/** How far ahead the agenda looks. Long enough to hold a year of birthdays. */
const UPCOMING_DAYS = 365;

/**
 * The moments calendar.
 *
 * Two views answer two different questions and neither substitutes for the
 * other: the agenda answers "what is coming", ordered and grouped by the
 * horizons a person plans against, and the month answers "what does this period
 * look like", where an empty week is as informative as a busy one. Both read
 * the same expanded range, so a repeating moment is one row in the database and
 * appears on every day it actually falls on.
 */
export function MomentsCalendar() {
  const api = useApi();
  // One clock for the whole view. The React Compiler rules forbid reading the
  // time during render, and a shared value also keeps every row's idea of
  // "today" identical. Ticking each minute keeps "in 3 min" honest.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(handle);
  }, []);

  // Day granularity, so the fetched range and the section boundaries only move
  // at midnight rather than on every tick of the clock above.
  const day = React.useMemo(() => startOfDay(now).getTime(), [now]);

  /**
   * The view and the focused day live in the URL rather than in state.
   *
   * A calendar is a place, not a mode: reloading, sharing or coming back from a
   * moment's detail page should land you on the same week you were looking at.
   */
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view: View = params.get("view") === "month" ? "month" : "upcoming";
  const focused = params.get("d");
  const selectedDay = focused ?? dayKey(day);
  const month = React.useMemo(() => {
    const anchor = new Date(`${selectedDay}T00:00:00`);
    const valid = Number.isNaN(anchor.getTime()) ? new Date(day) : anchor;
    return new Date(valid.getFullYear(), valid.getMonth(), 1);
  }, [selectedDay, day]);

  const navigate = React.useCallback(
    (next: { view?: View; day?: string }) => {
      const search = new URLSearchParams(params.toString());
      if (next.view) search.set("view", next.view);
      if (next.day) search.set("d", next.day);
      router.replace(`${pathname}?${search.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  /**
   * Paging to another month moves the selection with it, landing on today when
   * today is in view and on the 1st otherwise. A day panel describing a month
   * that is no longer on screen reads as a bug even when the data is right.
   */
  const showMonth = (next: Date) => {
    const today = new Date(day);
    navigate({
      day: dayKey(
        today.getFullYear() === next.getFullYear() &&
          today.getMonth() === next.getMonth()
          ? today
          : next,
      ),
    });
  };

  const [query, setQuery] = React.useState("");
  const [picking, setPicking] = React.useState(false);

  // The month view needs the six-week block it draws, including the bleed days
  // from the neighbouring months that are actually on screen.
  const range = React.useMemo(() => {
    if (view === "month") {
      const days = monthGridDays(month);
      const first = days[0] ?? month;
      const last = days[days.length - 1] ?? month;
      return {
        from: first.toISOString(),
        to: addDays(last, 1).toISOString(),
      };
    }
    // Deliberately anchored to the day, not the minute: recomputing the range
    // every tick would refetch the agenda once a minute for no new information.
    const today = startOfDay(day);
    return {
      from: today.toISOString(),
      to: addDays(today, UPCOMING_DAYS).toISOString(),
    };
  }, [view, month, day]);

  const moments = useResource(`moments:${range.from}:${range.to}`, () =>
    api.listMoments(range),
  );

  const occurrences = React.useMemo(() => {
    const all = moments.data?.occurrences ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((item) => item.name.toLowerCase().includes(needle));
  }, [moments.data, query]);

  const sections = React.useMemo(
    () => sectionize(occurrences, new Date(day)),
    [occurrences, day],
  );

  const goToToday = () => navigate({ day: dayKey(day) });

  const selectedOccurrences = occurrences.filter(
    (item) => dayKey(new Date(item.startsAt)) === selectedDay,
  );

  const createMoment = async (
    input: Parameters<React.ComponentProps<typeof EntityPicker>["onSubmit"]>[0],
  ) => {
    if (!input.entity) return;
    await api.createEntity(input.entity);
    toast.success("Moment saved");
    await moments.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        view={view}
        onView={(next) => navigate({ view: next })}
        month={month}
        onMonth={showMonth}
        onToday={goToToday}
        query={query}
        onQuery={setQuery}
        onAdd={() => setPicking(true)}
      />

      <Glance
        view={view}
        month={month}
        sections={sections}
        occurrences={occurrences}
        loading={moments.initialLoading}
      />

      {moments.error ? (
        <Failure onRetry={() => void moments.refresh()} />
      ) : moments.initialLoading ? (
        <LoadingState view={view} />
      ) : view === "upcoming" ? (
        <Agenda
          sections={sections}
          empty={occurrences.length === 0}
          now={now}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <MonthGrid
            month={month}
            occurrences={occurrences}
            selected={selectedDay}
            onSelect={(key) => navigate({ day: key })}
            now={now}
          />
          <DayPanel
            day={selectedDay}
            occurrences={selectedOccurrences}
            now={now}
          />
        </div>
      )}

      <EntityPicker
        open={picking}
        onOpenChange={setPicking}
        initialType="time"
        onSubmit={createMoment}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Toolbar({
  view,
  onView,
  month,
  onMonth,
  onToday,
  query,
  onQuery,
  onAdd,
}: {
  view: View;
  onView: (view: View) => void;
  month: Date;
  onMonth: (month: Date) => void;
  onToday: () => void;
  query: string;
  onQuery: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Moments
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {view === "month"
              ? formatMonthLabel(month)
              : "Everything ahead, from your notes."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {view === "month" ? (
            <div className="flex items-center gap-1 rounded-md border border-hairline-strong p-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous month"
                onClick={() => onMonth(addMonths(month, -1))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next month"
                onClick={() => onMonth(addMonths(month, 1))}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onToday}>
            Today
          </Button>
          <ViewToggle view={view} onView={onView} />
          <Button variant="primary" size="sm" onClick={onAdd}>
            <PlusIcon />
            <span className="hidden sm:inline">Add moment</span>
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Filter moments"
          className="pl-9 pr-9"
          aria-label="Filter moments"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle transition-colors hover:text-foreground"
          >
            <CloseIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ViewToggle({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  const options: { id: View; label: string }[] = [
    { id: "upcoming", label: "Upcoming" },
    { id: "month", label: "Month" },
  ];
  return (
    <div className="flex items-center rounded-md border border-hairline-strong p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onView(option.id)}
          aria-pressed={view === option.id}
          className={cn(
            "rounded-[0.4rem] px-3 py-1 text-[0.8125rem] font-medium transition-colors duration-150",
            view === option.id
              ? "bg-surface-strong text-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The four numbers that make the window legible before anything is read.
 *
 * They follow the view rather than staying fixed: "Today" is a lie in a month
 * you have paged away from, so the month view counts what is actually on
 * screen instead.
 */
function Glance({
  view,
  month,
  sections,
  occurrences,
  loading,
}: {
  view: View;
  month: Date;
  sections: ReturnType<typeof sectionize>;
  occurrences: MomentOccurrence[];
  loading: boolean;
}) {
  const find = (id: string) => sections.find((s) => s.id === id)?.count ?? 0;
  const inMonth = occurrences.filter(
    (item) => new Date(item.startsAt).getMonth() === month.getMonth(),
  );
  const count = (kind: MomentOccurrence["kind"]) =>
    inMonth.filter((item) => item.kind === kind).length;

  const stats =
    view === "month"
      ? [
          { label: formatMonthLabel(month), value: inMonth.length },
          { label: "Events", value: count("event") },
          { label: "Deadlines", value: count("deadline") },
          {
            label: "Reminders armed",
            value: inMonth.filter((item) => item.armed).length,
            icon: BellIcon,
          },
        ]
      : [
          { label: "Today", value: find("today") },
          {
            label: "This week",
            value: find("today") + find("tomorrow") + find("week"),
          },
          { label: "Next 12 months", value: occurrences.length },
          {
            label: "Reminders armed",
            value: occurrences.filter((item) => item.armed).length,
            icon: BellIcon,
          },
        ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-lg border border-hairline bg-surface px-3 py-2.5"
        >
          <span className="flex items-center gap-1.5 truncate text-[0.6875rem] font-medium uppercase tracking-wider text-subtle">
            {stat.icon ? <stat.icon className="size-3" aria-hidden /> : null}
            {stat.label}
          </span>
          {/* A skeleton is a <div>, so the value slot cannot be a <p>. */}
          <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {loading ? <Skeleton className="h-6 w-8" /> : stat.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Agenda({
  sections,
  empty,
  now,
}: {
  sections: ReturnType<typeof sectionize>;
  empty: boolean;
  now: number;
}) {
  if (empty) {
    return (
      <EmptyState
        title="No moments yet"
        body="Capture a note with a date in it, or add a moment by hand. Birthdays and recurring plans keep showing up on their own."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-2">
          <div className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-canvas/90 px-1 py-1.5 backdrop-blur">
            <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
              {section.title}
            </h2>
            {section.count > 0 ? (
              <span className="text-xs tabular-nums text-subtle">
                {section.count}
              </span>
            ) : null}
          </div>

          {section.days.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline px-3 py-3 text-sm text-subtle">
              {section.emptyHint}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {section.days.map((bucket) => (
                <div
                  key={bucket.key}
                  // `grid-cols-1` is explicit: an implicit column is sized to
                  // max-content, so one long AI summary would widen the whole
                  // page on a phone.
                  className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
                >
                  <div className="pt-2 sm:sticky sm:top-12 sm:self-start">
                    <p className="text-sm font-medium text-foreground">
                      {formatDayLabel(bucket.date, new Date(now))}
                    </p>
                    <p className="text-xs text-subtle">
                      {bucket.date.toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-col rounded-xl border border-hairline p-1">
                    {bucket.occurrences.map((occurrence) => (
                      <MomentRow
                        key={occurrence.occurrenceId}
                        occurrence={occurrence}
                        now={now}
                        showDistance
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function DayPanel({
  day,
  occurrences,
  now,
}: {
  day: string;
  occurrences: MomentOccurrence[];
  now: number;
}) {
  const date = new Date(`${day}T00:00:00`);
  return (
    <aside className="flex h-fit flex-col gap-2 rounded-xl border border-hairline p-3 lg:sticky lg:top-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {formatDayLabel(date, new Date(now))}
        </h2>
        <p className="text-xs text-subtle">
          {date.toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
      {occurrences.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline px-3 py-4 text-sm text-subtle">
          Nothing on this day.
        </p>
      ) : (
        <div className="flex flex-col">
          {occurrences.map((occurrence) => (
            <MomentRow
              key={occurrence.occurrenceId}
              occurrence={occurrence}
              now={now}
              compact
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function LoadingState({ view }: { view: View }) {
  if (view === "month") {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-[28rem] w-full rounded-xl" />
        <Skeleton className="hidden h-64 w-full rounded-xl lg:block" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="grid gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
        >
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-hairline px-6 py-14 text-center">
      <CalendarClockIcon
        className="size-6 text-[rgb(var(--entity-time))]"
        aria-hidden
      />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-subtle">{body}</p>
    </div>
  );
}

function Failure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-[rgb(var(--danger)/0.3)] bg-[rgb(var(--danger)/0.06)] px-6 py-10 text-center">
      <p className="text-sm text-foreground">
        Your moments could not be loaded.
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
