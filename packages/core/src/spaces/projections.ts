import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  spaceEntityKey,
  spaceEntitySchema,
  type SpaceEntity,
} from "@lictory/core/contracts/protocol";
import { canonicalJson } from "@lictory/core/domain/projections";
import type { Database, Tx } from "@lictory/core/domain/service";
import {
  refreshSpaceAccess,
  spaceAccessDrift,
} from "@lictory/core/spaces/access";

// Spaces read projections (`space_entity`), replicated to browsers by Zero
// and kept apart from `sync_entity`. Writers call `writeSpaceProjections` in
// the same transaction as their domain writes, under the organization lock,
// naming what they touched; it recomputes those rows from the domain tables
// and writes only what differs. `rebuildSpaceProjections` reconciles the
// whole organization (operator recovery and the test invariant).
//
// Scopes: rows with a NULL `page_id` are space-level (`space`, `spaceGrant`,
// `page` summaries); `pageCommit` and `pageBranch` rows carry their page.

export type SpaceProjectionRow = {
  key: string;
  organizationId: string;
  spaceId: string;
  pageId: string | null;
  type: SpaceEntity["type"];
  data: Record<string, unknown>;
};

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);

function row(entity: SpaceEntity, pageId: string | null): SpaceProjectionRow {
  const parsed = spaceEntitySchema.parse(entity);
  return {
    key: spaceEntityKey(parsed),
    organizationId: parsed.organizationId,
    spaceId: parsed.type === "space" ? parsed.id : parsed.spaceId,
    pageId,
    type: parsed.type,
    data: parsed,
  };
}

// Space summaries and named grants of the given spaces (all when omitted).
async function spaceRows(
  db: Database | Tx,
  organizationId: string,
  spaceIds?: string[],
) {
  const [spaces, grants] = await Promise.all([
    db
      .select()
      .from(s.space)
      .where(
        and(
          eq(s.space.organizationId, organizationId),
          spaceIds ? inArray(s.space.id, spaceIds) : undefined,
        ),
      ),
    db
      .select()
      .from(s.spaceGrant)
      .where(
        and(
          eq(s.spaceGrant.organizationId, organizationId),
          spaceIds ? inArray(s.spaceGrant.spaceId, spaceIds) : undefined,
        ),
      ),
  ]);
  return [
    ...spaces.map((x) =>
      row(
        {
          id: x.id,
          organizationId,
          type: "space",
          name: x.name,
          slug: x.slug,
          description: x.description,
          icon: x.icon,
          projectId: x.projectId,
          teamId: x.teamId,
          accessMode: x.accessMode,
          publishing: x.publishing,
          createdById: x.createdById,
          createdAt: iso(x.createdAt),
          updatedAt: iso(x.updatedAt),
          archivedAt: isoOrNull(x.archivedAt),
        },
        null,
      ),
    ),
    ...grants.map((g) =>
      row(
        {
          id: `${g.spaceId}:${g.userId}`,
          organizationId,
          spaceId: g.spaceId,
          type: "spaceGrant",
          userId: g.userId,
          level: g.level,
          grantedById: g.grantedById,
          createdAt: iso(g.createdAt),
          updatedAt: iso(g.updatedAt),
        },
        null,
      ),
    ),
  ];
}

// Page tree summaries: each page with the title and commit main publishes.
export async function pageSummaries(
  db: Database | Tx,
  organizationId: string,
  filter: { pageIds?: string[]; spaceIds?: string[] } = {},
) {
  const rows = await db
    .select({
      page: s.page,
      commitId: s.pageCommit.id,
      title: s.pageCommit.title,
      publishedAt: s.pageCommit.createdAt,
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
        eq(s.page.organizationId, organizationId),
        filter.pageIds ? inArray(s.page.id, filter.pageIds) : undefined,
        filter.spaceIds ? inArray(s.page.spaceId, filter.spaceIds) : undefined,
      ),
    );
  return rows.map(({ page, commitId, title, publishedAt }) =>
    row(
      {
        id: page.id,
        organizationId,
        spaceId: page.spaceId,
        type: "page",
        parentId: page.parentId,
        rank: page.rank,
        title,
        publishedCommitId: commitId,
        createdById: page.createdById,
        createdAt: iso(page.createdAt),
        updatedAt: iso(publishedAt),
        archivedAt: isoOrNull(page.archivedAt),
      },
      null,
    ),
  );
}

// A page's history: every commit and every live branch.
async function pageHistoryRows(
  db: Database | Tx,
  organizationId: string,
  pageIds?: string[],
) {
  const [pages, commits, branches, collaborators] = await Promise.all([
    db
      .select({ id: s.page.id, spaceId: s.page.spaceId })
      .from(s.page)
      .where(
        and(
          eq(s.page.organizationId, organizationId),
          pageIds ? inArray(s.page.id, pageIds) : undefined,
        ),
      ),
    db
      .select()
      .from(s.pageCommit)
      .where(
        and(
          eq(s.pageCommit.organizationId, organizationId),
          pageIds ? inArray(s.pageCommit.pageId, pageIds) : undefined,
        ),
      ),
    db
      .select()
      .from(s.pageBranch)
      .where(
        and(
          eq(s.pageBranch.organizationId, organizationId),
          isNull(s.pageBranch.deletedAt),
          pageIds ? inArray(s.pageBranch.pageId, pageIds) : undefined,
        ),
      ),
    db
      .select({
        branchId: s.pageBranchCollaborator.branchId,
        userId: s.pageBranchCollaborator.userId,
      })
      .from(s.pageBranchCollaborator)
      .innerJoin(
        s.pageBranch,
        and(
          eq(
            s.pageBranch.organizationId,
            s.pageBranchCollaborator.organizationId,
          ),
          eq(s.pageBranch.id, s.pageBranchCollaborator.branchId),
        ),
      )
      .where(
        and(
          eq(s.pageBranchCollaborator.organizationId, organizationId),
          pageIds ? inArray(s.pageBranch.pageId, pageIds) : undefined,
        ),
      )
      .orderBy(asc(s.pageBranchCollaborator.userId)),
  ]);
  const spaceOf = new Map(pages.map((p) => [p.id, p.spaceId]));
  const rows: SpaceProjectionRow[] = [];
  for (const c of commits) {
    const spaceId = spaceOf.get(c.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: c.id,
          organizationId,
          spaceId,
          type: "pageCommit",
          pageId: c.pageId,
          parentIds: c.parentIds,
          title: c.title,
          content: c.content,
          markdown: c.markdown,
          hash: c.hash,
          schemaVersion: c.schemaVersion,
          message: c.message,
          authorId: c.authorId,
          contributorIds: c.contributorIds,
          createdAt: iso(c.createdAt),
        },
        c.pageId,
      ),
    );
  }
  for (const b of branches) {
    const spaceId = spaceOf.get(b.pageId);
    if (!spaceId) continue;
    rows.push(
      row(
        {
          id: b.id,
          organizationId,
          spaceId,
          type: "pageBranch",
          pageId: b.pageId,
          name: b.name,
          isMain: b.isMain,
          headCommitId: b.headCommitId,
          baseCommitId: b.baseCommitId,
          authorId: b.authorId,
          collaboratorIds: collaborators
            .filter((x) => x.branchId === b.id)
            .map((x) => x.userId),
          createdAt: iso(b.createdAt),
        },
        b.pageId,
      ),
    );
  }
  return rows;
}

const BATCH = 500;

async function upsertRows(
  tx: Tx,
  organizationId: string,
  rows: SpaceProjectionRow[],
) {
  for (const r of rows)
    if (r.organizationId !== organizationId)
      throw new Error(
        `Space projection ${r.key} belongs to another organization than its writer.`,
      );
  for (let index = 0; index < rows.length; index += BATCH) {
    const batch = rows.slice(index, index + BATCH);
    const written = await tx
      .insert(s.spaceEntity)
      .values(batch)
      .onConflictDoUpdate({
        target: s.spaceEntity.key,
        set: {
          spaceId: sql`excluded.space_id`,
          pageId: sql`excluded.page_id`,
          type: sql`excluded.type`,
          data: sql`excluded.data`,
          updatedAt: sql`now()`,
        },
        // Keys are client-chosen ids; a row never moves across tenants.
        setWhere: eq(s.spaceEntity.organizationId, organizationId),
      })
      .returning({ key: s.spaceEntity.key });
    if (written.length !== batch.length)
      throw new Error(
        "A space projection key is already used by another organization.",
      );
  }
}

async function deleteKeys(tx: Tx, organizationId: string, keys: string[]) {
  for (let index = 0; index < keys.length; index += BATCH)
    await tx
      .delete(s.spaceEntity)
      .where(
        and(
          eq(s.spaceEntity.organizationId, organizationId),
          inArray(s.spaceEntity.key, keys.slice(index, index + BATCH)),
        ),
      );
}

type StoredRow = typeof s.spaceEntity.$inferSelect;
const same = (a: SpaceProjectionRow, b: StoredRow) =>
  a.spaceId === b.spaceId &&
  a.pageId === b.pageId &&
  a.type === b.type &&
  canonicalJson(a.data) === canonicalJson(b.data);

// Writes `expected` over `stored`: changed and missing rows are upserted,
// stored rows that are no longer expected are deleted.
async function reconcile(
  tx: Tx,
  organizationId: string,
  expected: SpaceProjectionRow[],
  stored: StoredRow[],
) {
  const existing = new Map(stored.map((r) => [r.key, r]));
  const wanted = new Map(expected.map((r) => [r.key, r]));
  const upserts = [...wanted.values()].filter((r) => {
    const current = existing.get(r.key);
    return !current || !same(r, current);
  });
  const deletes = stored.filter((r) => !wanted.has(r.key)).map((r) => r.key);
  await upsertRows(tx, organizationId, upserts);
  await deleteKeys(tx, organizationId, deletes);
  return {
    upserted: upserts.length,
    deleted: deletes.length,
    unchanged: wanted.size - upserts.length,
  };
}

// What a command touched: space summaries with their grants, page summaries
// (the tree), and page histories (commits and branches).
export type SpaceProjectionTarget = {
  spaces?: string[];
  pages?: string[];
  pageHistories?: string[];
};

// Rewrites the named rows from the domain tables, in the caller's
// transaction (which holds the organization lock).
export async function writeSpaceProjections(
  tx: Tx,
  organizationId: string,
  target: SpaceProjectionTarget,
) {
  const where = (...conditions: (ReturnType<typeof eq> | undefined)[]) =>
    and(eq(s.spaceEntity.organizationId, organizationId), ...conditions);
  if (target.spaces?.length) {
    const [expected, stored] = await Promise.all([
      spaceRows(tx, organizationId, target.spaces),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(s.spaceEntity.spaceId, target.spaces),
            isNull(s.spaceEntity.pageId),
            inArray(s.spaceEntity.type, ["space", "spaceGrant"]),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
  if (target.pages?.length) {
    const [expected, stored] = await Promise.all([
      pageSummaries(tx, organizationId, { pageIds: target.pages }),
      tx
        .select()
        .from(s.spaceEntity)
        .where(
          where(
            inArray(
              s.spaceEntity.key,
              target.pages.map((id) => `page:${id}`),
            ),
          ),
        ),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
  if (target.pageHistories?.length) {
    const [expected, stored] = await Promise.all([
      pageHistoryRows(tx, organizationId, target.pageHistories),
      tx
        .select()
        .from(s.spaceEntity)
        .where(where(inArray(s.spaceEntity.pageId, target.pageHistories))),
    ]);
    await reconcile(tx, organizationId, expected, stored);
  }
}

// Every Spaces projection row the organization should have.
export async function expectedSpaceProjections(
  tx: Database | Tx,
  organizationId: string,
) {
  const rows = [
    ...(await spaceRows(tx, organizationId)),
    ...(await pageSummaries(tx, organizationId)),
    ...(await pageHistoryRows(tx, organizationId)),
  ];
  return new Map(rows.map((r) => [r.key, r]));
}

// Reconciles `space_entity` and `space_reader` with the domain, in the
// caller's transaction under the organization lock. Called by
// `rebuildProjections`.
export async function rebuildSpaceProjections(tx: Tx, organizationId: string) {
  if (!(await hasSpaceRows(tx, organizationId)))
    return { upserted: 0, deleted: 0, unchanged: 0, readersChanged: 0 };
  const [expected, stored] = await Promise.all([
    expectedSpaceProjections(tx, organizationId),
    tx
      .select()
      .from(s.spaceEntity)
      .where(eq(s.spaceEntity.organizationId, organizationId)),
  ]);
  const result = await reconcile(
    tx,
    organizationId,
    [...expected.values()],
    stored,
  );
  const access = await refreshSpaceAccess(tx, organizationId);
  return { ...result, readersChanged: access.changedUserIds.length };
}

// Whether the organization has any space, Spaces projection or reader row:
// most organizations checked by the invariant have none.
async function hasSpaceRows(tx: Tx, organizationId: string) {
  const [row] = await tx.execute<{ found: boolean }>(sql`
    select exists (select 1 from ${s.space} where ${s.space.organizationId} = ${organizationId})
      or exists (select 1 from ${s.spaceEntity} where ${s.spaceEntity.organizationId} = ${organizationId})
      or exists (select 1 from ${s.spaceReader} where ${s.spaceReader.organizationId} = ${organizationId})
      as found`);
  return Boolean(row?.found);
}

// Keys whose stored Spaces projection or effective access differs from the
// domain (missing, stale or extra). Empty when the invariant holds.
export async function spaceProjectionDrift(tx: Tx, organizationId: string) {
  if (!(await hasSpaceRows(tx, organizationId))) return [];
  const [expected, stored] = await Promise.all([
    expectedSpaceProjections(tx, organizationId),
    tx
      .select()
      .from(s.spaceEntity)
      .where(eq(s.spaceEntity.organizationId, organizationId)),
  ]);
  const drift: string[] = [];
  for (const r of stored) {
    const want = expected.get(r.key);
    if (!want) drift.push(`extra ${r.key}`);
    else if (!same(want, r)) drift.push(`stale ${r.key}`);
  }
  const seen = new Set(stored.map((r) => r.key));
  for (const key of expected.keys())
    if (!seen.has(key)) drift.push(`missing ${key}`);
  drift.push(...(await spaceAccessDrift(tx, organizationId)));
  return drift.sort();
}
