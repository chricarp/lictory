import type { WorkItem } from "@lictory/core/contracts/protocol";
import {
  deliveryCategory,
  readyForSelection,
  type ExternalLink,
} from "@lictory/core/lib/lifecycle";
import type { Delivery, Project } from "@lictory/core/lib/work-items";

// What Home shows, derived from synchronized state. Each list says how many
// rows exist in all, so Home can show the first few and link to the rest.

type Listed<T> = { rows: T[]; total: number };

type Context = {
  items: readonly WorkItem[];
  projects: readonly Project[];
  delivery: Delivery;
  links: ReadonlyMap<string, ExternalLink>;
  userId: string;
};

const newest = (a: { updatedAt: string }, b: { updatedAt: string }) =>
  b.updatedAt.localeCompare(a.updatedAt);

function first<T>(all: T[], limit: number): Listed<T> {
  return { rows: all.slice(0, limit), total: all.length };
}

// Work assigned to me that has started (in Lictory, or in the delivery tool
// for projects delivered there), most recently changed first.
export function inFlight(
  { items, projects, delivery, links, userId }: Context,
  limit: number,
): Listed<WorkItem> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const started = items.filter((item) => {
    if (item.archivedAt || item.assigneeId !== userId) return false;
    const project = byId.get(item.projectId);
    return (
      !!project &&
      deliveryCategory(item, project, delivery, links.get(item.id)) ===
        "started"
    );
  });
  return first(started.sort(newest), limit);
}

// Ready specifications nobody has started: mine first, then unassigned ones.
// Work assigned to someone else is theirs to start.
export function readyToStart(
  { items, projects, delivery, links, userId }: Context,
  limit: number,
): Listed<WorkItem> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ready = items.filter((item) => {
    if (item.assigneeId && item.assigneeId !== userId) return false;
    const project = byId.get(item.projectId);
    return (
      !!project &&
      readyForSelection(item, project, delivery, links.get(item.id))
    );
  });
  ready.sort(
    (a, b) =>
      Number(b.assigneeId === userId) - Number(a.assigneeId === userId) ||
      newest(a, b),
  );
  return first(ready, limit);
}

type PageLike = {
  id: string;
  spaceId: string;
  updatedAt: string;
  archivedAt: string | null;
};

// Pages whose published version changed most recently, in active spaces.
export function recentPages<P extends PageLike>(
  pages: Iterable<P>,
  activeSpaceIds: ReadonlySet<string>,
  limit: number,
): Listed<P> {
  const recent: P[] = [];
  for (const page of pages)
    if (!page.archivedAt && activeSpaceIds.has(page.spaceId)) recent.push(page);
  return first(recent.sort(newest), limit);
}
