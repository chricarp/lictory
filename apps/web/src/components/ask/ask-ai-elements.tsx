"use client";

import * as React from "react";

import {
  Check,
  ChevronRight,
  FileText,
  ImageIcon,
  Network,
  Search,
  Sparkles,
  StickyNote,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const PIXEL_DELAYS = [90, 0, 90, 180, 90, 180, 270, 180, 270];

const SEARCH_TASKS = [
  {
    label: "Finding relevant notes",
    detail: "Titles, writing and summaries",
    icon: StickyNote,
  },
  {
    label: "Reading attachment context",
    detail: "Voice, images and documents",
    icon: FileText,
  },
  {
    label: "Following connections",
    detail: "People, places, dates and topics",
    icon: Network,
  },
];

export const ASK_RECOMMENDATIONS = [
  "What else connects these notes?",
  "Which dates matter here?",
  "Summarize the key people and places.",
];

function useElapsed(active: boolean) {
  const [deciseconds, setDeciseconds] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(
      () => setDeciseconds((current) => current + 1),
      100,
    );
    return () => window.clearInterval(timer);
  }, [active]);

  const seconds = deciseconds / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

function PixelLoader() {
  return (
    <span
      aria-hidden
      className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[2px]"
    >
      {PIXEL_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-1 rounded-[1px] bg-ember"
          style={{
            animation: `ask-pixel-on 720ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function AskThinkingTrace({
  label = "Reading across your notes",
}: {
  label?: string;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const elapsed = useElapsed(true);

  return (
    <div className="grid gap-3 sm:grid-cols-[2.25rem_minmax(0,1fr)]">
      <span className="flex size-9 items-center justify-center rounded-xl border border-[rgb(var(--ember)/0.22)] bg-[rgb(var(--ember)/0.08)] text-ember">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 pt-0.5" aria-live="polite">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="-mx-2 flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface"
        >
          <PixelLoader />
          <span
            className="t-shimmer truncate text-[0.8125rem] font-medium"
            data-text={label}
          >
            {label}
          </span>
          <span className="font-mono text-[0.6875rem] tabular-nums text-subtle">
            {elapsed}
          </span>
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-subtle transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>

        <div className="t-acc" data-open={expanded}>
          <div className="t-acc-panel">
            <div className="t-acc-panel-inner">
              <div className="relative ml-[5px] mt-2 space-y-1 border-l border-hairline pl-4">
                {SEARCH_TASKS.map((task, index) => {
                  const Icon = task.icon;
                  return (
                    <div
                      key={task.label}
                      className="ask-task-enter flex min-h-9 items-center gap-2.5 rounded-lg px-2 py-1.5"
                      style={{ animationDelay: `${index * 80}ms` }}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-surface text-subtle">
                        <Icon className="size-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {task.label}
                        </span>
                        <span className="block truncate text-[0.6875rem] text-subtle">
                          {task.detail}
                        </span>
                      </span>
                      <span className="size-1.5 animate-pulse rounded-full bg-ember" />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AskRecommendations({
  onSelect,
  className,
  heading = "Try asking",
  recommendations = ASK_RECOMMENDATIONS,
}: {
  onSelect: (value: string) => void;
  className?: string;
  heading?: string;
  recommendations?: readonly string[];
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="px-1 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-subtle">
        {heading}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {recommendations.map((recommendation, index) => (
          <button
            key={recommendation}
            type="button"
            onClick={() => onSelect(recommendation)}
            className="ask-recommendation-enter group flex min-h-20 flex-col justify-between rounded-xl border border-hairline bg-surface p-3 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-hairline-strong hover:bg-surface-strong active:translate-y-0"
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <span className="text-xs leading-5 text-muted">
              {recommendation}
            </span>
            <ArrowUpMini className="mt-2 size-3.5 self-end text-subtle transition-[color,transform] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ember" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function AskContextSummary({
  count,
  kinds,
}: {
  count: number;
  kinds: readonly string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-subtle">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2 py-1">
        <Search className="size-3" />
        {count} {count === 1 ? "source" : "sources"}
      </span>
      {kinds.map((kind) => (
        <span
          key={kind}
          className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1"
        >
          <Check className="size-2.5 text-success" />
          {kind}
        </span>
      ))}
    </div>
  );
}

function ArrowUpMini({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M3.5 12.5 12.5 3.5M5 3.5h7.5V11" />
    </svg>
  );
}

export function ContextScopeIcons() {
  return (
    <span className="flex -space-x-1" aria-hidden>
      {[StickyNote, ImageIcon, Network].map((Icon, index) => (
        <span
          key={index}
          className="flex size-4 items-center justify-center rounded-full border border-canvas bg-canvas-raised text-subtle"
        >
          <Icon className="size-2.5" />
        </span>
      ))}
    </span>
  );
}
