"use client";
import type { ReactNode } from "react";
import { Bookmark, SquareCheck, Zap } from "lucide-react";
import { cn } from "~/lib/utils";
import { kindMeta } from "~/lib/work-items";
import type { WorkItemKind, WorkItemPriority } from "~/sync/shared/protocol";

// Jira-style kind glyphs: a small filled square whose color identifies the type.
// Epic purple, Story green, Task blue. Kept small so rows stay calm.
export function KindIcon({
  kind,
  className,
  size = "sm",
}: {
  kind: WorkItemKind;
  className?: string;
  size?: "sm" | "md";
}) {
  const box = size === "md" ? "size-5 rounded-[5px]" : "size-4 rounded-[4px]";
  const glyph = size === "md" ? "size-3.5" : "size-2.5";
  return (
    <span
      aria-label={kindMeta[kind].label}
      title={kindMeta[kind].label}
      className={cn(
        "inline-grid shrink-0 place-items-center text-white",
        box,
        kind === "epic" && "bg-violet-600",
        kind === "story" && "bg-emerald-600",
        kind === "task" && "bg-sky-600",
        className,
      )}
    >
      {kind === "epic" ? (
        <Zap className={cn(glyph, "fill-current")} strokeWidth={2.5} />
      ) : kind === "story" ? (
        <Bookmark className={cn(glyph, "fill-current")} strokeWidth={2.5} />
      ) : (
        <SquareCheck className={glyph} strokeWidth={2.5} />
      )}
    </span>
  );
}

// Jira-style priority: stacked chevrons whose color, count, and weight encode
// rank. Urgent/high point up in warm colors; low points down in blue; medium
// is a yellow equals; none stays a quiet muted dash.
export function PriorityIcon({
  priority,
  className,
}: {
  priority: WorkItemPriority;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn("inline-block size-3.5 shrink-0", className)}
    >
      {priorityGlyphs[priority]}
    </svg>
  );
}

const priorityGlyphs: Record<WorkItemPriority, ReactNode> = {
  urgent: (
    <g className="fill-red-500">
      <path d="M8 1 15 8l-1.5 1.5L8 4 2.5 9.5 1 8z" />
      <path d="M8 5.6 15 12.6l-1.5 1.5L8 8.6 2.5 14.1 1 12.6z" />
    </g>
  ),
  high: (
    <path
      className="fill-orange-500"
      d="M8 3.2 14.4 9.6 12.6 9.6 8 5 3.4 9.6 1.6 9.6z"
    />
  ),
  medium: (
    <g className="fill-amber-400">
      <rect x="2.5" y="5.1" width="11" height="1.9" rx="0.35" />
      <rect x="2.5" y="9" width="11" height="1.9" rx="0.35" />
    </g>
  ),
  low: (
    <path
      className="fill-blue-500"
      d="M8 12.8 1.6 6.4 3.4 6.4 8 11 12.6 6.4 14.4 6.4z"
    />
  ),
  none: (
    <rect
      className="fill-muted-foreground/40"
      x="3.75"
      y="7.1"
      width="8.5"
      height="1.8"
      rx="0.35"
    />
  ),
};
