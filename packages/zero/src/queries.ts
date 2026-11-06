import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
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
  // My effective access level in each space I can read.
  mySpaceAccess: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceReader
      .where("organizationId", args.organizationId)
      .where("userId", ctx.userID)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
});
