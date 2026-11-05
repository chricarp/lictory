// Live draft persistence for Lictory Spaces (spike: the draft tables are not
// migrated yet; see docs/internals/spaces.md#draft-writes-a-narrow-exception-to-the-domain-write-rule).
//
// A live draft is a Yjs document stored as a compacted snapshot plus an
// append-only update log. Updates are written by one writer per draft that
// groups everything that arrives while the previous transaction is in flight
// (group commit), so a busy room costs one transaction per database round trip
// instead of one per keystroke.
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  authorize,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";

// One epoch of one draft. A new epoch replaces the content (restore, merging
// main into a branch); writes for an older epoch are refused.
export type DraftRef = {
  organizationId: string;
  draftId: string;
  epoch: number;
};

// Space access, decided inside the writer's transaction.
export type DraftAccess = (
  tx: Tx,
  userId: string,
  ref: DraftRef,
) => Promise<boolean>;

export const DRAFT_LIMITS = {
  // A single Yjs update (one message from one editor).
  updateBytes: 512 * 1024,
  // One group-commit transaction.
  batchBytes: 4 * 1024 * 1024,
};

const unavailable = () =>
  new DomainError("not_found", "This draft is no longer available.");

async function currentDraft(
  tx: Database | Tx,
  ref: DraftRef,
  forUpdate: boolean,
) {
  const rows = await tx.execute<{
    organization_id: string;
    epoch: number;
    sequence: number;
    fenced_at: Date | null;
    snapshot: Buffer | null;
    snapshot_sequence: number;
  }>(
    forUpdate
      ? sql`select organization_id, epoch, sequence, fenced_at, null::bytea as snapshot, snapshot_sequence
              from space_draft where id = ${ref.draftId} and organization_id = ${ref.organizationId}
              for update`
      : sql`select organization_id, epoch, sequence, fenced_at, snapshot, snapshot_sequence
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

type Entry = { userId: string; update: Uint8Array };

// Appends updates in one transaction. Each author is checked against current
// membership, two-factor policy, scheduled deletion and space edit access;
// updates of authors who lost access are refused, the others are stored.
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
    for (const userId of new Set(entries.map((e) => e.userId))) {
      // Better Auth commits membership changes outside the organization lock;
      // the row lock serializes this write with a concurrent removal.
      const member = await tx.execute(
        sql`select 1 from member
              where organization_id = ${ref.organizationId} and user_id = ${userId}
              for share`,
      );
      const allowed =
        member.length > 0 &&
        (await authorize(tx, userId, ref.organizationId).then(
          () => true,
          () => false,
        )) &&
        (await canEdit(tx, userId, ref));
      if (!allowed) denied.add(userId);
    }
    const draft = await currentDraft(tx, ref, true);
    const accepted = entries.filter((e) => !denied.has(e.userId));
    let sequence = draft.sequence;
    for (const entry of accepted) {
      sequence += 1;
      await tx.execute(
        sql`insert into space_draft_update (organization_id, draft_id, epoch, sequence, author_id, "update")
              values (${ref.organizationId}, ${ref.draftId}, ${ref.epoch}, ${sequence},
                      ${entry.userId}, ${Buffer.from(entry.update)})`,
      );
    }
    if (accepted.length)
      await tx.execute(
        sql`update space_draft set sequence = ${sequence}, updated_at = now()
              where id = ${ref.draftId}`,
      );
    return { sequence, denied };
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
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    readonly ref: DraftRef,
    private readonly canEdit: DraftAccess,
    // A database failure is retried with backoff for this long while the
    // edits stay unsaved (and invisible to peers); after that they are refused
    // and the client reconnects and offers them again.
    private readonly retryForMs = 30_000,
  ) {}

  submit(userId: string, update: Uint8Array): Promise<number> {
    if (update.byteLength > DRAFT_LIMITS.updateBytes)
      return Promise.reject(
        new DomainError(
          "validation",
          "This change is too large to save at once.",
        ),
      );
    return new Promise((resolve, reject) => {
      this.pending.push({ userId, update, resolve, reject });
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
          const { sequence, denied } = await this.append(batch);
          for (const entry of batch)
            if (denied.has(entry.userId))
              entry.reject(
                new DomainError(
                  "forbidden",
                  "You can no longer edit this page.",
                ),
              );
            else entry.resolve(sequence);
        } catch (error) {
          for (const entry of batch) entry.reject(error);
        }
      }
    } finally {
      this.flushing = null;
    }
  }
}
