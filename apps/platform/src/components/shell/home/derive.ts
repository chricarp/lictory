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
  // Native delivery: whether work may start now, by the one rule the
  // server enforces and the item and the Factory queue show
  // (`claimability`: agreed scope, readiness, blockers, no live claim).
  startable?: (item: WorkItem) => boolean;
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

// Work that can start now, by the rule agents claim by (`startable`:
// accepted scope, not started, nothing blocking it, readiness as the
// project's policy asks): mine first, then unassigned. Work assigned to
// someone else is theirs to start. A ready specification nobody accepted
// yet is not here: accepting it is its owner's act, in Waiting on you. Work
// broken down into open children starts through the children. In external
// delivery: ready specifications not handed off yet.
export function readyToStart(
  {
    items,
    projects,
    delivery,
    links,
    userId,
    startable,
  }: Context & { startable: (item: WorkItem) => boolean },
  limit: number,
): Listed<WorkItem> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const parents = new Set<string>();
  for (const child of items) {
    if (!child.parentId || child.archivedAt) continue;
    const project = byId.get(child.projectId);
    const category =
      project &&
      deliveryCategory(child, project, delivery, links.get(child.id));
    if (category !== "done" && category !== "canceled")
      parents.add(child.parentId);
  }
  const ready = items.filter((item) => {
    if (item.archivedAt) return false;
    if (item.assigneeId && item.assigneeId !== userId) return false;
    const project = byId.get(item.projectId);
    if (!project) return false;
    if (project.deliveryMode !== "native")
      return readyForSelection(item, project, delivery, links.get(item.id));
    return !parents.has(item.id) && startable(item);
  });
  ready.sort(
    (a, b) =>
      Number(b.assigneeId === userId) - Number(a.assigneeId === userId) ||
      newest(a, b),
  );
  return first(ready, limit);
}

// What finished lately and concerns me: my work items that reached done
// (merged and delivered, by the Definition of Done), and agent sessions I
// started or whose agent I own that completed or failed. A failed session
// stays here, with its Retry, until it ages out of the window. Newest first.
export const OUTCOME_DAYS = 7;

type OutcomeSession = {
  id: string;
  agentId: string;
  requestedById: string | null;
  status: string;
  updatedAt: string;
  completedAt: string | null;
};

export type Outcome<S> =
  | { kind: "item"; key: string; at: string; item: WorkItem }
  | {
      kind: "session";
      key: string;
      at: string;
      session: S;
      failed: boolean;
    };

export function recentOutcomes<S extends OutcomeSession>(
  {
    items,
    projects,
    delivery,
    links,
    userId,
    sessions,
    agentOwner,
    now,
  }: Context & {
    sessions: readonly S[];
    agentOwner: (agentId: string) => string | null | undefined;
    now: number;
  },
  limit: number,
): Listed<Outcome<S>> {
  const since = now - OUTCOME_DAYS * 86_400_000;
  const recent = (at: string) => Date.parse(at) >= since;
  const byId = new Map(projects.map((p) => [p.id, p]));
  const rows: Outcome<S>[] = [];
  for (const item of items) {
    if (item.archivedAt || !recent(item.updatedAt)) continue;
    if (item.assigneeId !== userId && item.createdById !== userId) continue;
    const project = byId.get(item.projectId);
    if (
      project &&
      deliveryCategory(item, project, delivery, links.get(item.id)) === "done"
    )
      rows.push({
        kind: "item",
        key: `item:${item.id}`,
        at: item.updatedAt,
        item,
      });
  }
  for (const session of sessions) {
    if (session.status !== "completed" && session.status !== "failed") continue;
    const at = session.completedAt ?? session.updatedAt;
    if (!recent(at)) continue;
    if (
      session.requestedById !== userId &&
      agentOwner(session.agentId) !== userId
    )
      continue;
    rows.push({
      kind: "session",
      key: `session:${session.id}`,
      at,
      session,
      failed: session.status === "failed",
    });
  }
  return first(
    rows.sort((a, b) => b.at.localeCompare(a.at)),
    limit,
  );
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
// so the greeting, the card and the tab always count the same things. It
// is grouped by what I do about it: agents stopped on my answer first, then
// reviews others wait on, then my own work (a failed session to retry,
// changes requested, blockers, merges); within a group, by urgency then
// newest first.

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
  return rows.sort(
    (a, b) =>
      groupOrder[waitingGroup(a)] - groupOrder[waitingGroup(b)] ||
      a.weight - b.weight ||
      b.at.localeCompare(a.at),
  );
}

export type WaitingGroup = "agents" | "reviews" | "yours";
const groupOrder: Record<WaitingGroup, number> = {
  agents: 0,
  reviews: 1,
  yours: 2,
};
// The To do's headings, in the queue's order.
export const waitingGroupLabels: Record<WaitingGroup, string> = {
  agents: "Agents waiting on you",
  reviews: "Reviews",
  yours: "Your work",
};

export function waitingGroup(
  row: Waiting<WaitingItem & { reason: string }, WaitingPage, WaitingRequest>,
): WaitingGroup {
  if (row.kind === "agent") return row.request.failed ? "yours" : "agents";
  if (row.kind === "page")
    return row.entry.reason === "review_requested" ||
      row.entry.reason === "review_again"
      ? "reviews"
      : "yours";
  return reviewReasons.has(row.entry.reason) ? "reviews" : "yours";
}

// What a list of waiting rows holds, by kind, for rows Home does not show
// ("2 blocked items · 1 failed session"): the count above the card and the
// rows in it reconcile without opening the Inbox. Kinds in the queue's
// order; each named once with its count.
const reviewReasons = new Set([
  "Review requested",
  "Pull request to review",
  "Review again",
]);
const itemKinds: Record<string, readonly [string, string]> = {
  Blocked: ["blocked item", "blocked items"],
  "Changes requested": [
    "item with changes requested",
    "items with changes requested",
  ],
  "Publish failed": ["failed hand-off", "failed hand-offs"],
  "Ready for delivery": ["item ready for delivery", "items ready for delivery"],
};

export function waitingKinds(
  rows: readonly Waiting<
    WaitingItem & { reason: string },
    WaitingPage,
    WaitingRequest
  >[],
): string {
  const counts = new Map<string, { n: number; one: string; many: string }>();
  const add = ([one, many]: readonly [string, string]) => {
    const entry = counts.get(one) ?? { n: 0, one, many };
    entry.n += 1;
    counts.set(one, entry);
  };
  for (const row of rows) {
    if (row.kind === "agent")
      add(
        row.request.failed
          ? ["failed agent session", "failed agent sessions"]
          : ["request from an agent", "requests from agents"],
      );
    else if (row.kind === "page") add(["page change", "page changes"]);
    else if (reviewReasons.has(row.entry.reason)) add(["review", "reviews"]);
    else
      add(itemKinds[row.entry.reason] ?? ["item to check", "items to check"]);
  }
  return [...counts.values()]
    .map(({ n, one, many }) => `${n} ${n === 1 ? one : many}`)
    .join(" · ");
}
