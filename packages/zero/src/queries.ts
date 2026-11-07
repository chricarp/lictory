import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import { knowledgeEntityTypes } from "@lictory/core/contracts/protocol";
import "@lictory/zero/context";
import { zql } from "@lictory/zero/schema";

const organizationArgs = z.object({ organizationId: z.string().min(1) });
const pageArgs = z.object({
  organizationId: z.string().min(1),
  pageId: z.string().min(1),
});
const workItemArgs = z.object({
  organizationId: z.string().min(1),
  workItemId: z.string().min(1),
});
const projectArgs = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});
const knowledgeTypes = [...knowledgeEntityTypes];

// Server-defined queries. Arguments only narrow; access always comes from the
// membership relationship evaluated against `ctx.userID`.
export const queries = defineQueries({
  // The organizations I belong to, with their public profile.
  memberships: defineQuery(({ ctx }) =>
    zql.member
      .where("userId", ctx.userID)
      .related("organization", (q) => q.where("type", "organizationProfile")),
  ),
  // Lists, boards, inbox and directory: organization-level projections only.
  organization: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.syncEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", "IS", null)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // One work item's history, loaded when the item is opened.
  workItem: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.syncEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // One work item's readiness checks alone, for a reference card naming
  // what is missing without loading the item's history.
  workItemReadiness: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.syncEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .where("type", "readiness")
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Lictory Spaces: every space I can read, with its grants and page tree
  // (space-level rows). Authorized by my effective access and my
  // organization membership; never part of the queries above.
  spaces: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("pageId", "IS", null)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // One page's history (commits and branches), loaded when it is opened.
  page: defineQuery(pageArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("pageId", args.pageId)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // A space's review list needs proposal metadata, never every page's content.
  spacePullRequests: defineQuery(
    z.object({ organizationId: z.string().min(1), spaceId: z.string().min(1) }),
    ({ args, ctx }) =>
      zql.spaceEntity
        .where("organizationId", args.organizationId)
        .where("spaceId", args.spaceId)
        .where("type", "pagePullRequest")
        .whereExists("readers", (r) => r.where("userId", ctx.userID))
        .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Knowledge links (docs/internals/knowledge-links.md). What pages say
  // about one work item: pages whose published version references it,
  // pages its specification revisions cite, attached pages, the page it was
  // created from and page branches proposed from it. Only rows of spaces I
  // read reach me, so nothing (not even a count) of other pages does.
  workItemKnowledge: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .where("type", "IN", knowledgeTypes)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // The work one page knows about (references, citations, attachments,
  // items created from it, branches proposed from items, context links),
  // without loading the page's history.
  pageWork: defineQuery(pageArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("pageId", args.pageId)
      .where("type", "IN", knowledgeTypes)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Work items the published pages of one space mention (a space home's
  // "Linked work"), through the space's readers.
  spaceWork: defineQuery(
    z.object({ organizationId: z.string().min(1), spaceId: z.string().min(1) }),
    ({ args, ctx }) =>
      zql.spaceEntity
        .where("organizationId", args.organizationId)
        .where("spaceId", args.spaceId)
        .where("type", "pageReference")
        .whereExists("readers", (r) => r.where("userId", ctx.userID))
        .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Context pages of a project, its teams and its iterations that I can
  // read (`teamId` / `iterationId` in each row name the list).
  projectContext: defineQuery(projectArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("projectId", args.projectId)
      .where("type", "pageContextLink")
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Which work items readable pages mention, are attached to, are cited by
  // or were created from, for the "N pages" signal of item lists and
  // previews (the pages the item's Knowledge section shows): small rows,
  // and only of spaces I read.
  itemPageLinks: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("type", "IN", [
        "pageReference",
        "pageAttachment",
        "specificationCitation",
        "workItemSource",
      ])
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Inbox To do: page pull request metadata of the spaces I read (never page
  // content), from which my page reviews and my mergeable proposals derive.
  myPagePullRequests: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("type", "pagePullRequest")
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Review decisions on the named pages (those with an open pull request
  // that asks for my review), so a review I gave clears it from To do.
  pagePullRequestReviews: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      pageIds: z.array(z.string().min(1)).max(200),
    }),
    ({ args, ctx }) =>
      zql.spaceEntity
        .where("organizationId", args.organizationId)
        .where("pageId", "IN", args.pageIds)
        .where("type", "pagePullRequestReview")
        .whereExists("readers", (r) => r.where("userId", ctx.userID))
        .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // My effective access level in each space I can read.
  mySpaceAccess: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceReader
      .where("organizationId", args.organizationId)
      .where("userId", ctx.userID)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
});
