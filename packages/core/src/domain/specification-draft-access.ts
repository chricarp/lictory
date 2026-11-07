import { and, eq, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Database, Tx } from "@lictory/core/domain/service";
import type { DraftAccess, DraftRef } from "@lictory/core/spaces/drafts";
import { SPECIFICATION_DRAFT_PREFIX } from "@lictory/core/spaces/collaboration-protocol";

// What the collaboration service needs to know about live drafts of
// specifications (docs/internals/specification-drafts.md): which draft epoch
// a document name means and whether a person may edit it. The checks are the
// ones the domain commands apply to the line, run inside the caller's
// transaction (the draft writer's, under the organization lock in shared
// mode, or the service's connection check):
//
// - main: an active discipline of the item's project that edits
//   specifications (and project membership, as for every capability), while
//   main is not protected;
// - a branch: its author or an invited collaborator, while it exists;
// - always: the item is active, its type has a specification and its project
//   is not archived.
//
// Organization membership, the session and two-factor policy are checked by
// the writer and the service around these adapters. Reading a specification
// draft needs the same right as writing it: only editors open live drafts,
// so losing the right closes the editor.

// `spec.<draftId>.<epoch>` of the current, open epoch, or null.
export async function resolveSpecificationDraftDocument(
  db: Database | Tx,
  documentName: string,
): Promise<DraftRef | null> {
  if (!documentName.startsWith(SPECIFICATION_DRAFT_PREFIX)) return null;
  const match = /^([0-9a-f-]{1,64})\.([1-9]\d{0,9})$/.exec(
    documentName.slice(SPECIFICATION_DRAFT_PREFIX.length),
  );
  if (!match) return null;
  const [, draftId, epoch] = match;
  const [draft] = await db
    .select({
      organizationId: s.specificationDraft.organizationId,
      epoch: s.specificationDraft.epoch,
      fencedAt: s.specificationDraft.fencedAt,
    })
    .from(s.specificationDraft)
    .where(eq(s.specificationDraft.id, draftId!));
  if (!draft || draft.fencedAt || String(draft.epoch) !== epoch) return null;
  return {
    organizationId: draft.organizationId,
    draftId: draftId!,
    epoch: draft.epoch,
    kind: "specification",
  };
}

// Whether `userId` may edit the line of this specification draft now.
export async function canEditSpecificationLine(
  tx: Database | Tx,
  userId: string,
  ref: Pick<DraftRef, "organizationId" | "draftId">,
) {
  const [line] = await tx
    .select({
      branchId: s.specificationDraft.branchId,
      fencedAt: s.specificationDraft.fencedAt,
      projectId: s.workItem.projectId,
      archivedAt: s.workItem.archivedAt,
      mainProtected: s.workItem.mainProtected,
      hasSpecification: s.workItemType.hasSpecification,
      projectArchivedAt: s.project.archivedAt,
    })
    .from(s.specificationDraft)
    .innerJoin(
      s.workItem,
      and(
        eq(s.workItem.organizationId, s.specificationDraft.organizationId),
        eq(s.workItem.id, s.specificationDraft.workItemId),
      ),
    )
    .innerJoin(
      s.workItemType,
      and(
        eq(s.workItemType.organizationId, s.workItem.organizationId),
        eq(s.workItemType.id, s.workItem.typeId),
      ),
    )
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.workItem.organizationId),
        eq(s.project.id, s.workItem.projectId),
      ),
    )
    .where(
      and(
        eq(s.specificationDraft.organizationId, ref.organizationId),
        eq(s.specificationDraft.id, ref.draftId),
      ),
    );
  if (
    !line ||
    line.fencedAt ||
    line.archivedAt ||
    line.projectArchivedAt ||
    !line.hasSpecification
  )
    return false;
  if (line.branchId) {
    const [branch] = await tx
      .select({
        authorId: s.specificationBranch.authorId,
        collaboratorIds: s.specificationBranch.collaboratorIds,
      })
      .from(s.specificationBranch)
      .where(
        and(
          eq(s.specificationBranch.organizationId, ref.organizationId),
          eq(s.specificationBranch.id, line.branchId),
          isNull(s.specificationBranch.deletedAt),
        ),
      );
    return Boolean(
      branch &&
      (branch.authorId === userId || branch.collaboratorIds.includes(userId)),
    );
  }
  if (line.mainProtected) return false;
  const rows = await tx.execute(
    sql`select 1 from ${s.disciplineMember} dm
          join ${s.discipline} d
            on d.organization_id = dm.organization_id and d.id = dm.discipline_id
          join ${s.projectMember} pm
            on pm.organization_id = d.organization_id and pm.project_id = d.project_id
           and pm.user_id = dm.user_id
         where dm.organization_id = ${ref.organizationId}
           and dm.user_id = ${userId}
           and d.project_id = ${line.projectId}
           and d.archived_at is null
           and d.can_edit_specifications
         limit 1`,
  );
  return rows.length > 0;
}

export const canEditSpecificationDraft: DraftAccess = (tx, userId, ref) =>
  canEditSpecificationLine(tx, userId, ref);
