import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "@lictory/core/db/schema";
import {
  applicationRoleOf,
  spaceAccessLevels,
  spaceLevelAtLeast,
  type SpaceAccessLevel,
  type SpaceAccessMode,
} from "@lictory/core/contracts/protocol";
import type { Database, Tx } from "@lictory/core/domain/service";

// Access to Lictory Spaces (docs/internals/spaces.md#access).
//
// Effective access is computed from the space (home and mode), organization
// membership, the home's project or team members and named grants, and
// materialized in `space_reader`. Every writer that changes one of those
// inputs calls `refreshSpaceAccess` in the same transaction, under the
// organization lock; Zero queries authorize through the materialized rows.
//
// The domain checks (`canReadSpace`, `canCommentOnPage`, `canEditDraft`,
// `canPublishPage`, `canReviewPageChange`, `canManageSpaceAccess`) read the
// current state inside the caller's transaction and also require a current
// organization membership row: Better Auth commits membership changes outside
// the organization lock, so `space_reader` can lag a removal by the time its
// hook takes; the membership join closes that window.

export type SpaceActor = { organizationId: string; userId: string };

type AccessSpace = {
  id: string;
  projectId: string | null;
  teamId: string | null;
  accessMode: SpaceAccessMode;
};
export type SpaceAccessInputs = {
  spaces: AccessSpace[];
  // Current organization members (Better Auth `member`).
  memberIds: string[];
  projectMembers: { projectId: string; userId: string }[];
  teamMembers: { teamId: string; userId: string }[];
  grants: { spaceId: string; userId: string; level: SpaceAccessLevel }[];
};
export type SpaceReaderRow = {
  spaceId: string;
  userId: string;
  level: SpaceAccessLevel;
};

const higher = (a: SpaceAccessLevel | undefined, b: SpaceAccessLevel) =>
  a && spaceAccessLevels.indexOf(a) >= spaceAccessLevels.indexOf(b) ? a : b;

// Pure: who reads each space and at which level.
// - inherited, home organization: every member edits;
// - inherited, home project: project members edit, other members view;
// - inherited, home team: team members edit, other members view;
// - restricted: only named grants count;
// - grants add (the higher level wins) and count only for current members.
// Administration grants nothing here: an administrator reads a restricted
// space only through a grant.
export function effectiveSpaceAccess(
  inputs: SpaceAccessInputs,
): SpaceReaderRow[] {
  const members = new Set(inputs.memberIds);
  const group = <K extends string>(
    rows: ({ userId: string } & Record<K, string>)[],
    key: K,
  ) => {
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = map.get(row[key]) ?? new Set<string>();
      set.add(row.userId);
      map.set(row[key], set);
    }
    return map;
  };
  const projectMembers = group(inputs.projectMembers, "projectId");
  const teamMembers = group(inputs.teamMembers, "teamId");
  const grants = new Map<string, SpaceAccessInputs["grants"]>();
  for (const grant of inputs.grants)
    grants.set(grant.spaceId, [...(grants.get(grant.spaceId) ?? []), grant]);
  const rows: SpaceReaderRow[] = [];
  for (const space of inputs.spaces) {
    const levels = new Map<string, SpaceAccessLevel>();
    if (space.accessMode === "inherited") {
      const editors = space.teamId
        ? teamMembers.get(space.teamId)
        : space.projectId
          ? projectMembers.get(space.projectId)
          : members;
      for (const userId of members)
        levels.set(userId, editors?.has(userId) ? "edit" : "view");
    }
    for (const grant of grants.get(space.id) ?? [])
      if (members.has(grant.userId))
        levels.set(grant.userId, higher(levels.get(grant.userId), grant.level));
    for (const [userId, level] of levels)
      rows.push({ spaceId: space.id, userId, level });
  }
  return rows;
}

// Which part of the organization to recompute. Omitted filters mean all.
export type SpaceAccessScope = {
  spaceIds?: string[];
  // Spaces homed in this project (or one of its teams).
  projectId?: string;
  userIds?: string[];
};

async function accessInputs(
  tx: Database | Tx,
  organizationId: string,
  scope: SpaceAccessScope,
): Promise<SpaceAccessInputs> {
  const spaces = await tx
    .select({
      id: s.space.id,
      projectId: s.space.projectId,
      teamId: s.space.teamId,
      accessMode: s.space.accessMode,
    })
    .from(s.space)
    .where(
      and(
        eq(s.space.organizationId, organizationId),
        scope.spaceIds ? inArray(s.space.id, scope.spaceIds) : undefined,
        scope.projectId ? eq(s.space.projectId, scope.projectId) : undefined,
      ),
    );
  if (!spaces.length)
    return {
      spaces,
      memberIds: [],
      projectMembers: [],
      teamMembers: [],
      grants: [],
    };
  const users = (column: AnyPgColumn) =>
    scope.userIds ? inArray(column, scope.userIds) : undefined;
  const projectIds = [
    ...new Set(spaces.flatMap((x) => (x.projectId ? [x.projectId] : []))),
  ];
  const teamIds = [
    ...new Set(spaces.flatMap((x) => (x.teamId ? [x.teamId] : []))),
  ];
  const [members, projectMembers, teamMembers, grants] = await Promise.all([
    tx
      .select({ userId: s.member.userId })
      .from(s.member)
      .where(
        and(
          eq(s.member.organizationId, organizationId),
          users(s.member.userId),
        ),
      ),
    projectIds.length
      ? tx
          .select({
            projectId: s.projectMember.projectId,
            userId: s.projectMember.userId,
          })
          .from(s.projectMember)
          .where(
            and(
              eq(s.projectMember.organizationId, organizationId),
              inArray(s.projectMember.projectId, projectIds),
              users(s.projectMember.userId),
            ),
          )
      : Promise.resolve([]),
    teamIds.length
      ? tx
          .select({ teamId: s.teamMember.teamId, userId: s.teamMember.userId })
          .from(s.teamMember)
          .where(
            and(
              eq(s.teamMember.organizationId, organizationId),
              inArray(s.teamMember.teamId, teamIds),
              users(s.teamMember.userId),
            ),
          )
      : Promise.resolve([]),
    tx
      .select({
        spaceId: s.spaceGrant.spaceId,
        userId: s.spaceGrant.userId,
        level: s.spaceGrant.level,
      })
      .from(s.spaceGrant)
      .where(
        and(
          eq(s.spaceGrant.organizationId, organizationId),
          inArray(
            s.spaceGrant.spaceId,
            spaces.map((x) => x.id),
          ),
          users(s.spaceGrant.userId),
        ),
      ),
  ]);
  return {
    spaces,
    memberIds: members.map((m) => m.userId),
    projectMembers,
    teamMembers,
    grants,
  };
}

const readerKey = (r: { spaceId: string; userId: string }) =>
  `${r.spaceId}\u0000${r.userId}`;

// What `space_reader` should hold for the scope, and what it holds.
async function readerDiff(
  tx: Database | Tx,
  organizationId: string,
  scope: SpaceAccessScope,
) {
  const inputs = await accessInputs(tx, organizationId, scope);
  const spaceIds = inputs.spaces.map((x) => x.id);
  const stored = spaceIds.length
    ? await tx
        .select({
          spaceId: s.spaceReader.spaceId,
          userId: s.spaceReader.userId,
          level: s.spaceReader.level,
        })
        .from(s.spaceReader)
        .where(
          and(
            eq(s.spaceReader.organizationId, organizationId),
            inArray(s.spaceReader.spaceId, spaceIds),
            scope.userIds
              ? inArray(s.spaceReader.userId, scope.userIds)
              : undefined,
          ),
        )
    : [];
  const expected = effectiveSpaceAccess(inputs);
  const current = new Map(stored.map((r) => [readerKey(r), r.level]));
  const wanted = new Set(expected.map(readerKey));
  return {
    upserts: expected.filter((r) => current.get(readerKey(r)) !== r.level),
    deletes: stored.filter((r) => !wanted.has(readerKey(r))),
  };
}

// Rewrites the effective access rows of the scope that differ (inserts,
// level changes, removals), never the whole table. Call it in the same
// transaction as any change to a space's home or mode, its grants, project
// or team membership, or organization membership, after taking the
// organization lock. Returns the people whose access changed, so the caller
// can ask the collaboration service to revalidate their connections after
// commit.
export async function refreshSpaceAccess(
  tx: Tx,
  organizationId: string,
  scope: SpaceAccessScope = {},
) {
  const { upserts, deletes } = await readerDiff(tx, organizationId, scope);
  for (let index = 0; index < upserts.length; index += 500)
    await tx
      .insert(s.spaceReader)
      .values(
        upserts
          .slice(index, index + 500)
          .map((r) => ({ organizationId, ...r })),
      )
      .onConflictDoUpdate({
        target: [s.spaceReader.spaceId, s.spaceReader.userId],
        set: { level: sql`excluded.level` },
        setWhere: eq(s.spaceReader.organizationId, organizationId),
      });
  for (const row of deletes)
    await tx
      .delete(s.spaceReader)
      .where(
        and(
          eq(s.spaceReader.organizationId, organizationId),
          eq(s.spaceReader.spaceId, row.spaceId),
          eq(s.spaceReader.userId, row.userId),
        ),
      );
  return {
    changedUserIds: [
      ...new Set([...upserts, ...deletes].map((r) => r.userId)),
    ].sort(),
  };
}

// Rows of `space_reader` that differ from a recomputation (empty when the
// invariant holds). Used by the projection rebuild invariant.
export async function spaceAccessDrift(tx: Tx, organizationId: string) {
  const { upserts, deletes } = await readerDiff(tx, organizationId, {});
  return [
    ...upserts.map((r) => `stale spaceReader:${r.spaceId}:${r.userId}`),
    ...deletes.map((r) => `extra spaceReader:${r.spaceId}:${r.userId}`),
  ].sort();
}

// ------------------------------------------------------------ domain checks

const memberJoin = (actor: SpaceActor) =>
  and(
    eq(s.member.organizationId, actor.organizationId),
    eq(s.member.userId, actor.userId),
  );
const readerJoin = (actor: SpaceActor) =>
  and(
    eq(s.spaceReader.organizationId, s.space.organizationId),
    eq(s.spaceReader.spaceId, s.space.id),
    eq(s.spaceReader.userId, actor.userId),
  );

// The space and the actor's effective level (null: no access), or undefined
// when the space does not exist in the actor's organization.
export async function spaceAccess(
  tx: Database | Tx,
  actor: SpaceActor,
  spaceId: string,
) {
  const [row] = await tx
    .select({ space: s.space, level: s.spaceReader.level })
    .from(s.space)
    .leftJoin(s.member, memberJoin(actor))
    .leftJoin(
      s.spaceReader,
      and(readerJoin(actor), sql`${s.member.id} IS NOT NULL`),
    )
    .where(
      and(
        eq(s.space.organizationId, actor.organizationId),
        eq(s.space.id, spaceId),
      ),
    );
  return row;
}

// A page with its space and the actor's level in that space.
export async function pageAccess(
  tx: Database | Tx,
  actor: SpaceActor,
  pageId: string,
) {
  const [row] = await tx
    .select({ page: s.page, space: s.space, level: s.spaceReader.level })
    .from(s.page)
    .innerJoin(
      s.space,
      and(
        eq(s.space.organizationId, s.page.organizationId),
        eq(s.space.id, s.page.spaceId),
      ),
    )
    .leftJoin(s.member, memberJoin(actor))
    .leftJoin(
      s.spaceReader,
      and(readerJoin(actor), sql`${s.member.id} IS NOT NULL`),
    )
    .where(
      and(
        eq(s.page.organizationId, actor.organizationId),
        eq(s.page.id, pageId),
      ),
    );
  return row;
}

const active = (row: {
  space: { archivedAt: Date | null };
  page?: { archivedAt: Date | null };
}) => !row.space.archivedAt && !row.page?.archivedAt;

// Read the space, its pages and their history (view level or more).
export async function canReadSpace(
  tx: Database | Tx,
  actor: SpaceActor,
  spaceId: string,
) {
  return Boolean((await spaceAccess(tx, actor, spaceId))?.level);
}

// Start or answer discussions on a page: comment level, on an active page.
export async function canCommentOnPage(
  tx: Database | Tx,
  actor: SpaceActor,
  pageId: string,
) {
  const row = await pageAccess(tx, actor, pageId);
  return Boolean(row && active(row) && spaceLevelAtLeast(row.level, "comment"));
}

// Write into a line's live draft: edit access to an active space and page,
// and a live branch. Main is writable only in Direct spaces; a named branch
// only by its author and collaborators.
export async function canEditDraft(
  tx: Database | Tx,
  actor: SpaceActor,
  branchId: string,
) {
  const [branch] = await tx
    .select({
      pageId: s.pageBranch.pageId,
      isMain: s.pageBranch.isMain,
      authorId: s.pageBranch.authorId,
      deletedAt: s.pageBranch.deletedAt,
      collaborator: s.pageBranchCollaborator.userId,
    })
    .from(s.pageBranch)
    .leftJoin(
      s.pageBranchCollaborator,
      and(
        eq(
          s.pageBranchCollaborator.organizationId,
          s.pageBranch.organizationId,
        ),
        eq(s.pageBranchCollaborator.branchId, s.pageBranch.id),
        eq(s.pageBranchCollaborator.userId, actor.userId),
      ),
    )
    .where(
      and(
        eq(s.pageBranch.organizationId, actor.organizationId),
        eq(s.pageBranch.id, branchId),
      ),
    );
  if (!branch || branch.deletedAt) return false;
  const row = await pageAccess(tx, actor, branch.pageId);
  if (!row || !active(row) || !spaceLevelAtLeast(row.level, "edit"))
    return false;
  if (branch.isMain) return row.space.publishing === "direct";
  return branch.authorId === actor.userId || branch.collaborator !== null;
}

// Publish into main (seal main's draft, merge a pull request into main):
// edit access to an active space and page. In Reviewed spaces the merge
// also needs its review gates, which the merge command checks.
export async function canPublishPage(
  tx: Database | Tx,
  actor: SpaceActor,
  pageId: string,
) {
  const row = await pageAccess(tx, actor, pageId);
  return Boolean(row && active(row) && spaceLevelAtLeast(row.level, "edit"));
}

// Decide a review of a proposed page change: an editor of the space who did
// not contribute to the result (pass the result's contributors).
export async function canReviewPageChange(
  tx: Database | Tx,
  actor: SpaceActor,
  pageId: string,
  contributorIds: readonly string[] = [],
) {
  if (contributorIds.includes(actor.userId)) return false;
  return canPublishPage(tx, actor, pageId);
}

// Manage access, publishing, home and archiving: the space's creator,
// organization administrators and administrators of an active home project.
// Managing does not grant reading: an administrator reads a restricted space
// only through a named grant, which is audited.
export async function canManageSpaceAccess(
  tx: Database | Tx,
  actor: SpaceActor,
  spaceId: string,
) {
  const [row] = await tx
    .select({
      role: s.member.role,
      createdById: s.space.createdById,
      projectRole: s.projectMember.role,
    })
    .from(s.space)
    .innerJoin(s.member, memberJoin(actor))
    .leftJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.space.organizationId),
        eq(s.project.id, s.space.projectId),
        isNull(s.project.archivedAt),
      ),
    )
    .leftJoin(
      s.projectMember,
      and(
        eq(s.projectMember.organizationId, s.space.organizationId),
        eq(s.projectMember.projectId, s.project.id),
        eq(s.projectMember.userId, actor.userId),
      ),
    )
    .where(
      and(
        eq(s.space.organizationId, actor.organizationId),
        eq(s.space.id, spaceId),
      ),
    );
  if (!row) return false;
  return (
    row.createdById === actor.userId ||
    applicationRoleOf(row.role) === "admin" ||
    row.projectRole === "admin"
  );
}

// Spaces the actor manages but cannot read: what an administrator needs to
// find a restricted space and grant themselves access. Names only.
export async function manageableUnreadableSpaces(
  tx: Database | Tx,
  actor: SpaceActor,
) {
  const condition: SQL = sql`not exists (
    select 1 from ${s.spaceReader}
    where ${s.spaceReader.organizationId} = ${s.space.organizationId}
      and ${s.spaceReader.spaceId} = ${s.space.id}
      and ${s.spaceReader.userId} = ${actor.userId})`;
  const candidates = await tx
    .select({
      id: s.space.id,
      name: s.space.name,
      accessMode: s.space.accessMode,
      archivedAt: s.space.archivedAt,
    })
    .from(s.space)
    .where(and(eq(s.space.organizationId, actor.organizationId), condition));
  const manageable = [];
  for (const space of candidates)
    if (await canManageSpaceAccess(tx, actor, space.id)) manageable.push(space);
  return manageable;
}
