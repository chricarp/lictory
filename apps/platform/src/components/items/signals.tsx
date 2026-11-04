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
          className={cn(
            "inline-flex items-center gap-0.5",
            // Below xl a blocked row keeps the blocker and approvals.
            !compact && blocked && "max-xl:hidden",
          )}
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
          {!compact && state !== "approved" && (
            <span className="ml-0.5 hidden xl:inline">approved</span>
          )}
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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums",
        className,
      )}
      title={`${item.readinessPassed} of ${item.readinessTotal} readiness checks pass`}
    >
      <span aria-hidden className="flex w-8 gap-px">
        {Array.from({ length: item.readinessTotal }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index < item.readinessPassed ? "bg-success" : "bg-foreground/12",
            )}
          />
        ))}
      </span>
      {item.readinessPassed}/{item.readinessTotal}
      {labelled && <span className="-ml-1 hidden xl:inline">checks</span>}
    </span>
  );
}
