import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { mergeBase } from "@lictory/core/contracts/merge";
import type {
  PageDraftSummary,
  PageMergeBlocker,
} from "@lictory/core/contracts/protocol";
import type { Database, Tx } from "@lictory/core/domain/service";
import {
  documentHash,
  mergeDocuments,
  stableSerialize,
  type Conflict,
  type MergeResult,
  type PageNode,
} from "@lictory/core/spaces/document";
import { draftDocumentName } from "@lictory/core/spaces/draft-access";
import {
  discussionCounts,
  discussionsOfMerge,
  onDeletedLine,
  type LineThread,
} from "@lictory/core/spaces/discussion-lifecycle";

// The state of a page's history that commands, projections and reads share:
// the commit graph, merge results of two lines, who contributed to a
// result, and what still stands between a pull request and its merge
// (docs/internals/spaces.md#history-commits-branches-and-pull-requests).
// Everything here reads; nothing writes.

type Db = Database | Tx;

// A commit without its content (graph, fingerprints, people).
export type CommitMeta = {
  id: string;
  pageId: string;
  parentIds: string[];
  title: string;
  hash: string;
  authorId: string;
  contributorIds: string[];
  approverIds: string[];
  message: string | null;
  pullRequestId: string | null;
  createdAt: Date;
};

export type PageSnapshot = { title: string; content: PageNode };

export async function commitMetas(
  db: Db,
  organizationId: string,
  pageIds: string[],
): Promise<CommitMeta[]> {
  if (!pageIds.length) return [];
  return db
    .select({
      id: s.pageCommit.id,
      pageId: s.pageCommit.pageId,
      parentIds: s.pageCommit.parentIds,
      title: s.pageCommit.title,
      hash: s.pageCommit.hash,
      authorId: s.pageCommit.authorId,
      contributorIds: s.pageCommit.contributorIds,
      approverIds: s.pageCommit.approverIds,
      message: s.pageCommit.message,
      pullRequestId: s.pageCommit.pullRequestId,
      createdAt: s.pageCommit.createdAt,
    })
    .from(s.pageCommit)
    .where(
      and(
        eq(s.pageCommit.organizationId, organizationId),
        inArray(s.pageCommit.pageId, pageIds),
      ),
    )
    .orderBy(asc(s.pageCommit.createdAt), asc(s.pageCommit.id));
}

// Titles and canonical content of the given commits.
export async function commitSnapshots(
  db: Db,
  organizationId: string,
  ids: string[],
) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, PageSnapshot>();
  const rows = await db
    .select({
      id: s.pageCommit.id,
      title: s.pageCommit.title,
      content: s.pageCommit.content,
    })
    .from(s.pageCommit)
    .where(
      and(
        eq(s.pageCommit.organizationId, organizationId),
        inArray(s.pageCommit.id, unique),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.id,
      { title: r.title, content: r.content as unknown as PageNode },
    ]),
  );
}

export function reachable(
  commits: { id: string; parentIds: string[] }[],
  head: string,
) {
  const parents = new Map(commits.map((c) => [c.id, c.parentIds]));
  const seen = new Set<string>();
  const queue = [head];
  for (const next of queue) {
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(parents.get(next) ?? []));
  }
  return seen;
}

// Everyone whose commits a merge of `sourceHead` into `targetHead` brings
// in: authors and contributors of commits reachable from the source but not
// from the target. They cannot approve that result.
export function resultContributors(
  commits: CommitMeta[],
  sourceHead: string,
  targetHead: string,
) {
  const inTarget = reachable(commits, targetHead);
  const ids = new Set<string>();
  for (const id of reachable(commits, sourceHead)) {
    if (inTarget.has(id)) continue;
    const commit = commits.find((c) => c.id === id);
    if (!commit) continue;
    ids.add(commit.authorId);
    for (const person of commit.contributorIds) ids.add(person);
  }
  return [...ids].sort();
}

export const TITLE_CONFLICT_ID = "page-conflict:title";

// One overlap a person has to resolve. Content conflicts come from the
// document engine (`Conflict`: smallest valid container, base/ours/theirs
// fragments as JSON and Markdown); the title conflicts as a whole.
export type PageConflict =
  | {
      id: string;
      kind: "title";
      base: string;
      ours: string;
      theirs: string;
    }
  | ({ kind: "content" } & Conflict);

export type PageMerge = {
  title: string;
  titleConflict: boolean;
  content: MergeResult;
  conflicts: PageConflict[];
};

// Three-way merge of two lines: `ours` is the line receiving the changes
// in a sync and the source of a pull request; `theirs` the other line.
// Titles merge like a single block.
export function mergePages(
  base: PageSnapshot,
  ours: PageSnapshot,
  theirs: PageSnapshot,
): PageMerge {
  const titleConflict =
    ours.title !== theirs.title &&
    base.title !== theirs.title &&
    base.title !== ours.title;
  const title =
    ours.title === theirs.title || base.title === theirs.title
      ? ours.title
      : base.title === ours.title
        ? theirs.title
        : ours.title;
  const content = mergeDocuments({
    base: base.content,
    ours: ours.content,
    theirs: theirs.content,
  });
  const conflicts: PageConflict[] = [
    ...(titleConflict
      ? [
          {
            id: TITLE_CONFLICT_ID,
            kind: "title" as const,
            base: base.title,
            ours: ours.title,
            theirs: theirs.title,
          },
        ]
      : []),
    ...(content.status === "conflicts"
      ? content.conflicts.map((c) => ({ kind: "content" as const, ...c }))
      : []),
  ];
  return { title, titleConflict, content, conflicts };
}

export function sameSnapshot(a: PageSnapshot, b: PageSnapshot) {
  return (
    a.title === b.title &&
    stableSerialize(a.content) === stableSerialize(b.content)
  );
}

type DraftRow = typeof s.spaceDraft.$inferSelect;
type BranchRow = typeof s.pageBranch.$inferSelect;
type PullRequestRow = typeof s.pagePullRequest.$inferSelect;
type ReviewRow = typeof s.pagePullRequestReview.$inferSelect;
type ReviewerRow = typeof s.pagePullRequestReviewer.$inferSelect;

export const draftHasChanges = (
  draft: Pick<DraftRow, "sequence" | "committedSequence">,
) => draft.sequence > draft.committedSequence;

// What the browser needs of an open draft; null for a fenced one.
export function draftSummary(
  draft: DraftRow | undefined,
): PageDraftSummary | null {
  if (!draft || draft.fencedAt) return null;
  return {
    id: draft.id,
    epoch: draft.epoch,
    documentName: draftDocumentName({ draftId: draft.id, epoch: draft.epoch }),
    committedSequence: draft.committedSequence,
    uncommittedChanges: draftHasChanges(draft),
  };
}

// The live state of one page needed to judge its pull requests.
export type PageLineState = {
  publishing: "direct" | "reviewed";
  branches: BranchRow[];
  commits: CommitMeta[];
  drafts: DraftRow[];
  pullRequests: PullRequestRow[];
  reviews: ReviewRow[];
  reviewers: ReviewerRow[];
  // Every discussion of the page with its line, for the merge gate and for
  // what a merge or a branch deletion removes.
  threads: LineThread[];
};

export async function pageLineStates(
  db: Db,
  organizationId: string,
  pageIds: string[],
) {
  const states = new Map<string, PageLineState>();
  if (!pageIds.length) return states;
  const [pages, branches, commits, drafts, pullRequests, threads] =
    await Promise.all([
      db
        .select({ id: s.page.id, publishing: s.space.publishing })
        .from(s.page)
        .innerJoin(
          s.space,
          and(
            eq(s.space.organizationId, s.page.organizationId),
            eq(s.space.id, s.page.spaceId),
          ),
        )
        .where(
          and(
            eq(s.page.organizationId, organizationId),
            inArray(s.page.id, pageIds),
          ),
        ),
      db
        .select()
        .from(s.pageBranch)
        .where(
          and(
            eq(s.pageBranch.organizationId, organizationId),
            inArray(s.pageBranch.pageId, pageIds),
            isNull(s.pageBranch.deletedAt),
          ),
        ),
      commitMetas(db, organizationId, pageIds),
      db
        .select()
        .from(s.spaceDraft)
        .where(
          and(
            eq(s.spaceDraft.organizationId, organizationId),
            inArray(s.spaceDraft.pageId, pageIds),
          ),
        ),
      db
        .select()
        .from(s.pagePullRequest)
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            inArray(s.pagePullRequest.pageId, pageIds),
            isNull(s.pagePullRequest.deletedAt),
          ),
        ),
      db
        .select({
          id: s.pageThread.id,
          pageId: s.pageThread.pageId,
          status: s.pageThread.status,
          blocking: s.pageThread.blocking,
          branchId: s.pageThread.branchId,
          pullRequestId: s.pageThread.pullRequestId,
          pullRequestSourceBranchId: s.pagePullRequest.sourceBranchId,
        })
        .from(s.pageThread)
        .leftJoin(
          s.pagePullRequest,
          and(
            eq(s.pagePullRequest.organizationId, s.pageThread.organizationId),
            eq(s.pagePullRequest.id, s.pageThread.pullRequestId),
          ),
        )
        .where(
          and(
            eq(s.pageThread.organizationId, organizationId),
            inArray(s.pageThread.pageId, pageIds),
          ),
        )
        .orderBy(asc(s.pageThread.createdAt), asc(s.pageThread.id)),
    ]);
  const prIds = pullRequests.map((p) => p.id);
  const [reviews, reviewers] = prIds.length
    ? await Promise.all([
        db
          .select()
          .from(s.pagePullRequestReview)
          .where(
            and(
              eq(s.pagePullRequestReview.organizationId, organizationId),
              inArray(s.pagePullRequestReview.pullRequestId, prIds),
            ),
          )
          .orderBy(
            asc(s.pagePullRequestReview.createdAt),
            asc(s.pagePullRequestReview.id),
          ),
        db
          .select()
          .from(s.pagePullRequestReviewer)
          .where(
            and(
              eq(s.pagePullRequestReviewer.organizationId, organizationId),
              inArray(s.pagePullRequestReviewer.pullRequestId, prIds),
            ),
          )
          .orderBy(asc(s.pagePullRequestReviewer.userId)),
      ])
    : [[], []];
  // An organization-wide rebuild loads every thread: group them once.
  const threadsByPage = new Map<string, LineThread[]>();
  for (const thread of threads) {
    const list = threadsByPage.get(thread.pageId);
    if (list) list.push(thread);
    else threadsByPage.set(thread.pageId, [thread]);
  }
  for (const page of pages) {
    const prs = pullRequests.filter((p) => p.pageId === page.id);
    const ids = new Set(prs.map((p) => p.id));
    states.set(page.id, {
      publishing: page.publishing,
      branches: branches.filter((b) => b.pageId === page.id),
      commits: commits.filter((c) => c.pageId === page.id),
      drafts: drafts.filter((d) => d.pageId === page.id),
      pullRequests: prs,
      reviews: reviews.filter((r) => ids.has(r.pullRequestId)),
      reviewers: reviewers.filter((r) => ids.has(r.pullRequestId)),
      threads: threadsByPage.get(page.id) ?? [],
    });
  }
  return states;
}

export const currentReview = (r: Pick<ReviewRow, "staleAt" | "withdrawnAt">) =>
  !r.staleAt && !r.withdrawnAt;

// The merge result of a pull request's current heads, or why there is
// none. `snapshots` must hold the base and both heads.
export function pullRequestMerge(
  state: Pick<PageLineState, "branches" | "commits">,
  pr: Pick<PullRequestRow, "sourceBranchId" | "targetBranchId">,
  snapshots: Map<string, PageSnapshot>,
) {
  const source = state.branches.find((b) => b.id === pr.sourceBranchId);
  const target = state.branches.find((b) => b.id === pr.targetBranchId);
  if (!source || !target) return null;
  const base = mergeBase(
    state.commits,
    source.headCommitId,
    target.headCommitId,
  );
  const ours = snapshots.get(source.headCommitId);
  const theirs = snapshots.get(target.headCommitId);
  const baseSnapshot = base ? snapshots.get(base.id) : undefined;
  const merge =
    base && ours && theirs && baseSnapshot
      ? mergePages(baseSnapshot, ours, theirs)
      : null;
  const resultHash =
    merge && !merge.conflicts.length
      ? documentHash(merge.title, merge.content.document)
      : null;
  const targetHash = state.commits.find(
    (c) => c.id === target.headCommitId,
  )?.hash;
  return {
    source,
    target,
    base: base ?? null,
    merge,
    resultHash,
    noChanges: resultHash !== null && resultHash === targetHash,
  };
}

// Commits whose content judging these pull requests needs.
export function pullRequestCommitIds(
  state: PageLineState,
  prs: Pick<PullRequestRow, "sourceBranchId" | "targetBranchId">[],
) {
  const ids: string[] = [];
  for (const pr of prs) {
    const source = state.branches.find((b) => b.id === pr.sourceBranchId);
    const target = state.branches.find((b) => b.id === pr.targetBranchId);
    if (!source || !target) continue;
    ids.push(source.headCommitId, target.headCommitId);
    const base = mergeBase(
      state.commits,
      source.headCommitId,
      target.headCommitId,
    );
    if (base) ids.push(base.id);
  }
  return ids;
}

export type PullRequestEvaluation = NonNullable<
  ReturnType<typeof evaluatePullRequest>
>;

// What stands between an unmerged pull request and its merge, from page
// data only (the merge command adds the access checks of the moment):
// conflicts, changes left, uncommitted drafts, blocking threads (the pull
// request's own and its source's; when targeting main, every thread of a
// line that still exists) and
// reviews. Every required reviewer needs a current approval of exactly this
// result from someone who did not contribute to it; a current request for
// changes of this result blocks; a Reviewed space merging into main needs
// at least one required review.
export function evaluatePullRequest(
  state: PageLineState,
  pr: PullRequestRow,
  snapshots: Map<string, PageSnapshot>,
) {
  if (pr.status === "merged" || pr.deletedAt) return null;
  const merged = pullRequestMerge(state, pr, snapshots);
  if (!merged) return null;
  const { source, target, base, merge, resultHash, noChanges } = merged;
  const contributorIds = resultContributors(
    state.commits,
    source.headCommitId,
    target.headCommitId,
  );
  const reviews = state.reviews.filter((r) => r.pullRequestId === pr.id);
  const current = reviews.filter(currentReview);
  const binding = current.filter(
    (r) => resultHash !== null && r.resultHash === resultHash,
  );
  const approvals = binding.filter(
    (r) => r.decision === "approved" && !contributorIds.includes(r.reviewerId),
  );
  const changesRequested = binding.filter(
    (r) => r.decision === "changes_requested",
  );
  const required = state.reviewers.filter(
    (r) => r.pullRequestId === pr.id && r.required,
  );
  const requiredApproved = required.filter((r) =>
    approvals.some((a) => a.reviewerId === r.userId),
  );
  const draftOf = (branchId: string) =>
    state.drafts.find((d) => d.branchId === branchId && !d.fencedAt);
  const sourceDraft = draftOf(source.id);
  const targetDraft = draftOf(target.id);
  // Merging into main retires the source unless another unmerged pull
  // request still uses it; the merge then removes the source's discussions
  // (all of them when it retires the source).
  const sourceRetired =
    target.isMain &&
    !state.pullRequests.some(
      (other) =>
        other.id !== pr.id &&
        other.status !== "merged" &&
        !other.deletedAt &&
        (other.sourceBranchId === source.id ||
          other.targetBranchId === source.id),
    );
  const removed = discussionsOfMerge(state.threads, pr, sourceRetired);
  const removedIds = new Set(removed.map((t) => t.id));
  // Open blocking discussions on a line that still exists: the pull
  // request's own, the ones the merge would remove (a merge never deletes an
  // open blocker) and, merging into main, every one of the page.
  const live = new Set(state.branches.map((b) => b.id));
  const blockingThreads = state.threads.filter(
    (t) =>
      t.status === "open" &&
      t.blocking &&
      !onDeletedLine(t, live) &&
      (t.pullRequestId === pr.id || target.isMain || removedIds.has(t.id)),
  ).length;
  const blockers: PageMergeBlocker[] = [];
  if (pr.status === "draft") blockers.push("draft");
  if (!base) blockers.push("no_merge_base");
  if (merge?.conflicts.length) blockers.push("conflicts");
  if (noChanges) blockers.push("no_changes");
  if (sourceDraft && draftHasChanges(sourceDraft))
    blockers.push("uncommitted_source");
  if (targetDraft && draftHasChanges(targetDraft))
    blockers.push("uncommitted_target");
  if (blockingThreads) blockers.push("blocking_threads");
  if (state.publishing === "reviewed" && target.isMain && !required.length)
    blockers.push("no_required_review");
  if (requiredApproved.length < required.length)
    blockers.push("review_pending");
  if (changesRequested.length) blockers.push("changes_requested");
  return {
    source,
    target,
    base,
    merge,
    resultHash,
    noChanges,
    contributorIds,
    approvals,
    changesRequested,
    required,
    requiredApproved,
    staleReviews: reviews.filter((r) => r.staleAt).length,
    blockingThreads,
    removedOnMerge: {
      sourceRetired,
      threadIds: [...removedIds],
      discussions: discussionCounts(removed),
    },
    sourceDraft,
    targetDraft,
    blockers,
  };
}
