"use client";
import type { ReactNode } from "react";
import {
  Bookmark,
  Bug,
  FlaskConical,
  ListTree,
  SquareCheck,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import type {
  LabelColor,
  WorkItemPriority,
  WorkItemType,
} from "@lictory/core/contracts/protocol";

// Type glyphs: a small filled square whose color identifies the type. Types
// are configurable, so the glyph and color come from the type registry.
const typeBackground: Record<LabelColor, string> = {
  gray: "bg-zinc-500",
  blue: "bg-sky-600",
  green: "bg-emerald-600",
  amber: "bg-amber-500",
  red: "bg-red-600",
  purple: "bg-violet-600",
  pink: "bg-pink-600",
  teal: "bg-teal-600",
};
const typeGlyph: Record<
  WorkItemType["icon"],
  { icon: typeof Zap; filled: boolean }
> = {
  epic: { icon: Zap, filled: true },
  story: { icon: Bookmark, filled: true },
  task: { icon: SquareCheck, filled: false },
  bug: { icon: Bug, filled: false },
  subtask: { icon: ListTree, filled: false },
  spike: { icon: FlaskConical, filled: false },
  chore: { icon: Wrench, filled: false },
};
export function TypeIcon({
  type,
  className,
  size = "sm",
}: {
  type: Pick<WorkItemType, "icon" | "color" | "name">;
  className?: string;
  size?: "sm" | "md";
}) {
  const box = size === "md" ? "size-5 rounded-[5px]" : "size-4 rounded-[4px]";
  const glyph = size === "md" ? "size-3.5" : "size-2.5";
  const { icon: Glyph, filled } = typeGlyph[type.icon] ?? typeGlyph.task;
  return (
    <span
      aria-label={type.name}
      title={type.name}
      className={cn(
        "inline-grid shrink-0 place-items-center text-white",
        box,
        typeBackground[type.color] ?? typeBackground.gray,
        className,
      )}
    >
      <Glyph
        className={cn(glyph, filled && "fill-current")}
        strokeWidth={2.5}
      />
    </span>
  );
}
// Static glyphs for navigation that is not tied to one configured type.
export const epicGlyph = {
  icon: "epic",
  color: "purple",
  name: "Epics",
} as const;
export const storyGlyph = {
  icon: "story",
  color: "green",
  name: "Work items",
} as const;

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
