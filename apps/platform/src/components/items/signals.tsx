import {
  CircleAlert,
  MessageSquare,
  ShieldCheck,
  ShieldEllipsis,
  ShieldX,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { approvalsCount, reviewState } from "@lictory/core/lib/work-items";
import type { WorkItem } from "@lictory/core/contracts/protocol";

// Compact review + readiness signal for rows. Icons are enough at a glance;
// the title attribute explains them.
// Compact rows show only the one signal that needs attention most: blockers
// first, then the review state; the full row shows every signal.
export function ReviewSignal({
  item,
  className,
  compact = false,
}: {
  item: WorkItem;
  className?: string;
  compact?: boolean;
}) {
  const state = reviewState(item);
  const { approved, total } = approvalsCount(item);
  const blocked = item.blockingThreads > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground tabular-nums",
        className,
      )}
    >
      {blocked && (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-destructive",
            !compact &&
              "rounded-full bg-destructive/8 py-0.5 pr-2 pl-1.5 font-medium",
          )}
          title={`${item.blockingThreads} blocking discussion${item.blockingThreads > 1 ? "s" : ""}`}
        >
          <CircleAlert className="size-3.5" />
          {compact
            ? item.blockingThreads
            : `${item.blockingThreads} blocker${item.blockingThreads > 1 ? "s" : ""}`}
        </span>
      )}
      {item.openThreads > item.blockingThreads && !(compact && blocked) && (
        <span
          className="inline-flex items-center gap-0.5"
          title={`${item.openThreads} open discussion${item.openThreads > 1 ? "s" : ""}`}
        >
          <MessageSquare className="size-3.5" />
          {item.openThreads}
        </span>
      )}
      {state !== "none" && !(compact && blocked) && (
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
  labelled = false,
}: {
  item: WorkItem;
  className?: string;
  // Spells out "checks" where there is room.
  labelled?: boolean;
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
            ratio === 1 ? "bg-success" : "bg-foreground/40",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      {item.readinessPassed}/{item.readinessTotal}
      {labelled && <span className="-ml-1 hidden xl:inline">checks</span>}
    </span>
  );
}
