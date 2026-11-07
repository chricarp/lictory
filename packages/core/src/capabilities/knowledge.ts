import { z } from "zod";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import {
  getWorkItemKnowledge,
  listContextPages,
  listPageWork,
  listReferencesTo,
} from "@lictory/core/spaces/knowledge-reads";
import { describePageLinks } from "@lictory/core/spaces/link-details";

// Reads of knowledge links between pages and work
// (docs/internals/knowledge-links.md) for the browser, MCP and Litto. Every
// read returns only pages the person can read now: never a title, a row or
// a count of other pages. The link commands (attachPage, detachPage,
// linkContextPage, unlinkContextPage, moveContextPage, createWorkItem with
// `source`, createPageBranch and proposePageChange with `origin`) are
// workspace commands generated from the protocol.

const getWorkItemKnowledgeCapability = defineCapability({
  name: "getWorkItemKnowledge",
  title: "Get work item knowledge",
  description:
    "What pages say about a work item, limited to pages you can read: `referencedIn` (pages whose published version mentions the item, with the published `commitId` and the top-level `blockIds`), `citations` (pages the item's specification revisions cite, per revision with pinned `commitIds` and whether the current revision cites them), `attachments` (pages attached with a purpose and optional pinned commit; `attachmentId` for detachPage), `source` (the committed page content the item was created from, with block and quote), `pageBranches` (page branches proposed from the item, with their pull requests) and `currentRevisionReferences` (items, pages and decisions the current revision references). Read a page with getPage.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, workItemId: id }),
  run: (ctx, q) =>
    getWorkItemKnowledge(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.workItemId,
    ),
});

const listPageWorkCapability = defineCapability({
  name: "listPageWork",
  title: "List work on a page",
  description:
    "The work a page you can read knows about: `references` (work items its published version mentions, with block ids), `citedBy` (items whose specification revisions cite it), `attachedTo` (items it is attached to), `createdItems` (items created from its content, with the quoted block), `branchOrigins` (branches of this page proposed from work items), `contexts` (projects, teams and iterations that keep it as context) and `referencedByPages` (other pages you can read whose published version links here). Items carry key, title and current revision id; read their status with getWorkItem.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, pageId: id }),
  run: (ctx, q) =>
    listPageWork(ctx.db, ctx.principal.userId, q.organizationId, q.pageId),
});

const listContextPagesCapability = defineCapability({
  name: "listContextPages",
  title: "List context pages",
  description:
    "Context pages of a project you can read, in order: the project's own list (board and backlog) by default, a team's with `teamId`, an iteration's (goals, notes, retrospectives) with `iterationId`, or every list of the project with `all: true`. Each entry has the page, its space, its published title and `linkId` (for unlinkContextPage and moveContextPage).",
  kind: "query",
  surfaces: everywhere,
  input: z
    .object({
      organizationId,
      projectId: id,
      teamId: id.optional(),
      iterationId: id.optional(),
      all: z.boolean().default(false),
    })
    .refine((q) => !(q.teamId && q.iterationId), {
      message: "Name a team or an iteration, not both.",
      path: ["iterationId"],
    }),
  run: (ctx, q) =>
    listContextPages(ctx.db, ctx.principal.userId, q.organizationId, q),
});

const listReferencesToCapability = defineCapability({
  name: "listReferencesTo",
  title: "List references to an item, page or decision",
  description:
    'Where a work item (`kind: "item"`), a page you can read (`page`) or a recorded decision (`decision`) is referenced: `pages` you can read whose published version mentions it (published `commitId`, `blockIds`, and for pages the pinned versions cited) and `specifications` whose main revisions do (each revision, with the pinned commit for page citations, and whether the item\'s current revision still does).',
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    kind: z.enum(["item", "page", "decision"]),
    id,
  }),
  run: (ctx, q) =>
    listReferencesTo(ctx.db, ctx.principal.userId, q.organizationId, {
      kind: q.kind,
      id: q.id,
    }),
});

const describePageLinksCapability = defineCapability({
  name: "describePageLinks",
  title: "Describe page links",
  description:
    "Details of pages you can read that refer to work, for showing a link in context: for each page its published title, `publishedCommitId` and `publishedVersion` (version numbers count main's history, as the page history does), the version number of each commit of the page in `versions`, and for `blocks` (a commit of the page and top-level block ids, as in getWorkItemKnowledge's `referencedIn`) each block's section `heading` and a short `excerpt`; with `pinned` (another commit of the page, such as a pinned version) the same blocks as that commit has them in `pinnedBlocks`. Pages you cannot read are left out.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    pages: z
      .array(
        z.object({
          pageId: id,
          blocks: z
            .object({ commitId: id, blockIds: z.array(z.string()).max(20) })
            .optional(),
          pinned: z.object({ commitId: id }).optional(),
          versions: z.array(id).max(20).optional(),
        }),
      )
      .max(50),
  }),
  run: (ctx, q) =>
    describePageLinks(ctx.db, ctx.principal.userId, q.organizationId, q.pages),
});

export const knowledgeCapabilities = [
  getWorkItemKnowledgeCapability,
  listPageWorkCapability,
  listContextPagesCapability,
  listReferencesToCapability,
  describePageLinksCapability,
] as AnyCapability[];
