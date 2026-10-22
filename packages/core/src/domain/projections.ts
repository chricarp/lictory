import { and, eq, inArray, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { logoUrl, type LogoKind } from "@lictory/core/branding/logo";
import {
  diffProjections,
  directoryKey,
  organizationLevelTypes,
  organizationProfileKey,
  projectionRow,
  type OrganizationProfile,
  type ProjectionOperation,
  type ProjectionRow,
  type ProjectionScope,
} from "@lictory/core/contracts/projection";
import type { Entity } from "@lictory/core/contracts/protocol";
import {
  lock,
  organizationDirectory,
  snapshot,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";

// Read projections (`sync_entity`) replicated to browsers by Zero. Every
// domain writer maintains them in the same transaction as its domain writes,
// under the organization lock, so a projection never shows a state that was
// not committed and a failed projection write rolls the domain change back.

const BATCH = 500;

// jsonb does not keep key order, so stored rows compare by canonical JSON.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

async function upsertRows(
  tx: Tx,
  organizationId: string,
  rows: ProjectionRow[],
) {
  for (const row of rows)
    if (row.organizationId !== organizationId)
      throw new Error(
        `Projection ${row.key} belongs to another organization than its writer.`,
      );
  for (let index = 0; index < rows.length; index += BATCH) {
    const batch = rows.slice(index, index + BATCH);
    const written = await tx
      .insert(s.syncEntity)
      .values(batch)
      .onConflictDoUpdate({
        target: s.syncEntity.key,
        set: {
          projectId: sql`excluded.project_id`,
          workItemId: sql`excluded.work_item_id`,
          type: sql`excluded.type`,
          data: sql`excluded.data`,
          updatedAt: sql`now()`,
        },
        // Keys are client-chosen ids; a row is never moved across tenants.
        setWhere: eq(s.syncEntity.organizationId, organizationId),
      })
      .returning({ key: s.syncEntity.key });
    if (written.length !== batch.length)
      throw new Error(
        "A projection key is already used by another organization.",
      );
  }
}

async function deleteKeys(tx: Tx, organizationId: string, keys: string[]) {
  for (let index = 0; index < keys.length; index += BATCH)
    await tx
      .delete(s.syncEntity)
      .where(
        and(
          eq(s.syncEntity.organizationId, organizationId),
          inArray(s.syncEntity.key, keys.slice(index, index + BATCH)),
        ),
      );
}

export async function writeOperations(
  tx: Tx,
  organizationId: string,
  operations: ProjectionOperation[],
) {
  const upserts = new Map<string, ProjectionRow>();
  const deletes = new Set<string>();
  for (const op of operations)
    if (op.operation === "upsert") {
      upserts.set(op.row.key, op.row);
      deletes.delete(op.row.key);
    } else {
      deletes.add(op.key);
      upserts.delete(op.key);
    }
  await upsertRows(tx, organizationId, [...upserts.values()]);
  await deleteKeys(tx, organizationId, [...deletes]);
}

// Writes what changed between two snapshots of the same scope.
export async function writeProjections(
  tx: Tx,
  organizationId: string,
  before: Entity[],
  after: Entity[],
  fallback?: ProjectionScope,
) {
  await writeOperations(
    tx,
    organizationId,
    diffProjections(before, after, fallback),
  );
}

// Writes entities that live in another scope than the command's own (a
// parent's readiness, runs owned by other items, readiness moves).
export async function writeEntities(
  tx: Tx,
  organizationId: string,
  entries: { entity: Entity; scope?: ProjectionScope }[],
) {
  if (!entries.length) return;
  await writeOperations(
    tx,
    organizationId,
    entries.map(({ entity, scope }) => ({
      operation: "upsert" as const,
      row: projectionRow(entity, scope),
    })),
  );
}

async function organizationProfile(
  tx: Tx,
  organizationId: string,
): Promise<OrganizationProfile | undefined> {
  const [[organization], logos] = await Promise.all([
    tx
      .select({
        id: s.organization.id,
        name: s.organization.name,
        slug: s.organization.slug,
      })
      .from(s.organization)
      .where(eq(s.organization.id, organizationId)),
    tx
      .select({
        kind: s.organizationLogo.kind,
        sha256: s.organizationLogo.sha256,
      })
      .from(s.organizationLogo)
      .where(eq(s.organizationLogo.organizationId, organizationId)),
  ]);
  if (!organization) return undefined;
  const url = (kind: LogoKind) => {
    const logo = logos.find((l) => l.kind === kind);
    return logo ? logoUrl(organizationId, kind, logo.sha256) : null;
  };
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logos: { mark: url("mark"), full: url("full") },
  };
}

async function directoryRows(
  tx: Tx,
  organizationId: string,
): Promise<ProjectionRow[]> {
  const [profile, directory] = await Promise.all([
    organizationProfile(tx, organizationId),
    organizationDirectory(tx, organizationId),
  ]);
  if (!profile) return [];
  const row = (key: string, type: string, data: object): ProjectionRow => ({
    key,
    organizationId,
    projectId: null,
    workItemId: null,
    type,
    data: data as Record<string, unknown>,
  });
  return [
    row(directoryKey(organizationId), "directory", directory),
    row(organizationProfileKey(organizationId), "organizationProfile", profile),
  ];
}

// Rewrites the organization's directory and public profile rows when their
// inputs changed: Better Auth organizations, members and users, branding,
// projects, disciplines, workflow, iterations, types, delivery configuration,
// AI policy and readiness revisions. Takes the organization lock so a slower
// writer never replaces a newer directory with an older one.
export async function refreshDirectoryProjection(
  tx: Tx,
  organizationId: string,
) {
  await lock(tx, organizationId);
  const [rows, stored] = await Promise.all([
    directoryRows(tx, organizationId),
    tx
      .select({ key: s.syncEntity.key, data: s.syncEntity.data })
      .from(s.syncEntity)
      .where(
        and(
          eq(s.syncEntity.organizationId, organizationId),
          inArray(s.syncEntity.key, [
            directoryKey(organizationId),
            organizationProfileKey(organizationId),
          ]),
        ),
      ),
  ]);
  // A deleted organization cascades its projections away.
  if (!rows.length) return false;
  const current = new Map(stored.map((r) => [r.key, canonical(r.data)]));
  const changed = rows.filter((r) => current.get(r.key) !== canonical(r.data));
  await upsertRows(tx, organizationId, changed);
  return changed.length > 0;
}

// Directory refresh in its own transaction, for writers outside the domain
// (Better Auth hooks, branding, profile photos, handles).
export async function refreshDirectories(
  db: Database,
  organizationIds: Iterable<string>,
) {
  for (const organizationId of new Set(organizationIds))
    await db.transaction((tx) =>
      refreshDirectoryProjection(tx, organizationId),
    );
}

// The organizations a user belongs to; their directories list the user.
export async function organizationsOf(db: Database | Tx, userId: string) {
  return (
    await db
      .select({ id: s.member.organizationId })
      .from(s.member)
      .where(eq(s.member.userId, userId))
  ).map((r) => r.id);
}

// Every projection row the organization should have, computed from the
// domain tables: organization-level rows, each work item's history and the
// directory and profile.
export async function expectedProjections(tx: Tx, organizationId: string) {
  const rows = new Map<string, ProjectionRow>();
  for (const entity of await snapshot(tx, { organizationId })) {
    const row = projectionRow(entity);
    rows.set(row.key, row);
  }
  const items = await tx
    .select({ id: s.workItem.id, projectId: s.workItem.projectId })
    .from(s.workItem)
    .where(eq(s.workItem.organizationId, organizationId));
  for (const item of items) {
    const scope = { projectId: item.projectId, workItemId: item.id };
    for (const entity of await snapshot(tx, { organizationId, ...scope })) {
      if (organizationLevelTypes.has(entity.type)) continue;
      const row = projectionRow(entity, scope);
      rows.set(row.key, row);
    }
  }
  for (const row of await directoryRows(tx, organizationId))
    rows.set(row.key, row);
  return rows;
}

// Reconciles `sync_entity` with the domain (operator recovery and the test
// invariant). Rows that differ are rewritten, missing ones added, stale ones
// removed. Runs under the organization lock.
export async function rebuildProjections(db: Database, organizationId: string) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const expected = await expectedProjections(tx, organizationId);
    const stored = await tx
      .select()
      .from(s.syncEntity)
      .where(eq(s.syncEntity.organizationId, organizationId));
    const same = (a: ProjectionRow, b: (typeof stored)[number]) =>
      a.projectId === b.projectId &&
      a.workItemId === b.workItemId &&
      a.type === b.type &&
      canonical(a.data) === canonical(b.data);
    const existing = new Map(stored.map((r) => [r.key, r]));
    const upserts = [...expected.values()].filter((row) => {
      const current = existing.get(row.key);
      return !current || !same(row, current);
    });
    const deletes = stored
      .filter((r) => !expected.has(r.key))
      .map((r) => r.key);
    await upsertRows(tx, organizationId, upserts);
    await deleteKeys(tx, organizationId, deletes);
    return {
      upserted: upserts.length,
      deleted: deletes.length,
      unchanged: expected.size - upserts.length,
    };
  });
}
