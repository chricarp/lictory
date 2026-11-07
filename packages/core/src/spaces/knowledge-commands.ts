import { and, eq, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  canManageProject,
  capabilitiesOf,
  type Directory,
  type KnowledgeCommand,
  type WorkItemPageSource,
} from "@lictory/core/contracts/protocol";
import { rankBetween } from "@lictory/core/contracts/rank";
import { DomainError } from "@lictory/core/domain/errors";
import type { Tx } from "@lictory/core/domain/service";
import { pageAccess, type SpaceActor } from "@lictory/core/spaces/access";
import { writeSpaceProjections } from "@lictory/core/spaces/projections";
import type { PageNode } from "@lictory/core/spaces/document/canonical";
import { quoteOccursIn } from "@lictory/core/spaces/source-quote";

// Knowledge link commands (docs/internals/knowledge-links.md), applied by
// `applyMutation` inside its transaction after the organization lock, the
// membership check and the receipt lookup. Each one needs two independent
// permissions: the Work side's (a discipline capability, or project
// administration) and reading the page. Someone who cannot read the page
// gets the same "unavailable" answer as for a page that does not exist.
// Links grant nothing: attaching a page never lets an item's readers read
// it. The commands record page activity (visible to the page's readers)
// rather than work item activity, which every organization member reads and
// would reveal that a restricted page exists.

export type KnowledgeCommandContext = {
  organizationId: string;
  userId: string;
  admin: boolean;
  roster: Directory;
  delegation?: Record<string, string | null>;
};

const unavailablePage = () =>
  new DomainError("not_found", "This page is unavailable.");
const fail = (
  message: string,
  category: DomainError["category"] = "validation",
): never => {
  throw new DomainError(category, message);
};

// The page as the actor may read it, active. Readers of an archived page
// learn why; everyone else gets not found.
async function readablePage(tx: Tx, actor: SpaceActor, pageId: string) {
  const row = await pageAccess(tx, actor, pageId);
  if (!row?.level) throw unavailablePage();
  if (row.page.archivedAt || row.space.archivedAt)
    fail("Restore this page before linking it.", "conflict");
  return row;
}

async function commitOfPage(
  tx: Tx,
  organizationId: string,
  pageId: string,
  commitId: string,
) {
  const [commit] = await tx
    .select({ id: s.pageCommit.id, content: s.pageCommit.content })
    .from(s.pageCommit)
    .where(
      and(
        eq(s.pageCommit.organizationId, organizationId),
        eq(s.pageCommit.pageId, pageId),
        eq(s.pageCommit.id, commitId),
      ),
    );
  if (!commit)
    throw new DomainError(
      "not_found",
      "That version of the page is unavailable.",
    );
  return commit;
}

async function activeItem(tx: Tx, organizationId: string, workItemId: string) {
  const [item] = await tx
    .select({
      id: s.workItem.id,
      projectId: s.workItem.projectId,
      archivedAt: s.workItem.archivedAt,
      projectArchivedAt: s.project.archivedAt,
    })
    .from(s.workItem)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.workItem.organizationId),
        eq(s.project.id, s.workItem.projectId),
      ),
    )
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.id, workItemId),
      ),
    );
  if (!item || item.projectArchivedAt)
    throw new DomainError("not_found", "This work item is unavailable.");
  if (item.archivedAt)
    fail("Restore this item before changing it.", "conflict");
  return item;
}

// Attaching pages to an item shapes how it is delivered, like its labels or
// epic: the same discipline capability (`changeProperties`).
function requireItemProperties(
  ctx: KnowledgeCommandContext,
  projectId: string,
) {
  if (
    !capabilitiesOf(ctx.roster.disciplines, ctx.userId, projectId)
      .changeProperties
  )
    fail(
      "Your disciplines in this project cannot change item properties, which attaching and detaching pages needs.",
      "forbidden",
    );
}

// Context pages are what a project's boards, backlogs and iterations show
// their people: project administrators manage them, and so do members whose
// discipline changes item properties (the people who plan iterations and
// shape the backlog).
function requireContextManager(
  ctx: KnowledgeCommandContext,
  projectId: string,
) {
  if (
    !canManageProject(ctx.roster, ctx.userId, ctx.admin, projectId) &&
    !capabilitiesOf(ctx.roster.disciplines, ctx.userId, projectId)
      .changeProperties
  )
    fail(
      "Project administrators and members whose discipline can change item properties manage this project's context pages.",
      "forbidden",
    );
}

async function activeProject(
  tx: Tx,
  organizationId: string,
  projectId: string,
) {
  const [project] = await tx
    .select({ id: s.project.id })
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, organizationId),
        eq(s.project.id, projectId),
        isNull(s.project.archivedAt),
      ),
    );
  if (!project)
    throw new DomainError("not_found", "This project is unavailable.");
}

type LinkRow = typeof s.pageContextLink.$inferSelect;

async function activeLinks(
  tx: Tx,
  organizationId: string,
  scope: {
    projectId: string;
    teamId: string | null;
    iterationId: string | null;
  },
) {
  return tx
    .select()
    .from(s.pageContextLink)
    .where(
      and(
        eq(s.pageContextLink.organizationId, organizationId),
        eq(s.pageContextLink.projectId, scope.projectId),
        scope.teamId
          ? eq(s.pageContextLink.teamId, scope.teamId)
          : isNull(s.pageContextLink.teamId),
        scope.iterationId
          ? eq(s.pageContextLink.iterationId, scope.iterationId)
          : isNull(s.pageContextLink.iterationId),
        isNull(s.pageContextLink.removedAt),
      ),
    );
}

// A rank strictly between the chosen neighbours (both omitted: last), as
// for pages. Neighbours must be links of the same scope.
function rankAmong(
  links: LinkRow[],
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
) {
  const neighbour = (id: string | null | undefined) => {
    if (!id) return null;
    const link = links.find((l) => l.id === id);
    if (!link)
      fail("Place the page next to another context page of the same list.");
    return link!.rank;
  };
  let low = neighbour(afterId);
  const high = neighbour(beforeId);
  if (low !== null && high !== null && low >= high)
    fail("Place the page between neighbours that are already in order.");
  if (!afterId && !beforeId)
    low =
      links
        .map((l) => l.rank)
        .sort()
        .at(-1) ?? null;
  const occupied = new Set(links.map((l) => l.rank));
  let rank = rankBetween(low, high);
  while (occupied.has(rank)) rank = rankBetween(rank, high);
  return rank;
}

async function contextLink(
  tx: Tx,
  ctx: KnowledgeCommandContext,
  projectId: string,
  linkId: string,
) {
  const [link] = await tx
    .select()
    .from(s.pageContextLink)
    .where(
      and(
        eq(s.pageContextLink.organizationId, ctx.organizationId),
        eq(s.pageContextLink.projectId, projectId),
        eq(s.pageContextLink.id, linkId),
      ),
    );
  const unavailable = () =>
    new DomainError("not_found", "This context page is unavailable.");
  if (!link) throw unavailable();
  // A link to a page the actor cannot read is not theirs to see.
  const row = await pageAccess(
    tx,
    { organizationId: ctx.organizationId, userId: ctx.userId },
    link.pageId,
  );
  if (!row?.level) throw unavailable();
  return link;
}

export async function applyKnowledgeCommand(
  tx: Tx,
  ctx: KnowledgeCommandContext,
  c: KnowledgeCommand,
): Promise<Record<string, string> | undefined> {
  const { organizationId, userId } = ctx;
  const actor: SpaceActor = { organizationId, userId };
  const now = new Date();
  const record = (
    pageId: string,
    action: string,
    detail: Record<string, unknown>,
  ) =>
    tx.insert(s.pageActivity).values({
      organizationId,
      pageId,
      actorId: userId,
      action,
      detail: { ...detail, ...ctx.delegation },
      createdAt: now,
    });
  const project = (pageIds: string[]) =>
    writeSpaceProjections(tx, organizationId, {
      knowledge: pageIds,
      pageDiscussions: pageIds,
    });

  switch (c.type) {
    case "attachPage": {
      const item = await activeItem(tx, organizationId, c.workItemId);
      await readablePage(tx, actor, c.pageId);
      requireItemProperties(ctx, item.projectId);
      const commitId = c.commitId ?? null;
      if (commitId) await commitOfPage(tx, organizationId, c.pageId, commitId);
      const [taken] = await tx
        .select({ id: s.workItemPageAttachment.id })
        .from(s.workItemPageAttachment)
        .where(eq(s.workItemPageAttachment.id, c.attachmentId));
      if (taken)
        fail(
          "This attachment id is already used. Retry with a new id.",
          "conflict",
        );
      const [current] = await tx
        .select()
        .from(s.workItemPageAttachment)
        .where(
          and(
            eq(s.workItemPageAttachment.organizationId, organizationId),
            eq(s.workItemPageAttachment.workItemId, item.id),
            eq(s.workItemPageAttachment.pageId, c.pageId),
            isNull(s.workItemPageAttachment.detachedAt),
          ),
        );
      if (current?.purpose === c.purpose && current.commitId === commitId)
        fail("Nothing to change: the page is already attached this way.");
      if (current) {
        await tx
          .update(s.workItemPageAttachment)
          .set({ detachedAt: now, detachedById: userId })
          .where(
            and(
              eq(s.workItemPageAttachment.organizationId, organizationId),
              eq(s.workItemPageAttachment.id, current.id),
            ),
          );
        await record(c.pageId, "page_detached", {
          attachmentId: current.id,
          workItemId: item.id,
          replacedBy: c.attachmentId,
        });
      }
      await tx.insert(s.workItemPageAttachment).values({
        id: c.attachmentId,
        organizationId,
        workItemId: item.id,
        pageId: c.pageId,
        purpose: c.purpose,
        commitId,
        createdById: userId,
        createdAt: now,
      });
      await record(c.pageId, "page_attached", {
        attachmentId: c.attachmentId,
        workItemId: item.id,
        purpose: c.purpose,
        commitId,
      });
      await project([c.pageId]);
      return {
        attachmentId: c.attachmentId,
        ...(current ? { replacedAttachmentId: current.id } : {}),
      };
    }

    case "detachPage": {
      const [attachment] = await tx
        .select()
        .from(s.workItemPageAttachment)
        .where(
          and(
            eq(s.workItemPageAttachment.organizationId, organizationId),
            eq(s.workItemPageAttachment.workItemId, c.workItemId),
            eq(s.workItemPageAttachment.id, c.attachmentId),
          ),
        );
      const unavailable = () =>
        new DomainError("not_found", "This attachment is unavailable.");
      if (!attachment) throw unavailable();
      const row = await pageAccess(tx, actor, attachment.pageId);
      if (!row?.level) throw unavailable();
      const item = await activeItem(tx, organizationId, c.workItemId);
      requireItemProperties(ctx, item.projectId);
      if (attachment.detachedAt) return undefined;
      await tx
        .update(s.workItemPageAttachment)
        .set({ detachedAt: now, detachedById: userId })
        .where(
          and(
            eq(s.workItemPageAttachment.organizationId, organizationId),
            eq(s.workItemPageAttachment.id, attachment.id),
          ),
        );
      await record(attachment.pageId, "page_detached", {
        attachmentId: attachment.id,
        workItemId: attachment.workItemId,
      });
      await project([attachment.pageId]);
      return undefined;
    }

    case "linkContextPage": {
      await activeProject(tx, organizationId, c.projectId);
      requireContextManager(ctx, c.projectId);
      const teamId = c.teamId ?? null;
      const iterationId = c.iterationId ?? null;
      if (teamId && iterationId)
        fail(
          "Link a context page to the project, a team or an iteration, not both.",
        );
      if (
        teamId &&
        !ctx.roster.teams.some(
          (t) =>
            t.id === teamId && t.projectId === c.projectId && !t.archivedAt,
        )
      )
        throw new DomainError(
          "not_found",
          "The team is unavailable in this project.",
        );
      // Completed iterations keep context too: retrospectives come after.
      if (
        iterationId &&
        !ctx.roster.iterations.some(
          (i) => i.id === iterationId && i.projectId === c.projectId,
        )
      )
        throw new DomainError(
          "not_found",
          "The iteration is unavailable in this project.",
        );
      await readablePage(tx, actor, c.pageId);
      const [taken] = await tx
        .select({ id: s.pageContextLink.id })
        .from(s.pageContextLink)
        .where(eq(s.pageContextLink.id, c.linkId));
      if (taken)
        fail("This link id is already used. Retry with a new id.", "conflict");
      const scope = { projectId: c.projectId, teamId, iterationId };
      const links = await activeLinks(tx, organizationId, scope);
      if (links.some((l) => l.pageId === c.pageId))
        fail("This page is already a context page here.", "conflict");
      const rank = rankAmong(links, c.afterId, c.beforeId);
      await tx.insert(s.pageContextLink).values({
        id: c.linkId,
        organizationId,
        ...scope,
        pageId: c.pageId,
        rank,
        createdById: userId,
        createdAt: now,
      });
      await record(c.pageId, "context_page_linked", {
        linkId: c.linkId,
        ...scope,
      });
      await project([c.pageId]);
      return { linkId: c.linkId };
    }

    case "unlinkContextPage": {
      const link = await contextLink(tx, ctx, c.projectId, c.linkId);
      requireContextManager(ctx, c.projectId);
      if (link.removedAt) return undefined;
      await tx
        .update(s.pageContextLink)
        .set({ removedAt: now, removedById: userId })
        .where(
          and(
            eq(s.pageContextLink.organizationId, organizationId),
            eq(s.pageContextLink.id, link.id),
          ),
        );
      await record(link.pageId, "context_page_unlinked", {
        linkId: link.id,
        projectId: link.projectId,
        teamId: link.teamId,
        iterationId: link.iterationId,
      });
      await project([link.pageId]);
      return undefined;
    }

    case "moveContextPage": {
      const link = await contextLink(tx, ctx, c.projectId, c.linkId);
      requireContextManager(ctx, c.projectId);
      if (link.removedAt)
        fail("This page is no longer a context page here.", "conflict");
      if (c.afterId === link.id || c.beforeId === link.id)
        fail("A context page cannot be its own neighbour.");
      const siblings = (await activeLinks(tx, organizationId, link)).filter(
        (l) => l.id !== link.id,
      );
      const rank = rankAmong(siblings, c.afterId, c.beforeId);
      await tx
        .update(s.pageContextLink)
        .set({ rank })
        .where(
          and(
            eq(s.pageContextLink.organizationId, organizationId),
            eq(s.pageContextLink.id, link.id),
          ),
        );
      await writeSpaceProjections(tx, organizationId, {
        knowledge: [link.pageId],
      });
      return undefined;
    }
  }
}

/**
 * Records where a new work item came from (`createWorkItem` with `source`),
 * in its creation transaction: the actor must read the page's space, the
 * commit must belong to the page, the block, when named, must be one of
 * the commit's top-level blocks and the quote, when given, must be that
 * commit's text. Written once; never changed.
 */
export async function recordWorkItemSource(
  tx: Tx,
  actor: SpaceActor,
  workItemId: string,
  source: WorkItemPageSource,
) {
  const row = await pageAccess(tx, actor, source.pageId);
  if (!row?.level) throw unavailablePage();
  const commit = await commitOfPage(
    tx,
    actor.organizationId,
    source.pageId,
    source.commitId,
  );
  const blockId = source.blockId ?? null;
  const content = commit.content as PageNode;
  if (blockId && !(content.content ?? []).some((b) => b.attrs?.id === blockId))
    throw new DomainError(
      "validation",
      "The quoted block is not part of that version of the page.",
    );
  // The quote is evidence of what the page said: it must be that version's
  // text, starting in the named block (source-quote.ts).
  if (source.quote && !quoteOccursIn(content, source.quote, blockId))
    throw new DomainError(
      "validation",
      blockId
        ? "The quote is not the text of that block in that version of the page. Quote the page's words exactly, starting in that block, or leave the quote out."
        : "The quote is not text of that version of the page. Quote the page's words exactly, or leave the quote out.",
    );
  await tx.insert(s.workItemPageSource).values({
    organizationId: actor.organizationId,
    workItemId,
    pageId: source.pageId,
    commitId: source.commitId,
    blockId,
    quote: source.quote ?? null,
    createdById: actor.userId,
  });
  await tx.insert(s.pageActivity).values({
    organizationId: actor.organizationId,
    pageId: source.pageId,
    actorId: actor.userId,
    action: "work_item_created_from_page",
    detail: { workItemId, commitId: source.commitId, blockId },
  });
  await writeSpaceProjections(tx, actor.organizationId, {
    knowledge: [source.pageId],
    pageDiscussions: [source.pageId],
  });
}
