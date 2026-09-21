"use client";
import type { ReactNode } from "react";
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleSlash,
  Eye,
  Loader,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { statusMeta, statusOrder } from "~/lib/work-items";
import type { WorkItemStatus } from "~/sync/shared/protocol";
import { Popover, Picker } from "~/components/ui/popover";

// Color is reserved for meaning: neutral until review, primary while in review,
// green when ready/done, muted when cancelled.
export function StatusIcon({
  status,
  className,
}: {
  status: WorkItemStatus;
  className?: string;
}) {
  const base = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "backlog":
      return (
        <CircleDashed
          className={cn(base, "text-muted-foreground/70")}
          aria-hidden
        />
      );
    case "draft":
      return (
        <Circle className={cn(base, "text-muted-foreground")} aria-hidden />
      );
    case "refinement":
      return (
        <CircleDotDashed className={cn(base, "text-amber-600")} aria-hidden />
      );
    case "in_review":
      return <Eye className={cn(base, "text-primary")} aria-hidden />;
    case "ready":
      return (
        <CircleCheck className={cn(base, "text-emerald-600")} aria-hidden />
      );
    case "in_progress":
      return <Loader className={cn(base, "text-primary")} aria-hidden />;
    case "done":
      return (
        <CircleCheck
          className={cn(base, "fill-emerald-500/20 text-emerald-700")}
          aria-hidden
        />
      );
    case "cancelled":
      return (
        <CircleSlash
          className={cn(base, "text-muted-foreground/70")}
          aria-hidden
        />
      );
    default:
      return <CircleDot className={base} aria-hidden />;
  }
}

export function IssueStatus({
  status,
  onChange,
  compact = false,
  disabled,
  readyHint,
}: {
  status: WorkItemStatus;
  onChange?: (status: WorkItemStatus) => void;
  compact?: boolean;
  disabled?: boolean;
  readyHint?: string;
}) {
  const content: ReactNode = (
    <>
      <StatusIcon status={status} />
      {!compact && <span>{statusMeta[status].label}</span>}
    </>
  );
  if (!onChange)
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[13px]"
        title={statusMeta[status].label}
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

          aria-label={`Status: ${statusMeta[status].label}`}
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
        options={statusOrder.map((s) => ({
          value: s,
          label: statusMeta[s].label,
          icon: <StatusIcon status={s} />,
          hint: s === "ready" && readyHint ? readyHint : undefined,
        }))}
        value={status}
        onSelect={onChange}
      />
    </Popover>
  );
}
