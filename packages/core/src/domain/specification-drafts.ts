// Live drafts of specifications (docs/internals/specification-drafts.md).
//
// A specification line (main, or one branch) can have one shared draft: a
// Yjs document of the Markdown editor's schema, edited by several people at
// once through the collaboration service and stored by the draft writer of
// Lictory Spaces (packages/core/src/spaces/drafts.ts). Markdown stays the
// stored format of revisions and commits: every epoch starts from the line's
// Markdown, and sealing converts the stored cut back with the head's
// Markdown as its source, so blocks nobody touched keep their exact bytes.
//
// Everything here runs inside a domain transaction (applyMutation) except
// `refreshSpecificationDraftProjection`, which takes the organization lock
// itself.
import { and, asc, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import * as Y from "yjs";
import * as s from "@lictory/core/db/schema";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import {
  draftStateToMarkdown,
  markdownToDraftState,
} from "@lictory/core/editor/draft-state";
import { DomainError } from "@lictory/core/domain/errors";
import { specificationDraftDocumentName } from "@lictory/core/spaces/collaboration-protocol";
import { writeEntities } from "@lictory/core/domain/projections";
import {
  lock,
  serialize,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";

export type SpecificationDraftRow = typeof s.specificationDraft.$inferSelect;

const draftWhere = (
  organizationId: string,
  workItemId: string,
  branchId: string | null,
) =>
  and(
    eq(s.specificationDraft.organizationId, organizationId),
    eq(s.specificationDraft.workItemId, workItemId),
    branchId
      ? eq(s.specificationDraft.branchId, branchId)
      : isNull(s.specificationDraft.branchId),
  );

// What the line's head is now: main's latest revision, or a live branch's
// head commit. Undefined for a deleted or unknown branch.
type Head = {
  revisionId: string | null;
  commitId: string | null;
  title: string;
  markdown: string;
};
async function headOf(
  tx: Tx,
  organizationId: string,
  workItemId: string,
  branchId: string | null,
): Promise<Head | undefined> {
  if (!branchId) {
    const [revision] = await tx
      .select({
        id: s.specificationRevision.id,
        title: s.specificationRevision.title,
        content: s.specificationRevision.content,
      })
      .from(s.specificationRevision)
      .where(
        and(
          eq(s.specificationRevision.organizationId, organizationId),
          eq(s.specificationRevision.workItemId, workItemId),
        ),
      )
      .orderBy(desc(s.specificationRevision.number))
      .limit(1);
    return revision
      ? {
          revisionId: revision.id,
          commitId: null,
          title: revision.title,
          markdown: revision.content,
        }
      : undefined;
  }
  const [row] = await tx
    .select({
      name: s.specificationBranch.name,
      commitId: s.specificationCommit.id,
      title: s.specificationCommit.title,
      content: s.specificationCommit.content,
    })
    .from(s.specificationBranch)
    .innerJoin(
      s.specificationCommit,
      and(
        eq(
          s.specificationCommit.organizationId,
          s.specificationBranch.organizationId,
        ),
        eq(s.specificationCommit.id, s.specificationBranch.headId),
      ),
    )
    .where(
      and(
        eq(s.specificationBranch.organizationId, organizationId),
        eq(s.specificationBranch.workItemId, workItemId),
        eq(s.specificationBranch.id, branchId),
        isNull(s.specificationBranch.deletedAt),
      ),
    );
  // Main as a branch row is never a draft line of its own: its draft is
  // the revision line.
  if (!row || row.name === "main") return undefined;
  return {
    revisionId: null,
    commitId: row.commitId,
    title: row.title,
    markdown: row.content,
  };
}

// The Markdown a draft's saved state is (its base).
async function baseMarkdown(tx: Tx, draft: SpecificationDraftRow) {
  if (draft.baseRevisionId) {
    const [row] = await tx
      .select({ content: s.specificationRevision.content })
      .from(s.specificationRevision)
      .where(
        and(
          eq(s.specificationRevision.organizationId, draft.organizationId),
          eq(s.specificationRevision.id, draft.baseRevisionId),
        ),
      );
    return row?.content ?? "";
  }
  const [row] = await tx
    .select({ content: s.specificationCommit.content })
    .from(s.specificationCommit)
    .where(
      and(
        eq(s.specificationCommit.organizationId, draft.organizationId),
        eq(s.specificationCommit.id, draft.baseCommitId!),
      ),
    );
  return row?.content ?? "";
}

async function keepSeed(
  tx: Tx,
  draft: { organizationId: string; id: string },
  epoch: number,
  seed: Buffer,
  source: string,
) {
  await tx.insert(s.specificationDraftSeed).values({
    organizationId: draft.organizationId,
    draftId: draft.id,
    epoch,
    seed,
    source,
  });
}

// A new epoch whose content is the head's Markdown. Editors of the previous
// epoch are closed (the `specification_draft` trigger signals the
// collaboration service after commit); its seed and update log stay.
async function startEpoch(tx: Tx, draft: SpecificationDraftRow, head: Head) {
  const epoch = draft.epoch + 1;
  const seed = Buffer.from(markdownToDraftState(head.markdown));
  await keepSeed(tx, draft, epoch, seed, head.markdown);
  await tx
    .update(s.specificationDraft)
    .set({
      epoch,
      baseRevisionId: head.revisionId,
      baseCommitId: head.commitId,
      committedSequence: draft.sequence,
      snapshot: seed,
      snapshotSequence: draft.sequence,
      fencedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(s.specificationDraft.organizationId, draft.organizationId),
        eq(s.specificationDraft.id, draft.id),
      ),
    );
  return { id: draft.id, epoch };
}

// The open draft of a line: created from the head, a closed one reopened as
// a new epoch, an open one returned as it is. The caller authorizes.
export async function openSpecificationDraft(
  tx: Tx,
  line: { organizationId: string; workItemId: string; branchId: string | null },
) {
  const { organizationId, workItemId, branchId } = line;
  const [existing] = await tx
    .select()
    .from(s.specificationDraft)
    .where(draftWhere(organizationId, workItemId, branchId));
  if (existing && !existing.fencedAt)
    return { id: existing.id, epoch: existing.epoch };
  const head = await headOf(tx, organizationId, workItemId, branchId);
  if (!head)
    throw new DomainError(
      "not_found",
      "This branch is unavailable. It was deleted or merged; its commits remain in history.",
    );
  if (existing) return startEpoch(tx, existing, head);
  const id = crypto.randomUUID();
  const seed = Buffer.from(markdownToDraftState(head.markdown));
  await tx.insert(s.specificationDraft).values({
    id,
    organizationId,
    workItemId,
    branchId,
    baseRevisionId: head.revisionId,
    baseCommitId: head.commitId,
    snapshot: seed,
  });
  await keepSeed(tx, { organizationId, id }, 1, seed, head.markdown);
  return { id, epoch: 1 };
}

// The open draft a seal names, or a refusal that tells the editor to reopen.
export async function requireOpenDraft(
  tx: Tx,
  organizationId: string,
  workItemId: string,
  draftId: string,
  epoch: number,
) {
  const [draft] = await tx
    .select()
    .from(s.specificationDraft)
    .where(
      and(
        eq(s.specificationDraft.organizationId, organizationId),
        eq(s.specificationDraft.workItemId, workItemId),
        eq(s.specificationDraft.id, draftId),
      ),
    );
  if (!draft || draft.fencedAt || draft.epoch !== epoch)
    throw new DomainError(
      "conflict",
      "This draft was closed or replaced since you opened it. Reopen the editor and save from its current draft.",
    );
  return draft;
}

// Keeps every open draft of an item on its line's head, after any command
// (or child change) that may have moved a head without sealing the draft:
//
// - a head with the draft's own content (a title change, a breakdown-only
//   commit, the draft's own seal) only moves the draft's base;
// - a head with other content (a revision saved another way, a restore, a
//   merged pull request, a synced branch) starts a new epoch at that head;
// - main of a protected specification, a deleted branch, an archived item
//   or one whose type has no specification closes (fences) the draft.
//
// Returns whether anything changed, so the caller projects the item again.
// Callers that can only upsert the item's projections (changes to children
// made by their parent's command) pass `close: false`: drafts are then never
// fenced, and the access checks refuse what a fence would have closed.
export async function followSpecificationDrafts(
  tx: Tx,
  organizationId: string,
  workItemId: string,
  options: { close?: boolean } = {},
) {
  const close = options.close ?? true;
  const drafts = await tx
    .select()
    .from(s.specificationDraft)
    .where(
      and(
        eq(s.specificationDraft.organizationId, organizationId),
        eq(s.specificationDraft.workItemId, workItemId),
        isNull(s.specificationDraft.fencedAt),
      ),
    );
  if (!drafts.length) return false;
  const [item] = await tx
    .select({
      archivedAt: s.workItem.archivedAt,
      mainProtected: s.workItem.mainProtected,
      hasSpecification: s.workItemType.hasSpecification,
    })
    .from(s.workItem)
    .innerJoin(
      s.workItemType,
      and(
        eq(s.workItemType.organizationId, s.workItem.organizationId),
        eq(s.workItemType.id, s.workItem.typeId),
      ),
    )
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.id, workItemId),
      ),
    );
  let changed = false;
  for (const draft of drafts) {
    const closed =
      !item ||
      item.archivedAt ||
      !item.hasSpecification ||
      (!draft.branchId && item.mainProtected);
    const head = closed
      ? undefined
      : await headOf(tx, organizationId, workItemId, draft.branchId);
    if (!head) {
      if (!close) continue;
      await fence(tx, draft);
      changed = true;
      continue;
    }
    const base = draft.baseRevisionId ?? draft.baseCommitId;
    if (base === (head.revisionId ?? head.commitId)) continue;
    changed = true;
    if ((await baseMarkdown(tx, draft)) === head.markdown)
      await tx
        .update(s.specificationDraft)
        .set({
          baseRevisionId: head.revisionId,
          baseCommitId: head.commitId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(s.specificationDraft.organizationId, organizationId),
            eq(s.specificationDraft.id, draft.id),
          ),
        );
    else await startEpoch(tx, draft, head);
  }
  return changed;
}

async function fence(tx: Tx, draft: SpecificationDraftRow) {
  await tx
    .update(s.specificationDraft)
    .set({ fencedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(s.specificationDraft.organizationId, draft.organizationId),
        eq(s.specificationDraft.id, draft.id),
        isNull(s.specificationDraft.fencedAt),
      ),
    );
}

// The stored cut of a draft at exactly `sequence`: its Markdown (with the
// base's Markdown as source), its working title (empty when nobody changed
// it) and who wrote the edits since the last saved cut.
export async function sealedSpecificationDraft(
  tx: Tx,
  draft: SpecificationDraftRow,
  sequence: number,
) {
  if (draft.sequence < sequence)
    throw new DomainError(
      "conflict",
      "Some of these edits are not saved yet. Wait until the editor shows “Saved” and try again.",
    );
  if (sequence < draft.committedSequence)
    throw new DomainError(
      "conflict",
      "These edits were already saved. Save again from the current draft.",
    );
  if (draft.snapshotSequence > sequence)
    throw new DomainError(
      "conflict",
      "The draft was compacted since you saw it. Save again from the current draft.",
    );
  const [updates, authors] = await Promise.all([
    tx
      .select({ update: s.specificationDraftUpdate.update })
      .from(s.specificationDraftUpdate)
      .where(
        and(
          eq(s.specificationDraftUpdate.organizationId, draft.organizationId),
          eq(s.specificationDraftUpdate.draftId, draft.id),
          eq(s.specificationDraftUpdate.epoch, draft.epoch),
          gt(s.specificationDraftUpdate.sequence, draft.snapshotSequence),
          lte(s.specificationDraftUpdate.sequence, sequence),
        ),
      )
      .orderBy(asc(s.specificationDraftUpdate.sequence)),
    tx
      .selectDistinct({ authorId: s.specificationDraftUpdate.authorId })
      .from(s.specificationDraftUpdate)
      .where(
        and(
          eq(s.specificationDraftUpdate.organizationId, draft.organizationId),
          eq(s.specificationDraftUpdate.draftId, draft.id),
          eq(s.specificationDraftUpdate.epoch, draft.epoch),
          gt(s.specificationDraftUpdate.sequence, draft.committedSequence),
          lte(s.specificationDraftUpdate.sequence, sequence),
        ),
      ),
  ]);
  const parts = [
    ...(draft.snapshot ? [new Uint8Array(draft.snapshot)] : []),
    ...updates.map((u) => new Uint8Array(u.update)),
  ];
  const doc = new Y.Doc();
  try {
    if (parts.length) Y.applyUpdate(doc, Y.mergeUpdates(parts));
    return {
      markdown: draftStateToMarkdown(doc, await baseMarkdown(tx, draft)),
      title: doc.getText("title").toJSON().trim(),
      authorIds: authors.map((a) => a.authorId).sort(),
    };
  } finally {
    doc.destroy();
  }
}

// After a seal: the cut is saved and the draft's base is the line's new head
// (or the same head, when the edits cancelled out).
export async function markSealed(
  tx: Tx,
  draft: SpecificationDraftRow,
  cut: {
    committedSequence: number;
    revisionId?: string | null;
    commitId?: string | null;
  },
) {
  await tx
    .update(s.specificationDraft)
    .set({
      committedSequence: cut.committedSequence,
      ...(cut.revisionId ? { baseRevisionId: cut.revisionId } : {}),
      ...(cut.commitId ? { baseCommitId: cut.commitId } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(s.specificationDraft.organizationId, draft.organizationId),
        eq(s.specificationDraft.id, draft.id),
      ),
    );
}

function draftEntity(row: SpecificationDraftRow): EntityOf<"specDraft"> {
  return serialize("specDraft", {
    id: row.id,
    organizationId: row.organizationId,
    workItemId: row.workItemId,
    branchId: row.branchId,
    epoch: row.epoch,
    documentName: specificationDraftDocumentName({
      draftId: row.id,
      epoch: row.epoch,
    }),
    committedSequence: row.committedSequence,
    uncommittedChanges: row.sequence > row.committedSequence,
    baseRevisionId: row.baseRevisionId,
    baseCommitId: row.baseCommitId,
  }) as EntityOf<"specDraft">;
}

// The `specDraft` projections of these items: their open drafts. The stored
// sequence advances with every typing batch and is never projected; only
// whether stored edits exist beyond the last saved cut.
export async function specificationDraftEntities(
  tx: Database | Tx,
  organizationId: string,
  workItemIds: string[],
) {
  if (!workItemIds.length) return [];
  const rows = await tx
    .select()
    .from(s.specificationDraft)
    .where(
      and(
        eq(s.specificationDraft.organizationId, organizationId),
        inArray(s.specificationDraft.workItemId, workItemIds),
        isNull(s.specificationDraft.fencedAt),
      ),
    )
    .orderBy(asc(s.specificationDraft.createdAt), asc(s.specificationDraft.id));
  return rows.map(draftEntity);
}

// The draft writer's first stored edit beyond the last saved cut: the item
// shows "Unsaved draft changes" from now on. A transaction of its own under
// the exclusive organization lock, like every projection writer; the
// writer's own transaction (shared lock) never writes projections.
export async function refreshSpecificationDraftProjection(
  db: Database,
  organizationId: string,
  draftId: string,
) {
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const [row] = await tx
      .select({ draft: s.specificationDraft, projectId: s.workItem.projectId })
      .from(s.specificationDraft)
      .innerJoin(
        s.workItem,
        and(
          eq(s.workItem.organizationId, s.specificationDraft.organizationId),
          eq(s.workItem.id, s.specificationDraft.workItemId),
        ),
      )
      .where(
        and(
          eq(s.specificationDraft.organizationId, organizationId),
          eq(s.specificationDraft.id, draftId),
        ),
      );
    if (!row || row.draft.fencedAt) return;
    await writeEntities(tx, organizationId, [
      {
        entity: draftEntity(row.draft),
        scope: { projectId: row.projectId, workItemId: row.draft.workItemId },
      },
    ]);
  });
}
