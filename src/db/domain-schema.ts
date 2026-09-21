import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

import { organization, user } from "./auth-schema";

// Keep IDs compatible with Better Auth's text IDs; domain IDs are UUID strings.
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

// Product owns the workflow up to `ready`; later statuses may eventually be
// synchronized from a delivery system. `ready` is gated by readiness evidence.
export const workItemStatus = pgEnum("work_item_status", [
  "backlog",
  "draft",
  "refinement",
  "in_review",
  "ready",
  "in_progress",
  "done",
  "cancelled",
]);
export const workItemKind = pgEnum("work_item_kind", ["epic", "story", "task"]);
export const workItemPriority = pgEnum("work_item_priority", [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);
export const reviewStatus = pgEnum("review_status", [
  "requested",
  "in_progress",
  "changes_requested",
  "completed",
  "cancelled",
]);
export const threadStatus = pgEnum("thread_status", ["open", "resolved"]);
export const suggestionStatus = pgEnum("suggestion_status", [
  "pending",
  "accepted",
  "rejected",
]);
export const approvalStatus = pgEnum("approval_status", [
  "granted",
  "revoked",
  "stale",
]);
export const checkStatus = pgEnum("check_status", [
  "pending",
  "running",
  "passed",
  "failed",
  "error",
  "skipped",
]);
export const deliverySyncStatus = pgEnum("delivery_sync_status", [
  "pending",
  "synced",
  "failed",
  "conflict",
]);

export const group = pgTable(
  "functional_group",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("group_org_id_unique").on(t.organizationId, t.id),
    unique("group_org_name_unique").on(t.organizationId, t.name),
  ],
);

// Functional membership only. Better Auth member remains the authority for
// organization access; the server must validate it before assigning a user.
export const groupMember = pgTable(
  "group_member",
  {
    organizationId: organizationId(),
    groupId: text("group_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [group.organizationId, group.id],
    }).onDelete("cascade"),
    index("group_member_org_user_idx").on(t.organizationId, t.userId),
  ],
);

export const product = pgTable(
  "product",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Short uppercase identifier prefix for work items, e.g. PAY in PAY-142.
    key: text("key").notNull(),
    description: text("description"),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("product_org_id_unique").on(t.organizationId, t.id),
    unique("product_org_slug_unique").on(t.organizationId, t.slug),
    unique("product_org_key_unique").on(t.organizationId, t.key),
    check("product_key_format", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
  ],
);

export const milestoneStatus = pgEnum("milestone_status", [
  "planned",
  "active",
  "completed",
  "cancelled",
]);

// Labels are lightweight, product-scoped tags. Color is a small named palette
// so meaning stays consistent rather than every label being a saturated hue.
export const label = pgTable(
  "label",
  {
    id: id(),
    organizationId: organizationId(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    color: text("color").default("gray").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("label_org_id_unique").on(t.organizationId, t.id),
    unique("label_product_name_unique").on(
      t.organizationId,
      t.productId,
      t.name,
    ),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [product.organizationId, product.id],
    }).onDelete("restrict"),
  ],
);

// A target release or planning horizon. Deliberately not a sprint.
export const milestone = pgTable(
  "milestone",
  {
    id: id(),
    organizationId: organizationId(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    targetDate: timestamp("target_date"),
    status: milestoneStatus("status").default("planned").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("milestone_org_id_unique").on(t.organizationId, t.id),
    unique("milestone_product_name_unique").on(
      t.organizationId,
      t.productId,
      t.name,
    ),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [product.organizationId, product.id],
    }).onDelete("restrict"),
  ],
);

// Work items are Epics, Stories and Tasks.
export const workItem = pgTable(
  "work_item",
  {
    id: id(),
    organizationId: organizationId(),
    productId: text("product_id").notNull(),
    parentId: text("parent_id"),
    kind: workItemKind("kind").default("story").notNull(),
    // Per-product sequence rendered as KEY-number. Allocated under the
    // organization lock; the unique constraint arbitrates races.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    problemStatement: text("problem_statement"),
    status: workItemStatus("status").default("draft").notNull(),
    priority: workItemPriority("priority").default("none").notNull(),
    assigneeId: optionalActor("assignee_id"),
    milestoneId: text("milestone_id"),
    // Manual ordering among siblings (stories inside an epic). Sparse integers.
    position: integer("position").default(0).notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("proposal_org_id_unique").on(t.organizationId, t.id),
    unique("proposal_product_id_unique").on(
      t.organizationId,
      t.productId,
      t.id,
    ),
    unique("work_item_product_number_unique").on(
      t.organizationId,
      t.productId,
      t.number,
    ),
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [product.organizationId, product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_parent_fk",
      columns: [t.organizationId, t.productId, t.parentId],
      foreignColumns: [t.organizationId, t.productId, t.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_milestone_fk",
      columns: [t.organizationId, t.milestoneId],
      foreignColumns: [milestone.organizationId, milestone.id],
    }).onDelete("restrict"),
    check(
      "work_item_not_own_parent",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    check("work_item_positive_number", sql`${t.number} > 0`),
    index("work_item_product_status_idx").on(
      t.organizationId,
      t.productId,
      t.status,
      t.updatedAt,
    ),
    index("work_item_creator_idx").on(t.organizationId, t.createdById),
    index("work_item_parent_idx").on(t.organizationId, t.parentId),
    index("work_item_assignee_idx").on(t.organizationId, t.assigneeId),
    index("work_item_milestone_idx").on(t.organizationId, t.milestoneId),
  ],
);

export const workItemLabel = pgTable(
  "work_item_label",
  {
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    labelId: text("label_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workItemId, t.labelId] }),
    foreignKey({
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.labelId],
      foreignColumns: [label.organizationId, label.id],
    }).onDelete("cascade"),
    index("work_item_label_label_idx").on(t.organizationId, t.labelId),
  ],
);

// Append-only snapshots. No updatedAt: edits and restores insert a new revision.
// Allocate numbers inside a transaction; the unique constraint arbitrates races.
export const specificationRevision = pgTable(
  "specification_revision",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(), // Markdown, including acceptance criteria.
    changeSummary: text("change_summary"),
    authorId: actor("author_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("revision_context_unique").on(t.organizationId, t.workItemId, t.id),
    unique("revision_number_unique").on(
      t.organizationId,
      t.workItemId,
      t.number,
    ),
    foreignKey({
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    check("revision_positive_number", sql`${t.number} > 0`),
  ],
);

// One responsibility per review; multiple people/groups can be assigned below.
export const review = pgTable(
  "review",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    responsibility: text("responsibility").notNull(),
    status: reviewStatus("status").default("requested").notNull(),
    required: boolean("required").default(true).notNull(),
    requestedById: actor("requested_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    unique("review_context_unique").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.id,
    ),
    unique("review_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    index("review_revision_idx").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
    ),
    index("review_status_idx").on(t.organizationId, t.status),
    check(
      "review_responsibility_present",
      sql`length(trim(${t.responsibility})) > 0`,
    ),
  ],
);

export const reviewAssignment = pgTable(
  "review_assignment",
  {
    id: id(),
    organizationId: organizationId(),
    reviewId: text("review_id").notNull(),
    userId: optionalActor("user_id"),
    groupId: text("group_id"),
    assignedById: actor("assigned_by_id"),
    createdAt: createdAt(),
    withdrawnAt: timestamp("withdrawn_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.reviewId],
      foreignColumns: [review.organizationId, review.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [group.organizationId, group.id],
    }).onDelete("restrict"),
    check(
      "review_assignment_one_target",
      sql`(${t.userId} IS NOT NULL) <> (${t.groupId} IS NOT NULL)`,
    ),
    uniqueIndex("review_assignment_active_user_unique")
      .on(t.reviewId, t.userId)
      .where(sql`${t.withdrawnAt} IS NULL`),
    uniqueIndex("review_assignment_active_group_unique")
      .on(t.reviewId, t.groupId)
      .where(sql`${t.withdrawnAt} IS NULL`),
    index("review_assignment_user_idx").on(t.organizationId, t.userId),
    index("review_assignment_group_idx").on(t.organizationId, t.groupId),
    index("review_assignment_review_idx").on(t.organizationId, t.reviewId),
  ],
);

export const thread = pgTable(
  "thread",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    reviewId: text("review_id"),
    authorId: actor("author_id"),
    status: threadStatus("status").default("open").notNull(),
    blocking: boolean("blocking").default(false).notNull(),
    // Optional versioned editor anchor/quoted text; always interpreted against revisionId.
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedById: optionalActor("resolved_by_id"),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    unique("thread_org_id_unique").on(t.organizationId, t.id),
    unique("thread_context_unique").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.id,
    ),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId, t.reviewId],
      foreignColumns: [
        review.organizationId,
        review.workItemId,
        review.revisionId,
        review.id,
      ],
    }).onDelete("restrict"),
    index("thread_item_status_idx").on(
      t.organizationId,
      t.workItemId,
      t.status,
      t.blocking,
    ),
    index("thread_revision_review_idx").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.reviewId,
    ),
    check(
      "thread_resolution_consistent",
      sql`(${t.status} = 'open' AND ${t.resolvedAt} IS NULL AND ${t.resolvedById} IS NULL) OR (${t.status} = 'resolved' AND ${t.resolvedAt} IS NOT NULL AND ${t.resolvedById} IS NOT NULL)`,
    ),
  ],
);

export const threadMessage = pgTable(
  "thread_message",
  {
    id: id(),
    organizationId: organizationId(),
    threadId: text("thread_id").notNull(),
    authorId: actor("author_id"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.threadId],
      foreignColumns: [thread.organizationId, thread.id],
    }).onDelete("restrict"),
    index("thread_message_chronology_idx").on(
      t.organizationId,
      t.threadId,
      t.createdAt,
      t.id,
    ),
  ],
);

export const suggestion = pgTable(
  "suggestion",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    threadId: text("thread_id"),
    authorId: actor("author_id"),
    // Null anchor means replacement of the whole Markdown document.
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    replacement: text("replacement").notNull(),
    rationale: text("rationale"),
    status: suggestionStatus("status").default("pending").notNull(),
    resolvedById: optionalActor("resolved_by_id"),
    resolvedAt: timestamp("resolved_at"),
    acceptedRevisionId: text("accepted_revision_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId, t.threadId],
      foreignColumns: [
        thread.organizationId,
        thread.workItemId,
        thread.revisionId,
        thread.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.acceptedRevisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    index("suggestion_revision_status_idx").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.status,
    ),
    check(
      "suggestion_resolution_consistent",
      sql`(${t.status} = 'pending' AND ${t.resolvedAt} IS NULL AND ${t.resolvedById} IS NULL AND ${t.acceptedRevisionId} IS NULL) OR (${t.status} = 'rejected' AND ${t.resolvedAt} IS NOT NULL AND ${t.resolvedById} IS NOT NULL AND ${t.acceptedRevisionId} IS NULL) OR (${t.status} = 'accepted' AND ${t.resolvedAt} IS NOT NULL AND ${t.resolvedById} IS NOT NULL AND ${t.acceptedRevisionId} IS NOT NULL AND ${t.acceptedRevisionId} <> ${t.revisionId})`,
    ),
  ],
);

// Responsibility is obtained from the referenced review, never from group membership.
export const approval = pgTable(
  "approval",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    reviewId: text("review_id").notNull(),
    reviewerId: actor("reviewer_id"),
    status: approvalStatus("status").default("granted").notNull(),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at"),
    endedById: optionalActor("ended_by_id"),
    endReason: text("end_reason"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId, t.reviewId],
      foreignColumns: [
        review.organizationId,
        review.workItemId,
        review.revisionId,
        review.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("approval_active_reviewer_unique")
      .on(t.reviewId, t.reviewerId)
      .where(sql`${t.status} = 'granted'`),
    index("approval_revision_status_idx").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.status,
    ),
    index("approval_reviewer_idx").on(t.organizationId, t.reviewerId),
    check(
      "approval_end_consistent",
      sql`(${t.status} = 'granted' AND ${t.endedAt} IS NULL AND ${t.endedById} IS NULL AND ${t.endReason} IS NULL) OR (${t.status} <> 'granted' AND ${t.endedAt} IS NOT NULL AND ${t.endReason} IS NOT NULL)`,
    ),
  ],
);

// Each evaluation is a separate result, so reruns retain earlier evidence.
export const readinessCheck = pgTable(
  "readiness_check",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    key: text("key").notNull(),
    status: checkStatus("status").default("pending").notNull(),
    blocking: boolean("blocking").default(false).notNull(),
    evaluatedById: optionalActor("evaluated_by_id"),
    evaluator: text("evaluator").notNull(), // e.g. manual or a versioned automated evaluator.
    explanation: text("explanation"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    index("readiness_check_revision_key_idx").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.key,
      t.createdAt,
    ),
    check(
      "readiness_completion_consistent",
      sql`(${t.status} IN ('pending', 'running') AND ${t.completedAt} IS NULL) OR (${t.status} IN ('passed', 'failed', 'error', 'skipped') AND ${t.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const decision = pgTable(
  "decision",
  {
    id: id(),
    organizationId: organizationId(),
    productId: text("product_id").notNull(),
    workItemId: text("work_item_id"),
    revisionId: text("revision_id"),
    sourceThreadId: text("source_thread_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    authorId: actor("author_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.productId],
      foreignColumns: [product.organizationId, product.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.productId, t.workItemId],
      foreignColumns: [
        workItem.organizationId,
        workItem.productId,
        workItem.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId, t.sourceThreadId],
      foreignColumns: [
        thread.organizationId,
        thread.workItemId,
        thread.revisionId,
        thread.id,
      ],
    }).onDelete("restrict"),
    check(
      "decision_source_context",
      sql`(${t.revisionId} IS NULL OR ${t.workItemId} IS NOT NULL) AND (${t.sourceThreadId} IS NULL OR ${t.revisionId} IS NOT NULL)`,
    ),
    index("decision_product_idx").on(
      t.organizationId,
      t.productId,
      t.createdAt,
    ),
    index("decision_item_idx").on(t.organizationId, t.workItemId),
  ],
);

export const deliveryItem = pgTable(
  "delivery_item",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    parentId: text("parent_id"),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(), // Product vocabulary, not provider issue types.
    position: integer("position").default(0).notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("delivery_item_org_id_unique").on(t.organizationId, t.id),
    unique("delivery_item_context_unique").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.id,
    ),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "delivery_item_parent_context_fk",
      columns: [t.organizationId, t.workItemId, t.revisionId, t.parentId],
      foreignColumns: [t.organizationId, t.workItemId, t.revisionId, t.id],
    }).onDelete("restrict"),
    check(
      "delivery_item_not_own_parent",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    check("delivery_item_position_nonnegative", sql`${t.position} >= 0`),
    index("delivery_item_hierarchy_idx").on(
      t.organizationId,
      t.workItemId,
      t.revisionId,
      t.parentId,
      t.position,
    ),
  ],
);

// External namespace is the remote installation/workspace, not a secret or project key.
// Connection configuration, credentials and provider field mappings come later.
export const deliveryExternalLink = pgTable(
  "delivery_external_link",
  {
    id: id(),
    organizationId: organizationId(),
    deliveryItemId: text("delivery_item_id").notNull(),
    provider: text("provider").notNull(),
    externalNamespace: text("external_namespace").notNull(),
    externalId: text("external_id"),
    externalKey: text("external_key"),
    externalUrl: text("external_url"),
    status: deliverySyncStatus("status").default("pending").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    syncedAt: timestamp("synced_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.deliveryItemId],
      foreignColumns: [deliveryItem.organizationId, deliveryItem.id],
    }).onDelete("restrict"),
    unique("delivery_external_destination_unique").on(
      t.organizationId,
      t.deliveryItemId,
      t.provider,
      t.externalNamespace,
    ),
    unique("delivery_external_identity_unique").on(
      t.organizationId,
      t.provider,
      t.externalNamespace,
      t.externalId,
    ),
    index("delivery_external_sync_idx").on(t.organizationId, t.status),
    check(
      "delivery_external_synced_identity",
      sql`${t.status} <> 'synced' OR (${t.externalId} IS NOT NULL AND ${t.syncedAt} IS NOT NULL)`,
    ),
  ],
);
