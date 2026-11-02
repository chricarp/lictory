import { and, desc, eq, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Directory } from "@lictory/core/contracts/protocol";
import type {
  ChildChange,
  NewChild,
} from "@lictory/core/contracts/decomposition";
import type { Tx } from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";

// Proposed changes to existing children of a reviewed breakdown.
//
// The child stays authoritative: a change is a reviewed delta against the
// child's state when it was proposed (`base`). It applies only while the
// child still has that revision and parent, and never to work that is
// already accepted, underway, finished or handed off. Otherwise merge refuses
// with the child named, so accepted work is never silently rewritten.
export type BreakdownScope = {
  organizationId: string;
  projectId: string;
  projectKey: string;
  // The item whose specification proposes the breakdown.
  parentId: string;
  roster: Directory;
};

const lockedCategories = new Set(["started", "done", "canceled"]);

async function latestRevision(tx: Tx, organizationId: string, id: string) {
  return (
    await tx
      .select()
      .from(s.specificationRevision)
      .where(
        and(
          eq(s.specificationRevision.organizationId, organizationId),
          eq(s.specificationRevision.workItemId, id),
        ),
      )
      .orderBy(desc(s.specificationRevision.number))
      .limit(1)
  )[0];
}

export async function inspectChildChange(
  tx: Tx,
  scope: BreakdownScope,
  change: ChildChange,
  newChildren: NewChild[],
) {
  const { organizationId, projectId, roster } = scope;
  const items = await tx
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.projectId, projectId),
      ),
    );
  const child = items.find((row) => row.id === change.workItemId);
  if (!child)
    throw new DomainError(
      "not_found",
      "A child named in this breakdown is no longer available in this project.",
    );
  const label = `${scope.projectKey}-${child.number}`;
  const type = roster.types.find((t) => t.id === child.typeId);
  if (child.archivedAt)
    throw new DomainError(
      "conflict",
      `${label} is archived. Restore it or drop its proposed change.`,
    );
  if (child.parentId !== scope.parentId)
    throw new DomainError(
      "conflict",
      `${label} is no longer a child of this item. Drop its proposed change or propose it on its current parent.`,
    );
  const status = roster.statuses.find((x) => x.id === child.statusId);
  const [link] = await tx
    .select({ id: s.workItemExternalLink.id })
    .from(s.workItemExternalLink)
    .where(
      and(
        eq(s.workItemExternalLink.organizationId, organizationId),
        eq(s.workItemExternalLink.workItemId, child.id),
      ),
    )
    .limit(1);
  if (
    (status && lockedCategories.has(status.category)) ||
    child.committedRevisionId ||
    child.deliveredRevisionId ||
    link
  )
    throw new DomainError(
      "conflict",
      `${label} is already accepted, underway or handed off. Change it on the item itself.`,
    );
  if (
    (change.title !== undefined || change.description !== undefined) &&
    type?.hasSpecification
  )
    throw new DomainError(
      "validation",
      `${label} has its own specification. Propose its text changes there, where its reviewers approve them.`,
    );
  const latest = await latestRevision(tx, organizationId, child.id);
  if (latest?.id !== change.base.revisionId)
    throw new DomainError(
      "conflict",
      `${label} changed since this change was proposed (now revision ${latest?.number ?? 0}). Review it and propose the change again.`,
    );
  if (change.parentId !== undefined && change.parentId !== null) {
    const level = (typeId: string) =>
      roster.types.find((t) => t.id === typeId)?.level ?? -Infinity;
    const proposed = newChildren.find((c) => c.workItemId === change.parentId);
    const target = items.find(
      (row) => row.id === change.parentId && !row.archivedAt,
    );
    if (!proposed && !target)
      throw new DomainError(
        "validation",
        `The new parent for ${label} is unavailable in this project.`,
      );
    if (change.parentId === child.parentId)
      throw new DomainError(
        "validation",
        `${label} is already under that parent.`,
      );
    // Moving under one of its own descendants would create a cycle.
    for (
      let cursor = target;
      cursor;
      cursor = items.find((row) => row.id === cursor.parentId)
    )
      if (cursor.id === child.id)
        throw new DomainError(
          "validation",
          `${label} cannot be moved under its own descendant.`,
        );
    if (level((proposed ?? target)!.typeId) <= level(child.typeId))
      throw new DomainError(
        "validation",
        `${label} needs a parent above ${type?.name ?? "its type"} in the hierarchy.`,
      );
  }
  if (
    change.archive &&
    items.some((row) => row.parentId === child.id && !row.archivedAt)
  )
    throw new DomainError(
      "conflict",
      `${label} has active children. Archive or move them first.`,
    );
  return { child, latest, label };
}

// Applies one inspected change inside the merge transaction. Returns the
// items whose own scope changed (the child and a new parent).
export async function applyChildChange(
  tx: Tx,
  scope: BreakdownScope & { userId: string; now: Date },
  change: ChildChange,
  newChildren: NewChild[],
  detail: Record<string, unknown>,
) {
  const { organizationId, userId, now } = scope;
  const { child, latest } = await inspectChildChange(
    tx,
    scope,
    change,
    newChildren,
  );
  const patch: Partial<typeof s.workItem.$inferInsert> = { updatedAt: now };
  const changed: string[] = [];
  if (change.title !== undefined || change.description !== undefined) {
    const title = change.title ?? child.title;
    const content = change.description ?? latest?.content ?? "";
    if (title !== child.title || content !== (latest?.content ?? "")) {
      await tx.insert(s.specificationRevision).values({
        organizationId,
        workItemId: child.id,
        number: (latest?.number ?? 0) + 1,
        title,
        content,
        changeSummary: "Accepted delivery breakdown change",
        authorId: userId,
      });
      patch.title = title;
      if (change.title !== undefined) changed.push("title");
      if (change.description !== undefined) changed.push("description");
    }
  }
  if (change.parentId !== undefined) {
    patch.parentId = change.parentId;
    changed.push(change.parentId ? "parent" : "detached");
  }
  if (change.archive) {
    patch.archivedAt = now;
    changed.push("archived");
  }
  await tx
    .update(s.workItem)
    .set(patch)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.id, child.id),
        isNull(s.workItem.archivedAt),
      ),
    );
  await tx.insert(s.activity).values({
    id: crypto.randomUUID(),
    organizationId,
    projectId: scope.projectId,
    workItemId: child.id,
    actorId: userId,
    action: "breakdown_change_accepted",
    detail: {
      ...detail,
      changeId: change.changeId,
      fromParentId: scope.parentId,
      ...(change.parentId !== undefined ? { toParentId: change.parentId } : {}),
      changed,
    },
    createdAt: now,
  });
  return [child.id, ...(change.parentId ? [change.parentId] : [])];
}
