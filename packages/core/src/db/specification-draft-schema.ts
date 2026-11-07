import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "@lictory/core/db/auth-schema";
import {
  specificationBranch,
  specificationCommit,
  specificationRevision,
  workItem,
} from "@lictory/core/db/domain-schema";

// Live drafts of specifications: the shared working tree of one line of a
// specification (main, or one branch), edited by several people at once
// through the collaboration service. The same machinery as the live drafts of
// Lictory Spaces (packages/core/src/spaces/drafts.ts, written by the draft
// writer under the organization lock in shared mode); see
// docs/internals/specification-drafts.md. A draft is never history: only
// "Save revision" (main) and "Commit" (a branch) seal an exact stored cut into
// an immutable revision or commit. Not replicated; the `specDraft` entity of
// `sync_entity` summarizes it (epoch, document name, uncommitted changes).

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });
const createdAt = () => timestamp("created_at").defaultNow().notNull();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// One draft per line: main (`branch_id` NULL, based on a revision) or a
// branch (based on a commit). `base_*` is the head the draft's content
// corresponds to at `committed_sequence`; a head that moves from outside the
// draft with other content starts a new epoch.
export const specificationDraft = pgTable(
  "specification_draft",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    branchId: text("branch_id"),
    epoch: integer("epoch").default(1).notNull(),
    // Last stored update (sequence numbers continue across epochs).
    sequence: integer("sequence").default(0).notNull(),
    // Last sequence sealed into a revision or commit; beyond it the draft
    // has unsaved changes.
    committedSequence: integer("committed_sequence").default(0).notNull(),
    baseRevisionId: text("base_revision_id"),
    baseCommitId: text("base_commit_id"),
    snapshot: bytea("snapshot"),
    snapshotSequence: integer("snapshot_sequence").default(0).notNull(),
    fencedAt: timestamp("fenced_at"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("specification_draft_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("specification_draft_main_unique")
      .on(t.organizationId, t.workItemId)
      .where(sql`${t.branchId} is null`),
    unique("specification_draft_branch_unique").on(t.branchId),
    index("specification_draft_item_idx").on(t.organizationId, t.workItemId),
    foreignKey({
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.branchId],
      foreignColumns: [
        specificationBranch.organizationId,
        specificationBranch.workItemId,
        specificationBranch.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.baseRevisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.baseCommitId],
      foreignColumns: [
        specificationCommit.organizationId,
        specificationCommit.workItemId,
        specificationCommit.id,
      ],
    }).onDelete("restrict"),
    check(
      "specification_draft_line_base",
      sql`(${t.branchId} IS NULL AND ${t.baseRevisionId} IS NOT NULL AND ${t.baseCommitId} IS NULL)
        OR (${t.branchId} IS NOT NULL AND ${t.baseCommitId} IS NOT NULL AND ${t.baseRevisionId} IS NULL)`,
    ),
    check("specification_draft_epoch_positive", sql`${t.epoch} > 0`),
    check(
      "specification_draft_sequences",
      sql`${t.sequence} >= 0 AND ${t.committedSequence} >= 0 AND ${t.snapshotSequence} >= 0
        AND ${t.committedSequence} <= ${t.sequence} AND ${t.snapshotSequence} <= ${t.sequence}`,
    ),
  ],
);

// The append-only update log of a specification draft, like
// `space_draft_update`: each update stored once per epoch (by digest).
export const specificationDraftUpdate = pgTable(
  "specification_draft_update",
  {
    organizationId: organizationId(),
    draftId: text("draft_id").notNull(),
    epoch: integer("epoch").notNull(),
    sequence: integer("sequence").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    digest: bytea("digest").notNull(),
    update: bytea("update").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.sequence] }),
    unique("specification_draft_update_digest_unique").on(
      t.draftId,
      t.epoch,
      t.digest,
    ),
    foreignKey({
      columns: [t.organizationId, t.draftId],
      foreignColumns: [
        specificationDraft.organizationId,
        specificationDraft.id,
      ],
    }).onDelete("restrict"),
  ],
);

// The start of every epoch, written once: the Yjs state and the exact
// Markdown it was read from (`source`), so a replaced epoch can be
// reconstructed and untouched blocks keep their bytes when it is converted
// back to Markdown.
export const specificationDraftSeed = pgTable(
  "specification_draft_seed",
  {
    organizationId: organizationId(),
    draftId: text("draft_id").notNull(),
    epoch: integer("epoch").notNull(),
    seed: bytea("seed").notNull(),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.epoch] }),
    foreignKey({
      columns: [t.organizationId, t.draftId],
      foreignColumns: [
        specificationDraft.organizationId,
        specificationDraft.id,
      ],
    }).onDelete("restrict"),
    check("specification_draft_seed_epoch_positive", sql`${t.epoch} > 0`),
  ],
);
