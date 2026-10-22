import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import "@lictory/zero/context";
import { zql } from "@lictory/zero/schema";

const organizationArgs = z.object({ organizationId: z.string().min(1) });
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
});
