import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Database, Tx } from "@lictory/core/domain/service";
import { canEditDraft, canReadSpace } from "@lictory/core/spaces/access";
import type { DraftAccess, DraftRef } from "@lictory/core/spaces/drafts";

// What the collaboration service needs from the domain: which draft epoch a
// document name means, and whether a person may read or write it. The
// adapters run inside the caller's transaction (the draft writer's, under the
// organization lock in shared mode) and use the same domain checks as every
// other surface.

// Hocuspocus document names are `<draftId>.<epoch>`: opaque to clients, and
// a name of an old epoch no longer resolves, so its clients reconnect.
export const draftDocumentName = (ref: Pick<DraftRef, "draftId" | "epoch">) =>
  `${ref.draftId}.${ref.epoch}`;

// The current, open epoch a document name refers to, or null (unknown draft,
// an older epoch, or a fenced draft).
export async function resolveDraftDocument(
  db: Database | Tx,
  documentName: string,
): Promise<DraftRef | null> {
  const match = /^([0-9a-f-]{1,64})\.([1-9]\d{0,9})$/.exec(documentName);
  if (!match) return null;
  const [, draftId, epoch] = match;
  const [draft] = await db
    .select({
      organizationId: s.spaceDraft.organizationId,
      epoch: s.spaceDraft.epoch,
      fencedAt: s.spaceDraft.fencedAt,
    })
    .from(s.spaceDraft)
    .where(eq(s.spaceDraft.id, draftId!));
  if (!draft || draft.fencedAt || String(draft.epoch) !== epoch) return null;
  return {
    organizationId: draft.organizationId,
    draftId: draftId!,
    epoch: draft.epoch,
  };
}

async function draftLine(tx: Tx, ref: DraftRef) {
  const [row] = await tx
    .select({ branchId: s.spaceDraft.branchId, spaceId: s.page.spaceId })
    .from(s.spaceDraft)
    .innerJoin(
      s.page,
      and(
        eq(s.page.organizationId, s.spaceDraft.organizationId),
        eq(s.page.id, s.spaceDraft.pageId),
      ),
    )
    .where(
      and(
        eq(s.spaceDraft.organizationId, ref.organizationId),
        eq(s.spaceDraft.id, ref.draftId),
      ),
    );
  return row;
}

// Read a draft: read access to its space (`canReadSpace`).
export const canReadDraft: DraftAccess = async (tx, userId, ref) => {
  const line = await draftLine(tx, ref);
  return Boolean(
    line &&
    (await canReadSpace(
      tx,
      { organizationId: ref.organizationId, userId },
      line.spaceId,
    )),
  );
};

// Write into a draft: `canEditDraft` for its line (edit access to an active
// space and page; main only in Direct spaces; a named branch only for its
// author and collaborators).
export const canWriteDraft: DraftAccess = async (tx, userId, ref) => {
  const line = await draftLine(tx, ref);
  return Boolean(
    line &&
    (await canEditDraft(
      tx,
      { organizationId: ref.organizationId, userId },
      line.branchId,
    )),
  );
};
