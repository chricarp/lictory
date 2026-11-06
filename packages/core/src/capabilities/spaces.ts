import { z } from "zod";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import { getPage, listPages, listSpaces } from "@lictory/core/spaces/reads";

// Reads of Lictory Spaces for the browser, MCP and Litto. Space and page
// commands are workspace commands (createSpace, createPage, …), generated
// from the protocol like every other command.

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
    "A page as published: the title and Markdown of the latest commit on its main line, with the commit id. Unpublished live drafts are never included.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, pageId: id }),
  run: (ctx, q) =>
    getPage(ctx.db, ctx.principal.userId, q.organizationId, q.pageId),
});

export const spaceCapabilities = [
  listSpacesCapability,
  listPagesCapability,
  getPageCapability,
] as AnyCapability[];
