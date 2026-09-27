import type {
  Directory,
  Entity,
  EntityOf,
  Iteration,
  LabelColor,
  MilestoneStatus,
  RefinementState,
  StatusCategory,
  Team,
  WorkflowStatus,
  WorkItem,
  WorkItemPriority,
  WorkItemType,
} from "~/sync/shared/protocol";

export type Project = EntityOf<"project">;
export type Relation = EntityOf<"relation">;

// Refinement is the specification's own lifecycle; `ready` is derived from
// readiness checks by the server and never chosen by hand.
export const refinementMeta: Record<RefinementState, { label: string }> = {
  draft: { label: "Draft" },
  refinement: { label: "In refinement" },
  in_review: { label: "In review" },
  ready: { label: "Ready" },
};
export const refinementOrder: RefinementState[] = [
  "draft",
  "refinement",
  "in_review",
  "ready",
];
export const categoryMeta: Record<StatusCategory, { label: string }> = {
  backlog: { label: "Backlog" },
  unstarted: { label: "Unstarted" },
  started: { label: "Started" },
  done: { label: "Done" },
  canceled: { label: "Canceled" },
};
export const categoryOrder: StatusCategory[] = [
  "backlog",
  "unstarted",
  "started",
  "done",
  "canceled",
];
export const isClosedCategory = (c: StatusCategory | undefined) =>
  c === "done" || c === "canceled";

// Directory lookups for delivery configuration. Built once per directory.
export type TeamStatus = WorkflowStatus & { teamId: string };
export type Delivery = {
  types: Map<string, WorkItemType>;
  teams: Map<string, Team>;
  statuses: Map<string, TeamStatus>;
  iterations: Map<string, Iteration>;
};
export function deliveryIndex(
  directory: Pick<Directory, "types" | "teams" | "iterations">,
): Delivery {
  const statuses = new Map<string, TeamStatus>();
  for (const team of directory.teams)
    for (const status of team.statuses)
      statuses.set(status.id, { ...status, teamId: team.id });
  return {
    types: new Map(directory.types.map((t) => [t.id, t])),
    teams: new Map(directory.teams.map((t) => [t.id, t])),
    statuses,
    iterations: new Map(directory.iterations.map((i) => [i.id, i])),
  };
}
const unknownType: WorkItemType = {
  id: "",
  name: "Item",
  icon: "task",
  color: "gray",
  level: 1,
  hasSpecification: false,
  position: 0,
  archivedAt: null,
};
export function typeOf(d: Delivery, item: Pick<WorkItem, "typeId">) {
  return d.types.get(item.typeId) ?? unknownType;
}
export function statusOf(d: Delivery, item: Pick<WorkItem, "statusId">) {
  return d.statuses.get(item.statusId);
}
export function categoryOf(d: Delivery, item: Pick<WorkItem, "statusId">) {
  return d.statuses.get(item.statusId)?.category;
}
// Top-level types (Epic by default) group specification work; their pages
// live under /epics, everything else under /stories.
export const isTopLevel = (type: Pick<WorkItemType, "level">) =>
  type.level >= 2;
export function segmentOf(type: Pick<WorkItemType, "level">) {
  return isTopLevel(type) ? "epics" : "stories";
}
export function activeStatuses(team: Team | undefined) {
  return (team?.statuses ?? [])
    .filter((x) => !x.archivedAt)
    .sort((a, b) => a.position - b.position);
}
export function enabledTypes(d: Delivery, team: Team | undefined) {
  return [...d.types.values()]
    .filter((t) => !t.archivedAt && (!team || team.typeIds.includes(t.id)))
    .sort((a, b) => b.level - a.level || a.position - b.position);
}
// Parents sit strictly above children in the type hierarchy.
export function canParent(parent: WorkItemType, child: WorkItemType) {
  return parent.level > child.level;
}
export const priorityMeta: Record<
  WorkItemPriority,
  { label: string; rank: number }
> = {
  urgent: { label: "Urgent", rank: 0 },
  high: { label: "High", rank: 1 },
  medium: { label: "Medium", rank: 2 },
  low: { label: "Low", rank: 3 },
  none: { label: "No priority", rank: 4 },
};
export const priorityOrder: WorkItemPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export function identifier(
  project: Pick<Project, "key"> | undefined,
  n: number,
) {
  return `${project?.key ?? "?"}-${n || "…"}`;
}
export const identifierPattern = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/;
export function parseIdentifier(value: string) {
  const match = identifierPattern.exec(value.trim());
  return match
    ? { key: match[1]!.toUpperCase(), number: Number(match[2]) }
    : undefined;
}

export type ReviewState =
  "none" | "requested" | "changes_requested" | "approved" | "partial";
export function reviewState(item: WorkItem): ReviewState {
  const active = item.reviews.filter((r) => r.status !== "cancelled");
  if (!active.length) return "none";
  if (active.some((r) => r.status === "changes_requested"))
    return "changes_requested";
  const approved = active.filter((r) => r.approved).length;
  if (approved === active.length) return "approved";
  return approved ? "partial" : "requested";
}
export function approvalsCount(item: WorkItem) {
  const active = item.reviews.filter((r) => r.status !== "cancelled");
  return {
    approved: active.filter((r) => r.approved).length,
    total: active.length,
  };
}

// A review "needs me" when I am assigned directly or through a role and I have
// not approved the current revision yet. The server still enforces authority.
export function myRoleIds(directory: Directory, userId: string) {
  return directory.roles
    .filter((r) => !r.archivedAt && r.userIds.includes(userId))
    .map((r) => r.id);
}
export function needsMyReview(
  item: WorkItem,
  userId: string,
  roleIds: string[],
) {
  if (item.archivedAt) return false;
  return (
    item.suggestionReviewerIds.includes(userId) ||
    item.reviews.some(
      (r) =>
        r.status !== "cancelled" &&
        r.status !== "completed" &&
        r.assigneeIds.some((id) => id === userId || roleIds.includes(id)),
    )
  );
}
export function isBlocked(item: WorkItem) {
  return item.blockingThreads > 0;
}

export type ViewId =
  | "all"
  | "needs-my-review"
  | "needs-review"
  | "blocked"
  | "ready"
  | "drafts"
  | "updated";
export const views: { id: ViewId; label: string; description: string }[] = [
  {
    id: "needs-my-review",
    label: "Needs my review",
    description:
      "Reviews assigned to you or your roles on the current revision, and suggestions waiting for your approval.",
  },
  {
    id: "needs-review",
    label: "Needs review",
    description: "Items with an outstanding review request.",
  },
  {
    id: "blocked",
    label: "Blocked",
    description: "Items with an open blocking discussion.",
  },
  {
    id: "ready",
    label: "Ready for development",
    description: "Specifications whose readiness checks all pass.",
  },
  {
    id: "drafts",
    label: "Drafts",
    description: "Draft specifications without a review yet.",
  },
  {
    id: "updated",
    label: "Recently updated",
    description: "Everything changed in the last two days.",
  },
];
export function matchesView(
  item: WorkItem,
  view: ViewId,
  userId: string,
  roleIds: string[],
) {
  switch (view) {
    case "all":
      return true;
    case "needs-my-review":
      return needsMyReview(item, userId, roleIds);
    case "needs-review":
      return item.reviews.some(
        (r) => r.status === "requested" || r.status === "in_progress",
      );
    case "blocked":
      return isBlocked(item);
    case "ready":
      return item.refinementState === "ready";
    case "drafts":
      return item.refinementState === "draft" && item.reviews.length === 0;
    case "updated":
      return Date.now() - new Date(item.updatedAt).getTime() < 2 * 86_400_000;
  }
}

export type Filters = {
  // Status categories: meaningful across teams with different workflows.
  status?: StatusCategory[];
  refinement?: RefinementState[];
  type?: string[];
  team?: string[];
  priority?: WorkItemPriority[];
  assignee?: string[]; // user ids, or "unassigned"
  parent?: string[];
  label?: string[];
  milestone?: string[]; // milestone ids, or "none"
  blocked?: boolean;
  needsReview?: boolean;
  search?: string;
};
export type SortKey = "updated" | "created" | "priority" | "status" | "number";
export function applyFilters(
  items: WorkItem[],
  filters: Filters,
  projects: Project[],
  delivery: Delivery,
) {
  const q = filters.search?.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status?.length) {
      const category = categoryOf(delivery, item);
      if (!category || !filters.status.includes(category)) return false;
    }
    if (
      filters.refinement?.length &&
      (!item.refinementState ||
        !filters.refinement.includes(item.refinementState))
    )
      return false;
    if (filters.type?.length && !filters.type.includes(item.typeId))
      return false;
    if (filters.team?.length && !filters.team.includes(item.teamId))
      return false;
    if (filters.priority?.length && !filters.priority.includes(item.priority))
      return false;
    if (filters.assignee?.length) {
      const key = item.assigneeId ?? "unassigned";
      if (!filters.assignee.includes(key)) return false;
    }
    if (
      filters.parent?.length &&
      !filters.parent.includes(item.parentId ?? "none")
    )
      return false;
    if (
      filters.label?.length &&
      !filters.label.some((l) => item.labelIds.includes(l))
    )
      return false;
    if (
      filters.milestone?.length &&
      !filters.milestone.includes(item.milestoneId ?? "none")
    )
      return false;
    if (filters.blocked && !isBlocked(item)) return false;
    if (
      filters.needsReview &&
      !item.reviews.some(
        (r) => r.status !== "completed" && r.status !== "cancelled",
      )
    )
      return false;
    if (q) {
      const project = projects.find((p) => p.id === item.projectId);
      const id = identifier(project, item.number).toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !id.includes(q) && id !== q)
        return false;
    }
    return true;
  });
}
export function sortItems(items: WorkItem[], key: SortKey, delivery: Delivery) {
  const statusRank = (item: WorkItem) => {
    const status = statusOf(delivery, item);
    return status
      ? categoryOrder.indexOf(status.category) * 1000 + status.position
      : 99_999;
  };
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (key) {
      case "updated":
        return b.updatedAt.localeCompare(a.updatedAt);
      case "created":
        return b.createdAt.localeCompare(a.createdAt);
      case "priority":
        return (
          priorityMeta[a.priority].rank - priorityMeta[b.priority].rank ||
          b.updatedAt.localeCompare(a.updatedAt)
        );
      case "status":
        return (
          statusRank(a) - statusRank(b) ||
          b.updatedAt.localeCompare(a.updatedAt)
        );
      case "number":
        return a.number - b.number;
    }
  });
  return sorted;
}

export function relativeTime(iso: string, now = Date.now()) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "just now";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export function absoluteTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function byType<T extends Entity["type"]>(entities: Entity[], type: T) {
  return entities.filter((e): e is EntityOf<T> => e.type === type);
}
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (
      (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")
    ).toUpperCase() || "?"
  );
}
export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
// PAY from "Payments", PLT from "Platform Tools", trimmed to the key format.
export function suggestKey(name: string) {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const base =
    words.length > 1
      ? words.map((w) => w[0]).join("")
      : (words[0] ?? "").slice(0, 4);
  const key = base
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return /^[A-Z][A-Z0-9]{1,9}$/.test(key)
    ? key
    : key.length === 1
      ? `${key}P`
      : "";
}

export type Label = EntityOf<"label">;
export type Milestone = EntityOf<"milestone">;
export const labelColorClasses: Record<
  LabelColor,
  { dot: string; chip: string }
> = {
  gray: {
    dot: "bg-zinc-400",
    chip: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300",
  },
  blue: {
    dot: "bg-blue-500",
    chip: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  },
  green: {
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    dot: "bg-amber-500",
    chip: "bg-amber-500/14 text-amber-800 dark:text-amber-300",
  },
  red: {
    dot: "bg-red-500",
    chip: "bg-red-500/12 text-red-700 dark:text-red-300",
  },
  purple: {
    dot: "bg-violet-500",
    chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  },
  pink: {
    dot: "bg-pink-500",
    chip: "bg-pink-500/12 text-pink-700 dark:text-pink-300",
  },
  teal: {
    dot: "bg-teal-500",
    chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
  },
};
export const milestoneStatusMeta: Record<MilestoneStatus, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};
export function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
// Backlog and board order: fractional rank, identifier as a tie-break.
export function byRank(a: WorkItem, b: WorkItem) {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.number - b.number;
}
// Sibling order: manual position first, identifier as a stable tie-break.
export function byPosition(a: WorkItem, b: WorkItem) {
  return a.position - b.position || a.number - b.number;
}
