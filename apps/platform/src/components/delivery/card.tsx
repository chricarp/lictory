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
import type { ClaimEntity } from "@lictory/core/claims/contracts";
import {
  ClaimBadge,
  ClaimOwner,
} from "@lictory/platform/components/claims/claim-badge";
import {
  Actor,
  type AgentIdentity,
} from "@lictory/platform/components/identity/actor";
import {
  PriorityIcon,
  TypeIcon,
} from "@lictory/platform/components/items/icons";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";

// How an estimate is read aloud: "5 points", "Estimate M".
export function estimateSpoken(
  project: Pick<Project, "estimateScale"> | undefined,
  label: string,
) {
  return project?.estimateScale === "tshirt"
    ? `Estimate ${label}`
    : `${label} ${label === "1" ? "point" : "points"}`;
}

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
  showStatus,
  dragging,
  draggable,
  selected,
  onOpen,
  onDragStart,
  onDragEnd,
  claim,
  claimAgent,
}: {
  item: WorkItem;
  project: Project | undefined;
  // Shown when the board is not narrowed to one team.
  teamName?: string;
  delivery: Delivery;
  orgSlug: string;
  showStatus?: boolean;
  dragging?: boolean;
  draggable: boolean;
  // The card is open in the item preview.
  selected?: boolean;
  // Plain clicks preview the item instead of following the link.
  onOpen?: (event: React.MouseEvent, id: string) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  // The agent claim holding the item, and the agent's identity.
  claim?: ClaimEntity;
  claimAgent?: AgentIdentity;
}) {
  const type = typeOf(delivery, item);
  const id = identifier(project, item.number);
  const status = delivery.statuses.get(item.statusId);
  const estimate = estimateLabel(project, item.estimate);
  return (
    <div
      data-card={item.id}
      data-peek-item
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-xl bg-card p-3 text-[13px] shadow-(--shadow-border) transition-shadow hover:shadow-(--shadow-border-hover)",
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
        {/* One owner: an agent holding the item replaces the assignee's
            avatar with its own line below the title. */}
        {item.assigneeId && !claim && (
          <span className="ml-auto">
            <PersonAvatarById userId={item.assigneeId} />
          </span>
        )}
        {claim && (
          <ClaimBadge
            claim={claim}
            assigneeId={item.assigneeId}
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
      {claim && (
        <div className="mt-1.5 flex min-w-0">
          <ClaimOwner
            claim={claim}
            agent={claimAgent}
            assigneeId={item.assigneeId}
            className="max-w-full"
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {item.priority !== "none" && <PriorityIcon priority={item.priority} />}
        {teamName && (
          <span className="max-w-28 truncate rounded-full bg-muted px-2">
            {teamName}
          </span>
        )}
        {estimate && (
          <span
            title={estimateSpoken(project, estimate)}
            className="rounded-full bg-muted px-2 text-[11px] font-medium tabular-nums"
          >
            <span aria-hidden>{estimate}</span>
            <span className="sr-only">{estimateSpoken(project, estimate)}</span>
          </span>
        )}
        {item.refinementState && (
          <span
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-full px-1.5 ring-1 ring-inset",
              // Color only when it needs attention: blockers carry it.
              item.refinementState === "ready"
                ? "bg-success/8 text-success ring-success/20"
                : "bg-muted text-foreground/80 ring-foreground/8",
            )}
            title={
              item.refinementState !== "ready"
                ? `Specification not ready: ${item.readinessPassed}/${item.readinessTotal} checks pass`
                : "Specification ready"
            }
          >
            <RefinementIcon state={item.refinementState} />
            {/* "Spec" keeps refinement apart from the delivery column. */}
            Spec: {refinementMeta[item.refinementState].label.toLowerCase()}
            {item.refinementState !== "ready" &&
              ` · ${item.readinessPassed}/${item.readinessTotal} checks`}
          </span>
        )}
        {item.blockingThreads > 0 && (
          <span
            className="inline-flex h-5 items-center gap-1 rounded-full bg-destructive/8 px-1.5 text-destructive ring-1 ring-destructive/20 ring-inset"
            title="Open blocking discussions"
          >
            <CircleAlert className="size-3" />
            {item.blockingThreads} blocker
            {item.blockingThreads === 1 ? "" : "s"}
          </span>
        )}
        {item.childCount > 0 && (
          <span className="tabular-nums" title="Children done">
            {item.childDoneCount}/{item.childCount} done
          </span>
        )}
      </div>
    </div>
  );
});

// The assignee's avatar on a card: their color or photo, named on hover.
function PersonAvatarById({ userId }: { userId: string }) {
  return <Actor userId={userId} label="none" size={20} />;
}
