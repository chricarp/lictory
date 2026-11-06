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
import { pageSummaries } from "@lictory/core/spaces/projections";

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

// A page as published: main's latest commit (title and Markdown). Live
// drafts are never returned.
export async function getPage(
  db: Database,
  userId: string,
  organizationId: string,
  pageId: string,
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const found = await pageAccess(tx, { organizationId, userId }, pageId);
    if (!found?.level) throw unavailablePage();
    const [published] = await tx
      .select({ commit: s.pageCommit })
      .from(s.pageBranch)
      .innerJoin(
        s.pageCommit,
        and(
          eq(s.pageCommit.organizationId, s.pageBranch.organizationId),
          eq(s.pageCommit.pageId, s.pageBranch.pageId),
          eq(s.pageCommit.id, s.pageBranch.headCommitId),
        ),
      )
      .where(
        and(
          eq(s.pageBranch.organizationId, organizationId),
          eq(s.pageBranch.pageId, pageId),
          eq(s.pageBranch.isMain, true),
        ),
      );
    if (!published) throw unavailablePage();
    const { page, space } = found;
    return {
      page: {
        id: page.id,
        spaceId: space.id,
        spaceName: space.name,
        parentId: page.parentId,
        archivedAt: page.archivedAt?.toISOString() ?? null,
      },
      title: published.commit.title,
      markdown: published.commit.markdown,
      commitId: published.commit.id,
      publishedAt: published.commit.createdAt.toISOString(),
      publishedBy: published.commit.authorId,
      level: found.level,
    };
  }, readOnly);
}
