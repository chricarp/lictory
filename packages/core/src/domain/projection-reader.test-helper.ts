import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  entityKey,
  type Change,
  type Directory,
  type Entity,
  type Mutation,
  type Scope,
} from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import {
  canonicalJson,
  expectedProjections,
} from "@lictory/core/domain/projections";
import {
  authorize,
  directory,
  executeMutation,
  type Database,
} from "@lictory/core/domain/service";

// Test access to the synchronized projections in the shape the domain suites
// were written against: a scope read returns the projected entities (what a
// Zero client of that scope holds), and a read from an earlier checkpoint
// returns what changed since, so tests can assert exactly which rows a
// command wrote. Checkpoints are local to this helper.

const typeOrder: Entity["type"][] = [
  "project",
  "label",
  "milestone",
  "workItem",
  "relation",
  "externalLink",
  "revision",
  "specBranch",
  "specCommit",
  "pullRequest",
  "prReview",
  "review",
  "thread",
  "approval",
  "suggestionReviewer",
  "suggestionDecision",
  "assignment",
  "message",
  "activity",
  "suggestion",
  "readiness",
  "aiRun",
];

function order(a: Entity, b: Entity) {
  const byType = typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
  if (byType) return byType;
  const at = (e: Entity) =>
    "createdAt" in e && typeof e.createdAt === "string" ? e.createdAt : "";
  return at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : a.id < b.id ? -1 : 1;
}

export async function projectedEntities(db: Database, scope: Scope) {
  const rows = await db
    .select()
    .from(s.syncEntity)
    .where(eq(s.syncEntity.organizationId, scope.organizationId));
  const entities = rows
    .filter(
      (r) =>
        r.type !== "directory" &&
        r.type !== "organizationProfile" &&
        (r.workItemId === null
          ? !scope.projectId || r.projectId === scope.projectId
          : Boolean(scope.workItemId) && r.workItemId === scope.workItemId),
    )
    .map((r) => r.data as unknown as Entity)
    .sort(order);
  const directoryRow = rows.find((r) => r.type === "directory");
  return {
    entities,
    directory: directoryRow?.data as
      Omit<Directory, "organizations"> | undefined,
    profile: rows.find((r) => r.type === "organizationProfile")?.data,
  };
}

export function projectionService(
  db: Database,
  options: {
    onMutationCommitted?: (
      userId: string,
      mutation: Mutation,
      snapshots: { before: Entity[]; after: Entity[]; directory?: Directory },
    ) => void;
  } = {},
) {
  const checkpoints = new Map<string, Map<string, Entity>>();
  let next = 0;
  const save = (state: Map<string, Entity>) => {
    const token = String(++next);
    checkpoints.set(token, state);
    return token;
  };
  return {
    mutate(userId: string, mutation: Mutation) {
      return executeMutation(db, { userId }, mutation, {
        onCommitted: (o) =>
          options.onMutationCommitted?.(o.userId, o.mutation, {
            before: o.before,
            after: o.after,
            directory: o.directory,
          }),
      });
    },
    async read(userId: string, scope: Scope, cursor?: string, limit = 100) {
      await authorize(db, userId, scope.organizationId);
      const { organizations } = await directory(db, userId);
      const projected = await projectedEntities(db, scope);
      if (!projected.directory)
        throw new Error("The organization has no directory projection.");
      const roster: Directory = {
        organizations,
        ...projected.directory,
      };
      const current = new Map(projected.entities.map((e) => [entityKey(e), e]));
      const all = await projectedEntities(db, {
        organizationId: scope.organizationId,
      });
      if (
        scope.projectId &&
        !all.entities.some(
          (e) => e.type === "project" && e.id === scope.projectId,
        )
      )
        throw new DomainError("unavailable", "This item is unavailable.");
      if (
        scope.workItemId &&
        !all.entities.some(
          (e) =>
            e.type === "workItem" &&
            e.id === scope.workItemId &&
            e.projectId === scope.projectId,
        )
      )
        throw new DomainError("unavailable", "This item is unavailable.");
      if (cursor === undefined) {
        const token = save(current);
        return {
          protocol: PROTOCOL,
          changes: [...current.values()].map((entity): Change => ({
            operation: "upsert",
            cursor: token,
            entity,
          })),
          nextCursor: token,
          hasMore: false,
          directory: roster,
        };
      }
      const base = checkpoints.get(cursor);
      if (!base)
        throw new DomainError(
          "conflict",
          "Checkpoint is ahead of the server. Reset this workspace cache.",
        );
      const pending: (
        | { operation: "upsert"; entity: Entity }
        | { operation: "delete"; key: string; entity: Entity }
      )[] = [];
      for (const [key, entity] of current)
        if (JSON.stringify(base.get(key)) !== JSON.stringify(entity))
          pending.push({ operation: "upsert", entity });
      for (const [key, entity] of base)
        if (!current.has(key))
          pending.push({ operation: "delete", key, entity });
      const page = pending.slice(0, Math.max(1, limit));
      const state = new Map(base);
      for (const change of page)
        if (change.operation === "upsert")
          state.set(entityKey(change.entity), change.entity);
        else state.delete(change.key);
      const token = save(state);
      return {
        protocol: PROTOCOL,
        changes: page.map((change): Change =>
          change.operation === "upsert"
            ? { operation: "upsert", cursor: token, entity: change.entity }
            : {
                operation: "delete",
                cursor: token,
                type: change.entity.type,
                id: change.entity.id,
              },
        ),
        nextCursor: token,
        hasMore: pending.length > page.length,
        directory: roster,
      };
    },
  };
}

// Keys whose stored projection differs from what the domain implies
// (missing, stale or extra rows). Empty when the invariant holds.
export async function projectionDrift(db: Database, organizationId: string) {
  return db.transaction(async (tx) => {
    const expected = await expectedProjections(tx, organizationId);
    const stored = await tx
      .select()
      .from(s.syncEntity)
      .where(eq(s.syncEntity.organizationId, organizationId));
    const drift: string[] = [];
    const seen = new Set<string>();
    for (const row of stored) {
      seen.add(row.key);
      const want = expected.get(row.key);
      if (!want) drift.push(`extra ${row.key}`);
      else if (
        want.projectId !== row.projectId ||
        want.workItemId !== row.workItemId ||
        canonicalJson(want.data) !== canonicalJson(row.data)
      )
        drift.push(`stale ${row.key}`);
    }
    for (const key of expected.keys())
      if (!seen.has(key)) drift.push(`missing ${key}`);
    return drift.sort();
  });
}
