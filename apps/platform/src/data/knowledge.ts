import type {
  PageAttachmentPurpose,
  SpaceEntity,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";

// Knowledge links (docs/internals/knowledge-links.md) as Work shows them.
// Every row arrives only to readers of its page's space; these functions
// additionally drop rows whose page or space is not in the reader's own
// page summaries (or is archived), so nothing about another page (not its
// title, not a count) ever reaches the screen. Pure, so the rules are
// tested without a browser.

export type PageLookup = {
  pageById: ReadonlyMap<string, SpacePage>;
  spaceById: ReadonlyMap<string, Space>;
};

type Readable = { page: SpacePage; space: Space };

// The page and its space, when the reader can read both and neither is
// archived.
export function readablePage(
  lookup: PageLookup,
  pageId: string,
): Readable | undefined {
  const page = lookup.pageById.get(pageId);
  if (!page || page.archivedAt) return undefined;
  const space = lookup.spaceById.get(page.spaceId);
  if (!space || space.archivedAt) return undefined;
  return { page, space };
}

export const purposeLabels: Record<PageAttachmentPurpose, string> = {
  background: "Background",
  design: "Design",
  runbook: "Runbook",
};

export type ItemKnowledgePage = Readable & {
  // The page's published version mentions the item in these top-level
  // blocks (document order).
  mention?: { commitId: string; blockIds: string[] };
  attachment?: {
    attachmentId: string;
    purpose: PageAttachmentPurpose;
    // Pinned version; null follows the published page.
    commitId: string | null;
    createdById: string;
    createdAt: string;
  };
  citation?: {
    // The current revision cites the page: its pinned versions (in order)
    // and whether it also cites it unpinned.
    current?: { number: number; commitIds: string[]; latest: boolean };
    // Only earlier revisions do (the newest of them).
    earlier?: { number: number; commitIds: string[] };
  };
  // The page's published version differs from a pinned one.
  newer: boolean;
};

export type ItemKnowledge = {
  pages: ItemKnowledgePage[];
  source?: Readable & SpaceEntityOf<"workItemSource">;
  proposals: (Readable & SpaceEntityOf<"pageBranchOrigin">)[];
};

const empty: ItemKnowledge = { pages: [], proposals: [] };

/**
 * One work item's knowledge as the reader may see it: one entry per page
 * (mentioned, attached and/or cited), the page it was created from and the
 * page updates proposed from it. Pages attached or cited by the current
 * revision come first, then mentions, then pages only earlier revisions
 * cited; titles break ties.
 */
export function itemKnowledge(
  rows: Iterable<SpaceEntity>,
  lookup: PageLookup,
  item: { id: string; revisionId: string },
): ItemKnowledge {
  const pages = new Map<string, ItemKnowledgePage>();
  let source: ItemKnowledge["source"];
  const proposals: ItemKnowledge["proposals"] = [];
  const entry = (pageId: string) => {
    const existing = pages.get(pageId);
    if (existing) return existing;
    const readable = readablePage(lookup, pageId);
    if (!readable) return undefined;
    const created: ItemKnowledgePage = { ...readable, newer: false };
    pages.set(pageId, created);
    return created;
  };
  for (const row of rows) {
    if ("workItemId" in row && row.workItemId !== item.id) continue;
    if (row.type === "pageReference") {
      const e = entry(row.pageId);
      if (e) e.mention = { commitId: row.commitId, blockIds: row.blockIds };
    } else if (row.type === "pageAttachment") {
      const e = entry(row.pageId);
      if (e)
        e.attachment = {
          attachmentId: row.id,
          purpose: row.purpose,
          commitId: row.commitId,
          createdById: row.createdById,
          createdAt: row.createdAt,
        };
    } else if (row.type === "specificationCitation") {
      const current = row.revisions.find(
        (r) => r.revisionId === item.revisionId,
      );
      const earlier = [...row.revisions]
        .filter((r) => r.revisionId !== item.revisionId)
        .sort((a, b) => b.number - a.number)[0];
      if (!current && !earlier) continue;
      const e = entry(row.pageId);
      if (e)
        e.citation = current
          ? {
              current: {
                number: current.number,
                commitIds: current.commitIds,
                latest: current.latest,
              },
            }
          : {
              earlier: {
                number: earlier!.number,
                commitIds: earlier!.commitIds,
              },
            };
    } else if (row.type === "workItemSource") {
      const readable = readablePage(lookup, row.pageId);
      if (readable) source = { ...readable, ...row };
    } else if (row.type === "pageBranchOrigin") {
      const readable = readablePage(lookup, row.pageId);
      if (readable) proposals.push({ ...readable, ...row });
    }
  }
  if (!pages.size && !source && !proposals.length) return empty;
  for (const e of pages.values()) {
    const pins = [
      ...(e.attachment?.commitId ? [e.attachment.commitId] : []),
      ...(e.citation?.current?.commitIds ?? []),
    ];
    e.newer = pins.some((id) => id !== e.page.publishedCommitId);
  }
  const rank = (e: ItemKnowledgePage) =>
    e.attachment || e.citation?.current ? 0 : e.mention ? 1 : 2;
  proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    pages: [...pages.values()].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.page.title.localeCompare(b.page.title) ||
        a.page.id.localeCompare(b.page.id),
    ),
    source,
    proposals,
  };
}

// The newest pull request of a proposed page update and what it says.
export type ProposalState =
  "no_pull_request" | "draft" | "open" | "merged" | "closed" | "branch_deleted";
export function proposalState(origin: SpaceEntityOf<"pageBranchOrigin">): {
  state: ProposalState;
  pullRequestId?: string;
} {
  const latest = origin.pullRequests.at(-1);
  if (!latest)
    return { state: origin.deletedAt ? "branch_deleted" : "no_pull_request" };
  return { state: latest.status, pullRequestId: latest.id };
}

/**
 * How many readable pages mention or are attached to each work item (a page
 * that does both counts once). Pages the reader cannot read, or that are
 * archived, never count.
 */
export function pageCountsByItem(
  rows: Iterable<SpaceEntity>,
  lookup: PageLookup,
): Map<string, number> {
  const pagesOf = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.type !== "pageReference" && row.type !== "pageAttachment") continue;
    if (!readablePage(lookup, row.pageId)) continue;
    const set = pagesOf.get(row.workItemId);
    if (set) set.add(row.pageId);
    else pagesOf.set(row.workItemId, new Set([row.pageId]));
  }
  return new Map([...pagesOf].map(([id, set]) => [id, set.size]));
}

export type ContextScope = {
  teamId?: string | null;
  iterationId?: string | null;
};
export type ContextLink = Readable & SpaceEntityOf<"pageContextLink">;

// The context pages of one list (the project's own, a team's or an
// iteration's), in rank order, readable ones only.
export function contextLinks(
  rows: Iterable<SpaceEntity>,
  lookup: PageLookup,
  scope: ContextScope,
): ContextLink[] {
  const teamId = scope.teamId ?? null;
  const iterationId = scope.iterationId ?? null;
  const out: ContextLink[] = [];
  for (const row of rows) {
    if (row.type !== "pageContextLink") continue;
    if (row.teamId !== teamId || row.iterationId !== iterationId) continue;
    const readable = readablePage(lookup, row.pageId);
    if (readable) out.push({ ...readable, ...row });
  }
  return out.sort((a, b) =>
    a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id.localeCompare(b.id),
  );
}

// Where a link moves one step up or down among its list (null at an end).
export function contextStep(
  links: readonly ContextLink[],
  linkId: string,
  direction: -1 | 1,
): { afterId: string | null; beforeId: string | null } | null {
  const index = links.findIndex((l) => l.id === linkId);
  if (index < 0) return null;
  const target = index + direction;
  if (target < 0 || target >= links.length) return null;
  // Without the link, its new place is index `target` of the rest.
  const rest = links.filter((l) => l.id !== linkId);
  return {
    afterId: rest[target - 1]?.id ?? null,
    beforeId: rest[target]?.id ?? null,
  };
}

// ------------------------------------------------------------ inbox to do

export type PageAttentionReason =
  "review_requested" | "review_again" | "changes_requested" | "ready_to_merge";
export type PageAttention = {
  pullRequest: SpaceEntityOf<"pagePullRequest">;
  reason: PageAttentionReason;
};
type PullRequest = SpaceEntityOf<"pagePullRequest">;
type Review = SpaceEntityOf<"pagePullRequestReview">;

const current = (r: Review) => !r.staleAt && !r.withdrawnAt;

// Pages whose open pull requests ask for my review: their review rows are
// what the To do needs to know whether I already answered.
export function pagesAwaitingMyReview(
  pullRequests: readonly PullRequest[],
  userId: string,
): string[] {
  return [
    ...new Set(
      pullRequests
        .filter(
          (pr) =>
            pr.status === "open" &&
            pr.authorId !== userId &&
            pr.reviewers.some((r) => r.userId === userId),
        )
        .map((pr) => pr.pageId),
    ),
  ].sort();
}

/**
 * Page pull requests waiting on me, derived from their current state (an
 * entry disappears when it resolves): open ones that ask for my review and
 * that I have not decided on (or whose result changed since: "review
 * again"), mine with changes requested, and mine approved with nothing left
 * blocking the merge. Draft and merged ones never ask anything; nor does a
 * review I cannot give because my commits are in the result.
 */
export function pageAttention(
  pullRequests: readonly PullRequest[],
  reviews: readonly Review[],
  userId: string,
  readable: (pageId: string) => boolean,
): PageAttention[] {
  const mine = new Map<string, Review[]>();
  for (const r of reviews)
    if (r.reviewerId === userId)
      mine.set(r.pullRequestId, [...(mine.get(r.pullRequestId) ?? []), r]);
  const out: PageAttention[] = [];
  for (const pr of pullRequests) {
    if (pr.status !== "open" || !readable(pr.pageId)) continue;
    const m = pr.mergeability;
    if (pr.authorId === userId) {
      if (m && m.changesRequested > 0)
        out.push({ pullRequest: pr, reason: "changes_requested" });
      else if (m && m.approvals > 0 && m.blockers.length === 0)
        out.push({ pullRequest: pr, reason: "ready_to_merge" });
      continue;
    }
    if (!pr.reviewers.some((r) => r.userId === userId)) continue;
    if (m?.contributorIds.includes(userId)) continue;
    const decisions = mine.get(pr.id) ?? [];
    if (decisions.some(current)) continue;
    out.push({
      pullRequest: pr,
      reason: decisions.some((r) => r.staleAt)
        ? "review_again"
        : "review_requested",
    });
  }
  return out;
}
