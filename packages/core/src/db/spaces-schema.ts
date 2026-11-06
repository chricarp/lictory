import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "@lictory/core/db/auth-schema";
import { project, team } from "@lictory/core/db/domain-schema";

// Lictory Spaces: spaces of nested pages with their own reviewed history. See
// docs/internals/spaces.md. Every table carries its organization, and
// composite foreign keys keep a page, commit, branch or draft inside its own
// space and page, so a valid id from another context can never be attached.
// History (commits, branches, pages, spaces) uses restrictive deletes; only
// the organization deletion job removes it, table by table.

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
const updatedAt = () =>
  timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// Inherited: the home's members edit, every other organization member views,
// named grants add. Restricted: only named grants count.
export const spaceAccessMode = pgEnum("space_access_mode", [
  "inherited",
  "restricted",
]);
// Direct: main has a live draft that editors publish. Reviewed: main is
// protected and changes arrive through reviewed pull requests.
export const spacePublishing = pgEnum("space_publishing", [
  "direct",
  "reviewed",
]);
// Ordered: view < comment < edit.
export const spaceAccessLevel = pgEnum("space_access_level", [
  "view",
  "comment",
  "edit",
]);

// A home for knowledge. Its home is the organization (no project), a project,
// or a team of that project; the composite key keeps the team inside the
// project.
export const space = pgTable(
  "space",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    // Lowercase URL handle, unique among the organization's active spaces.
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon"),
    projectId: text("project_id"),
    teamId: text("team_id"),
    accessMode: spaceAccessMode("access_mode").default("inherited").notNull(),
    publishing: spacePublishing("publishing").default("direct").notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
    archivedById: optionalActor("archived_by_id"),
  },
  (t) => [
    unique("space_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("space_active_slug_unique")
      .on(t.organizationId, sql`lower(${t.slug})`)
      .where(sql`${t.archivedAt} IS NULL`),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.teamId],
      foreignColumns: [team.organizationId, team.projectId, team.id],
    }).onDelete("restrict"),
    index("space_org_project_idx").on(t.organizationId, t.projectId),
    check(
      "space_team_needs_project",
      sql`${t.teamId} IS NULL OR ${t.projectId} IS NOT NULL`,
    ),
    check("space_name_present", sql`length(trim(${t.name})) > 0`),
    check("space_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      "space_archive_consistent",
      sql`(${t.archivedAt} IS NULL) = (${t.archivedById} IS NULL)`,
    ),
  ],
);

// Named access to a space. In inherited spaces grants only add access; in
// restricted spaces they are the only access. Grants of people who leave the
// organization stay (and grant nothing) like their project memberships;
// deleting an account removes them.
export const spaceGrant = pgTable(
  "space_grant",
  {
    organizationId: organizationId(),
    spaceId: text("space_id").notNull(),
    userId: actor("user_id"),
    level: spaceAccessLevel("level").notNull(),
    grantedById: actor("granted_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.spaceId],
      foreignColumns: [space.organizationId, space.id],
    }).onDelete("restrict"),
    index("space_grant_org_user_idx").on(t.organizationId, t.userId),
  ],
);

// Effective access, derived from the space, its home's memberships, grants
// and organization membership by `refreshSpaceAccess`
// (packages/core/src/spaces/access.ts) in the same transaction as every change
// of those inputs. Replicated by Zero: Spaces queries authorize through it.
export const spaceReader = pgTable(
  "space_reader",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    level: spaceAccessLevel("level").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.spaceId],
      foreignColumns: [space.organizationId, space.id],
    }).onDelete("cascade"),
    index("space_reader_org_user_idx").on(t.organizationId, t.userId),
  ],
);

// A page of a space, optionally under a parent page of the same space.
// Siblings are ordered by a fractional rank. The title lives in commits.
// Archiving hides the page and its subtree and is reversible.
export const page = pgTable(
  "page",
  {
    id: id(),
    organizationId: organizationId(),
    spaceId: text("space_id").notNull(),
    parentId: text("parent_id"),
    rank: text("rank").notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    archivedAt: timestamp("archived_at"),
    archivedById: optionalActor("archived_by_id"),
  },
  (t) => [
    unique("page_org_id_unique").on(t.organizationId, t.id),
    unique("page_space_id_unique").on(t.organizationId, t.spaceId, t.id),
    foreignKey({
      columns: [t.organizationId, t.spaceId],
      foreignColumns: [space.organizationId, space.id],
    }).onDelete("restrict"),
    // A parent is a page of the same space.
    foreignKey({
      columns: [t.organizationId, t.spaceId, t.parentId],
      foreignColumns: [t.organizationId, t.spaceId, t.id],
    }),
    index("page_space_tree_idx").on(t.organizationId, t.spaceId, t.parentId),
    check(
      "page_not_own_parent",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    check(
      "page_archive_consistent",
      sql`(${t.archivedAt} IS NULL) = (${t.archivedById} IS NULL)`,
    ),
  ],
);

// An immutable snapshot of a page: title and canonical content (Tiptap JSON)
// with the Markdown derived from it, a hash of both, parents, the sealing
// author, everyone who contributed, and the live draft cut it sealed. Never
// updated; restoring an old version creates a new commit.
export const pageCommit = pgTable(
  "page_commit",
  {
    id: id(),
    organizationId: organizationId(),
    pageId: text("page_id").notNull(),
    parentIds: text("parent_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    title: text("title").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    markdown: text("markdown").notNull(),
    hash: text("hash").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    message: text("message"),
    authorId: actor("author_id"),
    contributorIds: text("contributor_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Provenance: the draft epoch and sequence this commit sealed. Not a
    // foreign key: drafts are working trees and point at commits themselves.
    draftId: text("draft_id"),
    draftEpoch: integer("draft_epoch"),
    draftSequence: integer("draft_sequence"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("page_commit_org_id_unique").on(t.organizationId, t.id),
    unique("page_commit_page_id_unique").on(t.organizationId, t.pageId, t.id),
    foreignKey({
      columns: [t.organizationId, t.pageId],
      foreignColumns: [page.organizationId, page.id],
    }).onDelete("restrict"),
    index("page_commit_page_idx").on(t.organizationId, t.pageId, t.createdAt),
    check("page_commit_title_present", sql`length(trim(${t.title})) > 0`),
    check("page_commit_schema_version", sql`${t.schemaVersion} > 0`),
    check(
      "page_commit_draft_provenance",
      sql`(${t.draftId} IS NULL AND ${t.draftEpoch} IS NULL AND ${t.draftSequence} IS NULL)
        OR (${t.draftId} IS NOT NULL AND ${t.draftEpoch} IS NOT NULL AND ${t.draftSequence} IS NOT NULL)`,
    ),
  ],
);

// A movable pointer into a page's commit graph. Every page has exactly one
// `main` (the published line), which is never deleted. Named branches have an
// author and invited collaborators; deleting one keeps its commits.
export const pageBranch = pgTable(
  "page_branch",
  {
    id: id(),
    organizationId: organizationId(),
    pageId: text("page_id").notNull(),
    name: text("name").notNull(),
    isMain: boolean("is_main").default(false).notNull(),
    headCommitId: text("head_commit_id").notNull(),
    // The commit the branch started from; null for main.
    baseCommitId: text("base_commit_id"),
    authorId: actor("author_id"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at"),
    deletedById: optionalActor("deleted_by_id"),
  },
  (t) => [
    unique("page_branch_org_id_unique").on(t.organizationId, t.id),
    unique("page_branch_page_id_unique").on(t.organizationId, t.pageId, t.id),
    foreignKey({
      columns: [t.organizationId, t.pageId],
      foreignColumns: [page.organizationId, page.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.pageId, t.headCommitId],
      foreignColumns: [
        pageCommit.organizationId,
        pageCommit.pageId,
        pageCommit.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.pageId, t.baseCommitId],
      foreignColumns: [
        pageCommit.organizationId,
        pageCommit.pageId,
        pageCommit.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("page_branch_one_main")
      .on(t.pageId)
      .where(sql`${t.isMain}`),
    uniqueIndex("page_branch_active_name_unique")
      .on(t.organizationId, t.pageId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check(
      "page_branch_main_kept",
      sql`NOT (${t.isMain} AND ${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      "page_branch_delete_consistent",
      sql`(${t.deletedAt} IS NULL) = (${t.deletedById} IS NULL)`,
    ),
  ],
);

// People the branch author invited to edit a named branch.
export const pageBranchCollaborator = pgTable(
  "page_branch_collaborator",
  {
    organizationId: organizationId(),
    branchId: text("branch_id").notNull(),
    userId: actor("user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.branchId],
      foreignColumns: [pageBranch.organizationId, pageBranch.id],
    }).onDelete("restrict"),
  ],
);

// The live draft (working tree) of one writable line: a Yjs document stored
// as a compacted snapshot plus the update log below, written by the draft
// writer (packages/core/src/spaces/drafts.ts) under the organization lock in
// shared mode. Not replicated and read by no projection. A new epoch replaces
// the content and fences clients of the previous one; `fenced_at` closes the
// draft (a deleted branch, main of a Reviewed space).
export const spaceDraft = pgTable(
  "space_draft",
  {
    id: id(),
    organizationId: organizationId(),
    pageId: text("page_id").notNull(),
    branchId: text("branch_id").notNull().unique("space_draft_branch_unique"),
    epoch: integer("epoch").default(1).notNull(),
    // Last stored update (sequence numbers continue across epochs).
    sequence: integer("sequence").default(0).notNull(),
    // Last sequence sealed into a commit; `sequence` beyond it is
    // uncommitted.
    committedSequence: integer("committed_sequence").default(0).notNull(),
    // The commit the current epoch started from.
    baseCommitId: text("base_commit_id").notNull(),
    snapshot: bytea("snapshot"),
    snapshotSequence: integer("snapshot_sequence").default(0).notNull(),
    fencedAt: timestamp("fenced_at"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("space_draft_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.pageId, t.branchId],
      foreignColumns: [
        pageBranch.organizationId,
        pageBranch.pageId,
        pageBranch.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.pageId, t.baseCommitId],
      foreignColumns: [
        pageCommit.organizationId,
        pageCommit.pageId,
        pageCommit.id,
      ],
    }).onDelete("restrict"),
    check("space_draft_epoch_positive", sql`${t.epoch} > 0`),
    check(
      "space_draft_sequences",
      sql`${t.sequence} >= 0 AND ${t.committedSequence} >= 0 AND ${t.snapshotSequence} >= 0
        AND ${t.committedSequence} <= ${t.sequence} AND ${t.snapshotSequence} <= ${t.sequence}`,
    ),
  ],
);

// The append-only update log of a draft. Each update is stored once per
// epoch (keyed by its digest), so a retried batch is not duplicated.
export const spaceDraftUpdate = pgTable(
  "space_draft_update",
  {
    organizationId: organizationId(),
    draftId: text("draft_id").notNull(),
    epoch: integer("epoch").notNull(),
    sequence: integer("sequence").notNull(),
    authorId: actor("author_id"),
    digest: bytea("digest").notNull(),
    update: bytea("update").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.sequence] }),
    unique("space_draft_update_digest_unique").on(t.draftId, t.epoch, t.digest),
    foreignKey({
      columns: [t.organizationId, t.draftId],
      foreignColumns: [spaceDraft.organizationId, spaceDraft.id],
    }).onDelete("restrict"),
  ],
);

// Spaces read projections replicated to browsers by Zero, kept apart from
// `sync_entity` so space data can never reach the organization or work item
// queries (or the directory). `data` holds a protocol `SpaceEntity`. Rows with
// a NULL `page_id` are space-level (the space, its grants and its page tree);
// the others belong to that page's history, loaded when the page is opened.
// Written in the same transaction as the domain rows
// (packages/core/src/spaces/projections.ts).
export const spaceEntity = pgTable(
  "space_entity",
  {
    key: text("key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    pageId: text("page_id"),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("space_entity_scope_idx").on(
      t.organizationId,
      t.spaceId,
      t.pageId,
      t.type,
    ),
  ],
);
