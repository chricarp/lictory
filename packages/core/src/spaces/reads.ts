import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  SpaceAccessLevel,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import { authorize, type Database } from "@lictory/core/domain/service";
import {
  manageableUnreadableSpaces,
  pageAccess,
  spaceAccess,
  type SpaceActor,
} from "@lictory/core/spaces/access";
import {
  diffDocuments,
  documentToMarkdown,
} from "@lictory/core/spaces/document";
import {
  commitMetas,
  commitSnapshots,
  pageLineStates,
  pullRequestCommitIds,
  pullRequestMerge,
  reachable,
} from "@lictory/core/spaces/history-state";
import { pageSummaries } from "@lictory/core/spaces/projections";
import { workListResolver } from "@lictory/core/spaces/work-lists";
import { commitVersions } from "@lictory/core/knowledge/search";

// On-demand reads of Lictory Spaces for capabilities (MCP, Litto, browser
// routes). Browsers read the synchronized projections; these read the domain
// tables in one read-only snapshot and authorize with the same access checks.

const readOnly = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;
const unavailableSpace = () =>
  new DomainError("not_found", "This space is unavailable.");
const unavailablePage = () =>
  new DomainError("not_found", "This page is unavailable.");

export type SpaceSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  projectId: string | null;
  teamId: string | null;
  accessMode: "inherited" | "restricted";
  publishing: "direct" | "reviewed";
  archivedAt: string | null;
  // The reader's effective level.
  level: SpaceAccessLevel;
};

// The spaces the person can read, with their level, and the spaces they
// administer without reading them (restricted spaces they have no grant in:
// names only, so an administrator can grant themselves access).
export async function listSpaces(
  db: Database,
  userId: string,
  organizationId: string,
  options: { includeArchived?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const actor: SpaceActor = { organizationId, userId };
    const rows = await tx
      .select({ space: s.space, level: s.spaceReader.level })
      .from(s.space)
      .innerJoin(
        s.spaceReader,
        and(
          eq(s.spaceReader.organizationId, s.space.organizationId),
          eq(s.spaceReader.spaceId, s.space.id),
          eq(s.spaceReader.userId, userId),
        ),
      )
      .where(eq(s.space.organizationId, organizationId));
    const spaces: SpaceSummary[] = rows
      .filter((r) => options.includeArchived === true || !r.space.archivedAt)
      .map(({ space, level }) => ({
        id: space.id,
        name: space.name,
        slug: space.slug,
        description: space.description,
        icon: space.icon,
        projectId: space.projectId,
        teamId: space.teamId,
        accessMode: space.accessMode,
        publishing: space.publishing,
        archivedAt: space.archivedAt?.toISOString() ?? null,
        level,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const manageable = (await manageableUnreadableSpaces(tx, actor))
      .filter((x) => options.includeArchived === true || !x.archivedAt)
      .map((x) => ({ id: x.id, name: x.name, accessMode: x.accessMode }));
    return { spaces, manageableWithoutAccess: manageable };
  }, readOnly);
}

type PageNode = {
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  publishedCommitId: string;
  updatedAt: string;
  archivedAt: string | null;
};

// One space's page tree in reading order (depth first, siblings by rank).
// Archived pages, and everything under them, are left out unless asked for.
export async function listPages(
  db: Database,
  userId: string,
  organizationId: string,
  spaceId: string,
  options: { includeArchived?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const found = await spaceAccess(tx, { organizationId, userId }, spaceId);
    if (!found?.level) throw unavailableSpace();
    const pages = (
      await pageSummaries(tx, organizationId, { spaceIds: [spaceId] })
    ).map((r) => r.data as SpaceEntityOf<"page">);
    const children = new Map<string | null, SpaceEntityOf<"page">[]>();
    for (const page of pages)
      children.set(page.parentId, [
        ...(children.get(page.parentId) ?? []),
        page,
      ]);
    for (const list of children.values())
      list.sort((a, b) =>
        a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1,
      );
    const tree: PageNode[] = [];
    const visit = (parentId: string | null, depth: number) => {
      for (const page of children.get(parentId) ?? []) {
        if (page.archivedAt && !options.includeArchived) continue;
        tree.push({
          id: page.id,
          parentId: page.parentId,
          title: page.title,
          depth,
          publishedCommitId: page.publishedCommitId,
          updatedAt: page.updatedAt,
          archivedAt: page.archivedAt,
        });
        visit(page.id, depth + 1);
      }
    };
    visit(null, 0);
    return {
      space: { id: found.space.id, name: found.space.name, level: found.level },
      pages: tree,
    };
  }, readOnly);
}

// A page as published (main's latest commit), or any commit of its history
// with `commitId`: title and Markdown. Live drafts are never returned.
export async function getPage(
  db: Database,
  userId: string,
  organizationId: string,
  pageId: string,
  options: { commitId?: string } = {},
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const found = await pageAccess(tx, { organizationId, userId }, pageId);
    if (!found?.level) throw unavailablePage();
    const [main] = await tx
      .select({ headCommitId: s.pageBranch.headCommitId })
      .from(s.pageBranch)
      .where(
        and(
          eq(s.pageBranch.organizationId, organizationId),
          eq(s.pageBranch.pageId, pageId),
          eq(s.pageBranch.isMain, true),
        ),
      );
    if (!main) throw unavailablePage();
    const [commit] = await tx
      .select()
      .from(s.pageCommit)
      .where(
        and(
          eq(s.pageCommit.organizationId, organizationId),
          eq(s.pageCommit.pageId, pageId),
          eq(s.pageCommit.id, options.commitId ?? main.headCommitId),
        ),
      );
    if (!commit) throw unavailableCommit();
    const { page, space } = found;
    const resolver = await workListResolver(tx, organizationId, commit.content);
    const exported = resolver
      ? documentToMarkdown(commit.content, resolver)
      : null;
    const version = (await commitVersions(tx, organizationId, [commit.id])).get(
      commit.id,
    );
    return {
      page: {
        id: page.id,
        spaceId: space.id,
        spaceName: space.name,
        parentId: page.parentId,
        archivedAt: page.archivedAt?.toISOString() ?? null,
      },
      title: commit.title,
      // Live work lists are resolved now, into static references.
      markdown: exported ?? commit.markdown,
      commitId: commit.id,
      // Main's first-parent position of the commit: "version N", as the
      // page history numbers it. Cite this with the commitId.
      version: version ?? 1,
      // Whether this commit is what readers see now.
      published: commit.id === main.headCommitId,
      publishedAt: commit.createdAt.toISOString(),
      publishedBy: commit.authorId,
      message: commit.message,
      contributorIds: commit.contributorIds,
      approverIds: commit.approverIds,
      level: found.level,
    };
  }, readOnly);
}

const unavailableCommit = () =>
  new DomainError("not_found", "This version of the page is unavailable.");

async function readablePageIn(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  userId: string,
  organizationId: string,
  pageId: string,
) {
  await authorize(tx, userId, organizationId);
  const found = await pageAccess(tx, { organizationId, userId }, pageId);
  if (!found?.level) throw unavailablePage();
  return found;
}

// A page's history, newest first: every commit (or those reachable from
// one line), with its parents, message, author, contributors and the
// approvals recorded when it merged, and the page's live lines.
export async function listPageCommits(
  db: Database,
  userId: string,
  organizationId: string,
  pageId: string,
  options: { branchId?: string; limit?: number } = {},
) {
  return db.transaction(async (tx) => {
    await readablePageIn(tx, userId, organizationId, pageId);
    const [commits, branches] = await Promise.all([
      commitMetas(tx, organizationId, [pageId]),
      tx
        .select()
        .from(s.pageBranch)
        .where(
          and(
            eq(s.pageBranch.organizationId, organizationId),
            eq(s.pageBranch.pageId, pageId),
          ),
        ),
    ]);
    let selected = commits;
    if (options.branchId) {
      const branch = branches.find((b) => b.id === options.branchId);
      if (!branch)
        throw new DomainError(
          "not_found",
          "This branch is unavailable on this page.",
        );
      const lineage = reachable(commits, branch.headCommitId);
      selected = commits.filter((c) => lineage.has(c.id));
    }
    return {
      branches: branches
        .filter((b) => !b.deletedAt)
        .map((b) => ({
          id: b.id,
          name: b.name,
          isMain: b.isMain,
          headCommitId: b.headCommitId,
          authorId: b.authorId,
        })),
      commits: [...selected]
        .reverse()
        .slice(0, options.limit ?? 100)
        .map((c) => ({
          id: c.id,
          parentIds: c.parentIds,
          title: c.title,
          message: c.message,
          hash: c.hash,
          authorId: c.authorId,
          contributorIds: c.contributorIds,
          approverIds: c.approverIds,
          pullRequestId: c.pullRequestId,
          createdAt: c.createdAt.toISOString(),
        })),
      total: selected.length,
    };
  }, readOnly);
}

// What changed between two commits of a page: the title and each block
// (added, removed, changed, moved) with its Markdown before and after.
export async function diffPageCommits(
  db: Database,
  userId: string,
  organizationId: string,
  pageId: string,
  fromCommitId: string,
  toCommitId: string,
) {
  return db.transaction(async (tx) => {
    await readablePageIn(tx, userId, organizationId, pageId);
    const metas = await commitMetas(tx, organizationId, [pageId]);
    if (
      ![fromCommitId, toCommitId].every((id) => metas.some((c) => c.id === id))
    )
      throw unavailableCommit();
    const snapshots = await commitSnapshots(tx, organizationId, [
      fromCommitId,
      toCommitId,
    ]);
    const from = snapshots.get(fromCommitId)!;
    const to = snapshots.get(toCommitId)!;
    return {
      from: { commitId: fromCommitId, title: from.title },
      to: { commitId: toCommitId, title: to.title },
      titleChanged: from.title !== to.title,
      changes: diffDocuments(from.content, to.content).filter(
        (change) => change.kind !== "unchanged",
      ),
    };
  }, readOnly);
}

// The merge of two lines of a page as it would happen now: a pull
// request's source into its target, or `fromBranchId` (default main) into
// `branchId` (what syncPageBranch does). Lists every conflict with its id
// (what `resolutions` are keyed by), the result's fingerprint when clean
// and its Markdown (conflicts keep ours provisionally).
export async function previewPageMerge(
  db: Database,
  userId: string,
  organizationId: string,
  input:
    { pullRequestId: string } | { branchId: string; fromBranchId?: string },
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    let ours: string;
    let theirs: string | undefined;
    let pageId: string;
    if ("pullRequestId" in input) {
      const [pr] = await tx
        .select()
        .from(s.pagePullRequest)
        .where(
          and(
            eq(s.pagePullRequest.organizationId, organizationId),
            eq(s.pagePullRequest.id, input.pullRequestId),
          ),
        );
      if (!pr || pr.deletedAt)
        throw new DomainError("not_found", "This pull request is unavailable.");
      pageId = pr.pageId;
      ours = pr.sourceBranchId;
      theirs = pr.targetBranchId;
    } else {
      const [branch] = await tx
        .select({ pageId: s.pageBranch.pageId })
        .from(s.pageBranch)
        .where(
          and(
            eq(s.pageBranch.organizationId, organizationId),
            eq(s.pageBranch.id, input.branchId),
          ),
        );
      if (!branch)
        throw new DomainError(
          "not_found",
          "This branch is unavailable on this page.",
        );
      pageId = branch.pageId;
      ours = input.branchId;
      theirs = input.fromBranchId;
    }
    try {
      await readablePageIn(tx, userId, organizationId, pageId);
    } catch {
      throw new DomainError(
        "not_found",
        "This branch or pull request is unavailable.",
      );
    }
    const state = (await pageLineStates(tx, organizationId, [pageId])).get(
      pageId,
    )!;
    const line = state.branches.find((b) => b.id === ours);
    const from = theirs
      ? state.branches.find((b) => b.id === theirs)
      : state.branches.find((b) => b.isMain);
    if (!line || !from)
      throw new DomainError(
        "not_found",
        "This branch is unavailable on this page.",
      );
    const pr = { sourceBranchId: line.id, targetBranchId: from.id };
    const snapshots = await commitSnapshots(
      tx,
      organizationId,
      pullRequestCommitIds(state, [pr]),
    );
    const merged = pullRequestMerge(state, pr, snapshots);
    return {
      ours: {
        branchId: line.id,
        name: line.name,
        headCommitId: line.headCommitId,
      },
      theirs: {
        branchId: from.id,
        name: from.name,
        headCommitId: from.headCommitId,
      },
      baseCommitId: merged?.base?.id ?? null,
      alreadyUpToDate: reachable(state.commits, line.headCommitId).has(
        from.headCommitId,
      ),
      conflicts: merged?.merge?.conflicts ?? [],
      resultHash: merged?.resultHash ?? null,
      title: merged?.merge?.title ?? null,
      markdown: merged?.merge
        ? documentToMarkdown(merged.merge.content.document)
        : null,
    };
  }, readOnly);
}
