"use client";
import type { ReactNode } from "react";
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleSlash,
  Eye,
  Loader,
} from "lucide-react";
import { cn } from "~/lib/utils";
import {
  activeStatuses,
  categoryMeta,
  refinementMeta,
  refinementOrder,
} from "~/lib/work-items";
import type {
  LabelColor,
  RefinementState,
  StatusCategory,
} from "~/sync/shared/protocol";
import { Popover, Picker } from "~/components/ui/popover";
import { useDelivery } from "~/components/workspace/provider";

const tint: Record<LabelColor, string> = {
  gray: "text-muted-foreground",
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-success",
  amber: "text-warning",
  red: "text-destructive",
  purple: "text-violet-600 dark:text-violet-400",
  pink: "text-pink-600 dark:text-pink-400",
  teal: "text-teal-600 dark:text-teal-400",
};

// The glyph shape comes from the fixed category so every team's workflow reads
// the same way; the team-chosen color only tints it.
export function StatusIcon({
  category,
  color = "gray",
  className,
}: {
  category: StatusCategory | undefined;
  color?: LabelColor;
  className?: string;
}) {
  const base = cn("size-3.5 shrink-0", tint[color], className);
  switch (category) {
    case "backlog":
      return <CircleDashed className={cn(base, "opacity-80")} aria-hidden />;
    case "unstarted":
      return <Circle className={base} aria-hidden />;
    case "started":
      return <Loader className={base} aria-hidden />;
    case "done":
      return (
        <CircleCheck className={cn(base, "fill-current/15")} aria-hidden />
      );
    case "canceled":
      return <CircleSlash className={cn(base, "opacity-70")} aria-hidden />;
    default:
      return <CircleDashed className={base} aria-hidden />;
  }
}

// Delivery status from the item's team workflow.
export function IssueStatus({
  teamId,
  statusId,
  onChange,
  compact = false,
  disabled,
  hint,
}: {
  teamId: string;
  statusId: string;
  onChange?: (statusId: string) => void;
  compact?: boolean;
  disabled?: boolean;
  // Explains the readiness policy next to started statuses.
  hint?: string;
}) {
  const delivery = useDelivery();
  const team = delivery.teams.get(teamId);
  const status = delivery.statuses.get(statusId);
  const label = status?.name ?? "Unknown status";
  const content: ReactNode = (
    <>
      <StatusIcon category={status?.category} color={status?.color} />
      {!compact && <span>{label}</span>}
    </>
  );
  if (!onChange)
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[13px]"
        title={label}
      >
        {content}
      </span>
    );
  return (
    <Popover
      width={220}
      disabled={disabled}
      trigger={(props) => (
        <button
          {...props}
          aria-label={`Status: ${label}`}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none",
            compact ? "w-7 justify-center" : "px-1.5",
          )}
        >
          {content}
        </button>
      )}
    >
      <Picker
        title="Change status"
        options={activeStatuses(team).map((x) => ({
          value: x.id,
          label: x.name,
          icon: <StatusIcon category={x.category} color={x.color} />,
          hint:
            x.category === "started" && hint
              ? hint
              : categoryMeta[x.category].label,
        }))}
        value={statusId}
        onSelect={onChange}
      />
    </Popover>
  );
}

export function RefinementIcon({
  state,
  className,
}: {
  state: RefinementState;
  className?: string;
}) {
  const base = cn("size-3.5 shrink-0", className);
  switch (state) {
    case "draft":
      return (
        <Circle className={cn(base, "text-muted-foreground")} aria-hidden />
      );
    case "refinement":
      return (
        <CircleDotDashed className={cn(base, "text-warning")} aria-hidden />
      );
    case "in_review":
      return <Eye className={cn(base, "text-primary")} aria-hidden />;
    case "ready":
      return <CircleCheck className={cn(base, "text-success")} aria-hidden />;
  }
}

// Refinement state of a specification. `ready` is evidence-driven: it cannot
// be picked, only reached when every readiness check passes.
export function RefinementStatus({
  state,
  onChange,
  disabled,
  readyHint,
}: {
  state: RefinementState;
  onChange?: (state: Exclude<RefinementState, "ready">) => void;
  disabled?: boolean;
  readyHint?: string;
}) {
  const content = (
    <>
      <RefinementIcon state={state} />
      <span>{refinementMeta[state].label}</span>
    </>
  );
  if (!onChange)
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        {content}
      </span>
    );
  return (
    <Popover
      width={240}
      disabled={disabled}
      trigger={(props) => (
        <button
          {...props}
          aria-label={`Refinement: ${refinementMeta[state].label}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none"
        >
          {content}
        </button>
      )}
    >
      <Picker
        title="Refinement"
        options={refinementOrder
          .filter((x) => x !== "ready")
          .map((x) => ({
            value: x,
            label: refinementMeta[x].label,
            icon: <RefinementIcon state={x} />,
          }))}
        value={state === "ready" ? undefined : state}
        onSelect={onChange}
        footer={
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {readyHint ??
              "Ready is set automatically when every readiness check passes."}
          </p>
        }
      />
    </Popover>
  );
}
