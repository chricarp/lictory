"use client";
// Small, shared building blocks for the branch → commit → pull request →
// check → merge flow, so every surface speaks the same visual language.
import type { ReactNode } from "react";
import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Loader2,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import type { EntityOf } from "@lictory/core/contracts/protocol";

export type CheckState =
  "success" | "failure" | "pending" | "running" | "neutral" | "skipped";

export function CheckIcon({
  state,
  className,
}: {
  state: CheckState;
  className?: string;
}) {
  const base = cn("size-4 shrink-0", className);
  switch (state) {
    case "success":
      return <CircleCheck aria-hidden className={cn(base, "text-success")} />;
    case "failure":
      return <CircleX aria-hidden className={cn(base, "text-destructive")} />;
    case "running":
      return (
        <Loader2
          aria-hidden
          className={cn(
            base,
            "animate-spin text-amber-500 motion-reduce:animate-none",
          )}
        />
      );
    case "pending":
      return <CircleDot aria-hidden className={cn(base, "text-amber-500")} />;
    case "skipped":
      return (
        <CircleSlash
          aria-hidden
          className={cn(base, "text-muted-foreground/70")}
        />
      );
    default:
      return (
        <CircleDashed
          aria-hidden
          className={cn(base, "text-muted-foreground")}
        />
      );
  }
}

type PrStatus = EntityOf<"pullRequest">["status"];
export const prStatusMeta: Record<
  PrStatus,
  { label: string; icon: typeof GitPullRequest; pill: string; text: string }
> = {
  draft: {
    label: "Draft",
    icon: GitPullRequestDraft,
    pill: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
  open: {
    label: "Open",
    icon: GitPullRequest,
    pill: "bg-emerald-600 text-white dark:bg-emerald-500/90",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  merged: {
    label: "Merged",
    icon: GitMerge,
    pill: "bg-violet-600 text-white dark:bg-violet-500/90",
    text: "text-violet-600 dark:text-violet-400",
  },
};

export function PrStatusPill({ status }: { status: PrStatus }) {
  const meta = prStatusMeta[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        meta.pill,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {meta.label}
    </span>
  );
}

export function PrStatusIcon({
  status,
  className,
}: {
  status: PrStatus;
  className?: string;
}) {
  const meta = prStatusMeta[status];
  const Icon = meta.icon;
  return (
    <Icon
      aria-label={meta.label}
      className={cn("size-4 shrink-0", meta.text, className)}
    />
  );
}

export function BranchChip({
  name,
  onClick,
  muted,
}: {
  name: string;
  onClick?: () => void;
  muted?: boolean;
}) {
  const className = cn(
    "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-primary/8 px-1.5 py-0.5 font-mono text-[12px] text-primary",
    muted && "bg-muted text-muted-foreground line-through",
    onClick &&
      "hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
  );
  const content = (
    <>
      <GitBranch aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={className}>{content}</span>
  );
}

export type TabSpec<T extends string> = {
  id: T;
  label: string;
  count?: number;
  icon?: ReactNode;
  dot?: boolean;
};

// Underlined, keyboard-accessible tabs (arrow keys move between them).
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  tabs,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: TabSpec<T>[];
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 overflow-x-auto border-b"
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = tabs.findIndex((t) => t.id === value);
        const next =
          tabs[
            (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
          ]!;
        onChange(next.id);
        e.currentTarget
          .querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)
          ?.focus();
      }}
    >
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              selected
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                {t.count}
              </span>
            )}
            {t.dot && (
              <span
                aria-label="has uncommitted edits"
                className="size-1.5 rounded-full bg-amber-500"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export type Step = { label: string; state: "done" | "current" | "upcoming" };

// The lifecycle of a change, so people always know where they are.
export function FlowSteps({ steps }: { steps: Step[] }) {
  return (
    <ol
      aria-label="Change progress"
      className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[12px]"
    >
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                "mx-1 h-px w-5",
                s.state === "upcoming" ? "bg-border" : "bg-foreground/30",
              )}
            />
          )}
          <span
            aria-current={s.state === "current" ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5",
              s.state === "current" && "bg-primary/10 font-medium text-primary",
              s.state === "done" && "text-foreground",
              s.state === "upcoming" && "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-4 place-items-center rounded-full text-[10px] tabular-nums",
                s.state === "done" && "bg-foreground text-background",
                s.state === "current" && "bg-primary text-primary-foreground",
                s.state === "upcoming" && "border text-muted-foreground",
              )}
            >
              {s.state === "done" ? <Check className="size-2.5" /> : i + 1}
            </span>
            {s.label}
            <span className="sr-only">
              {s.state === "done"
                ? " (done)"
                : s.state === "current"
                  ? " (current step)"
                  : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// A one-line explanation of what happens next, with the one action that does it.
export function NextStep({
  tone = "neutral",
  title,
  children,
  action,
}: {
  tone?: "neutral" | "success" | "warning";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5",
        tone === "success" && "border-success/30 bg-success/5",
        tone === "warning" && "border-amber-500/40 bg-amber-500/5",
        tone === "neutral" && "bg-muted/30",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        {children && (
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            {children}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

export function duration(from: string | null, to: string | null) {
  if (!from || !to) return undefined;
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
