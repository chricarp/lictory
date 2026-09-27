"use client";
import {
  CircleAlert,
  MessageSquare,
  ShieldCheck,
  ShieldEllipsis,
  ShieldX,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { approvalsCount, reviewState } from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";

// Compact review + readiness signal for rows. Icons are enough at a glance;
// the title attribute explains them.
export function ReviewSignal({
  item,
  className,
}: {
  item: WorkItem;
  className?: string;
}) {
  const state = reviewState(item);
  const { approved, total } = approvalsCount(item);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground tabular-nums",
        className,
      )}
    >
      {item.blockingThreads > 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-destructive"
          title={`${item.blockingThreads} blocking discussion${item.blockingThreads > 1 ? "s" : ""}`}
        >
          <CircleAlert className="size-3.5" />
          {item.blockingThreads}
        </span>
      )}
      {item.openThreads > item.blockingThreads && (
        <span
          className="inline-flex items-center gap-0.5"
          title={`${item.openThreads} open discussion${item.openThreads > 1 ? "s" : ""}`}
        >
          <MessageSquare className="size-3.5" />
          {item.openThreads}
        </span>
      )}
      {state !== "none" && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5",
            state === "approved" && "text-success",
            state === "changes_requested" && "text-warning",
          )}
          title={
            state === "approved"
              ? "All reviews approved the current revision"
              : state === "changes_requested"
                ? "Changes requested"
                : `${approved} of ${total} reviews approved`
          }
        >
          {state === "approved" ? (
            <ShieldCheck className="size-3.5" />
          ) : state === "changes_requested" ? (
            <ShieldX className="size-3.5" />
          ) : (
            <ShieldEllipsis className="size-3.5" />
          )}
          {approved}/{total}
        </span>
      )}
    </span>
  );
}

export function ReadinessBar({
  item,
  className,
}: {
  item: WorkItem;
  className?: string;
}) {
  if (!item.readinessTotal) return null;
  const ratio = item.readinessPassed / item.readinessTotal;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums",
        className,
      )}
      title={`${item.readinessPassed} of ${item.readinessTotal} readiness checks pass`}
    >
      <span className="h-1.5 w-8 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            ratio === 1 ? "bg-emerald-500" : "bg-foreground/40",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      {item.readinessPassed}/{item.readinessTotal}
    </span>
  );
}
