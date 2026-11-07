import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "@lictory/core/db/auth-schema";
import {
  iteration,
  project,
  specificationRevision,
  team,
  workItem,
} from "@lictory/core/db/domain-schema";
import { page, pageBranch, pageCommit } from "@lictory/core/db/spaces-schema";

// Knowledge links between Lictory Spaces and Lictory Work
// (docs/internals/knowledge-links.md). Two kinds of rows:
//
// - Derived indexes (`page_reference`, `specification_reference`): the
//   references written in the current published commit of every page and in
//   every main specification revision. Maintained in the same transaction as
//   the head move or revision insert that changes them, rebuildable from the
//   stored commits and revisions, never exported.
// - Explicit links people make (`work_item_page_attachment`,
//   `work_item_page_source`, `page_branch_origin`, `page_context_link`):
//   ordinary organization records with history (detached and removed links
//   keep their rows).
//
// Every row names a page, so its projections follow that page's space
// access (`space_entity`), never organization-wide visibility. Targets of
// references are what the content says (no foreign key): a reference to an
// item that does not exist, or exists in another organization, is indexed
// and matches nothing in this organization.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });
const actor = (name: string) =>
  text(name)
    .notNull()
    .references(() => user.id, { onDelete: "restrict" });
const optionalActor = (name: string) =>
  text(name).references(() => user.id, { onDelete: "restrict" });
const createdAt = () => timestamp("created_at").defaultNow().notNull();

// What a Markdown or page reference points at
// (packages/core/src/contracts/references.ts).
export const referenceKind = pgEnum("reference_kind", [
  "item",
  "page",
  "decision",
]);

// The references of each page's published version: one row per reference
// in the current main head commit (`commit_id`), in document order, with the
// top-level block that holds it. Rewritten whenever main's head moves; older
// commits keep their references in their own content.
export const pageReference = pgTable(
  "page_reference",
  {
    organizationId: organizationId(),
    pageId: text("page_id").notNull(),
    commitId: text("commit_id").notNull(),
    position: integer("position").notNull(),
    blockId: text("block_id"),
    kind: referenceKind("kind").notNull(),
    targetId: text("target_id").notNull(),
    // A page reference pinned to one commit of the target page.
    targetCommitId: text("target_commit_id"),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.position] }),
    foreignKey({
      name: "page_reference_commit_fk",
      columns: [t.organizationId, t.pageId, t.commitId],
      foreignColumns: [
        pageCommit.organizationId,
        pageCommit.pageId,
        pageCommit.id,
      ],
    }).onDelete("restrict"),
    index("page_reference_target_idx").on(t.organizationId, t.kind, t.targetId),
    check("page_reference_position", sql`${t.position} >= 0`),
    check(
      "page_reference_pin",
      sql`${t.targetCommitId} IS NULL OR ${t.kind} = 'page'`,
    ),
  ],
);

// The references written in each main specification revision (item, page
// with an optional pinned commit, decision), distinct by target, in order of
// appearance. Written with the revision and never changed, like it.
export const specificationReference = pgTable(
  "specification_reference",
  {
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    position: integer("position").notNull(),
    kind: referenceKind("kind").notNull(),
    targetId: text("target_id").notNull(),
    targetCommitId: text("target_commit_id"),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.position] }),
    foreignKey({
      name: "specification_reference_revision_fk",
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    index("specification_reference_target_idx").on(
      t.organizationId,
      t.kind,
      t.targetId,
    ),
    index("specification_reference_item_idx").on(
      t.organizationId,
      t.workItemId,
    ),
    check("specification_reference_position", sql`${t.position} >= 0`),
    check(
      "specification_reference_pin",
      sql`${t.targetCommitId} IS NULL OR ${t.kind} = 'page'`,
    ),
  ],
);

// Why a page is attached to a work item. A small fixed vocabulary, not a
// relation builder.
export const pageAttachmentPurpose = pgEnum("page_attachment_purpose", [
  "background",
  "design",
  "runbook",
]);

// A page someone deliberately attached to a work item ("Attach page"),
// optionally pinned to one commit. Detaching keeps the row
// (`detached_at`); attaching again creates a new one. Titles are never
// stored here: readers resolve them from the pages they can read.
export const workItemPageAttachment = pgTable(
  "work_item_page_attachment",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    pageId: text("page_id").notNull(),
    purpose: pageAttachmentPurpose("purpose").notNull(),
    commitId: text("commit_id"),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    detachedAt: timestamp("detached_at"),
    detachedById: optionalActor("detached_by_id"),
  },
  (t) => [
    unique("work_item_page_attachment_org_id_unique").on(
      t.organizationId,
      t.id,
    ),
    foreignKey({
      name: "work_item_page_attachment_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_page_attachment_page_fk",
      columns: [t.organizationId, t.pageId],
      foreignColumns: [page.organizationId, page.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_page_attachment_commit_fk",
      columns: [t.organizationId, t.pageId, t.commitId],
      foreignColumns: [
        pageCommit.organizationId,
        pageCommit.pageId,
        pageCommit.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("work_item_page_attachment_active_unique")
      .on(t.organizationId, t.workItemId, t.pageId)
      .where(sql`${t.detachedAt} IS NULL`),
    index("work_item_page_attachment_item_idx").on(
      t.organizationId,
      t.workItemId,
    ),
    index("work_item_page_attachment_page_idx").on(t.organizationId, t.pageId),
    check(
      "work_item_page_attachment_detach_consistent",
      sql`(${t.detachedAt} IS NULL) = (${t.detachedById} IS NULL)`,
    ),
  ],
);

// Where a work item came from when it was created from committed page
// content: the page, the exact commit, the top-level block and the quoted
// selection. Written once with the item and never changed.
export const workItemPageSource = pgTable(
  "work_item_page_source",
  {
    organizationId: organizationId(),
    workItemId: text("work_item_id").primaryKey(),
    pageId: text("page_id").notNull(),
    commitId: text("commit_id").notNull(),
    blockId: text("block_id"),
    quote: text("quote"),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "work_item_page_source_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_page_source_commit_fk",
      columns: [t.organizationId, t.pageId, t.commitId],
      foreignColumns: [
        pageCommit.organizationId,
        pageCommit.pageId,
        pageCommit.id,
      ],
    }).onDelete("restrict"),
    index("work_item_page_source_page_idx").on(t.organizationId, t.pageId),
    check(
      "work_item_page_source_quote_length",
      sql`${t.quote} IS NULL OR length(${t.quote}) <= 2000`,
    ),
  ],
);

// The work item revision a page branch was opened from ("Propose page
// update" on an item). Written once with the branch; kept when the branch
// is merged or deleted, so both sides stay traceable.
export const pageBranchOrigin = pgTable(
  "page_branch_origin",
  {
    organizationId: organizationId(),
    branchId: text("branch_id").primaryKey(),
    pageId: text("page_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    // What the change is, as the person named it when opening the branch
    // ("Document the finance approval time"); the default title of its pull
    // request. Null for branches opened without one.
    title: text("title"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "page_branch_origin_branch_fk",
      columns: [t.organizationId, t.pageId, t.branchId],
      foreignColumns: [
        pageBranch.organizationId,
        pageBranch.pageId,
        pageBranch.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "page_branch_origin_revision_fk",
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    index("page_branch_origin_item_idx").on(t.organizationId, t.workItemId),
    index("page_branch_origin_page_idx").on(t.organizationId, t.pageId),
  ],
);

// Pages a project, one of its teams or one of its iterations keeps as
// context (board, backlog and iteration "Context"; iteration notes and
// retrospectives), ordered by a fractional rank within that scope.
// Unlinking keeps the row (`removed_at`).
export const pageContextLink = pgTable(
  "page_context_link",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    teamId: text("team_id"),
    iterationId: text("iteration_id"),
    pageId: text("page_id").notNull(),
    rank: text("rank").notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    removedAt: timestamp("removed_at"),
    removedById: optionalActor("removed_by_id"),
  },
  (t) => [
    unique("page_context_link_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      name: "page_context_link_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "page_context_link_team_fk",
      columns: [t.organizationId, t.projectId, t.teamId],
      foreignColumns: [team.organizationId, team.projectId, team.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "page_context_link_iteration_fk",
      columns: [t.organizationId, t.projectId, t.iterationId],
      foreignColumns: [
        iteration.organizationId,
        iteration.projectId,
        iteration.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "page_context_link_page_fk",
      columns: [t.organizationId, t.pageId],
      foreignColumns: [page.organizationId, page.id],
    }).onDelete("restrict"),
    uniqueIndex("page_context_link_active_unique")
      .on(
        t.organizationId,
        t.projectId,
        sql`coalesce(${t.teamId}, '')`,
        sql`coalesce(${t.iterationId}, '')`,
        t.pageId,
      )
      .where(sql`${t.removedAt} IS NULL`),
    index("page_context_link_project_idx").on(t.organizationId, t.projectId),
    index("page_context_link_page_idx").on(t.organizationId, t.pageId),
    check(
      "page_context_link_one_scope",
      sql`${t.teamId} IS NULL OR ${t.iterationId} IS NULL`,
    ),
    check(
      "page_context_link_remove_consistent",
      sql`(${t.removedAt} IS NULL) = (${t.removedById} IS NULL)`,
    ),
  ],
);
