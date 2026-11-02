import type {
  Directory,
  Entity,
  EntityOf,
  StatusCategory,
  WorkItem,
} from "@lictory/core/contracts/protocol";
import {
  categoryOf,
  type Delivery,
  type Project,
} from "@lictory/core/lib/work-items";

export type ExternalLink = EntityOf<"externalLink">;
export type LifecycleStage =
  | "proposal"
  | "refinement"
  | "review"
  | "ready"
  | "committed"
  | "underway"
  | "completed"
  | "canceled";

export const lifecycleStages: {
  id: LifecycleStage;
  label: string;
  description: string;
}[] = [
  {
    id: "proposal",
    label: "Proposals",
    description: "Rough intent, waiting to be refined.",
  },
  {
    id: "refinement",
    label: "In refinement",
    description: "Clarify behavior and prepare the work.",
  },
  {
    id: "review",
    label: "Awaiting agreement",
    description: "Review the current revision and resolve concerns.",
  },
  {
    id: "ready",
    label: "Ready for selection",
    description: "Evidence passes; the team has not committed yet.",
  },
  {
    id: "committed",
    label: "Committed",
    description: "An agreed scope has been selected for delivery.",
  },
  {
    id: "underway",
    label: "Underway",
    description: "Delivery has started; proposed changes remain reviewable.",
  },
  {
    id: "completed",
    label: "Completed",
    description: "Delivery is done. The agreement and history remain.",
  },
  {
    id: "canceled",
    label: "Canceled",
    description: "Work the team chose not to deliver.",
  },
];

type LifecycleItem = Pick<
  WorkItem,
  "statusId" | "refinementState" | "archivedAt"
> & {
  committedRevisionId?: string | null;
};

// Use the current delivery target when connections change. A reserved link
// without an external issue never claims that a handoff succeeded.
export function externalLinksByItem(
  entities: Iterable<Entity>,
  targets: Directory["delivery"]["targets"],
) {
  const connections = new Map(
    targets.map((t) => [t.projectId, t.connectionId]),
  );
  const links = new Map<string, ExternalLink>();
  for (const entity of entities) {
    if (entity.type !== "externalLink") continue;
    const current = links.get(entity.workItemId);
    const preferred = connections.get(entity.projectId);
    if (
      !current ||
      (entity.connectionId === preferred &&
        current.connectionId !== preferred) ||
      (entity.connectionId === current.connectionId &&
        (entity.syncedAt ?? "") > (current.syncedAt ?? ""))
    )
      links.set(entity.workItemId, entity);
  }
  return links;
}

export function deliveryCategory(
  item: Pick<WorkItem, "statusId">,
  project: Pick<Project, "deliveryMode">,
  delivery: Delivery,
  link?: ExternalLink,
): StatusCategory | undefined {
  if (project.deliveryMode === "native") return categoryOf(delivery, item);
  if (!link?.externalKey) return undefined;
  switch (link.externalStatusCategory) {
    case "done":
      return "done";
    case "in_progress":
      return "started";
    case "todo":
      return "unstarted";
    default:
      return undefined;
  }
}

// Readiness is eligibility; commitment and execution are separate facts.
// Tentative iteration planning does not commit an unready specification.
export function lifecycleStage(
  item: LifecycleItem,
  project: Pick<Project, "deliveryMode">,
  delivery: Delivery,
  link?: ExternalLink,
): LifecycleStage {
  const category = deliveryCategory(item, project, delivery, link);
  if (category === "done") return "completed";
  if (category === "canceled") return "canceled";
  if (category === "started") return "underway";
  if (
    project.deliveryMode === "external"
      ? Boolean(link?.externalKey) || link?.status === "pending"
      : Boolean(item.committedRevisionId)
  )
    return "committed";
  if (item.refinementState === "ready") return "ready";
  if (item.refinementState === "in_review") return "review";
  if (item.refinementState === "refinement" || item.refinementState === null)
    return "refinement";
  return "proposal";
}

export function readyForSelection(
  item: LifecycleItem,
  project: Pick<Project, "deliveryMode">,
  delivery: Delivery,
  link?: ExternalLink,
) {
  return (
    !item.archivedAt &&
    item.refinementState === "ready" &&
    lifecycleStage(item, project, delivery, link) === "ready" &&
    (project.deliveryMode !== "external" || link?.status !== "pending")
  );
}

export function nextRefinementAction(
  item: Pick<
    WorkItem,
    | "refinementState"
    | "blockingThreads"
    | "reviews"
    | "readinessPassed"
    | "readinessTotal"
  >,
) {
  if (item.blockingThreads)
    return `Resolve ${item.blockingThreads} blocking discussion${item.blockingThreads === 1 ? "" : "s"}.`;
  const changes = item.reviews.filter((r) => r.status === "changes_requested");
  if (changes.length)
    return `Address changes requested by ${changes.map((r) => r.responsibility).join(", ")}.`;
  const pending = item.reviews.filter(
    (r) => r.required && !r.approved && r.status !== "cancelled",
  );
  if (pending.length)
    return `Waiting on ${pending.map((r) => r.responsibility).join(", ")} to approve this revision.`;
  if (item.refinementState === "ready")
    return "Select this agreed scope for delivery when it becomes a priority.";
  if (!item.reviews.some((r) => r.required && r.status !== "cancelled"))
    return "Clarify the expected behavior, then request the required reviews.";
  return `${item.readinessTotal - item.readinessPassed} readiness check${item.readinessTotal - item.readinessPassed === 1 ? "" : "s"} still need evidence.`;
}
