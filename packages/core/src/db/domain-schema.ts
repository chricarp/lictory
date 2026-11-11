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

import type { OnboardingSetup } from "@lictory/core/contracts/protocol";
import type { ReadinessRules } from "@lictory/core/contracts/readiness";
import type { ProposedChild } from "@lictory/core/contracts/decomposition";
import type { AiFinding } from "@lictory/core/contracts/ai";
import type { IntelligenceContextUse } from "@lictory/core/intelligence/shared";
import { organization, user } from "@lictory/core/db/auth-schema";
// Circular with spaces-schema (which homes spaces in projects and teams);
// both only reference each other inside lazy foreign key callbacks.
import { page } from "@lictory/core/db/spaces-schema";

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

// Refinement state exists only on spec-backed items. `ready` is gated by
// readiness evidence and set/cleared automatically by the server.
export const refinementState = pgEnum("refinement_state", [
  "draft",
  "refinement",
  "in_review",
  "ready",
]);
// Fixed categories give meaning to team-defined statuses (boards, burndown,
// readiness gating) without a workflow builder.
export const statusCategory = pgEnum("status_category", [
  "backlog",
  "unstarted",
  "started",
  "done",
  "canceled",
]);
export const deliveryMode = pgEnum("delivery_mode", ["native", "external"]);
export const readinessPolicy = pgEnum("readiness_policy", [
  "off",
  "warn",
  "block",
]);
export const iterationMode = pgEnum("iteration_mode", [
  "off",
  "manual",
  "automatic",
]);
export const iterationState = pgEnum("iteration_state", [
  "planned",
  "active",
  "completed",
]);
export const estimateScale = pgEnum("estimate_scale", [
  "none",
  "fibonacci",
  "linear",
  "tshirt",
]);
export const relationKind = pgEnum("relation_kind", [
  "blocks",
  "relates",
  "duplicates",
]);
export const iterationEventKind = pgEnum("iteration_event_kind", [
  "added",
  "removed",
  "estimate_changed",
  "completed",
  "reopened",
]);
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
// A suggestion is reviewed like a pull request: drafted privately, opened for
// review, then merged into the mainline as a new revision or closed.
export const suggestionStatus = pgEnum("suggestion_status", [
  "draft",
  "open",
  "merged",
  "closed",
]);
export const suggestionDecisionKind = pgEnum("suggestion_decision_kind", [
  "approved",
  "changes_requested",
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
export const aiActionPolicy = pgEnum("ai_action_policy", [
  "off",
  "advisory",
  "required",
]);
export const aiRunKind = pgEnum("ai_run_kind", ["item_review", "pr_action"]);
export const aiRunStatus = pgEnum("ai_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "superseded",
]);
export const deliverySyncStatus = pgEnum("delivery_sync_status", [
  "pending",
  "synced",
  "failed",
  "conflict",
]);

export const project = pgTable(
  "project",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Short uppercase identifier prefix for work items, e.g. PAY in PAY-142.
    key: text("key").notNull(),
    description: text("description"),
    deliveryMode: deliveryMode("delivery_mode").default("native").notNull(),
    readinessPolicy: readinessPolicy("readiness_policy")
      .default("warn")
      .notNull(),
    estimateScale: estimateScale("estimate_scale")
      .default("fibonacci")
      .notNull(),
    iterationMode: iterationMode("iteration_mode").default("manual").notNull(),
    iterationWeeks: integer("iteration_weeks").default(2).notNull(),
    iterationStartDay: integer("iteration_start_day").default(1).notNull(),
    upcomingIterations: integer("upcoming_iterations").default(2).notNull(),
    aiActionPolicy: aiActionPolicy("ai_action_policy")
      .default("advisory")
      .notNull(),
    // Lictory Action: notify a pull request's author when it becomes ready
    // to merge.
    mergeReadyNotice: boolean("merge_ready_notice").default(true).notNull(),
    // Lictory's sample project, created on request so a person can explore
    // the review workflow alone (docs/internals/onboarding.md#sample-project).
    // At most one per organization, archived rather than deleted.
    sample: boolean("sample").default(false).notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("project_org_id_unique").on(t.organizationId, t.id),
    unique("project_org_slug_unique").on(t.organizationId, t.slug),
    unique("project_org_key_unique").on(t.organizationId, t.key),
    check("project_key_format", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
  ],
);

// Project administrators manage the project's configuration; members do the
// work. Organization administrators manage every project without a row here.
export const projectRole = pgEnum("project_role", ["admin", "member"]);
export const projectMember = pgTable(
  "project_member",
  {
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: projectRole("role").default("member").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("cascade"),
    index("project_member_org_user_idx").on(t.organizationId, t.userId),
  ],
);

// Work disciplines (Product, Engineering, QA by default) are project-owned
// groups of project members. They route reviews and carry the work item
// capabilities their members have in that project. They are not application
// roles: those stay on the Better Auth membership and the project role.
export const discipline = pgTable(
  "discipline",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Edit specifications directly and create spec-backed items.
    canEditSpecifications: boolean("can_edit_specifications")
      .default(false)
      .notNull(),
    // Change status, priority, owner, parent, labels, milestones, iterations.
    canChangeProperties: boolean("can_change_properties")
      .default(false)
      .notNull(),
    canRequestReviews: boolean("can_request_reviews").default(false).notNull(),
    // The discipline (or one of its members) can be asked to review.
    canReview: boolean("can_review").default(false).notNull(),
    // Hand ready work to the project's external delivery tool.
    canPublishDelivery: boolean("can_publish_delivery")
      .default(false)
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("discipline_org_id_unique").on(t.organizationId, t.id),
    unique("discipline_project_id_unique").on(
      t.organizationId,
      t.projectId,
      t.id,
    ),
    uniqueIndex("discipline_project_active_name_unique")
      .on(t.organizationId, t.projectId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    check("discipline_name_present", sql`length(trim(${t.name})) > 0`),
  ],
);

export const disciplineMember = pgTable(
  "discipline_member",
  {
    organizationId: organizationId(),
    disciplineId: text("discipline_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.disciplineId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.disciplineId],
      foreignColumns: [discipline.organizationId, discipline.id],
    }).onDelete("cascade"),
    index("discipline_member_org_user_idx").on(t.organizationId, t.userId),
  ],
);

export const milestoneStatus = pgEnum("milestone_status", [
  "planned",
  "active",
  "completed",
  "cancelled",
]);

// Labels are lightweight, project-scoped tags. Color is a small named palette
// so meaning stays consistent rather than every label being a saturated hue.
export const label = pgTable(
  "label",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    color: text("color").default("gray").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("label_org_id_unique").on(t.organizationId, t.id),
    unique("label_project_name_unique").on(
      t.organizationId,
      t.projectId,
      t.name,
    ),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
  ],
);

// A target release or planning horizon. Deliberately not a sprint.
export const milestone = pgTable(
  "milestone",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    targetDate: timestamp("target_date"),
    status: milestoneStatus("status").default("planned").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("milestone_org_id_unique").on(t.organizationId, t.id),
    unique("milestone_project_name_unique").on(
      t.organizationId,
      t.projectId,
      t.name,
    ),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
  ],
);

// A team is a group of people working on one vertical of a project (for
// example Board or Auth inside Jira). It owns no configuration: workflow,
// types, iterations and delivery belong to the project. Items may have no
// team. Team membership organizes people and grants nothing.
export const team = pgTable(
  "team",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("team_org_id_unique").on(t.organizationId, t.id),
    unique("team_project_id_unique").on(t.organizationId, t.projectId, t.id),
    uniqueIndex("team_project_active_name_unique")
      .on(t.organizationId, t.projectId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    check("team_name_present", sql`length(trim(${t.name})) > 0`),
  ],
);

export const teamMember = pgTable(
  "team_member",
  {
    organizationId: organizationId(),
    teamId: text("team_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.teamId],
      foreignColumns: [team.organizationId, team.id],
    }).onDelete("cascade"),
    index("team_member_org_user_idx").on(t.organizationId, t.userId),
  ],
);

// People who left the organization (removed, left, or deleted their
// account). Their history stays, and the directory lists them by name so it
// is still attributed. Grants nothing; a person who rejoins is listed as a
// member again.
export const formerMember = pgTable(
  "former_member",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    leftAt: timestamp("left_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index("former_member_user_idx").on(t.userId),
  ],
);

// Organization-wide type registry. Hierarchy level orders parents above
// children (Epic 2, Story/Task/Bug 1, Subtask 0). Spec-backed types carry
// revisions, reviews, approvals and readiness; others are plain work.
export const workItemType = pgTable(
  "work_item_type",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    color: text("color").default("gray").notNull(),
    level: integer("level").notNull(),
    hasSpecification: boolean("has_specification").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("work_item_type_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("work_item_type_org_active_name_unique")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    check("work_item_type_level", sql`${t.level} BETWEEN 0 AND 3`),
    check("work_item_type_name_present", sql`length(trim(${t.name})) > 0`),
  ],
);

export const projectWorkItemType = pgTable(
  "project_work_item_type",
  {
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    typeId: text("type_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.typeId] }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.typeId],
      foreignColumns: [workItemType.organizationId, workItemType.id],
    }).onDelete("cascade"),
  ],
);

// Project workflow. Any transition is allowed; categories carry the meaning.
export const workflowStatus = pgTable(
  "workflow_status",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    color: text("color").default("gray").notNull(),
    category: statusCategory("category").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("workflow_status_org_id_unique").on(t.organizationId, t.id),
    unique("workflow_status_project_id_unique").on(
      t.organizationId,
      t.projectId,
      t.id,
    ),
    uniqueIndex("workflow_status_project_active_name_unique")
      .on(t.organizationId, t.projectId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    check("workflow_status_name_present", sql`length(trim(${t.name})) > 0`),
  ],
);

// Sprints (manual) and cycles (automatic) are the same concept, planned per
// project; team boards are filtered views of the project's iteration.
export const iteration = pgTable(
  "iteration",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    name: text("name"),
    goal: text("goal"),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    state: iterationState("state").default("planned").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    // Frozen at completion so reports never change retroactively.
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("iteration_org_id_unique").on(t.organizationId, t.id),
    unique("iteration_project_id_unique").on(
      t.organizationId,
      t.projectId,
      t.id,
    ),
    unique("iteration_project_number_unique").on(
      t.organizationId,
      t.projectId,
      t.number,
    ),
    uniqueIndex("iteration_one_active_per_project")
      .on(t.organizationId, t.projectId)
      .where(sql`${t.state} = 'active'`),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    check("iteration_dates", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "iteration_state_consistent",
      sql`(${t.state} = 'planned' AND ${t.startedAt} IS NULL AND ${t.completedAt} IS NULL) OR (${t.state} = 'active' AND ${t.startedAt} IS NOT NULL AND ${t.completedAt} IS NULL) OR (${t.state} = 'completed' AND ${t.startedAt} IS NOT NULL AND ${t.completedAt} IS NOT NULL)`,
    ),
  ],
);

// A project's Definition of Ready, versioned like specifications: every
// publication is an immutable version. Projects without one use Lictory's
// defaults; publishing first records those as version 1.
export const readinessRevision = pgTable(
  "readiness_revision",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    // Checks per work item type id; types without an entry use the defaults.
    rules: jsonb("rules").$type<ReadinessRules>().notNull(),
    summary: text("summary"),
    // Null for the recorded Lictory defaults.
    authorId: optionalActor("author_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("readiness_revision_org_id_unique").on(t.organizationId, t.id),
    unique("readiness_revision_project_number_unique").on(
      t.organizationId,
      t.projectId,
      t.number,
    ),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    check("readiness_revision_positive_number", sql`${t.number} > 0`),
  ],
);

// Work items belong to exactly one project (key, number, workflow, iteration)
// and optionally one of its teams. Refinement and delivery state are
// orthogonal.
export const workItem = pgTable(
  "work_item",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    teamId: text("team_id"),
    typeId: text("type_id").notNull(),
    parentId: text("parent_id"),
    // Per-project sequence rendered as KEY-number. Allocated under the
    // organization lock; the unique constraint arbitrates races.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    problemStatement: text("problem_statement"),
    statusId: text("status_id").notNull(),
    // Null for types without a specification.
    refinementState: refinementState("refinement_state"),
    mainProtected: boolean("main_protected").notNull().default(false),
    priority: workItemPriority("priority").default("none").notNull(),
    assigneeId: optionalActor("assignee_id"),
    milestoneId: text("milestone_id"),
    iterationId: text("iteration_id"),
    estimate: integer("estimate"),
    // Manual ordering among siblings (children of one parent). Sparse integers.
    position: integer("position").default(0).notNull(),
    // Fractional rank for backlog and board order; a move rewrites one row.
    rank: text("rank").notNull(),
    // Revision of the parent specification this item was decomposed from.
    sourceRevisionId: text("source_revision_id"),
    // Native delivery scope. These reference this item's immutable revisions;
    // changes to main never advance either baseline implicitly.
    committedRevisionId: text("committed_revision_id"),
    deliveredRevisionId: text("delivered_revision_id"),
    // Readiness checks revision the item stays evaluated under because it was
    // ready or done when newer checks were published. Null follows the latest.
    readinessRevisionId: text("readiness_revision_id"),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("proposal_org_id_unique").on(t.organizationId, t.id),
    unique("work_item_project_id_unique").on(
      t.organizationId,
      t.projectId,
      t.id,
    ),
    unique("work_item_project_number_unique").on(
      t.organizationId,
      t.projectId,
      t.number,
    ),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    // The team, status and iteration must belong to the item's project.
    foreignKey({
      name: "work_item_team_fk",
      columns: [t.organizationId, t.projectId, t.teamId],
      foreignColumns: [team.organizationId, team.projectId, team.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_status_fk",
      columns: [t.organizationId, t.projectId, t.statusId],
      foreignColumns: [
        workflowStatus.organizationId,
        workflowStatus.projectId,
        workflowStatus.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_iteration_fk",
      columns: [t.organizationId, t.projectId, t.iterationId],
      foreignColumns: [
        iteration.organizationId,
        iteration.projectId,
        iteration.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_type_fk",
      columns: [t.organizationId, t.typeId],
      foreignColumns: [workItemType.organizationId, workItemType.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_parent_fk",
      columns: [t.organizationId, t.projectId, t.parentId],
      foreignColumns: [t.organizationId, t.projectId, t.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_milestone_fk",
      columns: [t.organizationId, t.milestoneId],
      foreignColumns: [milestone.organizationId, milestone.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_item_readiness_revision_fk",
      columns: [t.organizationId, t.readinessRevisionId],
      foreignColumns: [readinessRevision.organizationId, readinessRevision.id],
    }).onDelete("restrict"),
    check(
      "work_item_not_own_parent",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    check("work_item_positive_number", sql`${t.number} > 0`),
    check(
      "work_item_estimate_range",
      sql`${t.estimate} IS NULL OR ${t.estimate} BETWEEN 0 AND 1000`,
    ),
    index("work_item_project_idx").on(
      t.organizationId,
      t.projectId,
      t.updatedAt,
    ),
    index("work_item_project_rank_idx").on(
      t.organizationId,
      t.projectId,
      t.rank,
    ),
    index("work_item_team_idx").on(t.organizationId, t.teamId),
    index("work_item_iteration_idx").on(t.organizationId, t.iterationId),
    index("work_item_creator_idx").on(t.organizationId, t.createdById),
    index("work_item_parent_idx").on(t.organizationId, t.parentId),
    index("work_item_assignee_idx").on(t.organizationId, t.assigneeId),
    index("work_item_milestone_idx").on(t.organizationId, t.milestoneId),
  ],
);

// File bytes are stored only in private object storage. A row is retained when
// removed from the attachment list so historical Markdown links still resolve.
// A file belongs to exactly one owner: a work item (with its project) or a
// Lictory Spaces page, whose space access governs reading it.
export const fileObject = pgTable(
  "file_object",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id"),
    workItemId: text("work_item_id"),
    pageId: text("page_id"),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    readyAt: timestamp("ready_at"),
    removedAt: timestamp("removed_at"),
  },
  (t) => [
    index("file_object_item_idx").on(t.organizationId, t.workItemId),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.workItemId],
      foreignColumns: [
        workItem.organizationId,
        workItem.projectId,
        workItem.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.pageId],
      foreignColumns: [page.organizationId, page.id],
    }).onDelete("restrict"),
    index("file_object_page_idx")
      .on(t.organizationId, t.pageId)
      .where(sql`${t.pageId} IS NOT NULL`),
    check("file_object_size_positive", sql`${t.size} > 0`),
    check(
      "file_object_one_owner",
      sql`(${t.workItemId} IS NOT NULL AND ${t.projectId} IS NOT NULL AND ${t.pageId} IS NULL)
        OR (${t.workItemId} IS NULL AND ${t.projectId} IS NULL AND ${t.pageId} IS NOT NULL)`,
    ),
  ],
);

// Directed relation; inverses (blocked by, duplicated by) are derived.
export const workItemRelation = pgTable(
  "work_item_relation",
  {
    id: id(),
    organizationId: organizationId(),
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    kind: relationKind("kind").notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("work_item_relation_unique").on(
      t.organizationId,
      t.fromId,
      t.toId,
      t.kind,
    ),
    foreignKey({
      columns: [t.organizationId, t.fromId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.toId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("cascade"),
    check("work_item_relation_not_self", sql`${t.fromId} <> ${t.toId}`),
    index("work_item_relation_to_idx").on(t.organizationId, t.toId),
  ],
);

// Recorded, never reconstructed: burndown, scope change and velocity derive
// from these rows, written in the same transaction as the change.
export const iterationEvent = pgTable(
  "iteration_event",
  {
    id: id(),
    organizationId: organizationId(),
    iterationId: text("iteration_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    kind: iterationEventKind("kind").notNull(),
    // Estimate after the event (points), or the delta for estimate_changed.
    points: integer("points").default(0).notNull(),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.iterationId],
      foreignColumns: [iteration.organizationId, iteration.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    index("iteration_event_iteration_idx").on(
      t.organizationId,
      t.iterationId,
      t.createdAt,
    ),
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
    // Content search (docs/internals/knowledge-links.md) matches substrings
    // of specification titles and Markdown.
    index("revision_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("revision_content_trgm_idx").using(
      "gin",
      t.content.op("gin_trgm_ops"),
    ),
  ],
);

// Commits are immutable snapshots. Branches are movable pointers; deleted
// branches/PRs disappear from sync while their commits and audit history survive.
export const specificationCommit = pgTable(
  "specification_commit",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    proposedChildren: jsonb("proposed_children")
      .$type<ProposedChild[]>()
      .notNull()
      .default([]),
    parentIds: jsonb("parent_ids").$type<string[]>().notNull().default([]),
    message: text("message").notNull(),
    authorId: actor("author_id"),
    revisionId: text("revision_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("commit_context_unique").on(t.organizationId, t.workItemId, t.id),
    foreignKey({
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.revisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("commit_revision_unique").on(t.revisionId),
  ],
);
export const specificationBranch = pgTable(
  "specification_branch",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    name: text("name").notNull(),
    headId: text("head_id").notNull(),
    authorId: actor("author_id"),
    collaboratorIds: jsonb("collaborator_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    unique("branch_context_unique").on(t.organizationId, t.workItemId, t.id),
    uniqueIndex("branch_active_name_unique")
      .on(t.organizationId, t.workItemId, t.name)
      .where(sql`${t.deletedAt} is null`),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.headId],
      foreignColumns: [
        specificationCommit.organizationId,
        specificationCommit.workItemId,
        specificationCommit.id,
      ],
    }).onDelete("restrict"),
  ],
);
export const specificationPullRequest = pgTable(
  "specification_pull_request",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: text("target_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status")
      .$type<"draft" | "open" | "merged">()
      .notNull()
      .default("draft"),
    authorId: actor("author_id"),
    mergedCommitId: text("merged_commit_id"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    unique("pr_context_unique").on(t.organizationId, t.workItemId, t.id),
    ...[t.sourceId, t.targetId].map((column) =>
      foreignKey({
        columns: [t.organizationId, t.workItemId, column],
        foreignColumns: [
          specificationBranch.organizationId,
          specificationBranch.workItemId,
          specificationBranch.id,
        ],
      }).onDelete("restrict"),
    ),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.mergedCommitId],
      foreignColumns: [
        specificationCommit.organizationId,
        specificationCommit.workItemId,
        specificationCommit.id,
      ],
    }).onDelete("restrict"),
    check("pr_different_branches", sql`${t.sourceId} <> ${t.targetId}`),
    check("pr_valid_status", sql`${t.status} in ('draft','open','merged')`),
  ],
);
// Decisions bind to the complete proposed merge result, not a mutable branch.
export const pullRequestReview = pgTable(
  "pull_request_review",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    pullRequestId: text("pull_request_id").notNull(),
    disciplineId: text("discipline_id").notNull(),
    userId: optionalActor("user_id"),
    required: boolean("required").notNull().default(true),
    decision: text("decision").$type<"approved" | "changes_requested" | null>(),
    reviewerId: optionalActor("reviewer_id"),
    resultHash: text("result_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.pullRequestId],
      foreignColumns: [
        specificationPullRequest.organizationId,
        specificationPullRequest.workItemId,
        specificationPullRequest.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.disciplineId],
      foreignColumns: [discipline.organizationId, discipline.id],
    }).onDelete("restrict"),
    unique("pr_review_discipline_unique").on(t.pullRequestId, t.disciplineId),
  ],
);

// One responsibility per review; multiple people/roles can be assigned below.
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
    disciplineId: text("discipline_id"),
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
      columns: [t.organizationId, t.disciplineId],
      foreignColumns: [discipline.organizationId, discipline.id],
    }).onDelete("restrict"),
    check(
      "review_assignment_one_target",
      sql`(${t.userId} IS NOT NULL) <> (${t.disciplineId} IS NOT NULL)`,
    ),
    uniqueIndex("review_assignment_active_user_unique")
      .on(t.reviewId, t.userId)
      .where(sql`${t.withdrawnAt} IS NULL`),
    uniqueIndex("review_assignment_active_discipline_unique")
      .on(t.reviewId, t.disciplineId)
      .where(sql`${t.withdrawnAt} IS NULL`),
    index("review_assignment_user_idx").on(t.organizationId, t.userId),
    index("review_assignment_discipline_idx").on(
      t.organizationId,
      t.disciplineId,
    ),
    index("review_assignment_review_idx").on(t.organizationId, t.reviewId),
  ],
);

// A proposed replacement of the specification, reviewed like a pull request.
// `revisionId` is the mainline revision the replacement was written against;
// updating the suggestion re-bases it onto the current revision. `version`
// counts content updates so review decisions can name what they evaluated.
export const suggestion = pgTable(
  "suggestion",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    // Legacy, never written: discussions now reference the suggestion instead.
    threadId: text("thread_id"),
    authorId: actor("author_id"),
    // Null anchor means replacement of the whole Markdown document.
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    replacement: text("replacement").notNull(),
    title: text("title"),
    rationale: text("rationale"),
    status: suggestionStatus("status").default("draft").notNull(),
    version: integer("version").default(1).notNull(),
    openedAt: timestamp("opened_at"),
    resolvedById: optionalActor("resolved_by_id"),
    resolvedAt: timestamp("resolved_at"),
    // The mainline revision created by merging (column keeps its original name).
    acceptedRevisionId: text("accepted_revision_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("suggestion_org_id_unique").on(t.organizationId, t.id),
    unique("suggestion_context_unique").on(
      t.organizationId,
      t.workItemId,
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
    check("suggestion_positive_version", sql`${t.version} > 0`),
    check(
      "suggestion_resolution_consistent",
      sql`(${t.status} IN ('draft', 'open') AND ${t.resolvedAt} IS NULL AND ${t.resolvedById} IS NULL AND ${t.acceptedRevisionId} IS NULL) OR (${t.status} = 'closed' AND ${t.resolvedAt} IS NOT NULL AND ${t.resolvedById} IS NOT NULL AND ${t.acceptedRevisionId} IS NULL) OR (${t.status} = 'merged' AND ${t.resolvedAt} IS NOT NULL AND ${t.resolvedById} IS NOT NULL AND ${t.acceptedRevisionId} IS NOT NULL AND ${t.acceptedRevisionId} <> ${t.revisionId})`,
    ),
  ],
);

// People asked to review a suggestion. Only members of a role that can both
// edit specifications and be asked to review may be assigned; the server
// checks this at assignment time. Withdrawal keeps the record.
export const suggestionReviewer = pgTable(
  "suggestion_reviewer",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    suggestionId: text("suggestion_id").notNull(),
    userId: actor("user_id"),
    assignedById: actor("assigned_by_id"),
    createdAt: createdAt(),
    withdrawnAt: timestamp("withdrawn_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.suggestionId],
      foreignColumns: [
        suggestion.organizationId,
        suggestion.workItemId,
        suggestion.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("suggestion_reviewer_active_unique")
      .on(t.suggestionId, t.userId)
      .where(sql`${t.withdrawnAt} IS NULL`),
    index("suggestion_reviewer_user_idx").on(t.organizationId, t.userId),
    index("suggestion_reviewer_suggestion_idx").on(
      t.organizationId,
      t.suggestionId,
    ),
    index("suggestion_reviewer_item_idx").on(t.organizationId, t.workItemId),
  ],
);

// A reviewer's decision about one version of a suggestion. A later content
// update or a new decision by the same reviewer supersedes it with a reason;
// only unsuperseded approvals of the current version allow merging.
export const suggestionDecision = pgTable(
  "suggestion_decision",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    suggestionId: text("suggestion_id").notNull(),
    reviewerId: actor("reviewer_id"),
    version: integer("version").notNull(),
    decision: suggestionDecisionKind("decision").notNull(),
    createdAt: createdAt(),
    supersededAt: timestamp("superseded_at"),
    supersededReason: text("superseded_reason"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.suggestionId],
      foreignColumns: [
        suggestion.organizationId,
        suggestion.workItemId,
        suggestion.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("suggestion_decision_active_unique")
      .on(t.suggestionId, t.reviewerId)
      .where(sql`${t.supersededAt} IS NULL`),
    index("suggestion_decision_suggestion_idx").on(
      t.organizationId,
      t.suggestionId,
    ),
    index("suggestion_decision_item_idx").on(t.organizationId, t.workItemId),
    check(
      "suggestion_decision_supersede_consistent",
      sql`(${t.supersededAt} IS NULL AND ${t.supersededReason} IS NULL) OR (${t.supersededAt} IS NOT NULL AND ${t.supersededReason} IS NOT NULL)`,
    ),
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
    // Set when the discussion is about a suggestion's proposed text rather
    // than the mainline specification. Such threads block that suggestion's
    // merge, not the work item's readiness.
    suggestionId: text("suggestion_id"),
    pullRequestId: text("pull_request_id"),
    commitId: text("commit_id"),
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
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.suggestionId],
      foreignColumns: [
        suggestion.organizationId,
        suggestion.workItemId,
        suggestion.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.pullRequestId],
      foreignColumns: [
        specificationPullRequest.organizationId,
        specificationPullRequest.workItemId,
        specificationPullRequest.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.commitId],
      foreignColumns: [
        specificationCommit.organizationId,
        specificationCommit.workItemId,
        specificationCommit.id,
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

// A person confirming a manual readiness check for one specification
// revision. Withdrawing keeps the row; a new revision needs a new sign-off.
export const readinessSignOff = pgTable(
  "readiness_sign_off",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    revisionId: text("revision_id").notNull(),
    // Id of the manual check in the project's readiness checks.
    checkId: text("check_id").notNull(),
    userId: actor("user_id"),
    createdAt: createdAt(),
    withdrawnAt: timestamp("withdrawn_at"),
    withdrawnById: optionalActor("withdrawn_by_id"),
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
    uniqueIndex("readiness_sign_off_active_unique")
      .on(t.workItemId, t.revisionId, t.checkId)
      .where(sql`${t.withdrawnAt} IS NULL`),
    index("readiness_sign_off_item_idx").on(t.organizationId, t.workItemId),
    check(
      "readiness_sign_off_withdrawal_consistent",
      sql`(${t.withdrawnAt} IS NULL) = (${t.withdrawnById} IS NULL)`,
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
    projectId: text("project_id").notNull(),
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
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.workItemId],
      foreignColumns: [
        workItem.organizationId,
        workItem.projectId,
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
    index("decision_project_idx").on(
      t.organizationId,
      t.projectId,
      t.createdAt,
    ),
    index("decision_item_idx").on(t.organizationId, t.workItemId),
    // Product knowledge search matches substrings (ILIKE '%term%') across
    // every decision; trigram indexes serve it without changing semantics.
    // Specification revisions carry their own (content search).
    index("decision_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("decision_body_trgm_idx").using("gin", t.body.op("gin_trgm_ops")),
  ],
);

export const deliveryProviderKind = pgEnum("delivery_provider_kind", [
  "jira_cloud",
]);
export const deliveryConnectionStatus = pgEnum("delivery_connection_status", [
  "active",
  "invalid",
]);

// An organization's authenticated access to one external delivery system
// installation (a Jira Cloud site), managed by organization administrators. The credential is encrypted at rest
// (src/delivery/credentials.ts) and never leaves the server. `baseUrl` is the
// external namespace: it never changes for a connection, so links stay valid.
export const deliveryConnection = pgTable(
  "delivery_connection",
  {
    id: id(),
    organizationId: organizationId(),
    provider: deliveryProviderKind("provider").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    // Who the credential acts as in the external system (display only).
    accountLabel: text("account_label").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    status: deliveryConnectionStatus("status").default("active").notNull(),
    lastError: text("last_error"),
    lastVerifiedAt: timestamp("last_verified_at").notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("delivery_connection_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("delivery_connection_active_site_unique")
      .on(t.organizationId, t.provider, t.baseUrl)
      .where(sql`${t.archivedAt} IS NULL`),
    check("delivery_connection_name_present", sql`length(trim(${t.name})) > 0`),
  ],
);

// Where a project's work is handed off: an external project plus the mapping
// from Lictory work item types to external types. One per project.
export const deliveryTarget = pgTable(
  "delivery_target",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: text("connection_id").notNull(),
    projectId: text("project_id").notNull(),
    externalProjectId: text("external_project_id").notNull(),
    externalProjectKey: text("external_project_key").notNull(),
    // Lictory work item type id → external issue type id.
    typeMapping: jsonb("type_mapping")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("delivery_target_org_id_unique").on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [
        deliveryConnection.organizationId,
        deliveryConnection.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("cascade"),
    uniqueIndex("delivery_target_project_unique").on(
      t.organizationId,
      t.projectId,
    ),
  ],
);

// A work item exported to (or adopted from) an external system. Summary,
// description and labels are owned in Lictory and pushed one-way on explicit
// export; external status is a read-only copy refreshed on each export.
export const workItemExternalLink = pgTable(
  "work_item_external_link",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    connectionId: text("connection_id").notNull(),
    externalId: text("external_id"),
    externalKey: text("external_key"),
    externalUrl: text("external_url"),
    externalStatus: text("external_status"),
    // Provider-neutral category of the external status and the external
    // assignee, refreshed by the scheduled status sync. Read-only here.
    // `externalCheckedAt` orders that sync; it is not synchronized to clients
    // so routine checks never churn the change log.
    externalStatusCategory: text("external_status_category"),
    externalAssignee: text("external_assignee"),
    externalCheckedAt: timestamp("external_checked_at"),
    status: deliverySyncStatus("status").default("pending").notNull(),
    // Revision whose content was last pushed, and a hash of the pushed
    // payload so unchanged items are skipped on re-export.
    publishedRevisionId: text("published_revision_id"),
    payloadHash: text("payload_hash"),
    // External system's own last-modified time right after Lictory's last
    // write; changes after it (in the external clock) are external edits.
    externalUpdatedAt: timestamp("external_updated_at"),
    // Set (and committed) right before an external create, so a crash
    // between the create and recording it is recovered, not duplicated.
    createAttemptedAt: timestamp("create_attempted_at"),
    lastError: text("last_error"),
    syncedAt: timestamp("synced_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [
        deliveryConnection.organizationId,
        deliveryConnection.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.workItemId, t.publishedRevisionId],
      foreignColumns: [
        specificationRevision.organizationId,
        specificationRevision.workItemId,
        specificationRevision.id,
      ],
    }).onDelete("restrict"),
    unique("external_link_destination_unique").on(
      t.organizationId,
      t.workItemId,
      t.connectionId,
    ),
    unique("external_link_identity_unique").on(
      t.organizationId,
      t.connectionId,
      t.externalId,
    ),
    index("external_link_sync_idx").on(t.organizationId, t.status),
    check(
      "external_link_synced_identity",
      sql`${t.status} <> 'synced' OR (${t.externalId} IS NOT NULL AND ${t.syncedAt} IS NOT NULL)`,
    ),
  ],
);

export const deliveryPublicationStatus = pgEnum("delivery_publication_status", [
  "running",
  "completed",
  "partial",
  "failed",
]);

export type DeliveryItemOutcome =
  | "pending"
  | "created"
  | "updated"
  | "unchanged"
  | "conflict"
  | "failed"
  | "skipped";

// One explicit export run: who asked, what, and what happened to each item.
// Links hold the current external state; publications are the audit trail
// ("why was this published", "which revision went out") and survive re-exports.
export const deliveryPublication = pgTable(
  "delivery_publication",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: text("project_id").notNull(),
    connectionId: text("connection_id").notNull(),
    requestedById: actor("requested_by_id"),
    // Item exported with its subtree, or null for a hand-picked selection.
    rootItemId: text("root_item_id"),
    // Parents before children; the worker processes in this order.
    itemIds: jsonb("item_ids").$type<string[]>().notNull(),
    // Items the requester confirmed may overwrite external edits.
    overwriteItemIds: jsonb("overwrite_item_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    results: jsonb("results")
      .$type<
        Record<
          string,
          {
            outcome: DeliveryItemOutcome;
            message?: string;
            externalKey?: string;
            revisionNumber?: number;
          }
        >
      >()
      .default({})
      .notNull(),
    status: deliveryPublicationStatus("status").default("running").notNull(),
    // Worker lease: only one process advances a publication at a time.
    leaseUntil: timestamp("lease_until"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [
        deliveryConnection.organizationId,
        deliveryConnection.id,
      ],
    }).onDelete("restrict"),
    index("delivery_publication_running_idx").on(t.status, t.leaseUntil),
    index("delivery_publication_project_idx").on(
      t.organizationId,
      t.projectId,
      t.createdAt,
    ),
  ],
);

// The initial setup is an auditable human decision, committed with the project.
// This snapshot is historical; current configuration remains on teams/projects.
export const organizationOnboarding = pgTable(
  "organization_onboarding",
  {
    organizationId: organizationId().primaryKey(),
    projectId: text("project_id").notNull(),
    decidedById: actor("decided_by_id"),
    decisions: jsonb("decisions").$type<OnboardingSetup>().notNull(),
    completedAt: timestamp("completed_at").defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: "onboarding_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
  ],
);

// Whether an organization allows its content to be sent to the AI provider.
// Off until an administrator decides otherwise.
// Organization branding shown inside the app. `mark` is a square logomark,
// `full` a wide logo with the wordmark. Images are small, so they live in the
// database rather than object storage; `sha256` versions the public URL.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
// Small normalized profile photos; kept out of auth/session and sync payloads.
export const profilePhoto = pgTable("profile_photo", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  content: bytea("content").notNull(),
  sha256: text("sha256").notNull(),
});
export const organizationLogo = pgTable(
  "organization_logo",
  {
    organizationId: organizationId(),
    kind: text("kind", { enum: ["mark", "full"] }).notNull(),
    content: bytea("content").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    updatedById: actor("updated_by_id"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.kind] }),
    check("organization_logo_kind", sql`${t.kind} in ('mark', 'full')`),
  ],
);

export const organizationAiPolicy = pgTable("organization_ai_policy", {
  organizationId: organizationId().primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  updatedById: actor("updated_by_id"),
  updatedAt: updatedAt(),
});

// One Lictory Intelligence execution. Requests are queued inside the
// organization transaction; the model runs outside it and the result is written
// back in a short transaction. Runs are history: they are superseded or marked
// stale, never deleted or rewritten after completion.
export const aiRun = pgTable(
  "ai_run",
  {
    id: id(),
    organizationId: organizationId(),
    workItemId: text("work_item_id").notNull(),
    kind: aiRunKind("kind").notNull(),
    status: aiRunStatus("status").default("queued").notNull(),
    pullRequestId: text("pull_request_id"),
    headCommitId: text("head_commit_id"),
    requestedById: actor("requested_by_id"),
    contextRevisions: jsonb("context_revisions")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    score: integer("score"),
    summary: text("summary"),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    findings: jsonb("findings").$type<AiFinding[]>().notNull().default([]),
    correctivePullRequests: jsonb("corrective_pull_requests")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    appliedFindingIds: jsonb("applied_finding_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    // The Lictory Intelligence Context versions the model received, so a run
    // can always answer "what was Lictory Intelligence told?".
    intelligenceContext: jsonb("intelligence_context")
      .$type<IntelligenceContextUse[]>()
      .notNull()
      .default([]),
    model: text("model"),
    error: text("error"),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: createdAt(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    staleAt: timestamp("stale_at"),
    staleReason: text("stale_reason"),
  },
  (t) => [
    foreignKey({
      name: "ai_run_item_fk",
      columns: [t.organizationId, t.workItemId],
      foreignColumns: [workItem.organizationId, workItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_run_pull_request_fk",
      columns: [t.organizationId, t.workItemId, t.pullRequestId],
      foreignColumns: [
        specificationPullRequest.organizationId,
        specificationPullRequest.workItemId,
        specificationPullRequest.id,
      ],
    }).onDelete("restrict"),
    index("ai_run_item_idx").on(t.organizationId, t.workItemId, t.createdAt),
    index("ai_run_pending_idx")
      .on(t.status, t.createdAt)
      .where(sql`${t.status} in ('queued','running')`),
    check(
      "ai_run_kind_target",
      sql`(${t.kind} = 'pr_action') = (${t.pullRequestId} IS NOT NULL)`,
    ),
    check(
      "ai_run_score_range",
      sql`${t.score} IS NULL OR ${t.score} BETWEEN 0 AND 100`,
    ),
  ],
);

// Lictory Intelligence Context: knowledge administrators give Lictory
// Intelligence about an organization, a project or a team. Scopes compound
// (organization → project → team) and the narrower scope wins on conflict. An
// entry is a written note or an uploaded document converted to Markdown; its
// content lives in immutable versions. Archiving is reversible and keeps
// history.
export const intelligenceContextEntry = pgTable(
  "intelligence_context_entry",
  {
    id: id(),
    organizationId: organizationId(),
    scope: text("scope", {
      enum: ["organization", "project", "team"],
    }).notNull(),
    projectId: text("project_id"),
    teamId: text("team_id"),
    kind: text("kind", { enum: ["note", "document"] }).notNull(),
    createdById: actor("created_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at"),
    archivedById: optionalActor("archived_by_id"),
    // Retries of createIntelligenceContext with the same key return this entry.
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    unique("intelligence_context_entry_org_id_unique").on(
      t.organizationId,
      t.id,
    ),
    unique("intelligence_context_entry_idempotency_unique").on(
      t.organizationId,
      t.createdById,
      t.idempotencyKey,
    ),
    foreignKey({
      name: "intelligence_context_entry_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "intelligence_context_entry_team_fk",
      columns: [t.organizationId, t.teamId],
      foreignColumns: [team.organizationId, team.id],
    }).onDelete("restrict"),
    check(
      "intelligence_context_entry_scope_target",
      sql`(${t.scope} = 'organization' AND ${t.projectId} IS NULL AND ${t.teamId} IS NULL)
        OR (${t.scope} = 'project' AND ${t.projectId} IS NOT NULL AND ${t.teamId} IS NULL)
        OR (${t.scope} = 'team' AND ${t.teamId} IS NOT NULL AND ${t.projectId} IS NULL)`,
    ),
    check(
      "intelligence_context_entry_kind",
      sql`${t.kind} in ('note', 'document')`,
    ),
    index("intelligence_context_entry_scope_idx").on(
      t.organizationId,
      t.scope,
      t.projectId,
      t.teamId,
    ),
  ],
);

// One immutable snapshot of an entry. Edits and re-uploads add a version;
// nothing rewrites one. Uploaded documents keep their source metadata but not
// their bytes: the converted Markdown is what Lictory Intelligence receives.
export const intelligenceContextVersion = pgTable(
  "intelligence_context_version",
  {
    id: id(),
    organizationId: organizationId(),
    entryId: text("entry_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourceFilename: text("source_filename"),
    sourceFormat: text("source_format"),
    sourceSize: integer("source_size"),
    sourceSha256: text("source_sha256"),
    authorId: actor("author_id"),
    createdAt: createdAt(),
    // Retries of reviseIntelligenceContext with the same key return this version.
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    unique("intelligence_context_version_org_id_unique").on(
      t.organizationId,
      t.id,
    ),
    unique("intelligence_context_version_idempotency_unique").on(
      t.organizationId,
      t.authorId,
      t.idempotencyKey,
    ),
    unique("intelligence_context_version_number_unique").on(
      t.organizationId,
      t.entryId,
      t.number,
    ),
    foreignKey({
      name: "intelligence_context_version_entry_fk",
      columns: [t.organizationId, t.entryId],
      foreignColumns: [
        intelligenceContextEntry.organizationId,
        intelligenceContextEntry.id,
      ],
    }).onDelete("restrict"),
    check(
      "intelligence_context_version_title_present",
      sql`length(trim(${t.title})) > 0`,
    ),
    check("intelligence_context_version_number", sql`${t.number} >= 1`),
  ],
);
