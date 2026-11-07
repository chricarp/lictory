import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  knowledgeEntityTypes,
  spaceEntityKey,
  spaceEntitySchema,
  type SpaceEntity,
  type SpaceEntityOf,
  type StoredPageThreadAnchor,
} from "@lictory/core/contracts/protocol";
import { canonicalJson } from "@lictory/core/domain/projections";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import {
  discussionCounts,
  discussionsOfDeletedBranch,
} from "@lictory/core/spaces/discussion-lifecycle";
import {
  refreshSpaceAccess,
  spaceAccessDrift,
} from "@lictory/core/spaces/access";
import {
  commitSnapshots,
  draftSummary,
  evaluatePullRequest,
  pageLineStates,
  pullRequestCommitIds,
} from "@lictory/core/spaces/history-state";

// Spaces read projections (`space_entity`), replicated to browsers by Zero
// and kept apart from `sync_entity`. Writers call `writeSpaceProjections` in
// the same transaction as their domain writes, under the organization lock,
// naming what they touched; it recomputes those rows from the domain tables
// and writes only what differs. `rebuildSpaceProjections` reconciles the
// whole organization (operator recovery and the test invariant).
//
// Scopes: rows with a NULL `page_id` are space-level (`space`, `spaceGrant`,
// `page` summaries); `pageCommit` rows (immutable history), the page's
// lines (`pageBranch`, `pagePullRequest`, `pagePullRequestReview`) and
// `pageThread`, `pageThreadMessage` and `pageActivity` rows (discussions)
// carry their page. Knowledge links (`knowledgeEntityTypes`,
// docs/internals/knowledge-links.md) carry their page too, and the work item
// or project they concern in `work_item_id` / `project_id`.

export type SpaceProjectionRow = {
  key: string;
  organizationId: string;
  spaceId: string;
  pageId: string | null;
  workItemId: string | null;
  projectId: string | null;
  type: SpaceEntity["type"];
  data: Record<string, unknown>;
};

const knowledgeTypes = new Set<string>(knowledgeEntityTypes);

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);

function row(entity: SpaceEntity, pageId: string | null): SpaceProjectionRow {
  const parsed = spaceEntitySchema.parse(entity);
  return {
    key: spaceEntityKey(parsed),
    organizationId: parsed.organizationId,
    spaceId: parsed.type === "space" ? parsed.id : parsed.spaceId,
    pageId,
    workItemId:
      knowledgeTypes.has(parsed.type) && "workItemId" in parsed
        ? parsed.workItemId
        : null,
    projectId: parsed.type === "pageContextLink" ? parsed.projectId : null,
    type: parsed.type,
    data: parsed,
  };
}

// Space summaries and named grants of the given spaces (all when omitted).
async function spaceRows(
  db: Database | Tx,
  organizationId: string,
  spaceIds?: string[],
) {
  const [spaces, grants] = await Promise.all([
    db
      .select()
      .from(s.space)
      .where(
        and(
          eq(s.space.organizationId, organizationId),
          spaceIds ? inArray(s.space.id, spaceIds) : undefined,
        ),
      ),
    db
      .select()
      .from(s.spaceGrant)
      .where(
        and(
          eq(s.spaceGrant.organizationId, organizationId),
          spaceIds ? inArray(s.spaceGrant.spaceId, spaceIds) : undefined,
        ),
      ),
  ]);
  return [
    ...spaces.map((x) =>
      row(
        {
          id: x.id,
          organizationId,
          type: "space",
          name: x.name,
          slug: x.slug,
          description: x.description,
          icon: x.icon,
          projectId: x.projectId,
          teamId: x.teamId,
          accessMode: x.accessMode,
          publishing: x.publishing,
          createdById: x.createdById,
          createdAt: iso(x.createdAt),
          updatedAt: iso(x.updatedAt),
          archivedAt: isoOrNull(x.archivedAt),
        },
        null,
      ),
    ),
    ...grants.map((g) =>
      row(
        {
          id: `${g.spaceId}:${g.userId}`,
          organizationId,
          spaceId: g.spaceId,
          type: "spaceGrant",
          userId: g.userId,
          level: g.level,
          grantedById: g.grantedById,
          createdAt: iso(g.createdAt),
          updatedAt: iso(g.updatedAt),
        },
        null,
      ),
    ),
  ];
}

// Page tree summaries: each page with the title and commit main publishes.
export async function pageSummaries(
  db: Database | Tx,
  organizationId: string,
  filter: { pageIds?: string[]; spaceIds?: string[] } = {},
) {
  const rows = await db
    .select({
      page: s.page,
      publishing: s.space.publishing,
      commitId: s.pageCommit.id,
      title: s.pageCommit.title,
      publishedAt: s.pageCommit.createdAt,
      publishedById: s.pageCommit.authorId,
      publishedMessage: s.pageCommit.message,
      approverIds: s.pageCommit.approverIds,
      draft: s.spaceDraft,
    })
    .from(s.page)
    .innerJoin(
      s.space,
      and(
        eq(s.space.organizationId, s.page.organizationId),
        eq(s.space.id, s.page.spaceId),
      ),
    )
    .innerJoin(
      s.pageBranch,
      and(
        eq(s.pageBranch.organizationId, s.page.organizationId),
        eq(s.pageBranch.pageId, s.page.id),
        eq(s.pageBranch.isMain, true),
      ),
    )
    .innerJoin(
      s.pageCommit,
      and(
        eq(s.pageCommit.organizationId, s.pageBranch.organizationId),
        eq(s.pageCommit.pageId, s.pageBranch.pageId),
        eq(s.pageCommit.id, s.pageBranch.headCommitId),
      ),
    )
    .leftJoin(
      s.spaceDraft,
      and(
        eq(s.spaceDraft.organizationId, s.pageBranch.organizationId),
        eq(s.spaceDraft.branchId, s.pageBranch.id),
      ),
    )
    .where(
      and(
        eq(s.page.organizationId, organizationId),
        filter.pageIds ? inArray(s.page.id, filter.pageIds) : undefined,
        filter.spaceIds ? inArray(s.page.spaceId, filter.spaceIds) : undefined,
      ),
    );
  const counts = rows.length
    ? await db
        .select({
          pageId: s.pageThread.pageId,
          blocking: s.pageThread.blocking,
          threads: count(),
        })
        .from(s.pageThread)
        .innerJoin(
          s.page,
          and(
            eq(s.page.organizationId, s.pageThread.organizationId),
            eq(s.page.id, s.pageThread.pageId),
          ),
        )
        .where(
          and(
            eq(s.pageThread.organizationId, organizationId),
            eq(s.pageThread.status, "open"),
            filter.pageIds
              ? inArray(s.pageThread.pageId, filter.pageIds)
              : undefined,
            filter.spaceIds
              ? inArray(s.page.spaceId, filter.spaceIds)
              : undefined,
          ),
        )
        .groupBy(s.pageThread.pageId, s.pageThread.blocking)
    : [];
  const open = new Map<
    string,
    { openThreads: number; blockingThreads: number }
  >();
  for (const c of counts) {
    const entry = open.get(c.pageId) ?? { openThreads: 0, blockingThreads: 0 };
    entry.openThreads += c.threads;
    if (c.blocking) entry.blockingThreads += c.threads;
    open.set(c.pageId, entry);
  }
  return rows.map(
    ({
      page,
      publishing,
      commitId,
      title,
      publishedAt,
      publishedById,
      publishedMessage,
      approverIds,
      draft,
    }) =>
      row(
        {
          id: page.id,
          organizationId,
          spaceId: page.spaceId,
          type: "page",
          parentId: page.parentId,
          rank: page.rank,
          title,
          publishedCommitId: commitId,
          // "Approved" only where reviews are the policy; Direct spaces say
          // "Published".
          approvedCommitId:
            publishing === "reviewed" && approverIds.length ? commitId : null,
          mainDraft:
            publishing === "direct" ? draftSummary(draft ?? undefined) : null,
          createdById: page.createdById,
          createdAt: iso(page.createdAt),
          updatedAt: iso(publishedAt),
          publishedById,
          publishedMessage,
          archivedAt: isoOrNull(page.archivedAt),
          openThreads: open.get(page.id)?.openThreads ?? 0,
          blockingThreads: open.get(page.id)?.blockingThreads ?? 0,
        },
        null,
      ),
  );
}

// Discussion row types, all carrying their page.
const discussionTypes = [
  "pageThread",
  "pageThreadMessage",
  "pageActivity",
] satisfies SpaceEntity["type"][];

// A page's discussions: threads, their messages and the discussion events.
async function pageDiscussionRows(
  db: Database | Tx,
  organizationId: string,
  pageIds?: string[],
) {
  const [pages, threads, messages, activity] = await Promise.all([
    db
      .select({ id: s.page.id, spaceId: s.page.spaceId })
      .from(s.page)
      .where(
        and(
          eq(s.page.organizationId, organizationId),
          pageIds ? inArray(s.page.id, pageIds) : undefined,
        ),
      ),
    db
      .select()
      .from(s.pageThread)
      .where(
        and(
          eq(s.pageThread.organizationId, organizationId),
          pageIds ? inArray(s.pageThread.pageId, pageIds) : undefined,
        ),
      ),
    db
      .select({ message: s.pageThreadMessage, pageId: s.pageThread.pageId })
      .from(s.pageThreadMessage)
      .innerJoin(
        s.pageThread,
        and(
          eq(s.pageThread.organizationId, s.pageThreadMessage.organizationId),
          eq(s.pageThread.id, s.pageThreadMessage.threadId),
        ),
      )
      .where(
        and(
          eq(s.pageThreadMessage.organizationId, organizationId),
          pageIds ? inArray(s.pageThread.pageId, pageIds) : undefined,
        ),
      ),
    db
      .select()
      .from(s.pageActivity)
      .where(
        and(
          eq(s.pageActivity.organizationId, organizationId),
          pageIds ? inArray(s.pageActivity.pageId, pageIds) : undefined,
        ),
      ),
  ]);
  const spaceOf = new Map(pages.map((p) => [p.id, p.spaceId]));
  const rows: SpaceProjectionRow[] = [];
  for (const t of threads) {
    const spaceId = spaceOf.get(t.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: t.id,
          organizationId,
          spaceId,
          type: "pageThread",
          pageId: t.pageId,
          authorId: t.authorId,
          status: t.status,
          blocking: t.blocking,
          anchor: t.anchor as StoredPageThreadAnchor,
          commitId: t.commitId,
          branchId: t.branchId,
          pullRequestId: t.pullRequestId,
          createdAt: iso(t.createdAt),
          updatedAt: iso(t.updatedAt),
          resolvedById: t.resolvedById,
          resolvedAt: isoOrNull(t.resolvedAt),
        },
        t.pageId,
      ),
    );
  }
  for (const { message: m, pageId } of messages) {
    const spaceId = spaceOf.get(pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: m.id,
          organizationId,
          spaceId,
          type: "pageThreadMessage",
          pageId,
          threadId: m.threadId,
          authorId: m.authorId,
          body: m.body,
          createdAt: iso(m.createdAt),
        },
        pageId,
      ),
    );
  }
  for (const a of activity) {
    const spaceId = spaceOf.get(a.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: a.id,
          organizationId,
          spaceId,
          type: "pageActivity",
          pageId: a.pageId,
          actorId: a.actorId,
          action: a.action,
          detail: a.detail,
          createdAt: iso(a.createdAt),
        },
        a.pageId,
      ),
    );
  }
  return rows;
}

// Commits (immutable) of the given pages or with the given ids.
async function commitRows(
  db: Database | Tx,
  organizationId: string,
  filter: { pageIds?: string[]; commitIds?: string[] },
) {
  const commits = await db
    .select({ commit: s.pageCommit, spaceId: s.page.spaceId })
    .from(s.pageCommit)
    .innerJoin(
      s.page,
      and(
        eq(s.page.organizationId, s.pageCommit.organizationId),
        eq(s.page.id, s.pageCommit.pageId),
      ),
    )
    .where(
      and(
        eq(s.pageCommit.organizationId, organizationId),
        filter.pageIds
          ? inArray(s.pageCommit.pageId, filter.pageIds)
          : undefined,
        filter.commitIds
          ? inArray(s.pageCommit.id, filter.commitIds)
          : undefined,
      ),
    );
  return commits.map(({ commit: c, spaceId }) =>
    row(
      {
        id: c.id,
        organizationId,
        spaceId,
        type: "pageCommit",
        pageId: c.pageId,
        parentIds: c.parentIds,
        title: c.title,
        content: c.content,
        markdown: c.markdown,
        hash: c.hash,
        schemaVersion: c.schemaVersion,
        message: c.message,
        authorId: c.authorId,
        contributorIds: c.contributorIds,
        pullRequestId: c.pullRequestId,
        approverIds: c.approverIds,
        createdAt: iso(c.createdAt),
      },
      c.pageId,
    ),
  );
}

// Row types of a page's lines: what moves when a head, a draft's committed
// state, a pull request or a review changes.
const lineTypes = [
  "pageBranch",
  "pagePullRequest",
  "pagePullRequestReview",
] satisfies SpaceEntity["type"][];

// A page's lines: live branches with their drafts, unmerged and merged pull
// requests (deleted ones are history in the database only) with their
// mergeability, and every review decision.
async function lineRows(
  db: Database | Tx,
  organizationId: string,
  pageIds?: string[],
) {
  const pages = await db
    .select({ id: s.page.id, spaceId: s.page.spaceId })
    .from(s.page)
    .where(
      and(
        eq(s.page.organizationId, organizationId),
        pageIds ? inArray(s.page.id, pageIds) : undefined,
      ),
    );
  if (!pages.length) return [];
  const ids = pages.map((p) => p.id);
  const [states, collaborators] = await Promise.all([
    pageLineStates(db, organizationId, ids),
    db
      .select({
        branchId: s.pageBranchCollaborator.branchId,
        userId: s.pageBranchCollaborator.userId,
      })
      .from(s.pageBranchCollaborator)
      .innerJoin(
        s.pageBranch,
        and(
          eq(
            s.pageBranch.organizationId,
            s.pageBranchCollaborator.organizationId,
          ),
          eq(s.pageBranch.id, s.pageBranchCollaborator.branchId),
        ),
      )
      .where(
        and(
          eq(s.pageBranchCollaborator.organizationId, organizationId),
          inArray(s.pageBranch.pageId, ids),
        ),
      )
      .orderBy(asc(s.pageBranchCollaborator.userId)),
  ]);
  const rows: SpaceProjectionRow[] = [];
  // Every open pull request's commits in one query: a rebuild or drift check
  // covers every page of the organization under its lock.
  const snapshots = await commitSnapshots(
    db,
    organizationId,
    pages.flatMap(({ id }) => {
      const state = states.get(id);
      return state
        ? pullRequestCommitIds(
            state,
            state.pullRequests.filter((p) => p.status !== "merged"),
          )
        : [];
    }),
  );
  for (const { id: pageId, spaceId } of pages) {
    const state = states.get(pageId);
    if (!state) continue;
    const base = { organizationId, spaceId, pageId };
    for (const b of state.branches)
      rows.push(
        row(
          {
            ...base,
            id: b.id,
            type: "pageBranch",
            name: b.name,
            isMain: b.isMain,
            headCommitId: b.headCommitId,
            baseCommitId: b.baseCommitId,
            authorId: b.authorId,
            collaboratorIds: collaborators
              .filter((x) => x.branchId === b.id)
              .map((x) => x.userId),
            draft: draftSummary(state.drafts.find((d) => d.branchId === b.id)),
            createdAt: iso(b.createdAt),
            ...(b.isMain
              ? {}
              : {
                  discussionsOnDelete: discussionCounts(
                    discussionsOfDeletedBranch(state.threads, b.id),
                  ),
                }),
          },
          pageId,
        ),
      );
    for (const p of state.pullRequests) {
      const evaluation = evaluatePullRequest(state, p, snapshots);
      rows.push(
        row(
          {
            ...base,
            id: p.id,
            type: "pagePullRequest",
            sourceBranchId: p.sourceBranchId,
            targetBranchId: p.targetBranchId,
            title: p.title,
            description: p.description,
            status: p.status,
            authorId: p.authorId,
            reviewers: state.reviewers
              .filter((r) => r.pullRequestId === p.id)
              .map((r) => ({
                userId: r.userId,
                required: r.required,
                requestedById: r.requestedById,
                createdAt: iso(r.createdAt),
              })),
            createdAt: iso(p.createdAt),
            updatedAt: iso(p.updatedAt),
            mergedAt: isoOrNull(p.mergedAt),
            mergedById: p.mergedById,
            mergeCommitId: p.mergeCommitId,
            mergeability: evaluation
              ? {
                  sourceHeadId: evaluation.source.headCommitId,
                  targetHeadId: evaluation.target.headCommitId,
                  baseCommitId: evaluation.base?.id ?? null,
                  resultHash: evaluation.resultHash,
                  conflicts: evaluation.merge?.conflicts.length ?? 0,
                  contributorIds: evaluation.contributorIds,
                  blockingThreads: evaluation.blockingThreads,
                  requiredReviews: evaluation.required.length,
                  requiredApprovals: evaluation.requiredApproved.length,
                  approvals: evaluation.approvals.length,
                  changesRequested: evaluation.changesRequested.length,
                  staleReviews: evaluation.staleReviews,
                  blockers: evaluation.blockers,
                  onMerge: {
                    sourceRetired: evaluation.removedOnMerge.sourceRetired,
                    discussions: evaluation.removedOnMerge.discussions,
                  },
                }
              : null,
          },
          pageId,
        ),
      );
    }
    for (const r of state.reviews)
      rows.push(
        row(
          {
            ...base,
            id: r.id,
            type: "pagePullRequestReview",
            pullRequestId: r.pullRequestId,
            reviewerId: r.reviewerId,
            decision: r.decision,
            resultHash: r.resultHash,
            sourceHeadId: r.sourceHeadId,
            targetHeadId: r.targetHeadId,
            staleAt: isoOrNull(r.staleAt),
            staleReason: r.staleReason,
            withdrawnAt: isoOrNull(r.withdrawnAt),
            createdAt: iso(r.createdAt),
          },
          pageId,
        ),
      );
  }
  return rows;
}

// Knowledge links of the given pages (all when omitted): references in the
// published version, specification citations, attachments, sources, branch
// origins and context links. Pages that are archived, or whose space is,
// have none: readers exclude them.
export async function knowledgeRows(
  db: Database | Tx,
  organizationId: string,
  pageIds?: string[],
) {
  if (pageIds && !pageIds.length) return [];
  const pages = await db
    .select({ id: s.page.id, spaceId: s.page.spaceId })
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
        pageIds ? inArray(s.page.id, pageIds) : undefined,
        isNull(s.page.archivedAt),
        isNull(s.space.archivedAt),
      ),
    );
  if (!pages.length) return [];
  const spaceOf = new Map(pages.map((p) => [p.id, p.spaceId]));
  const ids = pageIds ? pages.map((p) => p.id) : undefined;
  const [references, citations, attachments, sources, origins, links] =
    await Promise.all([
      db
        .select()
        .from(s.pageReference)
        .where(
          and(
            eq(s.pageReference.organizationId, organizationId),
            eq(s.pageReference.kind, "item"),
            ids ? inArray(s.pageReference.pageId, ids) : undefined,
          ),
        )
        .orderBy(asc(s.pageReference.pageId), asc(s.pageReference.position)),
      db
        .select({
          reference: s.specificationReference,
          number: s.specificationRevision.number,
        })
        .from(s.specificationReference)
        .innerJoin(
          s.specificationRevision,
          and(
            eq(
              s.specificationRevision.organizationId,
              s.specificationReference.organizationId,
            ),
            eq(
              s.specificationRevision.workItemId,
              s.specificationReference.workItemId,
            ),
            eq(s.specificationRevision.id, s.specificationReference.revisionId),
          ),
        )
        .where(
          and(
            eq(s.specificationReference.organizationId, organizationId),
            eq(s.specificationReference.kind, "page"),
            ids ? inArray(s.specificationReference.targetId, ids) : undefined,
          ),
        )
        .orderBy(
          asc(s.specificationReference.workItemId),
          asc(s.specificationRevision.number),
          asc(s.specificationReference.position),
        ),
      db
        .select()
        .from(s.workItemPageAttachment)
        .where(
          and(
            eq(s.workItemPageAttachment.organizationId, organizationId),
            isNull(s.workItemPageAttachment.detachedAt),
            ids ? inArray(s.workItemPageAttachment.pageId, ids) : undefined,
          ),
        ),
      db
        .select()
        .from(s.workItemPageSource)
        .where(
          and(
            eq(s.workItemPageSource.organizationId, organizationId),
            ids ? inArray(s.workItemPageSource.pageId, ids) : undefined,
          ),
        ),
      db
        .select({
          origin: s.pageBranchOrigin,
          branch: s.pageBranch,
          revisionNumber: s.specificationRevision.number,
        })
        .from(s.pageBranchOrigin)
        .innerJoin(
          s.pageBranch,
          and(
            eq(s.pageBranch.organizationId, s.pageBranchOrigin.organizationId),
            eq(s.pageBranch.id, s.pageBranchOrigin.branchId),
          ),
        )
        .leftJoin(
          s.specificationRevision,
          and(
            eq(
              s.specificationRevision.organizationId,
              s.pageBranchOrigin.organizationId,
            ),
            eq(s.specificationRevision.id, s.pageBranchOrigin.revisionId),
          ),
        )
        .where(
          and(
            eq(s.pageBranchOrigin.organizationId, organizationId),
            ids ? inArray(s.pageBranchOrigin.pageId, ids) : undefined,
          ),
        ),
      db
        .select()
        .from(s.pageContextLink)
        .where(
          and(
            eq(s.pageContextLink.organizationId, organizationId),
            isNull(s.pageContextLink.removedAt),
            ids ? inArray(s.pageContextLink.pageId, ids) : undefined,
          ),
        ),
    ]);
  const branchIds = origins.map((o) => o.branch.id);
  const pullRequests = branchIds.length
    ? await db
        .select({
          id: s.pagePullRequest.id,
          title: s.pagePullRequest.title,
          sourceBranchId: s.pagePullRequest.sourceBranchId,
          targetBranchId: s.pagePullRequest.targetBranchId,
          status: s.pagePullRequest.status,
          mergeCommitId: s.pagePullRequest.mergeCommitId,
          deletedAt: s.pagePullRequest.deletedAt,
        })
        .from(s.pagePullRequest)
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            inArray(s.pagePullRequest.sourceBranchId, branchIds),
          ),
        )
        .orderBy(asc(s.pagePullRequest.createdAt), asc(s.pagePullRequest.id))
    : [];
  const rows: SpaceProjectionRow[] = [];
  const referenced = new Map<
    string,
    SpaceEntityOf<"pageReference"> & { blockIds: string[] }
  >();
  for (const r of references) {
    const spaceId = spaceOf.get(r.pageId);
    if (!spaceId) continue;
    const id = `${r.pageId}:${r.targetId}`;
    const entry = referenced.get(id) ?? {
      id,
      organizationId,
      spaceId,
      type: "pageReference" as const,
      pageId: r.pageId,
      workItemId: r.targetId,
      commitId: r.commitId,
      blockIds: [],
    };
    if (r.blockId && !entry.blockIds.includes(r.blockId))
      entry.blockIds.push(r.blockId);
    referenced.set(id, entry);
  }
  for (const entity of referenced.values())
    rows.push(row(entity, entity.pageId));
  const cited = new Map<string, SpaceEntityOf<"specificationCitation">>();
  for (const { reference: r, number } of citations) {
    const spaceId = spaceOf.get(r.targetId);
    if (!spaceId) continue;
    const id = `${r.workItemId}:${r.targetId}`;
    const entry = cited.get(id) ?? {
      id,
      organizationId,
      spaceId,
      type: "specificationCitation" as const,
      pageId: r.targetId,
      workItemId: r.workItemId,
      revisions: [],
    };
    let revision = entry.revisions.find((x) => x.revisionId === r.revisionId);
    if (!revision) {
      revision = {
        revisionId: r.revisionId,
        number,
        commitIds: [],
        latest: false,
      };
      entry.revisions.push(revision);
    }
    if (r.targetCommitId) {
      if (!revision.commitIds.includes(r.targetCommitId))
        revision.commitIds.push(r.targetCommitId);
    } else revision.latest = true;
    cited.set(id, entry);
  }
  for (const entity of cited.values()) rows.push(row(entity, entity.pageId));
  for (const a of attachments) {
    const spaceId = spaceOf.get(a.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: a.id,
          organizationId,
          spaceId,
          type: "pageAttachment",
          pageId: a.pageId,
          workItemId: a.workItemId,
          purpose: a.purpose,
          commitId: a.commitId,
          createdById: a.createdById,
          createdAt: iso(a.createdAt),
        },
        a.pageId,
      ),
    );
  }
  for (const source of sources) {
    const spaceId = spaceOf.get(source.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: source.workItemId,
          organizationId,
          spaceId,
          type: "workItemSource",
          pageId: source.pageId,
          workItemId: source.workItemId,
          commitId: source.commitId,
          blockId: source.blockId,
          quote: source.quote,
          createdById: source.createdById,
          createdAt: iso(source.createdAt),
        },
        source.pageId,
      ),
    );
  }
  for (const { origin, branch, revisionNumber } of origins) {
    const spaceId = spaceOf.get(origin.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: origin.branchId,
          organizationId,
          spaceId,
          type: "pageBranchOrigin",
          pageId: origin.pageId,
          branchId: origin.branchId,
          workItemId: origin.workItemId,
          revisionId: origin.revisionId,
          revisionNumber,
          name: branch.name,
          title: origin.title,
          authorId: branch.authorId,
          createdAt: iso(origin.createdAt),
          deletedAt: isoOrNull(branch.deletedAt),
          pullRequests: pullRequests
            .filter((p) => p.sourceBranchId === origin.branchId)
            .map((p) => ({
              id: p.id,
              title: p.title,
              status: p.deletedAt ? ("closed" as const) : p.status,
              targetBranchId: p.targetBranchId,
              mergeCommitId: p.mergeCommitId,
            })),
        },
        origin.pageId,
      ),
    );
  }
  for (const link of links) {
    const spaceId = spaceOf.get(link.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: link.id,
          organizationId,
          spaceId,
          type: "pageContextLink",
          pageId: link.pageId,
          projectId: link.projectId,
          teamId: link.teamId,
          iterationId: link.iterationId,
          rank: link.rank,
          createdById: link.createdById,
          createdAt: iso(link.createdAt),
        },
        link.pageId,
      ),
    );
  }
  return rows;
}

const BATCH = 500;

async function upsertRows(
  tx: Tx,
  organizationId: string,
  rows: SpaceProjectionRow[],
) {
  for (const r of rows)
    if (r.organizationId !== organizationId)
      throw new Error(
        `Space projection ${r.key} belongs to another organization than its writer.`,
      );
  for (let index = 0; index < rows.length; index += BATCH) {
    const batch = rows.slice(index, index + BATCH);
    const written = await tx
      .insert(s.spaceEntity)
      .values(batch)
      .onConflictDoUpdate({
        target: s.spaceEntity.key,
        set: {
          spaceId: sql`excluded.space_id`,
          pageId: sql`excluded.page_id`,
          workItemId: sql`excluded.work_item_id`,
          projectId: sql`excluded.project_id`,
          type: sql`excluded.type`,
          data: sql`excluded.data`,
          updatedAt: sql`now()`,
        },
        // Keys are client-chosen ids; a row never moves across tenants.
        setWhere: eq(s.spaceEntity.organizationId, organizationId),
      })
      .returning({ key: s.spaceEntity.key });
    if (written.length !== batch.length)
      throw new Error(
        "A space projection key is already used by another organization.",
      );
  }
}

async function deleteKeys(tx: Tx, organizationId: string, keys: string[]) {
  for (let index = 0; index < keys.length; index += BATCH)
    await tx
      .delete(s.spaceEntity)
      .where(
        and(
          eq(s.spaceEntity.organizationId, organizationId),
          inArray(s.spaceEntity.key, keys.slice(index, index + BATCH)),
        ),
      );
}

type StoredRow = typeof s.spaceEntity.$inferSelect;
const same = (a: SpaceProjectionRow, b: StoredRow) =>
  a.spaceId === b.spaceId &&
  a.pageId === b.pageId &&
  a.workItemId === b.workItemId &&
  a.projectId === b.projectId &&
  a.type === b.type &&
  canonicalJson(a.data) === canonicalJson(b.data);

// Writes `expected` over `stored`: changed and missing rows are upserted,
// stored rows that are no longer expected are deleted.
async function reconcile(
  tx: Tx,
  organizationId: string,
  expected: SpaceProjectionRow[],
  stored: StoredRow[],
) {
  const existing = new Map(stored.map((r) => [r.key, r]));
  const wanted = new Map(expected.map((r) => [r.key, r]));
  const upserts = [...wanted.values()].filter((r) => {
    const current = existing.get(r.key);
    return !current || !same(r, current);
  });
  const deletes = stored.filter((r) => !wanted.has(r.key)).map((r) => r.key);
  await upsertRows(tx, organizationId, upserts);
  await deleteKeys(tx, organizationId, deletes);
  return {
    upserted: upserts.length,
    deleted: deletes.length,
    unchanged: wanted.size - upserts.length,
  };
}

// What a command touched: space summaries with their grants, page summaries
// (the tree, discussion counters, main's draft), page histories (every
// page-level row), new commits by id (commits never change, so only new
// ones are written), page lines (branches with their drafts, pull requests
// with their mergeability, reviews), page discussions (threads, messages
// and discussion events) and the pages' knowledge links. Knowledge links
// depend on main's head, the page's archive state and its branches, so
// `pages` and `pageLines` rewrite them too.
export type SpaceProjectionTarget = {
  spaces?: string[];
  pages?: string[];
  pageHistories?: string[];
  commits?: string[];
  pageLines?: string[];
  pageDiscussions?: string[];
  knowledge?: string[];
};

// Rewrites the named rows from the domain tables, in the caller's
// transaction (which holds the organization lock).
export async function writeSpaceProjections(
  tx: Tx,
  organizationId: string,
  target: SpaceProjectionTarget,
) {
  const where = (...conditions: (ReturnType<typeof eq> | undefined)[]) =>
    and(eq(s.spaceEntity.organizationId, organizationId), ...conditions);
  if (target.spaces?.length) {
    const [expected, stored] = await Promise.all([
      spaceRows(tx, organizationId, target.spaces),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(s.spaceEntity.spaceId, target.spaces),
            isNull(s.spaceEntity.pageId),
            inArray(s.spaceEntity.type, ["space", "spaceGrant"]),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
  if (target.pages?.length) {
    const [expected, stored] = await Promise.all([
      pageSummaries(tx, organizationId, { pageIds: target.pages }),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(
              s.spaceEntity.key,
              target.pages.map((id) => `page:${id}`),
            ),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
  const histories = target.pageHistories ?? [];
  if (histories.length) {
    const [commits, lines, discussions, knowledge, stored] = await Promise.all([
      commitRows(tx, organizationId, { pageIds: histories }),
      lineRows(tx, organizationId, histories),
      pageDiscussionRows(tx, organizationId, histories),
      knowledgeRows(tx, organizationId, histories),
      tx
        .select()
        .from(s.spaceEntity)
        .where(where(inArray(s.spaceEntity.pageId, histories))),
    ]);
    await reconcile(
      tx,
      organizationId,
      [...commits, ...lines, ...discussions, ...knowledge],
      stored,
    );
  }
  const knowledge = [
    ...new Set([
      ...(target.knowledge ?? []),
      ...(target.pages ?? []),
      ...(target.pageLines ?? []),
    ]),
  ].filter((id) => !histories.includes(id));
  if (knowledge.length) {
    const [expected, stored] = await Promise.all([
      knowledgeRows(tx, organizationId, knowledge),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(s.spaceEntity.pageId, knowledge),
            inArray(s.spaceEntity.type, [...knowledgeEntityTypes]),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
  if (target.commits?.length) {
    const [expected, stored] = await Promise.all([
      commitRows(tx, organizationId, { commitIds: target.commits }),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(
              s.spaceEntity.key,
              target.commits.map((id) => `pageCommit:${id}`),
            ),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
  const lines = target.pageLines?.filter((id) => !histories.includes(id));
  if (lines?.length) {
    const [expected, stored] = await Promise.all([
      lineRows(tx, organizationId, lines),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(s.spaceEntity.pageId, lines),
            inArray(s.spaceEntity.type, lineTypes),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
  const discussions = target.pageDiscussions?.filter(
    (id) => !histories.includes(id),
  );
  if (discussions?.length) {
    const [expected, stored] = await Promise.all([
      pageDiscussionRows(tx, organizationId, discussions),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(s.spaceEntity.pageId, discussions),
            inArray(s.spaceEntity.type, discussionTypes),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
}

// The draft writer's coarse transition (docs/internals/spaces.md#uncommitted-changes):
// when stored edits first go beyond a draft's committed sequence, the
// "uncommitted changes" flags of its page (main's draft on the page
// summary, the branch, pull requests merging from or into it) are rewritten
// here, in a transaction of its own that takes the organization lock in
// exclusive mode like every domain write, after the draft writer's
// transaction committed. The flag never changes back here: only commits
// and new epochs (domain commands) clear it.
export async function refreshDraftProjections(
  db: Database,
  organizationId: string,
  draftId: string,
) {
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const [draft] = await tx
      .select({ pageId: s.spaceDraft.pageId })
      .from(s.spaceDraft)
      .where(
        and(
          eq(s.spaceDraft.organizationId, organizationId),
          eq(s.spaceDraft.id, draftId),
        ),
      );
    if (!draft) return;
    await writeSpaceProjections(tx, organizationId, {
      pages: [draft.pageId],
      pageLines: [draft.pageId],
    });
  });
}

// Every Spaces projection row the organization should have.
export async function expectedSpaceProjections(
  tx: Database | Tx,
  organizationId: string,
) {
  const rows = [
    ...(await spaceRows(tx, organizationId)),
    ...(await pageSummaries(tx, organizationId)),
    ...(await commitRows(tx, organizationId, {})),
    ...(await lineRows(tx, organizationId)),
    ...(await pageDiscussionRows(tx, organizationId)),
    ...(await knowledgeRows(tx, organizationId)),
  ];
  return new Map(rows.map((r) => [r.key, r]));
}

// Reconciles `space_entity` and `space_reader` with the domain, in the
// caller's transaction under the organization lock. Called by
// `rebuildProjections`.
export async function rebuildSpaceProjections(tx: Tx, organizationId: string) {
  if (!(await hasSpaceRows(tx, organizationId)))
    return { upserted: 0, deleted: 0, unchanged: 0, readersChanged: 0 };
  const [expected, stored] = await Promise.all([
    expectedSpaceProjections(tx, organizationId),
    tx
      .select()
      .from(s.spaceEntity)
      .where(eq(s.spaceEntity.organizationId, organizationId)),
  ]);
  const result = await reconcile(
    tx,
    organizationId,
    [...expected.values()],
    stored,
  );
  const access = await refreshSpaceAccess(tx, organizationId);
  return { ...result, readersChanged: access.changedUserIds.length };
}

// Whether the organization has any space, Spaces projection or reader row:
// most organizations checked by the invariant have none.
async function hasSpaceRows(tx: Tx, organizationId: string) {
  const [row] = await tx.execute<{ found: boolean }>(sql`
    select exists (select 1 from ${s.space} where ${s.space.organizationId} = ${organizationId})
      or exists (select 1 from ${s.spaceEntity} where ${s.spaceEntity.organizationId} = ${organizationId})
      or exists (select 1 from ${s.spaceReader} where ${s.spaceReader.organizationId} = ${organizationId})
      as found`);
  return Boolean(row?.found);
}

// Keys whose stored Spaces projection or effective access differs from the
// domain (missing, stale or extra). Empty when the invariant holds.
export async function spaceProjectionDrift(tx: Tx, organizationId: string) {
  if (!(await hasSpaceRows(tx, organizationId))) return [];
  const [expected, stored] = await Promise.all([
    expectedSpaceProjections(tx, organizationId),
    tx
      .select()
      .from(s.spaceEntity)
      .where(eq(s.spaceEntity.organizationId, organizationId)),
  ]);
  const drift: string[] = [];
  for (const r of stored) {
    const want = expected.get(r.key);
    if (!want) drift.push(`extra ${r.key}`);
    else if (!same(want, r)) drift.push(`stale ${r.key}`);
  }
  const seen = new Set(stored.map((r) => r.key));
  for (const key of expected.keys())
    if (!seen.has(key)) drift.push(`missing ${key}`);
  drift.push(...(await spaceAccessDrift(tx, organizationId)));
  return drift.sort();
}
