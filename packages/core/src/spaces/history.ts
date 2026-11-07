import { and, asc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import * as Y from "yjs";
import * as s from "@lictory/core/db/schema";
import {
  spaceLevelAtLeast,
  type PageHistoryCommand,
  type PageMergeResolution,
  type PageThreadAnchor,
  type StoredPageThreadAnchor,
} from "@lictory/core/contracts/protocol";
import { mergeBase } from "@lictory/core/contracts/merge";
import { branchNameProblem } from "@lictory/core/lib/branch-name";
import { DomainError } from "@lictory/core/domain/errors";
import type { Tx } from "@lictory/core/domain/service";
import {
  canEditDraft,
  canReviewPageChange,
  pageAccess,
  type SpaceActor,
} from "@lictory/core/spaces/access";
import type {
  SpaceCommandContext,
  SpaceCommandSummary,
} from "@lictory/core/spaces/commands";
import { removePageThreads } from "@lictory/core/spaces/discussions";
import {
  describeDiscussions,
  discussionCounts,
  discussionTotal,
  discussionsOfDeletedBranch,
  type DiscussionCounts,
} from "@lictory/core/spaces/discussion-lifecycle";
import {
  canonicalizeDocument,
  documentHash,
  documentToDraftState,
  documentToMarkdown,
  draftStateToDocument,
  markdownToDocument,
  PAGE_SCHEMA_VERSION,
  PageDocumentError,
  pageSchema,
  resolveMerge,
  stableSerialize,
  type MergeChoice,
  type PageNode,
} from "@lictory/core/spaces/document";
import {
  commitMetas,
  commitSnapshots,
  currentReview,
  draftHasChanges,
  evaluatePullRequest,
  mergePages,
  pageLineStates,
  pullRequestCommitIds,
  pullRequestMerge,
  reachable,
  resultContributors,
  TITLE_CONFLICT_ID,
  type CommitMeta,
  type PageLineState,
  type PageSnapshot,
} from "@lictory/core/spaces/history-state";
import {
  notifyPageApprovalInvalidated,
  notifyPageReviewRequested,
} from "@lictory/core/spaces/notifications";
import {
  indexPublishedPage,
  revisionOfItem,
} from "@lictory/core/spaces/knowledge";
import { writeSpaceProjections } from "@lictory/core/spaces/projections";
import { signalSpaceAccess } from "@lictory/core/spaces/signals";

// Page history commands (docs/internals/spaces.md#history-commits-branches-and-pull-requests),
// applied by `applySpaceCommand` inside `applyMutation`'s transaction, which
// holds the organization lock in exclusive mode: the live draft writer
// (shared mode) cannot store updates while one of these runs, so a draft
// read here is exactly what is stored.
//
// The model mirrors specification branches (packages/core/src/domain/branches.ts)
// for multiplayer drafts: commits are immutable snapshots sealed from a
// draft at an exact stored sequence (or created by restore, sync, merge and
// proposals); every head move that does not come from sealing a line's own
// draft starts a new epoch of that draft, seeded from the new head; review
// decisions bind to the fingerprint of the complete merge result and go
// stale when it changes.

type Ctx = SpaceCommandContext;
type BranchRow = typeof s.pageBranch.$inferSelect;
type DraftRow = typeof s.spaceDraft.$inferSelect;
type PullRequestRow = typeof s.pagePullRequest.$inferSelect;

const fail = (
  message: string,
  category: DomainError["category"] = "validation",
  kind?: string,
): never => {
  throw new DomainError(category, message, undefined, kind);
};
const unavailablePage = () =>
  new DomainError("not_found", "This page is unavailable.");
const unavailableBranch = () =>
  new DomainError("not_found", "This branch is unavailable on this page.");
const unavailablePullRequest = () =>
  new DomainError("not_found", "This pull request is unavailable.");
const short = (id: string) => id.slice(0, 8);

// ------------------------------------------------------------------ access

// The page as the actor may see it: people without read access get not
// found (restricted spaces do not reveal pages); readers learn why not.
async function readablePage(tx: Tx, actor: SpaceActor, pageId: string) {
  const row = await pageAccess(tx, actor, pageId);
  if (!row?.level) throw unavailablePage();
  return row as typeof row & { level: NonNullable<typeof row.level> };
}

function requireActive(row: {
  space: { name: string; archivedAt: Date | null };
  page: { archivedAt: Date | null };
}) {
  if (row.space.archivedAt)
    fail(
      `${row.space.name} is archived. Restore it before changing its pages.`,
      "conflict",
    );
  if (row.page.archivedAt)
    fail("This page is archived. Restore it before changing it.", "conflict");
}

function requireEditor(row: { level: string; space: { name: string } }) {
  if (!spaceLevelAtLeast(row.level as "view", "edit"))
    fail(
      `You can view ${row.space.name} but not edit it. Ask one of its administrators for edit access.`,
      "forbidden",
    );
}

// Writing to a line: edit access to the active space and page, and for a
// named branch being its author or a collaborator. Main is written only in
// Direct spaces (publishing); Reviewed spaces change main through pull
// requests.
async function requireLineWriter(
  tx: Tx,
  actor: SpaceActor,
  row: Awaited<ReturnType<typeof readablePage>>,
  branch: BranchRow,
) {
  requireActive(row);
  requireEditor(row);
  if (branch.isMain && row.space.publishing === "reviewed")
    fail(
      `Main is protected in ${row.space.name}: changes arrive through reviewed pull requests. Make the change on a branch and open a pull request.`,
      "forbidden",
    );
  if (!(await canEditDraft(tx, actor, branch.id)))
    fail(
      `Only the author of ${branch.name} and the collaborators they invite can change it.`,
      "forbidden",
    );
}

async function branchOf(tx: Tx, organizationId: string, branchId: string) {
  const [branch] = await tx
    .select()
    .from(s.pageBranch)
    .where(
      and(
        eq(s.pageBranch.organizationId, organizationId),
        eq(s.pageBranch.id, branchId),
      ),
    );
  return branch;
}

// A branch as the actor may see it: one on a page they cannot read reads
// exactly like one that does not exist.
async function readableBranch(tx: Tx, actor: SpaceActor, branchId: string) {
  const branch = await branchOf(tx, actor.organizationId, branchId);
  if (!branch) throw unavailableBranch();
  const row = await pageAccess(tx, actor, branch.pageId);
  if (!row?.level) throw unavailableBranch();
  return {
    branch,
    row: row as typeof row & { level: NonNullable<typeof row.level> },
  };
}

// A live branch of the page.
async function liveBranch(
  tx: Tx,
  organizationId: string,
  pageId: string,
  branchId: string,
) {
  const branch = await branchOf(tx, organizationId, branchId);
  if (branch?.pageId !== pageId) throw unavailableBranch();
  if (branch.deletedAt)
    fail(
      `${branch.name} was deleted. Its commits are kept in the page's history.`,
      "conflict",
    );
  return branch;
}

async function draftOf(tx: Tx, organizationId: string, branchId: string) {
  const [draft] = await tx
    .select()
    .from(s.spaceDraft)
    .where(
      and(
        eq(s.spaceDraft.organizationId, organizationId),
        eq(s.spaceDraft.branchId, branchId),
      ),
    );
  return draft;
}

const openDraft = (draft: DraftRow | undefined) =>
  draft && !draft.fencedAt ? draft : undefined;

const UNCOMMITTED_HINTS = {
  merge:
    ", so a merge never includes or leaves out text people are still writing.",
  sync: ", so updating the branch never replaces text people are still writing.",
  restore:
    ", or restore with discardDraftChanges to replace them (they stay recoverable).",
};

function requireNoUncommitted(
  draft: DraftRow | undefined,
  branch: BranchRow,
  action: keyof typeof UNCOMMITTED_HINTS,
) {
  const open = openDraft(draft);
  if (open && draftHasChanges(open))
    fail(
      `${
        branch.isMain
          ? "Main has unpublished changes in its live draft. Publish them first"
          : `${branch.name} has uncommitted changes in its live draft. Commit them first`
      }${UNCOMMITTED_HINTS[action]}`,
      "conflict",
      "uncommitted_changes",
    );
}

async function commitMeta(
  tx: Tx,
  organizationId: string,
  pageId: string,
  commitId: string,
) {
  const [commit] = (await commitMetas(tx, organizationId, [pageId])).filter(
    (c) => c.id === commitId,
  );
  if (!commit)
    throw new DomainError(
      "not_found",
      "This version of the page is unavailable.",
    );
  return commit;
}

async function snapshotOf(tx: Tx, organizationId: string, commitId: string) {
  const snapshot = (await commitSnapshots(tx, organizationId, [commitId])).get(
    commitId,
  );
  if (!snapshot)
    throw new DomainError(
      "not_found",
      "This version of the page is unavailable.",
    );
  return snapshot;
}

function requireHead(branch: BranchRow, expected: string) {
  if (branch.headCommitId !== expected)
    fail(
      `${branch.name} changed since you looked at it. Review its latest commit and try again.`,
      "conflict",
    );
}

async function requireNewId(
  tx: Tx,
  table: "branch" | "pullRequest",
  id: string,
) {
  const [existing] =
    table === "branch"
      ? await tx
          .select({ id: s.pageBranch.id })
          .from(s.pageBranch)
          .where(eq(s.pageBranch.id, id))
      : await tx
          .select({ id: s.pagePullRequest.id })
          .from(s.pagePullRequest)
          .where(eq(s.pagePullRequest.id, id));
  if (existing)
    fail(
      `This ${table === "branch" ? "branch" : "pull request"} id is already used. Retry with a new id.`,
      "conflict",
    );
}

// ------------------------------------------------------------------ drafts

// Every epoch's seed is kept (`space_draft_seed`), so a replaced epoch can
// be reconstructed from its seed and its updates (`recoverDraftEpoch`).
async function keepEpochSeed(
  tx: Tx,
  organizationId: string,
  draftId: string,
  epoch: number,
  seed: Buffer,
) {
  await tx
    .insert(s.spaceDraftSeed)
    .values({ organizationId, draftId, epoch, seed });
}

// Starts a new epoch of a draft whose content is the given commit: the
// seeded Yjs state becomes the epoch's snapshot, so editors connecting to
// the new document name load exactly the committed content. Clients of
// the previous epoch are refused (the `space_draft` trigger signals the
// collaboration service to close them). The previous epoch's seed and
// update log stay stored.
async function startDraftEpoch(
  tx: Tx,
  organizationId: string,
  draft: DraftRow,
  commitId: string,
) {
  const { content } = await snapshotOf(tx, organizationId, commitId);
  const epoch = draft.epoch + 1;
  const seed = Buffer.from(documentToDraftState(content));
  await keepEpochSeed(tx, organizationId, draft.id, epoch, seed);
  await tx
    .update(s.spaceDraft)
    .set({
      epoch,
      baseCommitId: commitId,
      committedSequence: draft.sequence,
      snapshot: seed,
      snapshotSequence: draft.sequence,
      fencedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(s.spaceDraft.organizationId, organizationId),
        eq(s.spaceDraft.id, draft.id),
      ),
    );
  return { id: draft.id, epoch };
}

// The open live draft of a line at the given commit: created seeded, or a
// fenced one reopened as a new epoch seeded from the commit. An open draft
// is returned as it is.
export async function openLineDraft(
  tx: Tx,
  organizationId: string,
  pageId: string,
  branchId: string,
  commitId: string,
) {
  const existing = await draftOf(tx, organizationId, branchId);
  if (existing && !existing.fencedAt)
    return { id: existing.id, epoch: existing.epoch };
  if (existing) return startDraftEpoch(tx, organizationId, existing, commitId);
  const { content } = await snapshotOf(tx, organizationId, commitId);
  const id = crypto.randomUUID();
  const seed = Buffer.from(documentToDraftState(content));
  await tx.insert(s.spaceDraft).values({
    id,
    organizationId,
    pageId,
    branchId,
    baseCommitId: commitId,
    snapshot: seed,
  });
  await keepEpochSeed(tx, organizationId, id, 1, seed);
  return { id, epoch: 1 };
}

// After a line's head moved without sealing its own draft (restore, sync,
// merge into it), its open draft starts a new epoch at the new head.
async function reseedLineDraft(
  tx: Tx,
  organizationId: string,
  branchId: string,
  commitId: string,
) {
  const draft = openDraft(await draftOf(tx, organizationId, branchId));
  return draft ? startDraftEpoch(tx, organizationId, draft, commitId) : null;
}

async function fenceDraft(tx: Tx, organizationId: string, branchId: string) {
  await tx
    .update(s.spaceDraft)
    .set({ fencedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(s.spaceDraft.organizationId, organizationId),
        eq(s.spaceDraft.branchId, branchId),
        isNull(s.spaceDraft.fencedAt),
      ),
    );
}

// The stored state of a draft epoch up to exactly `sequence`, and who wrote
// the updates since the last commit.
async function sealedDraftState(tx: Tx, draft: DraftRow, sequence: number) {
  const [updates, authors] = await Promise.all([
    tx
      .select({ update: s.spaceDraftUpdate.update })
      .from(s.spaceDraftUpdate)
      .where(
        and(
          eq(s.spaceDraftUpdate.organizationId, draft.organizationId),
          eq(s.spaceDraftUpdate.draftId, draft.id),
          eq(s.spaceDraftUpdate.epoch, draft.epoch),
          gt(s.spaceDraftUpdate.sequence, draft.snapshotSequence),
          lte(s.spaceDraftUpdate.sequence, sequence),
        ),
      )
      .orderBy(asc(s.spaceDraftUpdate.sequence)),
    tx
      .selectDistinct({ authorId: s.spaceDraftUpdate.authorId })
      .from(s.spaceDraftUpdate)
      .where(
        and(
          eq(s.spaceDraftUpdate.organizationId, draft.organizationId),
          eq(s.spaceDraftUpdate.draftId, draft.id),
          eq(s.spaceDraftUpdate.epoch, draft.epoch),
          gt(s.spaceDraftUpdate.sequence, draft.committedSequence),
          lte(s.spaceDraftUpdate.sequence, sequence),
        ),
      ),
  ]);
  const parts = [
    ...(draft.snapshot ? [new Uint8Array(draft.snapshot)] : []),
    ...updates.map((u) => new Uint8Array(u.update)),
  ];
  return {
    state: parts.length ? Y.mergeUpdates(parts) : new Uint8Array([0, 0]),
    authorIds: authors.map((a) => a.authorId),
  };
}

// The title a commit seals: the draft's own title at the cut, else the
// title the request named, else the line's current title.
const PAGE_TITLE_MAX = 200;
function sealedTitle(doc: Y.Doc, requested: string | undefined, head: string) {
  const own = doc.getText("title").toJSON().trim();
  if (own.length > PAGE_TITLE_MAX)
    fail(
      `The page title is longer than ${PAGE_TITLE_MAX} characters. Shorten it and commit again.`,
    );
  if (own) return own;
  const asked = requested?.trim();
  if (asked) return asked;
  return head;
}

// ---------------------------------------------------------------- anchors

type DraftAnchor = Extract<PageThreadAnchor, { kind: "draft" }>;

const inlineSize = (node: Y.XmlText | Y.XmlElement | Y.XmlHook) =>
  node instanceof Y.XmlText ? node.length : 1;

// A Yjs relative position of a draft as (path of the textblock, offset
// into its content in ProseMirror positions), or null when the text it
// pointed at no longer exists.
function locate(doc: Y.Doc, encoded: string) {
  let relative: Y.RelativePosition;
  try {
    relative = Y.decodeRelativePosition(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
  const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
  if (!absolute) return null;
  let element: Y.XmlElement;
  let offset: number;
  if (absolute.type instanceof Y.XmlText) {
    const parent = absolute.type.parent;
    if (!(parent instanceof Y.XmlElement)) return null;
    const children = parent.toArray();
    const index = children.indexOf(absolute.type);
    if (index < 0) return null;
    offset =
      children.slice(0, index).reduce((n, c) => n + inlineSize(c), 0) +
      absolute.index;
    element = parent as Y.XmlElement;
  } else if (absolute.type instanceof Y.XmlElement) {
    element = absolute.type as Y.XmlElement;
    offset = element
      .toArray()
      .slice(0, absolute.index)
      .reduce((n, c) => n + inlineSize(c), 0);
  } else return null;
  const root = doc.getXmlFragment("default");
  const path: number[] = [];
  let node: Y.XmlFragment = element;
  while (node !== root) {
    if (node._item?.deleted) return null;
    const parent: unknown = node.parent;
    if (!(parent instanceof Y.XmlFragment)) return null;
    const index = parent.toArray().indexOf(node as Y.XmlElement);
    if (index < 0) return null;
    path.unshift(index);
    node = parent;
  }
  return { path, offset };
}

// Freezes a draft anchor against the committed document: the textblock at
// the start position (block id, offsets, the committed quote), or null when
// the selected text no longer exists in the commit. A range spanning
// blocks is cut at the end of its first block; the quote keeps the text
// that was selected when the committed text is empty.
function freezeDraftAnchor(
  doc: Y.Doc,
  content: PageNode,
  anchor: Pick<DraftAnchor, "start" | "end" | "quote">,
) {
  const start = locate(doc, anchor.start);
  const end = locate(doc, anchor.end);
  if (!start || !end) return null;
  let node: PageNode | undefined = content;
  for (const index of start.path) node = node?.content?.[index];
  if (
    !node ||
    !pageSchema.nodes[node.type]?.isTextblock ||
    typeof node.attrs?.id !== "string"
  )
    return null;
  const block = pageSchema.nodeFromJSON(node);
  const size = block.content.size;
  const from = Math.min(start.offset, size);
  const to =
    stableSerialize(start.path) === stableSerialize(end.path)
      ? Math.min(end.offset, size)
      : size;
  if (from >= to) return null;
  const text = block.textBetween(from, to, "\n", "");
  return {
    blockId: node.attrs.id,
    from,
    to,
    quote: (text.trim() ? text : anchor.quote).slice(0, 2000),
  };
}

// Converts the open threads anchored to this draft epoch into anchors on
// the new commit, in the commit's transaction. The only change ever made to
// an anchor (docs/internals/spaces.md#anchors).
async function freezeDraftAnchors(
  tx: Tx,
  organizationId: string,
  pageId: string,
  draft: { id: string; epoch: number },
  commitId: string,
  doc: Y.Doc,
  content: PageNode,
) {
  const threads = await tx
    .select({ id: s.pageThread.id, anchor: s.pageThread.anchor })
    .from(s.pageThread)
    .where(
      and(
        eq(s.pageThread.organizationId, organizationId),
        eq(s.pageThread.pageId, pageId),
        eq(s.pageThread.status, "open"),
        sql`${s.pageThread.anchor}->>'kind' = 'draft'`,
        sql`${s.pageThread.anchor}->>'draftId' = ${draft.id}`,
        sql`${s.pageThread.anchor}->>'epoch' = ${String(draft.epoch)}`,
      ),
    );
  for (const thread of threads) {
    const anchor = thread.anchor as unknown as DraftAnchor;
    const frozen = freezeDraftAnchor(doc, content, anchor);
    const next: StoredPageThreadAnchor = frozen
      ? { v: 1, kind: "commit", commitId, ...frozen }
      : { v: 1, kind: "detached", commitId, quote: anchor.quote };
    await tx
      .update(s.pageThread)
      .set({ anchor: next, commitId, updatedAt: new Date() })
      .where(
        and(
          eq(s.pageThread.organizationId, organizationId),
          eq(s.pageThread.id, thread.id),
        ),
      );
  }
  return threads.length;
}

// ---------------------------------------------------------------- commits

async function insertCommit(
  tx: Tx,
  ctx: Ctx,
  input: {
    pageId: string;
    parentIds: string[];
    title: string;
    content: PageNode;
    message: string | null;
    contributorIds: string[];
    draft?: { id: string; epoch: number; sequence: number };
    pullRequestId?: string;
    approverIds?: string[];
  },
) {
  const content = canonicalizeDocument(input.content);
  const id = crypto.randomUUID();
  const hash = documentHash(input.title, content);
  await tx.insert(s.pageCommit).values({
    id,
    organizationId: ctx.organizationId,
    pageId: input.pageId,
    parentIds: input.parentIds,
    title: input.title,
    content: content,
    markdown: documentToMarkdown(content),
    hash,
    schemaVersion: PAGE_SCHEMA_VERSION,
    message: input.message?.trim() ? input.message.trim() : null,
    authorId: ctx.userId,
    contributorIds: [...new Set([ctx.userId, ...input.contributorIds])].sort(),
    draftId: input.draft?.id ?? null,
    draftEpoch: input.draft?.epoch ?? null,
    draftSequence: input.draft?.sequence ?? null,
    pullRequestId: input.pullRequestId ?? null,
    approverIds: [...new Set(input.approverIds ?? [])].sort(),
  });
  return { id, hash };
}

// Every head move of a page line goes through here. When main moves, the
// page's published version changed: its reference index follows in the
// same transaction (docs/internals/knowledge-links.md).
async function moveHead(
  tx: Tx,
  organizationId: string,
  branchId: string,
  commitId: string,
) {
  const [moved] = await tx
    .update(s.pageBranch)
    .set({ headCommitId: commitId })
    .where(
      and(
        eq(s.pageBranch.organizationId, organizationId),
        eq(s.pageBranch.id, branchId),
      ),
    )
    .returning({ pageId: s.pageBranch.pageId, isMain: s.pageBranch.isMain });
  if (moved?.isMain) await indexPublishedPage(tx, organizationId, moved.pageId);
}

// The work item revision a branch is opened from ("Propose page update"):
// any work item of the organization (items are visible to every member)
// and one of its revisions.
async function recordBranchOrigin(
  tx: Tx,
  organizationId: string,
  pageId: string,
  branchId: string,
  origin: { workItemId: string; revisionId: string } | undefined,
) {
  if (!origin) return undefined;
  if (
    !(await revisionOfItem(
      tx,
      organizationId,
      origin.workItemId,
      origin.revisionId,
    ))
  )
    throw new DomainError(
      "not_found",
      "The work item revision this branch proposes to document is unavailable.",
    );
  await tx.insert(s.pageBranchOrigin).values({
    organizationId,
    branchId,
    pageId,
    workItemId: origin.workItemId,
    revisionId: origin.revisionId,
  });
  return { workItemId: origin.workItemId, revisionId: origin.revisionId };
}

function validDocument<T>(run: () => T, what: string): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PageDocumentError)
      fail(`${what}: ${error.message}`, "validation", "invalid_page_content");
    throw error;
  }
}

// ---------------------------------------------------------------- reviews

// Marks current review decisions whose result no longer matches their pull
// request's merge result stale, naming what changed, and tells the
// approvers. Runs after every head move of the page.
async function invalidateStaleReviews(tx: Tx, ctx: Ctx, pageId: string) {
  const state = (await pageLineStates(tx, ctx.organizationId, [pageId])).get(
    pageId,
  );
  if (!state) return;
  const open = state.pullRequests.filter((p) => p.status !== "merged");
  if (!open.length) return;
  const snapshots = await commitSnapshots(
    tx,
    ctx.organizationId,
    pullRequestCommitIds(state, open),
  );
  const now = new Date();
  for (const pr of open) {
    const merged = pullRequestMerge(state, pr, snapshots);
    const stale = state.reviews.filter(
      (r) =>
        r.pullRequestId === pr.id &&
        currentReview(r) &&
        r.resultHash !== (merged?.resultHash ?? null),
    );
    if (!stale.length) continue;
    for (const review of stale) {
      const changed = [
        merged && review.sourceHeadId !== merged.source.headCommitId
          ? merged.source.name
          : null,
        merged && review.targetHeadId !== merged.target.headCommitId
          ? merged.target.name
          : null,
      ].filter((x): x is string => x !== null);
      const reason = changed.length
        ? `${changed.join(" and ")} changed after this review; the merge result is different.`
        : "The merge result changed after this review.";
      await tx
        .update(s.pagePullRequestReview)
        .set({ staleAt: now, staleReason: reason })
        .where(
          and(
            eq(s.pagePullRequestReview.organizationId, ctx.organizationId),
            eq(s.pagePullRequestReview.id, review.id),
          ),
        );
    }
    const approvers = stale
      .filter((r) => r.decision === "approved")
      .map((r) => r.reviewerId);
    if (approvers.length)
      await notifyPageApprovalInvalidated(tx, {
        organizationId: ctx.organizationId,
        pageId,
        actorId: ctx.userId,
        reviewerIds: approvers,
        pullRequestId: pr.id,
        pullRequestTitle: pr.title,
      });
  }
}

async function pullRequestOf(tx: Tx, organizationId: string, id: string) {
  const [pr] = await tx
    .select()
    .from(s.pagePullRequest)
    .where(
      and(
        eq(s.pagePullRequest.organizationId, organizationId),
        eq(s.pagePullRequest.id, id),
      ),
    );
  return pr;
}

// A pull request the actor can read, with its page.
async function readablePullRequest(tx: Tx, actor: SpaceActor, id: string) {
  const pr = await pullRequestOf(tx, actor.organizationId, id);
  if (!pr || pr.deletedAt) throw unavailablePullRequest();
  const row = await pageAccess(tx, actor, pr.pageId);
  if (!row?.level) throw unavailablePullRequest();
  return {
    pr,
    row: row as typeof row & { level: NonNullable<typeof row.level> },
  };
}

// Manage a pull request (title, draft state, reviewers): its author or an
// author/collaborator of its source branch.
async function requirePullRequestManager(
  tx: Tx,
  actor: SpaceActor,
  pr: PullRequestRow,
) {
  if (pr.authorId === actor.userId) return;
  if (await canEditDraft(tx, actor, pr.sourceBranchId)) return;
  fail(
    "Only the pull request's author and the collaborators of its source branch can change it.",
    "forbidden",
  );
}

async function lineState(tx: Tx, organizationId: string, pageId: string) {
  const state = (await pageLineStates(tx, organizationId, [pageId])).get(
    pageId,
  );
  if (!state) throw unavailablePage();
  return state;
}

async function evaluate(
  tx: Tx,
  organizationId: string,
  state: PageLineState,
  pr: PullRequestRow,
) {
  const snapshots = await commitSnapshots(
    tx,
    organizationId,
    pullRequestCommitIds(state, [pr]),
  );
  const evaluation = evaluatePullRequest(state, pr, snapshots);
  if (!evaluation) throw unavailablePullRequest();
  return evaluation;
}

function requireInspectedHeads(
  evaluation: { source: BranchRow; target: BranchRow },
  sourceHead: string,
  targetHead: string,
) {
  if (
    evaluation.source.headCommitId !== sourceHead ||
    evaluation.target.headCommitId !== targetHead
  )
    fail(
      "A branch of this pull request changed. Inspect the updated merge result before continuing.",
      "conflict",
    );
}

// Deleting a branch or merging a pull request removes discussions; people
// confirm the counts they were shown (`discussionsToRemove`). Without a
// confirmation (clients and agents that predate the warning) or when it
// differs, nothing is removed and the person is asked to look again.
function requireConfirmedRemoval(
  expected: number | undefined,
  counts: DiscussionCounts,
) {
  const total = discussionTotal(counts);
  if (expected === total) return;
  if (expected === undefined) {
    if (!total) return;
    fail(
      `This permanently deletes ${describeDiscussions(counts)}. Confirm the deletion first: reload to see the warning, or pass discussionsToRemove: ${total}.`,
      "conflict",
      "discussions_unconfirmed",
    );
  }
  fail(
    `The discussions this removes changed since you confirmed: it now removes ${describeDiscussions(counts)}. Review the warning and confirm again.`,
    "conflict",
    "discussions_changed",
  );
}

function conflictRefusal(count: number, source: string, target: string): never {
  return fail(
    `${count === 1 ? "One conflict" : `${count} conflicts`} between ${source} and ${target} must be resolved first: sync ${target} into ${source} with a resolution for each (previewPageMerge lists them).`,
    "conflict",
    "page_merge_conflicts",
  );
}

// Applies a person's choices to the conflicts of a merge.
function resolve(
  merge: ReturnType<typeof mergePages>,
  resolutions: Record<string, PageMergeResolution>,
) {
  const known = new Set(merge.conflicts.map((c) => c.id));
  const unknown = Object.keys(resolutions).filter((id) => !known.has(id));
  if (unknown.length)
    fail(
      `These conflicts no longer exist: ${unknown.join(", ")}. Review the current conflicts and resolve them again.`,
      "conflict",
      "page_merge_conflicts",
    );
  let title = merge.title;
  if (merge.titleConflict) {
    const choice = resolutions[TITLE_CONFLICT_ID];
    const titles = merge.conflicts.find((c) => c.kind === "title")!;
    if (!choice) fail("Choose a title for the page: both lines changed it.");
    if (choice === "both" || (typeof choice === "object" && "manual" in choice))
      fail('Resolve the title conflict with "ours", "theirs" or { title }.');
    title =
      choice === "ours"
        ? (titles as { ours: string }).ours
        : choice === "theirs"
          ? (titles as { theirs: string }).theirs
          : (choice as { title: string }).title;
  }
  const choices: Record<string, MergeChoice> = {};
  for (const [id, choice] of Object.entries(resolutions)) {
    if (id === TITLE_CONFLICT_ID) continue;
    if (typeof choice === "object" && "title" in choice)
      fail(`Resolve ${id} with "ours", "theirs", "both" or { manual }.`);
    choices[id] =
      typeof choice === "object"
        ? {
            manual: (choice as { manual: unknown }).manual as
              PageNode | PageNode[],
          }
        : choice;
  }
  const content = validDocument(
    () => resolveMerge(merge.content, choices),
    "The resolved page is invalid",
  );
  return { title, content };
}

// ---------------------------------------------------------------- commands

export async function applyPageHistoryCommand(
  tx: Tx,
  ctx: Ctx,
  c: PageHistoryCommand,
): Promise<SpaceCommandSummary | undefined> {
  const { organizationId, userId } = ctx;
  const actor: SpaceActor = { organizationId, userId };
  // Page activity rows are projected with the page's discussions.
  let recorded = false;
  const record = (
    pageId: string,
    action: string,
    detail: Record<string, unknown>,
  ) => {
    recorded = true;
    return tx.insert(s.pageActivity).values({
      organizationId,
      pageId,
      actorId: userId,
      action,
      detail: { ...detail, ...ctx.delegation },
    });
  };
  const project = (
    pageId: string,
    options: { commits?: string[]; discussions?: boolean } = {},
  ) =>
    writeSpaceProjections(tx, organizationId, {
      pages: [pageId],
      pageLines: [pageId],
      commits: options.commits,
      pageDiscussions: options.discussions || recorded ? [pageId] : undefined,
    });

  switch (c.type) {
    case "commitDraft": {
      const row = await readablePage(tx, actor, c.pageId);
      const branch = await liveBranch(tx, organizationId, c.pageId, c.branchId);
      await requireLineWriter(tx, actor, row, branch);
      const draft = openDraft(await draftOf(tx, organizationId, branch.id));
      if (draft?.id !== c.draftId || draft.epoch !== c.epoch)
        fail(
          "This draft was closed or replaced since you opened it. Reopen the page and commit from its current draft.",
          "conflict",
          "draft_replaced",
        );
      if (draft!.sequence < c.expectedSequence)
        fail(
          "Some of these edits are not saved yet. Wait until the editor shows “Saved” and commit again.",
          "conflict",
        );
      if (c.expectedSequence < draft!.committedSequence)
        fail(
          "These edits were already committed. Commit again from the current draft.",
          "conflict",
        );
      if (draft!.snapshotSequence > c.expectedSequence)
        fail(
          "The draft was compacted since you saw it. Commit again from the current draft.",
          "conflict",
        );
      const sealed = await sealedDraftState(tx, draft!, c.expectedSequence);
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, sealed.state);
        const head = await commitMeta(
          tx,
          organizationId,
          c.pageId,
          branch.headCommitId,
        );
        const headSnapshot = await snapshotOf(tx, organizationId, head.id);
        // A draft that was never written (no seed, no update) is an empty
        // page; it reuses the head's content when that is empty too.
        const content: PageNode = doc.getXmlFragment("default").length
          ? validDocument(
              () => draftStateToDocument(sealed.state),
              "This draft cannot be committed",
            )
          : documentToMarkdown(headSnapshot.content) === ""
            ? headSnapshot.content
            : canonicalizeDocument({
                type: "doc",
                content: [{ type: "paragraph" }],
              });
        // The committed title is the draft's working title at the sealed
        // cut (Y.Text "title"), exactly like the content: a title someone
        // typed after the cut stays uncommitted. Drafts whose title was
        // never edited carry none; then the request's title (older
        // editors) and finally the head's title apply.
        const title = sealedTitle(doc, c.title, head.title);
        if (documentHash(title, content) === head.hash) {
          if (c.expectedSequence === draft!.committedSequence)
            fail(
              "Nothing to commit: the title and content equal the latest commit.",
            );
          // Edits that cancel out: the draft matches the head again, so the
          // cut is recorded as committed without a new commit.
          await tx
            .update(s.spaceDraft)
            .set({
              committedSequence: c.expectedSequence,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(s.spaceDraft.organizationId, organizationId),
                eq(s.spaceDraft.id, draft!.id),
              ),
            );
          await project(c.pageId);
          return {
            nothingToCommit: "true",
            committedSequence: String(c.expectedSequence),
          };
        }
        const commit = await insertCommit(tx, ctx, {
          pageId: c.pageId,
          parentIds: [branch.headCommitId],
          title,
          content,
          message: c.message ?? null,
          contributorIds: sealed.authorIds,
          draft: {
            id: draft!.id,
            epoch: draft!.epoch,
            sequence: c.expectedSequence,
          },
        });
        await moveHead(tx, organizationId, branch.id, commit.id);
        await tx
          .update(s.spaceDraft)
          .set({
            committedSequence: c.expectedSequence,
            baseCommitId: commit.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(s.spaceDraft.organizationId, organizationId),
              eq(s.spaceDraft.id, draft!.id),
            ),
          );
        const frozen = await freezeDraftAnchors(
          tx,
          organizationId,
          c.pageId,
          draft!,
          commit.id,
          doc,
          canonicalizeDocument(content),
        );
        await invalidateStaleReviews(tx, ctx, c.pageId);
        await project(c.pageId, {
          commits: [commit.id],
          discussions: frozen > 0,
        });
        return {
          commitId: commit.id,
          committedSequence: String(c.expectedSequence),
          ...(branch.isMain ? { published: "true" } : {}),
        };
      } finally {
        doc.destroy();
      }
    }

    case "restorePageCommit": {
      const row = await readablePage(tx, actor, c.pageId);
      const branch = await liveBranch(tx, organizationId, c.pageId, c.branchId);
      await requireLineWriter(tx, actor, row, branch);
      requireHead(branch, c.expectedHead);
      const draft = await draftOf(tx, organizationId, branch.id);
      if (!c.discardDraftChanges)
        requireNoUncommitted(draft, branch, "restore");
      const restored = await commitMeta(
        tx,
        organizationId,
        c.pageId,
        c.commitId,
      );
      const head = await commitMeta(
        tx,
        organizationId,
        c.pageId,
        branch.headCommitId,
      );
      if (restored.hash === head.hash)
        fail("Nothing to restore: this version equals the latest commit.");
      const snapshot = await snapshotOf(tx, organizationId, restored.id);
      const commit = await insertCommit(tx, ctx, {
        pageId: c.pageId,
        parentIds: [branch.headCommitId],
        title: snapshot.title,
        content: snapshot.content,
        message:
          c.message ??
          `Restore the version of ${restored.createdAt.toISOString().slice(0, 10)} (${short(restored.id)})`,
        contributorIds: [],
      });
      await moveHead(tx, organizationId, branch.id, commit.id);
      const epoch = await reseedLineDraft(
        tx,
        organizationId,
        branch.id,
        commit.id,
      );
      await record(c.pageId, "page_restored", {
        branchId: branch.id,
        commitId: commit.id,
        restoredCommitId: restored.id,
        discardedDraftChanges: Boolean(
          c.discardDraftChanges && openDraft(draft) && draftHasChanges(draft!),
        ),
      });
      await invalidateStaleReviews(tx, ctx, c.pageId);
      await project(c.pageId, { commits: [commit.id] });
      return {
        commitId: commit.id,
        ...(epoch ? { draftId: epoch.id, epoch: String(epoch.epoch) } : {}),
      };
    }

    case "createPageBranch": {
      const row = await readablePage(tx, actor, c.pageId);
      requireActive(row);
      requireEditor(row);
      const problem = branchNameProblem(c.name);
      if (problem) fail(`Branch name: ${problem}`);
      await requireNewId(tx, "branch", c.branchId);
      const branches = await tx
        .select()
        .from(s.pageBranch)
        .where(
          and(
            eq(s.pageBranch.organizationId, organizationId),
            eq(s.pageBranch.pageId, c.pageId),
            isNull(s.pageBranch.deletedAt),
          ),
        );
      if (branches.some((b) => b.name.toLowerCase() === c.name.toLowerCase()))
        fail("That branch name is already in use on this page.", "conflict");
      const main = branches.find((b) => b.isMain)!;
      const from = c.fromCommitId
        ? (await commitMeta(tx, organizationId, c.pageId, c.fromCommitId)).id
        : main.headCommitId;
      await tx.insert(s.pageBranch).values({
        id: c.branchId,
        organizationId,
        pageId: c.pageId,
        name: c.name,
        isMain: false,
        headCommitId: from,
        baseCommitId: from,
        authorId: userId,
      });
      const origin = await recordBranchOrigin(
        tx,
        organizationId,
        c.pageId,
        c.branchId,
        c.origin,
      );
      const draft = await openLineDraft(
        tx,
        organizationId,
        c.pageId,
        c.branchId,
        from,
      );
      await record(c.pageId, "branch_created", {
        branchId: c.branchId,
        name: c.name,
        fromCommitId: from,
        ...(origin ? { origin } : {}),
      });
      await project(c.pageId);
      return { branchId: c.branchId, draftId: draft.id };
    }

    case "setPageBranchCollaborator": {
      const { branch, row } = await readableBranch(tx, actor, c.branchId);
      if (branch.deletedAt) fail(`${branch.name} was deleted.`, "conflict");
      requireActive(row);
      if (branch.isMain)
        fail(
          "Main has no collaborators: everyone who edits the space edits it.",
        );
      if (branch.authorId !== userId)
        fail(
          "Only the branch author can invite or remove collaborators.",
          "forbidden",
        );
      if (c.userId === branch.authorId)
        fail("The branch author always edits the branch.");
      if (c.collaborator) {
        const target = await pageAccess(
          tx,
          { organizationId, userId: c.userId },
          branch.pageId,
        );
        if (!spaceLevelAtLeast(target?.level ?? null, "edit"))
          fail(
            `That person cannot edit ${row.space.name}. Ask an administrator to give them edit access first.`,
            "forbidden",
          );
        const inserted = await tx
          .insert(s.pageBranchCollaborator)
          .values({ organizationId, branchId: branch.id, userId: c.userId })
          .onConflictDoNothing()
          .returning({ userId: s.pageBranchCollaborator.userId });
        if (!inserted.length) return undefined;
      } else {
        const removed = await tx
          .delete(s.pageBranchCollaborator)
          .where(
            and(
              eq(s.pageBranchCollaborator.organizationId, organizationId),
              eq(s.pageBranchCollaborator.branchId, branch.id),
              eq(s.pageBranchCollaborator.userId, c.userId),
            ),
          )
          .returning({ userId: s.pageBranchCollaborator.userId });
        if (!removed.length) return undefined;
        // Their open editors become read-only once the service rechecks.
        await signalSpaceAccess(tx, organizationId, [c.userId]);
      }
      await record(branch.pageId, "branch_collaborator_changed", {
        branchId: branch.id,
        userId: c.userId,
        collaborator: c.collaborator,
      });
      await project(branch.pageId);
      return undefined;
    }

    case "deletePageBranch": {
      const { branch, row } = await readableBranch(tx, actor, c.branchId);
      if (branch.deletedAt) return undefined;
      requireActive(row);
      if (branch.isMain) fail("Main cannot be deleted.");
      if (branch.authorId !== userId) requireEditor(row);
      const active = await tx
        .select({ id: s.pagePullRequest.id })
        .from(s.pagePullRequest)
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            eq(s.pagePullRequest.pageId, branch.pageId),
            isNull(s.pagePullRequest.deletedAt),
            ne(s.pagePullRequest.status, "merged"),
            sql`(${s.pagePullRequest.sourceBranchId} = ${branch.id} OR ${s.pagePullRequest.targetBranchId} = ${branch.id})`,
          ),
        );
      if (active.length)
        fail(
          `${branch.name} has an unmerged pull request. Merge or delete it before deleting the branch.`,
          "conflict",
        );
      // Its discussions go with it, open or resolved, blocking or not.
      const state = await lineState(tx, organizationId, branch.pageId);
      const removed = discussionsOfDeletedBranch(state.threads, branch.id);
      requireConfirmedRemoval(c.discussionsToRemove, discussionCounts(removed));
      await tx
        .update(s.pageBranch)
        .set({ deletedAt: new Date(), deletedById: userId })
        .where(
          and(
            eq(s.pageBranch.organizationId, organizationId),
            eq(s.pageBranch.id, branch.id),
          ),
        );
      // Its editors are disconnected; stored edits stay with the fenced
      // draft (and in exports), and its commits stay in the page's history.
      await fenceDraft(tx, organizationId, branch.id);
      await record(branch.pageId, "branch_deleted", {
        branchId: branch.id,
        name: branch.name,
        headCommitId: branch.headCommitId,
      });
      const gone = await removePageThreads(
        tx,
        organizationId,
        branch.pageId,
        removed,
      );
      if (gone)
        await record(branch.pageId, "discussions_removed", {
          ...gone,
          reason: "branch_deleted",
          branchId: branch.id,
          name: branch.name,
        });
      await project(branch.pageId);
      return undefined;
    }

    case "syncPageBranch": {
      const { branch, row } = await readableBranch(tx, actor, c.branchId);
      if (branch.deletedAt) fail(`${branch.name} was deleted.`, "conflict");
      if (branch.isMain)
        fail(
          "Main changes through pull requests. Sync main into a branch instead.",
        );
      await requireLineWriter(tx, actor, row, branch);
      const state = await lineState(tx, organizationId, branch.pageId);
      const from = c.fromBranchId
        ? state.branches.find((b) => b.id === c.fromBranchId)
        : state.branches.find((b) => b.isMain);
      if (!from) throw unavailableBranch();
      if (from.id === branch.id)
        fail("Choose another line to bring changes from.");
      requireHead(branch, c.expectedHead);
      requireHead(from, c.expectedTargetHead);
      requireNoUncommitted(
        await draftOf(tx, organizationId, branch.id),
        branch,
        "sync",
      );
      if (reachable(state.commits, branch.headCommitId).has(from.headCommitId))
        return { alreadyUpToDate: "true" };
      const outcome = await mergeLines(
        tx,
        organizationId,
        state.commits,
        branch,
        from,
      );
      const resolved = outcome.merge.conflicts.length
        ? c.resolutions
          ? resolve(outcome.merge, c.resolutions)
          : conflictRefusal(
              outcome.merge.conflicts.length,
              branch.name,
              from.name,
            )
        : {
            title: outcome.merge.title,
            content: outcome.merge.content.document,
          };
      const commit = await insertCommit(tx, ctx, {
        pageId: branch.pageId,
        parentIds: [branch.headCommitId, from.headCommitId],
        title: resolved.title,
        content: resolved.content,
        message: `Merge ${from.name} into ${branch.name}`,
        contributorIds: [],
      });
      await moveHead(tx, organizationId, branch.id, commit.id);
      const epoch = await reseedLineDraft(
        tx,
        organizationId,
        branch.id,
        commit.id,
      );
      await record(branch.pageId, "branch_synced", {
        branchId: branch.id,
        fromBranchId: from.id,
        commitId: commit.id,
        resolvedConflicts: outcome.merge.conflicts.length,
      });
      await invalidateStaleReviews(tx, ctx, branch.pageId);
      await project(branch.pageId, { commits: [commit.id] });
      return {
        commitId: commit.id,
        ...(epoch ? { draftId: epoch.id, epoch: String(epoch.epoch) } : {}),
      };
    }

    case "createPagePullRequest": {
      const row = await readablePage(tx, actor, c.pageId);
      const source = await liveBranch(
        tx,
        organizationId,
        c.pageId,
        c.sourceBranchId,
      );
      if (source.isMain)
        fail("Open a pull request from a branch, not from main.");
      await requireLineWriter(tx, actor, row, source);
      await requireNewId(tx, "pullRequest", c.pullRequestId);
      const target = c.targetBranchId
        ? await liveBranch(tx, organizationId, c.pageId, c.targetBranchId)
        : (
            await tx
              .select()
              .from(s.pageBranch)
              .where(
                and(
                  eq(s.pageBranch.organizationId, organizationId),
                  eq(s.pageBranch.pageId, c.pageId),
                  eq(s.pageBranch.isMain, true),
                ),
              )
          )[0]!;
      if (target.id === source.id)
        fail("A pull request must target another line.");
      if (source.headCommitId === target.headCommitId)
        fail("Commit changes to the branch before opening a pull request.");
      const [existing] = await tx
        .select({ id: s.pagePullRequest.id })
        .from(s.pagePullRequest)
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            eq(s.pagePullRequest.sourceBranchId, source.id),
            eq(s.pagePullRequest.targetBranchId, target.id),
            isNull(s.pagePullRequest.deletedAt),
            ne(s.pagePullRequest.status, "merged"),
          ),
        );
      if (existing)
        fail("A pull request between these lines is already open.", "conflict");
      await tx.insert(s.pagePullRequest).values({
        id: c.pullRequestId,
        organizationId,
        pageId: c.pageId,
        sourceBranchId: source.id,
        targetBranchId: target.id,
        title: c.title,
        description: c.description?.trim() ? c.description.trim() : null,
        status: c.draft ? "draft" : "open",
        authorId: userId,
      });
      await record(c.pageId, "pull_request_created", {
        pullRequestId: c.pullRequestId,
        sourceBranchId: source.id,
        targetBranchId: target.id,
        draft: Boolean(c.draft),
      });
      await project(c.pageId);
      return { pullRequestId: c.pullRequestId };
    }

    case "updatePagePullRequest": {
      const { pr, row } = await readablePullRequest(tx, actor, c.pullRequestId);
      requireActive(row);
      await requirePullRequestManager(tx, actor, pr);
      if (pr.status === "merged")
        fail("This pull request is merged.", "conflict");
      const status =
        c.draft === undefined ? pr.status : c.draft ? "draft" : "open";
      await tx
        .update(s.pagePullRequest)
        .set({
          ...(c.title !== undefined ? { title: c.title } : {}),
          ...(c.description !== undefined
            ? {
                description: c.description?.trim()
                  ? c.description.trim()
                  : null,
              }
            : {}),
          status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            eq(s.pagePullRequest.id, pr.id),
          ),
        );
      if (status !== pr.status)
        await record(pr.pageId, "pull_request_draft_changed", {
          pullRequestId: pr.id,
          draft: status === "draft",
        });
      await project(pr.pageId);
      return undefined;
    }

    case "deletePagePullRequest": {
      const { pr, row } = await readablePullRequest(tx, actor, c.pullRequestId);
      requireActive(row);
      if (pr.status === "merged")
        fail(
          "A merged pull request is history and cannot be deleted.",
          "conflict",
        );
      if (pr.authorId !== userId) requireEditor(row);
      const now = new Date();
      await tx
        .update(s.pagePullRequest)
        .set({ deletedAt: now, deletedById: userId, updatedAt: now })
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            eq(s.pagePullRequest.id, pr.id),
          ),
        );
      // As for specification pull requests: open discussions on it would
      // otherwise stay open (and blocking) with nothing left to resolve
      // them on. Each resolution is recorded.
      const resolved = await tx
        .update(s.pageThread)
        .set({
          status: "resolved",
          resolvedById: userId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.pageThread.organizationId, organizationId),
            eq(s.pageThread.pullRequestId, pr.id),
            eq(s.pageThread.status, "open"),
          ),
        )
        .returning({ id: s.pageThread.id });
      for (const thread of resolved)
        await record(pr.pageId, "thread_resolved", {
          threadId: thread.id,
          reason: "pull_request_deleted",
          pullRequestId: pr.id,
        });
      await record(pr.pageId, "pull_request_deleted", { pullRequestId: pr.id });
      await project(pr.pageId, { discussions: resolved.length > 0 });
      return undefined;
    }

    case "requestPageReview": {
      const { pr, row } = await readablePullRequest(tx, actor, c.pullRequestId);
      requireActive(row);
      if (pr.status === "merged")
        fail("This pull request is merged.", "conflict");
      if (pr.authorId !== userId) {
        const editor = spaceLevelAtLeast(row.level, "edit");
        if (!editor) await requirePullRequestManager(tx, actor, pr);
      }
      if (
        !(await canReviewPageChange(
          tx,
          { organizationId, userId: c.userId },
          pr.pageId,
        ))
      )
        fail(
          `That person cannot comment on ${row.space.name}, so they cannot review it. Give them comment or edit access first.`,
          "forbidden",
        );
      const state = await lineState(tx, organizationId, pr.pageId);
      const source = state.branches.find((b) => b.id === pr.sourceBranchId);
      const target = state.branches.find((b) => b.id === pr.targetBranchId);
      if (
        source &&
        target &&
        resultContributors(
          state.commits,
          source.headCommitId,
          target.headCommitId,
        ).includes(c.userId)
      )
        fail(
          "That person contributed to this change and cannot approve it. Ask someone else to review.",
        );
      const [existing] = state.reviewers.filter(
        (r) => r.pullRequestId === pr.id && r.userId === c.userId,
      );
      if (existing?.required === c.required)
        fail("This review is already requested.", "conflict");
      if (existing)
        await tx
          .update(s.pagePullRequestReviewer)
          .set({ required: c.required, requestedById: userId })
          .where(
            and(
              eq(s.pagePullRequestReviewer.organizationId, organizationId),
              eq(s.pagePullRequestReviewer.pullRequestId, pr.id),
              eq(s.pagePullRequestReviewer.userId, c.userId),
            ),
          );
      else {
        await tx.insert(s.pagePullRequestReviewer).values({
          organizationId,
          pullRequestId: pr.id,
          userId: c.userId,
          required: c.required,
          requestedById: userId,
        });
        await notifyPageReviewRequested(tx, {
          organizationId,
          pageId: pr.pageId,
          actorId: userId,
          reviewerIds: [c.userId],
          pullRequestId: pr.id,
          pullRequestTitle: pr.title,
        });
      }
      await record(pr.pageId, "review_requested", {
        pullRequestId: pr.id,
        userId: c.userId,
        required: c.required,
      });
      await project(pr.pageId);
      return undefined;
    }

    case "cancelPageReview": {
      const { pr, row } = await readablePullRequest(tx, actor, c.pullRequestId);
      requireActive(row);
      if (pr.status === "merged")
        fail("This pull request is merged.", "conflict");
      // Reviewers may decline; otherwise the people who manage the request.
      if (c.userId !== userId && pr.authorId !== userId) {
        if (!spaceLevelAtLeast(row.level, "edit"))
          await requirePullRequestManager(tx, actor, pr);
      }
      const removed = await tx
        .delete(s.pagePullRequestReviewer)
        .where(
          and(
            eq(s.pagePullRequestReviewer.organizationId, organizationId),
            eq(s.pagePullRequestReviewer.pullRequestId, pr.id),
            eq(s.pagePullRequestReviewer.userId, c.userId),
          ),
        )
        .returning({ userId: s.pagePullRequestReviewer.userId });
      if (!removed.length) return undefined;
      await record(pr.pageId, "review_cancelled", {
        pullRequestId: pr.id,
        userId: c.userId,
      });
      await project(pr.pageId);
      return undefined;
    }

    case "decidePagePullRequest": {
      const { pr, row } = await readablePullRequest(tx, actor, c.pullRequestId);
      requireActive(row);
      if (pr.status === "merged")
        fail("This pull request is merged.", "conflict");
      if (pr.status === "draft")
        fail(
          "This pull request is a draft. Mark it ready for review first.",
          "conflict",
        );
      if (!(await canReviewPageChange(tx, actor, pr.pageId)))
        fail(
          `You can view ${row.space.name} but not review its changes. Reviewers need comment or edit access.`,
          "forbidden",
        );
      const state = await lineState(tx, organizationId, pr.pageId);
      const evaluation = await evaluate(tx, organizationId, state, pr);
      requireInspectedHeads(
        evaluation,
        c.inspectedSourceHead,
        c.inspectedTargetHead,
      );
      const mine = state.reviews.filter(
        (r) =>
          r.pullRequestId === pr.id &&
          r.reviewerId === userId &&
          currentReview(r),
      );
      const now = new Date();
      if (c.decision === "revoke") {
        if (!mine.length)
          fail("You have no current decision on this pull request.");
      } else {
        if (
          c.decision === "approve" &&
          !(await canReviewPageChange(
            tx,
            actor,
            pr.pageId,
            evaluation.contributorIds,
          ))
        )
          fail(
            "You contributed to this change, so you cannot approve it. Ask someone else to review.",
            "forbidden",
          );
        if (evaluation.merge?.conflicts.length)
          conflictRefusal(
            evaluation.merge.conflicts.length,
            evaluation.source.name,
            evaluation.target.name,
          );
        if (!evaluation.resultHash)
          fail(
            "These lines have no single common version. Sync the target into the source branch first.",
            "conflict",
          );
      }
      if (mine.length)
        await tx
          .update(s.pagePullRequestReview)
          .set({ withdrawnAt: now })
          .where(
            and(
              eq(s.pagePullRequestReview.organizationId, organizationId),
              inArray(
                s.pagePullRequestReview.id,
                mine.map((r) => r.id),
              ),
            ),
          );
      if (c.decision !== "revoke")
        await tx.insert(s.pagePullRequestReview).values({
          organizationId,
          pullRequestId: pr.id,
          reviewerId: userId,
          decision: c.decision === "approve" ? "approved" : "changes_requested",
          resultHash: evaluation.resultHash!,
          sourceHeadId: evaluation.source.headCommitId,
          targetHeadId: evaluation.target.headCommitId,
        });
      await record(pr.pageId, "review_decided", {
        pullRequestId: pr.id,
        decision: c.decision,
        resultHash: evaluation.resultHash,
        sourceHeadId: evaluation.source.headCommitId,
        targetHeadId: evaluation.target.headCommitId,
      });
      await project(pr.pageId);
      return undefined;
    }

    case "mergePagePullRequest": {
      const { pr, row } = await readablePullRequest(tx, actor, c.pullRequestId);
      requireActive(row);
      if (pr.status === "merged")
        fail("This pull request is already merged.", "conflict");
      if (pr.status === "draft")
        fail(
          "This pull request is a draft. Mark it ready for review first.",
          "conflict",
        );
      const state = await lineState(tx, organizationId, pr.pageId);
      const evaluation = await evaluate(tx, organizationId, state, pr);
      requireInspectedHeads(
        evaluation,
        c.inspectedSourceHead,
        c.inspectedTargetHead,
      );
      const { source, target } = evaluation;
      if (target.isMain) requireEditor(row);
      else if (!(await canEditDraft(tx, actor, target.id)))
        fail(
          `Only the author of ${target.name} and its collaborators can merge into it.`,
          "forbidden",
        );
      requireNoUncommitted(evaluation.sourceDraft, source, "merge");
      requireNoUncommitted(evaluation.targetDraft, target, "merge");
      if (!evaluation.base)
        fail(
          "These lines have no single common version. Sync the target into the source branch first.",
          "conflict",
        );
      if (evaluation.merge!.conflicts.length)
        conflictRefusal(
          evaluation.merge!.conflicts.length,
          source.name,
          target.name,
        );
      if (evaluation.noChanges)
        fail("The pull request has no remaining changes to merge.");
      // Open blockers on a line that still exists hold the merge, including
      // the source's: merging removes them, so they are resolved first.
      const blocking = evaluation.blockingThreads;
      if (blocking)
        fail(
          `${blocking === 1 ? "A blocking discussion is" : `${blocking} blocking discussions are`} still open${target.isMain ? " on this page" : ` on this pull request or ${source.name}`}. Resolve them before merging.`,
          "conflict",
          "blocking_threads",
        );
      if (evaluation.changesRequested.length)
        fail(
          "A reviewer requested changes to this result. Address them and ask for a new review.",
          "conflict",
          "changes_requested",
        );
      // Approvals count only from people who can still review the page.
      const approvals: typeof evaluation.approvals = [];
      for (const review of evaluation.approvals)
        if (
          await canReviewPageChange(
            tx,
            { organizationId, userId: review.reviewerId },
            pr.pageId,
            evaluation.contributorIds,
          )
        )
          approvals.push(review);
      if (
        row.space.publishing === "reviewed" &&
        target.isMain &&
        !evaluation.required.length
      )
        fail(
          `${row.space.name} requires reviews: request at least one required review before merging into main.`,
          "conflict",
          "review_required",
        );
      const pending = evaluation.required.filter(
        (r) => !approvals.some((a) => a.reviewerId === r.userId),
      );
      if (pending.length)
        fail(
          `${pending.length === 1 ? "A required reviewer has" : `${pending.length} required reviewers have`} not approved the current result. Every required review must approve exactly what will be merged.`,
          "conflict",
          "review_pending",
        );
      const { removedOnMerge } = evaluation;
      requireConfirmedRemoval(
        c.discussionsToRemove,
        removedOnMerge.discussions,
      );
      if (
        c.deletesSourceBranch !== undefined &&
        c.deletesSourceBranch !== removedOnMerge.sourceRetired
      )
        fail(
          `Merging now ${removedOnMerge.sourceRetired ? "deletes" : "keeps"} branch ${source.name}, unlike what you confirmed. Review the warning and confirm again.`,
          "conflict",
          "source_branch_changed",
        );
      const commit = await insertCommit(tx, ctx, {
        pageId: pr.pageId,
        parentIds: [target.headCommitId, source.headCommitId],
        title: evaluation.merge!.title,
        content: evaluation.merge!.content.document,
        message: `Merge pull request: ${pr.title}`,
        contributorIds: evaluation.contributorIds,
        pullRequestId: pr.id,
        approverIds: approvals.map((a) => a.reviewerId),
      });
      await moveHead(tx, organizationId, target.id, commit.id);
      const now = new Date();
      await tx
        .update(s.pagePullRequest)
        .set({
          status: "merged",
          mergedAt: now,
          mergedById: userId,
          mergeCommitId: commit.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            eq(s.pagePullRequest.id, pr.id),
          ),
        );
      // The target's draft no longer matches its head: a new epoch.
      await reseedLineDraft(tx, organizationId, target.id, commit.id);
      await record(pr.pageId, "pull_request_merged", {
        pullRequestId: pr.id,
        sourceBranchId: source.id,
        targetBranchId: target.id,
        commitId: commit.id,
        approverIds: approvals.map((a) => a.reviewerId),
      });
      // Like specification branches: merging into main retires the source
      // branch unless another unmerged pull request still uses it.
      if (removedOnMerge.sourceRetired) {
        await tx
          .update(s.pageBranch)
          .set({ deletedAt: now, deletedById: userId })
          .where(
            and(
              eq(s.pageBranch.organizationId, organizationId),
              eq(s.pageBranch.id, source.id),
            ),
          );
        await fenceDraft(tx, organizationId, source.id);
        await record(pr.pageId, "branch_deleted", {
          branchId: source.id,
          name: source.name,
          headCommitId: source.headCommitId,
          automatic: true,
          reason: "pull_request_merged",
          pullRequestId: pr.id,
        });
      }
      // The source's discussions and the pull request's own end with the
      // merge (all of the source's when it retires).
      const gone = await removePageThreads(
        tx,
        organizationId,
        pr.pageId,
        state.threads.filter((t) => removedOnMerge.threadIds.includes(t.id)),
      );
      if (gone)
        await record(pr.pageId, "discussions_removed", {
          ...gone,
          reason: "pull_request_merged",
          pullRequestId: pr.id,
          branchId: source.id,
          name: source.name,
          sourceRetired: removedOnMerge.sourceRetired,
        });
      await invalidateStaleReviews(tx, ctx, pr.pageId);
      await project(pr.pageId, { commits: [commit.id] });
      return {
        commitId: commit.id,
        ...(target.isMain ? { published: "true" } : {}),
      };
    }

    case "proposePageChange": {
      const row = await readablePage(tx, actor, c.pageId);
      requireActive(row);
      requireEditor(row);
      await requireNewId(tx, "branch", c.branchId);
      await requireNewId(tx, "pullRequest", c.pullRequestId);
      const content = validDocument(
        () =>
          c.markdown !== undefined
            ? markdownToDocument(c.markdown)
            : canonicalizeDocument(c.content),
        "The proposed page is invalid",
      );
      const [main] = await tx
        .select()
        .from(s.pageBranch)
        .where(
          and(
            eq(s.pageBranch.organizationId, organizationId),
            eq(s.pageBranch.pageId, c.pageId),
            eq(s.pageBranch.isMain, true),
          ),
        );
      const head = await commitMeta(
        tx,
        organizationId,
        c.pageId,
        main!.headCommitId,
      );
      if (documentHash(c.title, content) === head.hash)
        fail(
          "Nothing to propose: the title and content equal the published page.",
        );
      const name = c.branchName ?? `proposal-${short(c.branchId)}`;
      const problem = branchNameProblem(name);
      if (problem) fail(`Branch name: ${problem}`);
      const [taken] = await tx
        .select({ id: s.pageBranch.id })
        .from(s.pageBranch)
        .where(
          and(
            eq(s.pageBranch.organizationId, organizationId),
            eq(s.pageBranch.pageId, c.pageId),
            isNull(s.pageBranch.deletedAt),
            sql`lower(${s.pageBranch.name}) = ${name.toLowerCase()}`,
          ),
        );
      if (taken)
        fail("That branch name is already in use on this page.", "conflict");
      await tx.insert(s.pageBranch).values({
        id: c.branchId,
        organizationId,
        pageId: c.pageId,
        name,
        isMain: false,
        headCommitId: head.id,
        baseCommitId: head.id,
        authorId: userId,
      });
      const origin = await recordBranchOrigin(
        tx,
        organizationId,
        c.pageId,
        c.branchId,
        c.origin,
      );
      const commit = await insertCommit(tx, ctx, {
        pageId: c.pageId,
        parentIds: [head.id],
        title: c.title,
        content,
        message: c.message,
        contributorIds: [],
      });
      await moveHead(tx, organizationId, c.branchId, commit.id);
      // People continue the proposal in the branch's live draft.
      const draft = await openLineDraft(
        tx,
        organizationId,
        c.pageId,
        c.branchId,
        commit.id,
      );
      await tx.insert(s.pagePullRequest).values({
        id: c.pullRequestId,
        organizationId,
        pageId: c.pageId,
        sourceBranchId: c.branchId,
        targetBranchId: main!.id,
        title: c.message.split("\n")[0]!.slice(0, 200),
        description: c.description?.trim() ? c.description.trim() : null,
        status: "open",
        authorId: userId,
      });
      await record(c.pageId, "page_change_proposed", {
        branchId: c.branchId,
        commitId: commit.id,
        pullRequestId: c.pullRequestId,
        ...(origin ? { origin } : {}),
      });
      await project(c.pageId, { commits: [commit.id] });
      return {
        branchId: c.branchId,
        commitId: commit.id,
        pullRequestId: c.pullRequestId,
        draftId: draft.id,
      };
    }
  }
}

// Merge of two lines with their content (ours: `line`, theirs: `from`).
async function mergeLines(
  tx: Tx,
  organizationId: string,
  commits: CommitMeta[],
  line: BranchRow,
  from: BranchRow,
) {
  const base = mergeBase(commits, line.headCommitId, from.headCommitId);
  if (!base)
    fail(
      "These lines have more than one or no common version. Restore the version you want on the branch and open a pull request from it.",
      "conflict",
    );
  const snapshots = await commitSnapshots(tx, organizationId, [
    base!.id,
    line.headCommitId,
    from.headCommitId,
  ]);
  const get = (id: string): PageSnapshot => snapshots.get(id)!;
  return {
    base: base!,
    merge: mergePages(
      get(base!.id),
      get(line.headCommitId),
      get(from.headCommitId),
    ),
  };
}
