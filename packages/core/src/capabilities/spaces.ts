import { z } from "zod";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import { listPageThreads } from "@lictory/core/spaces/discussions";
import {
  diffPageCommits,
  getPage,
  listPageCommits,
  listPages,
  listSpaces,
  previewPageMerge,
} from "@lictory/core/spaces/reads";

// Reads of Lictory Spaces for the browser, MCP and Litto. Space, page,
// page discussion and page history commands are workspace commands
// (createSpace, createPage, createPageThread, commitDraft,
// proposePageChange, …), generated from the protocol like every other
// command.

const listSpacesCapability = defineCapability({
  name: "listSpaces",
  title: "List spaces",
  description:
    "Spaces of knowledge pages you can read, with your access level (view, comment or edit), each space's home (organization, project or team), access mode and publishing policy. `manageableWithoutAccess` lists restricted spaces you administer but cannot read (names only); grant yourself access with setSpaceGrant to read one, which is recorded in the audit log.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    includeArchived: z.boolean().default(false),
  }),
  run: (ctx, q) =>
    listSpaces(ctx.db, ctx.principal.userId, q.organizationId, {
      includeArchived: q.includeArchived,
    }),
});

const listPagesCapability = defineCapability({
  name: "listPages",
  title: "List pages",
  description:
    "The page tree of one space in reading order: each page's id, parent, published title and depth. Archived pages (and their subpages) are omitted unless includeArchived is true.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    spaceId: id,
    includeArchived: z.boolean().default(false),
  }),
  run: (ctx, q) =>
    listPages(ctx.db, ctx.principal.userId, q.organizationId, q.spaceId, {
      includeArchived: q.includeArchived,
    }),
});

const getPageCapability = defineCapability({
  name: "getPage",
  title: "Get page",
  description:
    "A page as published: the title and Markdown of the latest commit on its main line, with the commit id. Pass `commitId` for any earlier version from listPageCommits (`published` tells whether it is the current one). Unpublished live drafts are never included.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, pageId: id, commitId: id.optional() }),
  run: (ctx, q) =>
    getPage(ctx.db, ctx.principal.userId, q.organizationId, q.pageId, {
      commitId: q.commitId,
    }),
});

const listPageCommitsCapability = defineCapability({
  name: "listPageCommits",
  title: "List page history",
  description:
    "A page's commits, newest first (all of them, or those of one line with `branchId`): parents, title, message, author, contributors, the pull request a merge commit came from and the approvals recorded on it; and the page's live branches with their latest commit. Read a version with getPage and compare two with diffPageCommits.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    pageId: id,
    branchId: id.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  run: (ctx, q) =>
    listPageCommits(ctx.db, ctx.principal.userId, q.organizationId, q.pageId, {
      branchId: q.branchId,
      limit: q.limit,
    }),
});

const diffPageCommitsCapability = defineCapability({
  name: "diffPageCommits",
  title: "Compare page versions",
  description:
    "What changed between two commits of a page: whether the title changed and every added, removed, changed or moved block with its Markdown before and after.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    pageId: id,
    fromCommitId: id,
    toCommitId: id,
  }),
  run: (ctx, q) =>
    diffPageCommits(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.pageId,
      q.fromCommitId,
      q.toCommitId,
    ),
});

const previewPageMergeCapability = defineCapability({
  name: "previewPageMerge",
  title: "Preview page merge",
  description:
    "The merge of two lines of a page as it would happen now: a page pull request (`pullRequestId`) or main / `fromBranchId` into `branchId` (what syncPageBranch does). Returns the heads, the merge base, every conflict (id, the conflicting block or the title, and base/ours/theirs as JSON and Markdown; resolve them with syncPageBranch `resolutions`), the result's fingerprint when clean (what review decisions bind to) and its Markdown.",
  kind: "query",
  surfaces: everywhere,
  input: z
    .object({
      organizationId,
      pullRequestId: id.optional(),
      branchId: id.optional(),
      fromBranchId: id.optional(),
    })
    .refine(
      (q) => (q.pullRequestId === undefined) !== (q.branchId === undefined),
      {
        message: "Name either a pull request or a branch.",
        path: ["pullRequestId"],
      },
    ),
  run: (ctx, q) =>
    previewPageMerge(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.pullRequestId
        ? { pullRequestId: q.pullRequestId }
        : { branchId: q.branchId!, fromBranchId: q.fromBranchId },
    ),
});

const listPageThreadsCapability = defineCapability({
  name: "listPageThreads",
  title: "List page discussions",
  description:
    "Discussions on a page with all their messages, oldest first: status, blocking, the anchor (whole page, a commit range with its quote, or a live draft range with its quote) and the line it was written on. Resolved discussions are omitted unless includeResolved is true. Start or answer one with createPageThread and replyToPageThread.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    pageId: id,
    includeResolved: z.boolean().default(false),
  }),
  run: (ctx, q) =>
    listPageThreads(ctx.db, ctx.principal.userId, q.organizationId, q.pageId, {
      includeResolved: q.includeResolved,
    }),
});

export const spaceCapabilities = [
  listSpacesCapability,
  listPagesCapability,
  getPageCapability,
  listPageCommitsCapability,
  diffPageCommitsCapability,
  previewPageMergeCapability,
  listPageThreadsCapability,
] as AnyCapability[];
