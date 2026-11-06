// Live draft persistence for Lictory Spaces (tables `space_draft` and
// `space_draft_update`, packages/core/src/db/spaces-schema.ts; see
// docs/internals/spaces.md#draft-writes-a-narrow-exception-to-the-domain-write-rule).
//
// A live draft is a Yjs document stored as a compacted snapshot plus an
// append-only update log. Updates are written by one writer per draft that
// groups everything that arrives while the previous transaction is in flight
// (group commit), so a busy room costs one transaction per database round trip
// instead of one per keystroke.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  authorize,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";
import { canEditDraft, type SpaceActor } from "@lictory/core/spaces/access";
import {
  documentToMarkdown,
  draftStateToDocument,
} from "@lictory/core/spaces/document";
import {
  DRAFT_UPDATE_BYTES,
  SAVE_REFUSALS,
} from "@lictory/core/spaces/collaboration-protocol";
import { refreshDraftProjections } from "@lictory/core/spaces/projections";

// One epoch of one draft. A new epoch replaces the content (restore, merging
// main into a branch); writes for an older epoch are refused.
export type DraftRef = {
  organizationId: string;
  draftId: string;
  epoch: number;
};

// Space access, decided inside the writer's transaction. The production
// adapters over the domain checks are `canReadDraft` and `canWriteDraft` in
// draft-access.ts.
export type DraftAccess = (
  tx: Tx,
  userId: string,
  ref: DraftRef,
) => Promise<boolean>;

export const DRAFT_LIMITS = {
  // A single Yjs update (one message from one editor).
  updateBytes: DRAFT_UPDATE_BYTES,
  // One group-commit transaction.
  batchBytes: 4 * 1024 * 1024,
  // Waiting to be stored per draft; beyond it new changes are refused and the
  // client reconnects, so an outage cannot grow server memory without bound.
  pendingBytes: 8 * 1024 * 1024,
};

const unavailable = () => new DomainError("not_found", SAVE_REFUSALS.draftGone);

async function currentDraft(
  tx: Database | Tx,
  ref: DraftRef,
  forUpdate: boolean,
) {
  const rows = await tx.execute<{
    organization_id: string;
    epoch: number;
    sequence: number;
    committed_sequence: number;
    fenced_at: Date | null;
    snapshot: Buffer | null;
    snapshot_sequence: number;
  }>(
    forUpdate
      ? sql`select organization_id, epoch, sequence, committed_sequence, fenced_at, null::bytea as snapshot, snapshot_sequence
              from space_draft where id = ${ref.draftId} and organization_id = ${ref.organizationId}
              for update`
      : sql`select organization_id, epoch, sequence, committed_sequence, fenced_at, snapshot, snapshot_sequence
              from space_draft where id = ${ref.draftId} and organization_id = ${ref.organizationId}`,
  );
  const draft = rows[0];
  if (!draft || draft.fenced_at || draft.epoch !== ref.epoch)
    throw unavailable();
  return draft;
}

// The complete current state of a draft epoch, merged into one update.
export async function loadDraft(db: Database, ref: DraftRef) {
  return db.transaction(
    async (tx) => {
      const draft = await currentDraft(tx, ref, false);
      const updates = await tx.execute<{ update: Buffer }>(
        sql`select "update" from space_draft_update
              where draft_id = ${ref.draftId} and epoch = ${ref.epoch}
                and sequence > ${draft.snapshot_sequence}
              order by sequence`,
      );
      const parts = [
        ...(draft.snapshot ? [new Uint8Array(draft.snapshot)] : []),
        ...updates.map((u) => new Uint8Array(u.update)),
      ];
      return {
        state: parts.length ? Y.mergeUpdates(parts) : new Uint8Array([0, 0]),
        sequence: draft.sequence,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// The content of one epoch of a draft as it was last stored, including an
// epoch that a restore, merge or publishing change replaced: the epoch's
// seed (`space_draft_seed`) plus every update stored for it. This is how
// edits discarded by `restorePageCommit` with `discardDraftChanges` (or
// typed into a replaced epoch and stored before the replacement) are
// recovered, by support and operators or a future editor action. Needs the
// right to write the draft's line now (`canEditDraft`); others learn
// nothing about the draft. Nothing is written: recovering is reading, and
// putting text back is an ordinary edit of the current draft.
export async function recoverDraftEpoch(
  db: Database,
  actor: SpaceActor,
  draftId: string,
  epoch: number,
) {
  return db.transaction(
    async (tx) => {
      await authorize(tx, actor.userId, actor.organizationId);
      const rows = await tx.execute<{
        branch_id: string;
        epoch: number;
        snapshot: Buffer | null;
        snapshot_sequence: number;
      }>(
        sql`select branch_id, epoch, snapshot, snapshot_sequence from space_draft
              where id = ${draftId} and organization_id = ${actor.organizationId}`,
      );
      const draft = rows[0];
      if (!draft || !(await canEditDraft(tx, actor, draft.branch_id)))
        throw unavailable();
      if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > draft.epoch)
        throw new DomainError(
          "not_found",
          `This draft has no epoch ${epoch}; its current epoch is ${draft.epoch}.`,
        );
      const current = epoch === draft.epoch;
      const seed = current
        ? draft.snapshot
        : (
            await tx.execute<{ seed: Buffer }>(
              sql`select seed from space_draft_seed
                    where draft_id = ${draftId} and organization_id = ${actor.organizationId}
                      and epoch = ${epoch}`,
            )
          )[0]?.seed;
      if (!current && !seed)
        throw new DomainError(
          "not_found",
          `The start of epoch ${epoch} of this draft was not kept (it was replaced before seeds were stored), so its edits cannot be reconstructed.`,
        );
      const updates = await tx.execute<{ update: Buffer; sequence: number }>(
        sql`select "update", sequence from space_draft_update
              where draft_id = ${draftId} and organization_id = ${actor.organizationId}
                and epoch = ${epoch}
                and sequence > ${current ? draft.snapshot_sequence : 0}
              order by sequence`,
      );
      const parts = [
        ...(seed ? [new Uint8Array(seed)] : []),
        ...updates.map((u) => new Uint8Array(u.update)),
      ];
      const state = parts.length
        ? Y.mergeUpdates(parts)
        : new Uint8Array([0, 0]);
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, state);
        const content = draftStateToDocument(state);
        return {
          epoch,
          current,
          // The epoch's working title (empty when nobody changed it).
          title: doc.getText("title").toJSON(),
          content,
          markdown: documentToMarkdown(content),
          lastSequence: updates.at(-1)?.sequence ?? null,
        };
      } finally {
        doc.destroy();
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// An author is a person in one signed-in session: signing out or revoking
// the session ends their right to write, even while they stay a member.
export type DraftAuthor = { userId: string; sessionId: string };
type Entry = DraftAuthor & { update: Uint8Array };

const authorKey = (author: DraftAuthor) =>
  `${author.userId}\u0000${author.sessionId}`;

// Session validity, membership, two-factor policy, scheduled deletion and
// space edit access, decided inside the caller's transaction.
async function authorMayWrite(
  tx: Tx,
  author: DraftAuthor,
  ref: DraftRef,
  canEdit: DraftAccess,
) {
  // Better Auth commits membership changes outside the organization lock;
  // the row lock serializes this write with a concurrent removal.
  const member = await tx.execute(
    sql`select 1 from member
          where organization_id = ${ref.organizationId} and user_id = ${author.userId}
          for share`,
  );
  if (!member.length || !(await hasSession(tx, author))) return false;
  const authorized = await authorize(
    tx,
    author.userId,
    ref.organizationId,
  ).then(
    () => true,
    () => false,
  );
  return authorized && (await canEdit(tx, author.userId, ref));
}

export async function hasSession(tx: Database | Tx, author: DraftAuthor) {
  const rows = await tx.execute(
    sql`select 1 from session
          where id = ${author.sessionId} and user_id = ${author.userId}
            and expires_at > now()`,
  );
  return rows.length > 0;
}

// Appends updates in one transaction. Updates of authors who lost access are
// refused, the others are stored. An update already stored (a retry after a
// commit whose acknowledgement was lost) is not stored twice: Yjs updates carry
// their client id and clock, so equal bytes are the same change.
export async function appendDraftUpdates(
  db: Database,
  ref: DraftRef,
  entries: Entry[],
  canEdit: DraftAccess,
) {
  return db.transaction(async (tx) => {
    // Shared mode: waits for (and blocks) exclusive domain mutations of the
    // organization, never other drafts. Order: organization lock, member rows,
    // draft row. Never upgraded to exclusive in this transaction.
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(hashtextextended(${ref.organizationId}, 0))`,
    );
    const denied = new Set<string>();
    const authors = new Map(entries.map((e) => [authorKey(e), e]));
    for (const [key, author] of authors)
      if (!(await authorMayWrite(tx, author, ref, canEdit))) denied.add(key);
    const draft = await currentDraft(tx, ref, true);
    const accepted = entries.filter((e) => !denied.has(authorKey(e)));
    let sequence = draft.sequence;
    for (const entry of accepted) {
      const digest = createHash("sha256").update(entry.update).digest();
      const inserted = await tx.execute(
        sql`insert into space_draft_update
              (organization_id, draft_id, epoch, sequence, author_id, digest, "update")
              values (${ref.organizationId}, ${ref.draftId}, ${ref.epoch}, ${sequence + 1},
                      ${entry.userId}, ${digest}, ${Buffer.from(entry.update)})
              on conflict (draft_id, epoch, digest) do nothing
              returning sequence`,
      );
      if (inserted.length) sequence += 1;
    }
    if (sequence !== draft.sequence)
      await tx.execute(
        sql`update space_draft set sequence = ${sequence}, updated_at = now()
              where id = ${ref.draftId}`,
      );
    // The first stored edit beyond the last commit: projections show
    // "uncommitted changes" from now on (`refreshDraftProjections`).
    const becameDirty =
      draft.sequence <= draft.committed_sequence &&
      sequence > draft.committed_sequence;
    return { sequence, denied, becameDirty };
  });
}

type Pending = Entry & {
  resolve: (sequence: number) => void;
  reject: (error: unknown) => void;
};

// One writer per loaded draft epoch. `submit` resolves once the update is
// durably stored; the collaboration service applies and broadcasts it only
// then, so nobody sees, and no author is told "Saved" about, an edit the
// database does not hold.
export class DraftWriter {
  private pending: Pending[] = [];
  private pendingBytes = 0;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    readonly ref: DraftRef,
    private readonly canEdit: DraftAccess,
    // A database failure is retried with backoff for this long while the
    // edits stay unsaved (and invisible to peers); after that they are refused
    // and the client reconnects and offers them again. Short on purpose: the
    // client, not the server, holds unsaved work during an outage.
    private readonly retryForMs = 5_000,
  ) {}

  submit(author: DraftAuthor, update: Uint8Array): Promise<number> {
    if (update.byteLength > DRAFT_LIMITS.updateBytes)
      return Promise.reject(
        new DomainError("validation", SAVE_REFUSALS.tooLarge),
      );
    // Never store what cannot be read back: a malformed update would make
    // the draft impossible to load.
    try {
      Y.decodeUpdate(update);
    } catch {
      return Promise.reject(
        new DomainError("validation", SAVE_REFUSALS.unreadable),
      );
    }
    if (this.pendingBytes + update.byteLength > DRAFT_LIMITS.pendingBytes)
      return Promise.reject(
        new DomainError("unavailable", "Saving is behind; reconnecting."),
      );
    this.pendingBytes += update.byteLength;
    return new Promise((resolve, reject) => {
      this.pending.push({ ...author, update, resolve, reject });
      this.flushing ??= this.flush();
    });
  }

  // Resolves when everything submitted so far is settled.
  async idle() {
    while (this.flushing) await this.flushing;
  }

  private async append(batch: Pending[]) {
    const deadline = Date.now() + this.retryForMs;
    for (let delay = 100; ; delay = Math.min(delay * 2, 2_000)) {
      try {
        return await appendDraftUpdates(this.db, this.ref, batch, this.canEdit);
      } catch (error) {
        // Access and availability decisions are final; only failures of the
        // database itself are worth retrying.
        if (error instanceof DomainError || Date.now() + delay > deadline)
          throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async flush() {
    try {
      while (this.pending.length) {
        let bytes = 0;
        let count = 0;
        while (
          count < this.pending.length &&
          (count === 0 ||
            bytes + this.pending[count]!.update.byteLength <=
              DRAFT_LIMITS.batchBytes)
        )
          bytes += this.pending[count++]!.update.byteLength;
        const batch = this.pending.splice(0, count);
        try {
          const { sequence, denied, becameDirty } = await this.append(batch);
          for (const entry of batch)
            if (denied.has(authorKey(entry)))
              entry.reject(
                new DomainError("forbidden", SAVE_REFUSALS.cannotEdit),
              );
            else entry.resolve(sequence);
          // After the authors were told "Saved": a failure here only delays
          // the flag until the next commit or projection rebuild, and the
          // merge gates read the draft itself.
          if (becameDirty)
            await refreshDraftProjections(
              this.db,
              this.ref.organizationId,
              this.ref.draftId,
            ).catch(() => undefined);
        } catch (error) {
          for (const entry of batch) entry.reject(error);
        } finally {
          this.pendingBytes -= bytes;
        }
      }
    } finally {
      this.flushing = null;
    }
  }
}
