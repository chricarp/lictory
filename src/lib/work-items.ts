import type {
  Directory,
  Entity,
  EntityOf,
  WorkItem,
  WorkItemKind,
  WorkItemPriority,
  WorkItemStatus,
} from "~/sync/shared/protocol";

export type Product = EntityOf<"product">;

export const statusMeta: Record<
  WorkItemStatus,
  { label: string; group: "todo" | "active" | "done" }
> = {
  backlog: { label: "Backlog", group: "todo" },
  draft: { label: "Draft", group: "todo" },
  refinement: { label: "In refinement", group: "active" },
  in_review: { label: "In review", group: "active" },
  ready: { label: "Ready", group: "active" },
  in_progress: { label: "In progress", group: "active" },
  done: { label: "Done", group: "done" },
  cancelled: { label: "Cancelled", group: "done" },
};
export const statusOrder: WorkItemStatus[] = [
  "backlog",
  "draft",
  "refinement",
  "in_review",
  "ready",
  "in_progress",
  "done",
  "cancelled",
];
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
export const kindMeta: Record<
  WorkItemKind,
  { label: string; plural: string; segment: string }
> = {
  epic: { label: "Epic", plural: "Epics", segment: "epics" },
  story: { label: "Story", plural: "Stories", segment: "stories" },
  task: { label: "Task", plural: "Tasks", segment: "stories" },
};

export function identifier(
  product: Pick<Product, "key"> | undefined,
  n: number,
) {
  return `${product?.key ?? "?"}-${n || "…"}`;
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

// A review "needs me" when I am assigned directly or through a group and I have
// not approved the current revision yet. The server still enforces authority.
export function myGroupIds(directory: Directory, userId: string) {
  return directory.groups
    .filter((g) => g.userIds.includes(userId))
    .map((g) => g.id);
}
export function needsMyReview(
  item: WorkItem,
  userId: string,
  groupIds: string[],
) {
  if (item.archivedAt) return false;
  return item.reviews.some(
    (r) =>
      r.status !== "cancelled" &&
      r.status !== "completed" &&
      r.assigneeIds.some((id) => id === userId || groupIds.includes(id)),
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
      "Reviews assigned to you or your groups on the current revision.",
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
    description: "Items whose readiness checks all pass.",
  },
  {
    id: "drafts",
    label: "Drafts",
    description: "Backlog and draft items without a review yet.",
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
  groupIds: string[],
) {
  switch (view) {
    case "all":
      return true;
    case "needs-my-review":
      return needsMyReview(item, userId, groupIds);
    case "needs-review":
      return item.reviews.some(
        (r) => r.status === "requested" || r.status === "in_progress",
      );
    case "blocked":
      return isBlocked(item);
    case "ready":
      return item.status === "ready";
    case "drafts":
      return (
        (item.status === "backlog" || item.status === "draft") &&
        item.reviews.length === 0
      );
    case "updated":
      return Date.now() - new Date(item.updatedAt).getTime() < 2 * 86_400_000;
  }
}

export type Filters = {
  status?: WorkItemStatus[];
  priority?: WorkItemPriority[];
  assignee?: string[]; // user ids, or "unassigned"
  parent?: string[];
  blocked?: boolean;
  needsReview?: boolean;
  search?: string;
};
export type SortKey = "updated" | "created" | "priority" | "status" | "number";
export function applyFilters(
  items: WorkItem[],
  filters: Filters,
  products: Product[],
) {
  const q = filters.search?.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status?.length && !filters.status.includes(item.status))
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
    if (filters.blocked && !isBlocked(item)) return false;
    if (
      filters.needsReview &&
      !item.reviews.some(
        (r) => r.status !== "completed" && r.status !== "cancelled",
      )
    )
      return false;
    if (q) {
      const product = products.find((p) => p.id === item.productId);
      const id = identifier(product, item.number).toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !id.includes(q) && id !== q)
        return false;
    }
    return true;
  });
}
export function sortItems(items: WorkItem[], key: SortKey) {
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
          statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) ||
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
