"use client";
import Link from "next/link";
import { memo } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  identifier,
  segmentOf,
  typeOf,
  type Delivery,
  type Project,
} from "~/lib/work-items";
import {
  estimateOptions,
  type Team,
  type WorkItem,
} from "~/sync/shared/protocol";
import { Avatar } from "~/components/ui/primitives";
import { PriorityIcon, TypeIcon } from "~/components/items/icons";
import { RefinementIcon, StatusIcon } from "~/components/items/status";

export function estimateLabel(team: Team | undefined, value: number | null) {
  if (value === null || !team || team.estimateScale === "none") return null;
  return (
    estimateOptions[team.estimateScale].find((o) => o.value === value)?.label ??
    String(value)
  );
}

// Why a spec-backed item may not start yet, according to the team's policy.
// The server enforces the same rule; the client explains it before a drag.
export function startBlocker(
  delivery: Delivery,
  team: Team,
  item: WorkItem,
  statusId: string,
) {
  const to = delivery.statuses.get(statusId);
  const from = delivery.statuses.get(item.statusId);
  if (
    to?.category !== "started" ||
    from?.category === "started" ||
    !typeOf(delivery, item).hasSpecification ||
    item.refinementState === "ready" ||
    team.readinessPolicy === "off"
  )
    return undefined;
  return {
    policy: team.readinessPolicy,
    detail: `${item.readinessPassed}/${item.readinessTotal} readiness checks pass${item.blockingThreads ? `, ${item.blockingThreads} blocking discussion${item.blockingThreads > 1 ? "s" : ""}` : ""}`,
  };
}

export const ItemCard = memo(function ItemCard({
  item,
  project,
  team,
  delivery,
  orgSlug,
  memberName,
  showStatus,
  dragging,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  item: WorkItem;
  project: Project | undefined;
  team: Team;
  delivery: Delivery;
  orgSlug: string;
  memberName: (id: string | null) => string;
  showStatus?: boolean;
  dragging?: boolean;
  draggable: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const type = typeOf(delivery, item);
  const id = identifier(project, item.number);
  const status = delivery.statuses.get(item.statusId);
  const estimate = estimateLabel(team, item.estimate);
  const notReady =
    type.hasSpecification &&
    item.refinementState !== "ready" &&
    team.readinessPolicy !== "off";
  return (
    <div
      data-card={item.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-lg bg-card p-2.5 text-[13px] shadow-(--shadow-border) transition-shadow hover:shadow-(--shadow-panel)",
        draggable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TypeIcon type={type} className="size-3.5 rounded-[3px]" />
        <span className="font-mono">{id}</span>
        {showStatus && status && (
          <span className="ml-1 inline-flex items-center gap-1">
            <StatusIcon category={status.category} color={status.color} />
            {status.name}
          </span>
        )}
        {item.assigneeId && (
          <Avatar
            name={memberName(item.assigneeId)}
            size="xs"
            className="ml-auto"
          />
        )}
      </div>
      {project && (
        <Link
          href={paths.item(orgSlug, project.key, segmentOf(type), id)}
          draggable={false}
          className="mt-1 line-clamp-3 block font-medium outline-none after:absolute after:inset-0 focus-visible:text-primary"
        >
          {item.title}
        </Link>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {item.priority !== "none" && <PriorityIcon priority={item.priority} />}
        {estimate && (
          <span className="rounded bg-muted px-1.5 tabular-nums">
            {estimate}
          </span>
        )}
        {item.refinementState && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              notReady && "text-amber-700 dark:text-amber-400",
            )}
            title={
              notReady
                ? `Specification not ready: ${item.readinessPassed}/${item.readinessTotal} checks pass`
                : "Specification ready"
            }
          >
            <RefinementIcon state={item.refinementState} />
            {item.readinessPassed}/{item.readinessTotal}
          </span>
        )}
        {item.blockingThreads > 0 && (
          <span
            className="inline-flex items-center gap-1 text-destructive"
            title="Open blocking discussions"
          >
            <CircleAlert className="size-3" />
            {item.blockingThreads}
          </span>
        )}
        {item.childCount > 0 && (
          <span className="tabular-nums" title="Children done">
            {item.childDoneCount}/{item.childCount}
          </span>
        )}
      </div>
    </div>
  );
});
