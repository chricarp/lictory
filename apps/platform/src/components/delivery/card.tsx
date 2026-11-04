import { Link } from "@lictory/platform/lib/navigation";
import { memo } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  identifier,
  refinementMeta,
  typeOf,
  type Delivery,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  estimateOptions,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import { Avatar } from "@lictory/ui/primitives";
import {
  PriorityIcon,
  TypeIcon,
} from "@lictory/platform/components/items/icons";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";

export function estimateLabel(
  project: Pick<Project, "estimateScale"> | undefined,
  value: number | null,
) {
  if (value === null || !project || project.estimateScale === "none")
    return null;
  return (
    estimateOptions[project.estimateScale].find((o) => o.value === value)
      ?.label ?? String(value)
  );
}

// Why a spec-backed item may not start yet, according to the project's
// policy. The server enforces the same rule; the client explains it before a
// drag.
export function startBlocker(
  delivery: Delivery,
  project: Pick<Project, "readinessPolicy">,
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
    project.readinessPolicy === "off"
  )
    return undefined;
  return {
    policy: project.readinessPolicy,
    detail: `${item.readinessPassed}/${item.readinessTotal} readiness checks pass${item.blockingThreads ? `, ${item.blockingThreads} blocking discussion${item.blockingThreads > 1 ? "s" : ""}` : ""}`,
  };
}

export const ItemCard = memo(function ItemCard({
  item,
  project,
  teamName,
  delivery,
  orgSlug,
  memberName,
  showStatus,
  dragging,
  draggable,
  selected,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: WorkItem;
  project: Project | undefined;
  // Shown when the board is not narrowed to one team.
  teamName?: string;
  delivery: Delivery;
  orgSlug: string;
  memberName: (id: string | null) => string;
  showStatus?: boolean;
  dragging?: boolean;
  draggable: boolean;
  // The card is open in the item preview.
  selected?: boolean;
  // Plain clicks preview the item instead of following the link.
  onOpen?: (event: React.MouseEvent, id: string) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const type = typeOf(delivery, item);
  const id = identifier(project, item.number);
  const status = delivery.statuses.get(item.statusId);
  const estimate = estimateLabel(project, item.estimate);
  const notReady =
    type.hasSpecification &&
    item.refinementState !== "ready" &&
    project?.readinessPolicy !== "off";
  return (
    <div
      data-card={item.id}
      data-peek-item
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-lg bg-card p-2.5 text-[13px] shadow-(--shadow-border) transition-shadow hover:shadow-(--shadow-border-hover) dark:bg-accent",
        draggable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        selected && "ring-2 ring-primary/60",
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
            userId={item.assigneeId}
            name={memberName(item.assigneeId)}
            size="xs"
            className="ml-auto"
          />
        )}
      </div>
      {project && (
        <Link
          href={paths.item(orgSlug, project.key, id)}
          draggable={false}
          aria-current={selected ? true : undefined}
          onClick={onOpen ? (e) => onOpen(e, id) : undefined}
          className="mt-1 line-clamp-3 block font-medium outline-none after:absolute after:inset-0 focus-visible:text-primary"
        >
          {item.title}
        </Link>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {item.priority !== "none" && <PriorityIcon priority={item.priority} />}
        {teamName && (
          <span className="max-w-28 truncate rounded bg-muted px-1.5">
            {teamName}
          </span>
        )}
        {estimate && (
          <span className="rounded bg-muted px-1.5 tabular-nums">
            {estimate}
          </span>
        )}
        {item.refinementState && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              notReady && "text-warning",
            )}
            title={
              item.refinementState !== "ready"
                ? `Specification not ready: ${item.readinessPassed}/${item.readinessTotal} checks pass`
                : "Specification ready"
            }
          >
            <RefinementIcon state={item.refinementState} />
            {refinementMeta[item.refinementState].label}
            {item.refinementState !== "ready" &&
              ` · ${item.readinessPassed}/${item.readinessTotal}`}
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
