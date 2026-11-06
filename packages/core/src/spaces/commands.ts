import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  isPageDiscussionCommand,
  isPageHistoryCommand,
  spaceLevelAtLeast,
  type Directory,
  type SpaceAccessLevel,
  type SpaceCommand,
} from "@lictory/core/contracts/protocol";
import { rankBetween } from "@lictory/core/contracts/rank";
import { DomainError } from "@lictory/core/domain/errors";
import type { Tx } from "@lictory/core/domain/service";
import {
  canManageSpaceAccess,
  pageAccess,
  refreshSpaceAccess,
  spaceAccess,
  type SpaceActor,
} from "@lictory/core/spaces/access";
import { applyPageDiscussionCommand } from "@lictory/core/spaces/discussions";
import {
  documentHash,
  documentToMarkdown,
  emptyDocument,
  PAGE_SCHEMA_VERSION,
} from "@lictory/core/spaces/document";
import {
  applyPageHistoryCommand,
  openLineDraft,
} from "@lictory/core/spaces/history";
import {
  writeSpaceProjections,
  type SpaceProjectionTarget,
} from "@lictory/core/spaces/projections";

// Lictory Spaces commands, applied by `applyMutation`
// (packages/core/src/domain/service.ts) inside its transaction: after the
// organization lock, the membership check and the idempotency receipt
// lookup. Each handler authorizes in domain language, writes the domain rows,
// recomputes effective access when its inputs changed, records access,
// home and publishing changes in `configuration_audit` (identifiers only)
// and rewrites the Spaces projections it touched. None of them changes
// `sync_entity` or the directory.

export type SpaceCommandContext = {
  organizationId: string;
  userId: string;
  roster: Directory;
  // How the command arrived when not from the web (surface and agent),
  // recorded with page activity like work item activity.
  delegation?: Record<string, string | null>;
};

// What a command created, kept in the mutation receipt so a retry returns
// the same identifiers.
export type SpaceCommandSummary = Record<string, string>;

const fail = (
  message: string,
  category: DomainError["category"] = "validation",
): never => {
  throw new DomainError(category, message);
};

// The first commit of a new page: its title and the engine's canonical
// empty document.
export function initialPageCommit(title: string) {
  const content = emptyDocument();
  return {
    title,
    content: content as unknown as Record<string, unknown>,
    markdown: documentToMarkdown(content),
    schemaVersion: PAGE_SCHEMA_VERSION,
    hash: documentHash(title, content),
  };
}

const unavailableSpace = () =>
  new DomainError("not_found", "This space is unavailable.");
const unavailablePage = () =>
  new DomainError("not_found", "This page is unavailable.");

// The space as the actor may see it. People without access get not found,
// so restricted spaces do not reveal that they exist.
async function readableSpace(tx: Tx, actor: SpaceActor, spaceId: string) {
  const row = await spaceAccess(tx, actor, spaceId);
  if (!row?.level) throw unavailableSpace();
  return { space: row.space, level: row.level };
}

function requireEdit(level: SpaceAccessLevel, name: string) {
  if (!spaceLevelAtLeast(level, "edit"))
    fail(`You can view ${name} but not edit it.`, "forbidden");
}

async function requireManager(tx: Tx, actor: SpaceActor, spaceId: string) {
  const row = await spaceAccess(tx, actor, spaceId);
  if (!row) throw unavailableSpace();
  if (!(await canManageSpaceAccess(tx, actor, spaceId))) {
    // Readers learn why; everyone else cannot tell the space exists.
    if (!row.level) throw unavailableSpace();
    fail(
      `Only ${row.space.name}'s administrators (its creator, organization administrators and its project's administrators) can change its access, home, publishing or archive state.`,
      "forbidden",
    );
  }
  return row;
}

function requireActiveSpace(space: { name: string; archivedAt: Date | null }) {
  if (space.archivedAt)
    fail(`Restore ${space.name} before changing it.`, "conflict");
}

type Home = { projectId: string | null; teamId: string | null };

// A home must be an active project, or an active team of that project.
function resolveHome(
  roster: Directory,
  home: { projectId?: string; teamId?: string } | undefined,
): Home {
  if (!home?.projectId) return { projectId: null, teamId: null };
  const project = roster.projects.find((p) => p.id === home.projectId);
  if (!project)
    throw new DomainError("not_found", "This project is unavailable.");
  if (project.archivedAt)
    fail(`Restore ${project.name} before adding spaces to it.`, "conflict");
  if (!home.teamId) return { projectId: project.id, teamId: null };
  const team = roster.teams.find(
    (t) => t.id === home.teamId && t.projectId === project.id,
  );
  if (!team)
    throw new DomainError(
      "not_found",
      `This team is unavailable in ${project.name}.`,
    );
  if (team.archivedAt)
    fail(
      `Restore the ${team.name} team before adding spaces to it.`,
      "conflict",
    );
  return { projectId: project.id, teamId: team.id };
}

async function requireFreeSlug(
  tx: Tx,
  organizationId: string,
  slug: string,
  exceptId?: string,
) {
  const [taken] = await tx
    .select({ id: s.space.id, name: s.space.name })
    .from(s.space)
    .where(
      and(
        eq(s.space.organizationId, organizationId),
        isNull(s.space.archivedAt),
        sql`lower(${s.space.slug}) = ${slug.toLowerCase()}`,
        exceptId ? ne(s.space.id, exceptId) : undefined,
      ),
    );
  if (taken)
    fail(
      `Another space already uses the handle “${slug}”. Choose a different one.`,
      "conflict",
    );
}

// Configuration audit for Spaces, shaped like `auditConfiguration`'s
// entries ({ command, previous }) so the audit log names the people, project
// and space involved. Identifiers and settings only: never names,
// descriptions or page content.
async function audit(
  tx: Tx,
  ctx: SpaceCommandContext,
  command: { type: SpaceCommand["type"]; spaceId: string } & Record<
    string,
    unknown
  >,
  extra: Record<string, unknown> = {},
) {
  await tx.insert(s.configurationAudit).values({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: command.type,
    detail: { command, ...extra },
  });
}

async function grantOf(
  tx: Tx,
  organizationId: string,
  spaceId: string,
  userId: string,
) {
  const [grant] = await tx
    .select({ level: s.spaceGrant.level })
    .from(s.spaceGrant)
    .where(
      and(
        eq(s.spaceGrant.organizationId, organizationId),
        eq(s.spaceGrant.spaceId, spaceId),
        eq(s.spaceGrant.userId, userId),
      ),
    );
  return grant?.level ?? null;
}

async function setGrant(
  tx: Tx,
  ctx: SpaceCommandContext,
  spaceId: string,
  userId: string,
  level: SpaceAccessLevel | null,
) {
  if (level === null) {
    await tx
      .delete(s.spaceGrant)
      .where(
        and(
          eq(s.spaceGrant.organizationId, ctx.organizationId),
          eq(s.spaceGrant.spaceId, spaceId),
          eq(s.spaceGrant.userId, userId),
        ),
      );
    return;
  }
  await tx
    .insert(s.spaceGrant)
    .values({
      organizationId: ctx.organizationId,
      spaceId,
      userId,
      level,
      grantedById: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [s.spaceGrant.spaceId, s.spaceGrant.userId],
      set: { level, grantedById: ctx.userId, updatedAt: new Date() },
      setWhere: eq(s.spaceGrant.organizationId, ctx.organizationId),
    });
}

// ------------------------------------------------------------- page tree

type PageRow = typeof s.page.$inferSelect;

async function pagesOfSpace(tx: Tx, organizationId: string, spaceId: string) {
  return tx
    .select()
    .from(s.page)
    .where(
      and(
        eq(s.page.organizationId, organizationId),
        eq(s.page.spaceId, spaceId),
      ),
    );
}

// A rank strictly between the chosen siblings (both omitted: after the last
// sibling). Stale or filtered neighbours can leave other siblings inside the
// interval; an occupied rank is never reused.
function rankAmong(
  siblings: PageRow[],
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
) {
  const neighbour = (id: string | null | undefined) => {
    if (!id) return null;
    const sibling = siblings.find((p) => p.id === id);
    if (!sibling) fail("Place the page next to a page under the same parent.");
    return sibling!.rank;
  };
  let low = neighbour(afterId);
  const high = neighbour(beforeId);
  if (low !== null && high !== null && low >= high)
    fail("Place the page between neighbours that are already in order.");
  if (!afterId && !beforeId)
    low =
      siblings
        .map((p) => p.rank)
        .sort()
        .at(-1) ?? null;
  const occupied = new Set(siblings.map((p) => p.rank));
  let rank = rankBetween(low, high);
  while (occupied.has(rank)) rank = rankBetween(rank, high);
  return rank;
}

// Ids of the page and every descendant.
async function subtree(tx: Tx, organizationId: string, pageId: string) {
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive tree as (
      select id from page where organization_id = ${organizationId} and id = ${pageId}
      union all
      select p.id from page p join tree t on p.parent_id = t.id
      where p.organization_id = ${organizationId}
    )
    select id from tree`);
  return rows.map((r) => r.id);
}

async function requireNewId(tx: Tx, table: "page" | "space", id: string) {
  const [existing] =
    table === "page"
      ? await tx.select({ id: s.page.id }).from(s.page).where(eq(s.page.id, id))
      : await tx
          .select({ id: s.space.id })
          .from(s.space)
          .where(eq(s.space.id, id));
  if (existing)
    fail(`This ${table} id is already used. Retry with a new id.`, "conflict");
}

// Main branches of a space's pages with their drafts.
async function mainLines(tx: Tx, organizationId: string, spaceId: string) {
  return tx
    .select({
      pageId: s.page.id,
      archivedAt: s.page.archivedAt,
      branchId: s.pageBranch.id,
      headCommitId: s.pageBranch.headCommitId,
      draft: s.spaceDraft,
    })
    .from(s.page)
    .innerJoin(
      s.pageBranch,
      and(
        eq(s.pageBranch.organizationId, s.page.organizationId),
        eq(s.pageBranch.pageId, s.page.id),
        eq(s.pageBranch.isMain, true),
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
        eq(s.page.spaceId, spaceId),
      ),
    );
}

// Direct → Reviewed closes main's drafts (refused while one holds unpublished
// changes); Reviewed → Direct opens them again at main's head, as a new epoch.
async function changePublishing(
  tx: Tx,
  organizationId: string,
  spaceId: string,
  publishing: "direct" | "reviewed",
) {
  const lines = await mainLines(tx, organizationId, spaceId);
  if (publishing === "reviewed") {
    const unpublished = lines.filter(
      (l) =>
        l.draft &&
        !l.draft.fencedAt &&
        l.draft.sequence > l.draft.committedSequence,
    );
    if (unpublished.length)
      fail(
        `${unpublished.length === 1 ? "One page has" : `${unpublished.length} pages have`} unpublished changes. Publish or discard them before requiring reviews.`,
        "conflict",
      );
    const open = lines.flatMap((l) =>
      l.draft && !l.draft.fencedAt ? [l.draft.id] : [],
    );
    if (open.length)
      await tx
        .update(s.spaceDraft)
        .set({ fencedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(s.spaceDraft.organizationId, organizationId),
            inArray(s.spaceDraft.id, open),
          ),
        );
    return;
  }
  // Seeded from main's head, so editors start from the published content.
  for (const line of lines)
    await openLineDraft(
      tx,
      organizationId,
      line.pageId,
      line.branchId,
      line.headCommitId,
    );
}

async function requirePageForEdit(tx: Tx, actor: SpaceActor, pageId: string) {
  const row = await pageAccess(tx, actor, pageId);
  if (!row?.level) throw unavailablePage();
  requireEdit(row.level, row.space.name);
  requireActiveSpace(row.space);
  return { page: row.page, space: row.space };
}

// ---------------------------------------------------------------- commands

export async function applySpaceCommand(
  tx: Tx,
  ctx: SpaceCommandContext,
  c: SpaceCommand,
): Promise<SpaceCommandSummary | undefined> {
  if (isPageDiscussionCommand(c)) return applyPageDiscussionCommand(tx, ctx, c);
  if (isPageHistoryCommand(c)) return applyPageHistoryCommand(tx, ctx, c);
  const { organizationId, userId, roster } = ctx;
  const actor: SpaceActor = { organizationId, userId };
  const now = new Date();
  const project = async (target: SpaceProjectionTarget) =>
    writeSpaceProjections(tx, organizationId, target);

  switch (c.type) {
    case "createSpace": {
      await requireNewId(tx, "space", c.spaceId);
      const home = resolveHome(roster, c.home);
      await requireFreeSlug(tx, organizationId, c.slug);
      const accessMode = c.accessMode ?? "inherited";
      const publishing = c.publishing ?? "direct";
      await tx.insert(s.space).values({
        id: c.spaceId,
        organizationId,
        name: c.name,
        slug: c.slug,
        description: c.description?.trim() ? c.description.trim() : null,
        icon: c.icon ?? null,
        ...home,
        accessMode,
        publishing,
        createdById: userId,
      });
      // A restricted space is never created unreadable by its creator.
      const creatorGrant = accessMode === "restricted";
      if (creatorGrant) await setGrant(tx, ctx, c.spaceId, userId, "edit");
      await audit(
        tx,
        ctx,
        { type: c.type, spaceId: c.spaceId, ...home, accessMode, publishing },
        creatorGrant ? { creatorGrant: "edit" } : {},
      );
      await refreshSpaceAccess(tx, organizationId, { spaceIds: [c.spaceId] });
      await project({ spaces: [c.spaceId] });
      return { spaceId: c.spaceId };
    }

    case "updateSpace": {
      // Reading comes first, whatever the command carries: people who
      // cannot read the space learn nothing (not even its name or archive
      // state), exactly as for a space that does not exist.
      const { space, level } = await readableSpace(tx, actor, c.spaceId);
      const description =
        c.description === undefined
          ? undefined
          : c.description?.trim()
            ? c.description.trim()
            : null;
      // Name, handle, description and icon are editors'; home and
      // publishing are administrators'.
      if (
        c.name !== undefined ||
        c.slug !== undefined ||
        c.description !== undefined ||
        c.icon !== undefined
      )
        requireEdit(level, space.name);
      const homeChanged =
        c.home !== undefined &&
        ((c.home.projectId ?? null) !== space.projectId ||
          (c.home.teamId ?? null) !== space.teamId);
      const publishingChanged =
        c.publishing !== undefined && c.publishing !== space.publishing;
      if (c.home !== undefined || c.publishing !== undefined)
        await requireManager(tx, actor, c.spaceId);
      const details = {
        ...(c.name !== undefined && c.name !== space.name
          ? { name: c.name }
          : {}),
        ...(c.slug !== undefined && c.slug !== space.slug
          ? { slug: c.slug }
          : {}),
        ...(description !== undefined && description !== space.description
          ? { description }
          : {}),
        ...(c.icon !== undefined && c.icon !== space.icon
          ? { icon: c.icon }
          : {}),
      };
      requireActiveSpace(space);
      if (!homeChanged && !publishingChanged && !Object.keys(details).length)
        fail(
          "Nothing to change: the space already has these details and settings.",
        );
      // Only a new home is validated: a space may stay in a project that
      // was archived after it was created.
      const home = homeChanged ? resolveHome(roster, c.home) : undefined;
      if (details.slug !== undefined)
        await requireFreeSlug(tx, organizationId, details.slug, space.id);
      if (publishingChanged)
        await changePublishing(tx, organizationId, space.id, c.publishing!);
      await tx
        .update(s.space)
        .set({
          ...details,
          ...(homeChanged ? home : {}),
          ...(publishingChanged ? { publishing: c.publishing } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(s.space.organizationId, organizationId),
            eq(s.space.id, space.id),
          ),
        );
      if (homeChanged || publishingChanged)
        await audit(
          tx,
          ctx,
          {
            type: c.type,
            spaceId: space.id,
            ...(homeChanged ? { home } : {}),
            ...(publishingChanged ? { publishing: c.publishing } : {}),
          },
          {
            previous: {
              ...(homeChanged
                ? { home: { projectId: space.projectId, teamId: space.teamId } }
                : {}),
              ...(publishingChanged ? { publishing: space.publishing } : {}),
            },
          },
        );
      if (homeChanged)
        await refreshSpaceAccess(tx, organizationId, { spaceIds: [space.id] });
      // The policy decides main's draft, the "Approved" label and the
      // review gates of pull requests into main.
      const pageIds = publishingChanged
        ? (await pagesOfSpace(tx, organizationId, space.id)).map((p) => p.id)
        : [];
      await project({
        spaces: [space.id],
        ...(pageIds.length ? { pages: pageIds, pageLines: pageIds } : {}),
      });
      return undefined;
    }

    case "setSpaceAccessMode": {
      const { space } = await requireManager(tx, actor, c.spaceId);
      if (space.accessMode === c.accessMode) return undefined;
      // Whoever restricts a space keeps reading it: they receive an edit
      // grant unless they already hold one.
      const actorGrant = await grantOf(tx, organizationId, space.id, userId);
      const grantSelf = c.accessMode === "restricted" && actorGrant !== "edit";
      if (grantSelf) await setGrant(tx, ctx, space.id, userId, "edit");
      await tx
        .update(s.space)
        .set({ accessMode: c.accessMode, updatedAt: now })
        .where(
          and(
            eq(s.space.organizationId, organizationId),
            eq(s.space.id, space.id),
          ),
        );
      await audit(
        tx,
        ctx,
        { type: c.type, spaceId: space.id, accessMode: c.accessMode },
        {
          previous: { accessMode: space.accessMode },
          ...(grantSelf
            ? { selfGrant: { level: "edit", previous: actorGrant } }
            : {}),
        },
      );
      await refreshSpaceAccess(tx, organizationId, { spaceIds: [space.id] });
      await project({ spaces: [space.id] });
      return undefined;
    }

    case "setSpaceGrant": {
      const { space } = await requireManager(tx, actor, c.spaceId);
      if (c.level !== null && !roster.members.some((m) => m.id === c.userId))
        throw new DomainError(
          "not_found",
          "That person is not a member of this organization.",
        );
      const previous = await grantOf(tx, organizationId, space.id, c.userId);
      if (previous === c.level) return undefined;
      await setGrant(tx, ctx, space.id, c.userId, c.level);
      // Granting oneself access is how an administrator reads a restricted
      // space; the audit entry says so.
      await audit(
        tx,
        ctx,
        { type: c.type, spaceId: space.id, userId: c.userId, level: c.level },
        {
          previous: { level: previous },
          accessMode: space.accessMode,
          ...(c.userId === userId ? { selfGrant: true } : {}),
        },
      );
      await refreshSpaceAccess(tx, organizationId, {
        spaceIds: [space.id],
        userIds: [c.userId],
      });
      await project({ spaces: [space.id] });
      return undefined;
    }

    case "archiveSpace": {
      const { space } = await requireManager(tx, actor, c.spaceId);
      if (Boolean(space.archivedAt) === c.archived) return undefined;
      if (!c.archived)
        await requireFreeSlug(tx, organizationId, space.slug, space.id);
      await tx
        .update(s.space)
        .set({
          archivedAt: c.archived ? now : null,
          archivedById: c.archived ? userId : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.space.organizationId, organizationId),
            eq(s.space.id, space.id),
          ),
        );
      await audit(tx, ctx, {
        type: c.type,
        spaceId: space.id,
        archived: c.archived,
      });
      await project({ spaces: [space.id] });
      return undefined;
    }

    case "createPage": {
      const { space, level } = await readableSpace(tx, actor, c.spaceId);
      requireEdit(level, space.name);
      requireActiveSpace(space);
      await requireNewId(tx, "page", c.pageId);
      const pages = await pagesOfSpace(tx, organizationId, space.id);
      const parentId = c.parentId ?? null;
      if (parentId) {
        const parent = pages.find((p) => p.id === parentId);
        if (!parent)
          throw new DomainError("not_found", "The parent page is unavailable.");
        if (parent.archivedAt)
          fail(
            "Restore the parent page before adding pages under it.",
            "conflict",
          );
      }
      const rank = rankAmong(
        pages.filter((p) => p.parentId === parentId),
        c.afterId,
        c.beforeId,
      );
      await tx.insert(s.page).values({
        id: c.pageId,
        organizationId,
        spaceId: space.id,
        parentId,
        rank,
        createdById: userId,
      });
      const commitId = crypto.randomUUID();
      const initial = initialPageCommit(c.title);
      await tx.insert(s.pageCommit).values({
        id: commitId,
        organizationId,
        pageId: c.pageId,
        parentIds: [],
        title: initial.title,
        content: initial.content,
        markdown: initial.markdown,
        hash: initial.hash,
        schemaVersion: initial.schemaVersion,
        message: null,
        authorId: userId,
        contributorIds: [userId],
      });
      const branchId = crypto.randomUUID();
      await tx.insert(s.pageBranch).values({
        id: branchId,
        organizationId,
        pageId: c.pageId,
        name: "main",
        isMain: true,
        headCommitId: commitId,
        baseCommitId: null,
        authorId: userId,
      });
      // Reviewed spaces protect main: it has no writable draft.
      const draftId =
        space.publishing === "direct"
          ? (
              await openLineDraft(
                tx,
                organizationId,
                c.pageId,
                branchId,
                commitId,
              )
            ).id
          : undefined;
      await project({
        pages: [c.pageId],
        pageLines: [c.pageId],
        commits: [commitId],
      });
      return {
        pageId: c.pageId,
        mainBranchId: branchId,
        commitId,
        ...(draftId ? { draftId } : {}),
      };
    }

    case "movePage": {
      const { page } = await requirePageForEdit(tx, actor, c.pageId);
      if (page.archivedAt)
        fail("Restore this page before moving it.", "conflict");
      if (c.parentId) {
        const [parent] = await tx
          .select()
          .from(s.page)
          .where(
            and(
              eq(s.page.organizationId, organizationId),
              eq(s.page.id, c.parentId),
            ),
          );
        // A page of another space reads like a missing one: whether it
        // exists is not this space's business.
        if (parent?.spaceId !== page.spaceId)
          throw new DomainError(
            "not_found",
            "The new parent page is unavailable in this space. Pages move only within their space.",
          );
        if (parent.archivedAt)
          fail(
            "Restore the new parent page before moving pages under it.",
            "conflict",
          );
        if ((await subtree(tx, organizationId, page.id)).includes(parent.id))
          fail("A page cannot move under itself or one of its own subpages.");
      }
      const siblings = (
        await pagesOfSpace(tx, organizationId, page.spaceId)
      ).filter((p) => p.parentId === c.parentId && p.id !== page.id);
      if (c.afterId === page.id || c.beforeId === page.id)
        fail("A page cannot be its own neighbour.");
      const rank = rankAmong(siblings, c.afterId, c.beforeId);
      await tx
        .update(s.page)
        .set({ parentId: c.parentId, rank })
        .where(
          and(
            eq(s.page.organizationId, organizationId),
            eq(s.page.id, page.id),
          ),
        );
      await project({ pages: [page.id] });
      return undefined;
    }

    case "archivePage": {
      const { page } = await requirePageForEdit(tx, actor, c.pageId);
      if (Boolean(page.archivedAt) === c.archived) return undefined;
      const ids = await subtree(tx, organizationId, page.id);
      if (c.archived) {
        // Descendants archived earlier keep their own archive time, so
        // restoring this page later leaves them archived.
        const changed = await tx
          .update(s.page)
          .set({ archivedAt: now, archivedById: userId })
          .where(
            and(
              eq(s.page.organizationId, organizationId),
              inArray(s.page.id, ids),
              isNull(s.page.archivedAt),
            ),
          )
          .returning({ id: s.page.id });
        await project({ pages: changed.map((p) => p.id) });
        return undefined;
      }
      if (page.parentId) {
        const [parent] = await tx
          .select({ archivedAt: s.page.archivedAt })
          .from(s.page)
          .where(
            and(
              eq(s.page.organizationId, organizationId),
              eq(s.page.id, page.parentId),
            ),
          );
        if (parent?.archivedAt)
          fail(
            "Its parent page is archived. Restore the parent first, or move this page elsewhere after restoring it.",
            "conflict",
          );
      }
      // Restores what was archived together with this page.
      const changed = await tx
        .update(s.page)
        .set({ archivedAt: null, archivedById: null })
        .where(
          and(
            eq(s.page.organizationId, organizationId),
            inArray(s.page.id, ids),
            eq(s.page.archivedAt, page.archivedAt!),
          ),
        )
        .returning({ id: s.page.id });
      await project({ pages: changed.map((p) => p.id) });
      return undefined;
    }
  }
}
