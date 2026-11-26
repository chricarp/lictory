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

// Everything waiting on me, in one queue: work items (reviews, requested
// changes, blocking discussions), page changes, and the questions agents
// ask me. Home's "Waiting on you" and the Inbox's To do show this same list,
// so the greeting, the card and the tab always count the same things. An
// agent waiting on a person is stopped, so its question comes first.

type WaitingItem = { weight: number; item: { id: string; updatedAt: string } };
type WaitingPage = {
  reason: keyof typeof pageWeight;
  pullRequest: { id: string; updatedAt: string };
};
// An agent's session waiting on me: one entry per question it asks, one
// for the session when it waits for my next message, or one for a session
// I started that failed (I retry it or decide what next).
type WaitingRequest = {
  session: { id: string; updatedAt: string };
  approval?: { id: string; createdAt: string };
  failed?: boolean;
};

export const pageWeight = {
  review_requested: 0,
  review_again: 0,
  changes_requested: 1,
  ready_to_merge: 3,
} as const;

export type Waiting<I, P, R> =
  | { kind: "agent"; key: string; weight: number; at: string; request: R }
  | { kind: "item"; key: string; weight: number; at: string; entry: I }
  | { kind: "page"; key: string; weight: number; at: string; entry: P };

export function waitingOnYou<
  I extends WaitingItem & { reason: string },
  P extends WaitingPage,
  R extends WaitingRequest,
>({
  items,
  pages,
  requests,
}: {
  items: readonly I[];
  pages: readonly P[];
  requests: readonly R[];
}): Waiting<I, P, R>[] {
  const rows: Waiting<I, P, R>[] = [
    ...requests.map((request) => ({
      kind: "agent" as const,
      key: request.approval
        ? `agent:${request.approval.id}`
        : request.failed
          ? `agent:failed:${request.session.id}`
          : `agent:session:${request.session.id}`,
      // A live agent waiting is stopped: first. A failure waits like a
      // review does.
      weight: request.failed ? 0 : -1,
      at: request.approval?.createdAt ?? request.session.updatedAt,
      request,
    })),
    ...items.map((entry) => ({
      kind: "item" as const,
      key: `item:${entry.item.id}:${entry.reason}`,
      weight: entry.weight,
      at: entry.item.updatedAt,
      entry,
    })),
    ...pages.map((entry) => ({
      kind: "page" as const,
      key: `page:${entry.pullRequest.id}`,
      weight: pageWeight[entry.reason],
      at: entry.pullRequest.updatedAt,
      entry,
    })),
  ];
  return rows.sort((a, b) => a.weight - b.weight || b.at.localeCompare(a.at));
}
