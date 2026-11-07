import { z } from "zod";
import { branchNameProblem } from "@lictory/core/lib/branch-name";
import {
  aiActionPolicies,
  aiFindingSchema,
  aiRunKinds,
  aiRunStatuses,
} from "@lictory/core/contracts/ai";
import { intelligenceContextUseSchema } from "@lictory/core/intelligence/shared";
import { readinessRulesSchema } from "@lictory/core/contracts/readiness";
import { proposedChildrenSchema } from "@lictory/core/contracts/decomposition";

const id = z.string().min(1).max(160);
const text = z.string().trim().min(1).max(200_000);
// Specifications may be empty while an item is being drafted; readiness reports it.
const document = z.string().max(200_000);
const base = { id, organizationId: id };
const context = { workItemId: id, revisionId: id };

// Refinement state of spec-backed items; `ready` is server-gated by readiness.
export const refinementStates = [
  "draft",
  "refinement",
  "in_review",
  "ready",
] as const;
export type RefinementState = (typeof refinementStates)[number];
// Fixed categories that give meaning to project-defined workflow statuses.
export const statusCategories = [
  "backlog",
  "unstarted",
  "started",
  "done",
  "canceled",
] as const;
export type StatusCategory = (typeof statusCategories)[number];
export const deliveryModes = ["native", "external"] as const;
export type DeliveryMode = (typeof deliveryModes)[number];
// Provider-neutral category of an external status (Jira status categories).
export const externalStatusCategories = [
  "todo",
  "in_progress",
  "done",
] as const;
export type ExternalStatusCategory = (typeof externalStatusCategories)[number];
export const deliverySyncStatuses = [
  "pending",
  "synced",
  "failed",
  "conflict",
] as const;
export type DeliverySyncStatus = (typeof deliverySyncStatuses)[number];
export const readinessPolicies = ["off", "warn", "block"] as const;
export type ReadinessPolicy = (typeof readinessPolicies)[number];
export const iterationModes = ["off", "manual", "automatic"] as const;
export type IterationMode = (typeof iterationModes)[number];
export const iterationStates = ["planned", "active", "completed"] as const;
export const estimateScales = [
  "none",
  "fibonacci",
  "linear",
  "tshirt",
] as const;
export type EstimateScale = (typeof estimateScales)[number];
export const relationKinds = ["blocks", "relates", "duplicates"] as const;
export type RelationKind = (typeof relationKinds)[number];
export const typeIcons = [
  "epic",
  "story",
  "task",
  "bug",
  "subtask",
  "spike",
  "chore",
] as const;
export const workItemPriorities = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type WorkItemPriority = (typeof workItemPriorities)[number];
export const labelColors = [
  "gray",
  "blue",
  "green",
  "amber",
  "red",
  "purple",
  "pink",
  "teal",
] as const;
export type LabelColor = (typeof labelColors)[number];
export const milestoneStatuses = [
  "planned",
  "active",
  "completed",
  "cancelled",
] as const;
export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const suggestionStatuses = [
  "draft",
  "open",
  "merged",
  "closed",
] as const;
export type SuggestionStatus = (typeof suggestionStatuses)[number];

// Review information every list, inbox and filter needs without loading the
// item's full history. Computed server-side from the current revision only.
export const reviewSummarySchema = z.object({
  id,
  responsibility: z.string(),
  status: z.string(),
  required: z.boolean(),
  // Users and roles currently assigned; the client derives "needs my review".
  assigneeIds: z.array(id),
  approved: z.boolean(),
});
export const readinessCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
  // Manual sign-off checks: who may sign off and the current sign-off.
  signOff: z
    .object({
      disciplineIds: z.array(id),
      signedOffBy: id.nullable(),
      signedOffAt: z.string().nullable(),
    })
    .optional(),
  // Lictory Intelligence checks: the review the result comes from.
  intelligence: z
    .object({
      runId: id.nullable(),
      reviewedCurrent: z.boolean(),
      findings: z.number().int(),
      score: z.number().int().nullable(),
      model: z.string().nullable(),
      completedAt: z.string().nullable(),
      overridden: z.boolean(),
    })
    .optional(),
});
export const entitySchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("project"),
    name: z.string(),
    slug: z.string(),
    key: z.string(),
    description: z.string().nullable(),
    // Delivery configuration is the project's: every item of the project
    // follows one workflow, readiness policy, estimate scale and cadence.
    deliveryMode: z.enum(deliveryModes),
    readinessPolicy: z.enum(readinessPolicies),
    estimateScale: z.enum(estimateScales),
    iterationMode: z.enum(iterationModes),
    iterationWeeks: z.number().int(),
    iterationStartDay: z.number().int(),
    upcomingIterations: z.number().int(),
    aiActionPolicy: z.enum(aiActionPolicies),
    mergeReadyNotice: z.boolean().default(true),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("label"),
    projectId: id,
    name: z.string(),
    color: z.enum(labelColors),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("milestone"),
    projectId: id,
    name: z.string(),
    targetDate: z.string().nullable(),
    status: z.enum(milestoneStatuses),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("workItem"),
    projectId: id,
    // Optional: the team (vertical) of the project working on the item.
    teamId: id.nullable(),
    typeId: id,
    parentId: id.nullable(),
    number: z.number().int(),
    title: z.string(),
    statusId: id,
    // Null for types without a specification.
    refinementState: z.enum(refinementStates).nullable(),
    mainProtected: z.boolean().default(false),
    priority: z.enum(workItemPriorities),
    assigneeId: id.nullable(),
    milestoneId: id.nullable(),
    iterationId: id.nullable(),
    estimate: z.number().int().nullable(),
    labelIds: z.array(id),
    position: z.number().int(),
    rank: z.string(),
    sourceRevisionId: id.nullable(),
    committedRevisionId: id.nullable().optional(),
    committedRevisionNumber: z.number().int().nullable().optional(),
    deliveredRevisionId: id.nullable().optional(),
    deliveredRevisionNumber: z.number().int().nullable().optional(),
    createdById: id,
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
    revisionId: id,
    revisionNumber: z.number().int(),
    openThreads: z.number().int(),
    blockingThreads: z.number().int(),
    openSuggestions: z.number().int(),
    // Reviewers of open suggestions who have not approved the current
    // version yet; the client derives "needs my review" from it.
    suggestionReviewerIds: z.array(id),
    reviews: z.array(reviewSummarySchema),
    readinessPassed: z.number().int(),
    readinessTotal: z.number().int(),
    childCount: z.number().int(),
    // Spec-backed children whose refinement is ready.
    childReadyCount: z.number().int(),
    // Children in a done or canceled status category.
    childDoneCount: z.number().int(),
    // Sum of children's estimates (rollup, never stored).
    childEstimate: z.number().int(),
  }),
  z.object({
    ...base,
    type: z.literal("relation"),
    // Project of the source item: relations travel with it in sync scopes.
    projectId: id,
    fromId: id,
    toId: id,
    kind: z.enum(relationKinds),
    createdById: id,
    createdAt: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("revision"),
    workItemId: id,
    number: z.number().int(),
    title: z.string(),
    content: z.string(),
    changeSummary: z.string().nullable(),
    authorId: id,
    createdAt: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("specCommit"),
    workItemId: id,
    title: z.string(),
    content: z.string(),
    proposedChildren: proposedChildrenSchema.default([]),
    parentIds: z.array(id),
    message: z.string(),
    authorId: id,
    revisionId: id.nullable(),
    createdAt: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("specBranch"),
    workItemId: id,
    name: z.string(),
    headId: id,
    authorId: id,
    collaboratorIds: z.array(id),
    createdAt: z.string(),
  }),
  // The live draft of one line of a specification (main when `branchId`
  // is null, else that branch): the collaboration document an editor
  // connects to and whether stored edits exist beyond the last saved
  // revision or commit. Never its content
  // (docs/internals/specification-drafts.md).
  z.object({
    ...base,
    type: z.literal("specDraft"),
    workItemId: id,
    branchId: id.nullable(),
    epoch: z.number().int(),
    documentName: z.string(),
    committedSequence: z.number().int(),
    uncommittedChanges: z.boolean(),
    // The revision (main) or commit (branch) the draft's saved state is.
    baseRevisionId: id.nullable(),
    baseCommitId: id.nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("pullRequest"),
    workItemId: id,
    sourceId: id,
    targetId: id,
    title: z.string(),
    description: z.string(),
    status: z.enum(["draft", "open", "merged"]),
    authorId: id,
    mergedCommitId: id.nullable(),
    createdAt: z.string(),
    // People whose review this open pull request still waits for: undecided,
    // or approved for a merge result that has since changed. Derived on the
    // server, which can compare result hashes.
    pendingReviewerIds: z.array(id).default([]),
  }),
  z.object({
    ...base,
    type: z.literal("prReview"),
    workItemId: id,
    pullRequestId: id,
    disciplineId: id,
    userId: id.nullable(),
    required: z.boolean(),
    decision: z.enum(["approved", "changes_requested"]).nullable(),
    reviewerId: id.nullable(),
    resultHash: z.string().nullable(),
    createdAt: z.string(),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal("review"),
    responsibility: z.string(),
    status: z.string(),
    required: z.boolean(),
    requestedById: id,
    createdAt: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("assignment"),
    reviewId: id,
    userId: id.nullable(),
    disciplineId: id.nullable(),
    withdrawnAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal("thread"),
    // Discussions about a suggestion's proposed text block that suggestion's
    // merge rather than the work item's readiness.
    suggestionId: id.nullable(),
    pullRequestId: id.nullable().default(null),
    commitId: id.nullable().default(null),
    authorId: id,
    status: z.enum(["open", "resolved"]),
    blocking: z.boolean(),
    createdAt: z.string(),
    // Anchors are always interpreted against revisionId. A quote lets later
    // revisions re-locate the discussed text or report that it changed.
    anchor: z
      .object({
        version: z.literal(1),
        kind: z.literal("document"),
        section: z.string(),
        quote: z.string().optional(),
        // Which copy of the quote under its section was selected (0 is the
        // first), so repeated words never attach to another copy.
        occurrence: z.number().int().min(0).optional(),
      })
      .nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("message"),
    threadId: id,
    authorId: id,
    body: z.string(),
    createdAt: z.string(),
  }),
  // A proposed replacement of the specification, reviewed like a pull request.
  // `revisionId` is the mainline revision it was written against; `version`
  // increments on every content update so decisions can name what they saw.
  z.object({
    ...base,
    ...context,
    type: z.literal("suggestion"),
    authorId: id,
    replacement: z.string(),
    title: z.string().nullable(),
    rationale: z.string().nullable(),
    status: z.enum(suggestionStatuses),
    version: z.number().int(),
    openedAt: z.string().nullable(),
    mergedRevisionId: id.nullable(),
    resolvedById: id.nullable(),
    resolvedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("suggestionReviewer"),
    workItemId: id,
    suggestionId: id,
    userId: id,
    assignedById: id,
    createdAt: z.string(),
    withdrawnAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("suggestionDecision"),
    workItemId: id,
    suggestionId: id,
    reviewerId: id,
    version: z.number().int(),
    decision: z.enum(["approved", "changes_requested"]),
    createdAt: z.string(),
    supersededAt: z.string().nullable(),
    supersededReason: z.string().nullable(),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal("approval"),
    reviewId: id,
    reviewerId: id,
    status: z.enum(["granted", "revoked", "stale"]),
    createdAt: z.string(),
    endReason: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("readiness"),
    workItemId: id,
    checks: z.array(readinessCheckSchema),
    // Revision of the project's readiness checks the item is evaluated
    // under (0 and null: Lictory's defaults). Pinned items were ready or done
    // when newer checks were published and keep the checks they met.
    policyRevisionId: id.nullable().default(null),
    policyRevisionNumber: z.number().int().default(0),
    pinned: z.boolean().default(false),
  }),
  // Where a work item was exported. Travels with the item's project so
  // lists and boards can show the external key without loading the item.
  z.object({
    ...base,
    type: z.literal("externalLink"),
    projectId: id,
    workItemId: id,
    connectionId: id,
    externalKey: z.string().nullable(),
    externalUrl: z.string().nullable(),
    // Read-only copy of the external status, assignee and status category,
    // refreshed on each export and by the scheduled status sync.
    externalStatus: z.string().nullable(),
    externalStatusCategory: z.enum(externalStatusCategories).nullable(),
    externalAssignee: z.string().nullable(),
    status: z.enum(deliverySyncStatuses),
    publishedRevisionId: id.nullable(),
    publishedRevisionNumber: z.number().int().nullable(),
    lastError: z.string().nullable(),
    syncedAt: z.string().nullable(),
  }),
  // One execution of Lictory Intelligence: an item review (the item with its
  // ancestors and descendants) or a Lictory Intelligence review action run on a
  // pull request head.
  z.object({
    ...base,
    type: z.literal("aiRun"),
    workItemId: id,
    kind: z.enum(aiRunKinds),
    status: z.enum(aiRunStatuses),
    pullRequestId: id.nullable(),
    headCommitId: id.nullable(),
    requestedById: id,
    // Main revision of every analysed item, keyed by work item id.
    contextRevisions: z.record(z.string(), z.string()),
    score: z.number().int().nullable(),
    summary: z.string().nullable(),
    strengths: z.array(z.string()),
    findings: z.array(aiFindingSchema),
    // Corrective pull requests created from this review, by work item id.
    correctivePullRequests: z.record(z.string(), z.string()),
    appliedFindingIds: z.array(z.string()),
    // Lictory Intelligence Context versions the model received.
    intelligenceContext: z.array(intelligenceContextUseSchema).default([]),
    model: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    staleAt: z.string().nullable(),
    staleReason: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("activity"),
    workItemId: id,
    actorId: id,
    action: z.string(),
    detail: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("decision"),
    projectId: id,
    workItemId: id,
    revisionId: id,
    sourceThreadId: id.nullable(),
    title: z.string(),
    body: z.string(),
    authorId: id,
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  }),
]);
export type Entity = z.infer<typeof entitySchema>;
export type EntityType = Entity["type"];
export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>;
export type WorkItem = EntityOf<"workItem">;
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

// Organization scope: projects and every work item summary. Item scope adds the
// item's revisions, discussions, suggestions, reviews, approvals and activity.
export const scopeSchema = z
  .object({
    organizationId: id,
    projectId: id.optional(),
    workItemId: id.optional(),
  })
  .refine(
    (scope) => !scope.workItemId || Boolean(scope.projectId),
    "A work item scope requires a project.",
  );
export type Scope = z.infer<typeof scopeSchema>;
export const checkpointSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/);
const entityTypes = z.enum([
  "project",
  "label",
  "milestone",
  "workItem",
  "relation",
  "revision",
  "specCommit",
  "specBranch",
  "specDraft",
  "pullRequest",
  "prReview",
  "review",
  "assignment",
  "thread",
  "message",
  "suggestion",
  "suggestionReviewer",
  "suggestionDecision",
  "approval",
  "readiness",
  "externalLink",
  "aiRun",
  "activity",
]);
export const changeSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("upsert"),
    cursor: checkpointSchema,
    entity: entitySchema,
  }),
  z.object({
    operation: z.literal("delete"),
    cursor: checkpointSchema,
    type: entityTypes,
    id,
  }),
]);
export type Change = z.infer<typeof changeSchema>;
// Fixed application roles, held on the organization membership. `admin`
// (Better Auth owner/admin) administers the organization and every project;
// `member` works in the organization. Work item capabilities never come from
// application roles: they come from the disciplines a person holds in a
// project.
export const applicationRoles = ["admin", "member"] as const;
export type ApplicationRole = (typeof applicationRoles)[number];
export function applicationRoleOf(raw: string): ApplicationRole {
  return raw.split(",").some((r) => r === "owner" || r === "admin")
    ? "admin"
    : "member";
}
export const memberSchema = z.object({
  id,
  name: z.string(),
  image: z.string().nullable().optional(),
  email: z.string(),
  // Platform-wide handle; null only for accounts that have not chosen one.
  handle: z.string().nullable(),
});
export type DirectoryMember = z.infer<typeof memberSchema>;
export const directoryMemberSchema = memberSchema.extend({
  // Better Auth member row, needed to change the application role.
  memberId: id,
  role: z.enum(applicationRoles),
  owner: z.boolean(),
});
// Project roles. A project administrator manages the project's configuration
// (settings, workflow, types, teams, members, disciplines, iterations and its
// delivery target); a project member works in it. Organization administrators
// administer every project without being listed.
export const projectRoles = ["admin", "member"] as const;
export type ProjectRole = (typeof projectRoles)[number];
export const projectMemberSchema = z.object({
  projectId: id,
  userId: id,
  role: z.enum(projectRoles),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;
// Work item capabilities a discipline grants its members in its project.
export const capabilitySchema = z.object({
  editSpecifications: z.boolean(),
  changeProperties: z.boolean(),
  requestReviews: z.boolean(),
  review: z.boolean(),
  publishDelivery: z.boolean(),
});
export type Capabilities = z.infer<typeof capabilitySchema>;
export const capabilityKeys = Object.keys(
  capabilitySchema.shape,
) as (keyof Capabilities)[];
export const noCapabilities: Capabilities = {
  editSpecifications: false,
  changeProperties: false,
  requestReviews: false,
  review: false,
  publishDelivery: false,
};
// A work discipline (Product, Engineering, QA…) of one project: who reviews
// what, and what its members may do with the project's work items.
export const disciplineSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  description: z.string().nullable(),
  capabilities: capabilitySchema,
  userIds: z.array(id),
  archivedAt: z.string().nullable(),
});
export type Discipline = z.infer<typeof disciplineSchema>;
// Union of capabilities over the active disciplines a user holds in a project.
export function capabilitiesOf(
  disciplines: Discipline[],
  userId: string,
  projectId: string,
): Capabilities {
  const mine = disciplines.filter(
    (d) =>
      d.projectId === projectId && !d.archivedAt && d.userIds.includes(userId),
  );
  return {
    editSpecifications: mine.some((d) => d.capabilities.editSpecifications),
    changeProperties: mine.some((d) => d.capabilities.changeProperties),
    requestReviews: mine.some((d) => d.capabilities.requestReviews),
    review: mine.some((d) => d.capabilities.review),
    publishDelivery: mine.some((d) => d.capabilities.publishDelivery),
  };
}
// Suggestion reviewers merge into the mainline, so they must hold an active
// discipline of the project that both edits specifications and reviews.
export function canReviewSuggestions(
  disciplines: Discipline[],
  userId: string,
  projectId: string,
) {
  return disciplines.some(
    (d) =>
      d.projectId === projectId &&
      !d.archivedAt &&
      d.userIds.includes(userId) &&
      d.capabilities.editSpecifications &&
      d.capabilities.review,
  );
}
// Recording a conclusion needs a discipline that edits specifications or
// reviews in the project.
export function canRecordDecisions(capabilities: Capabilities) {
  return capabilities.editSpecifications || capabilities.review;
}
// Specification editors curate every decision of the project. An author may
// also archive or restore their own decision while they can still record
// decisions there: authorship adds to a current capability, never replaces it.
export function canArchiveDecision(
  capabilities: Capabilities,
  decision: { authorId: string },
  userId: string,
) {
  return (
    capabilities.editSpecifications ||
    (decision.authorId === userId && canRecordDecisions(capabilities))
  );
}
export function projectRoleOf(
  members: ProjectMember[],
  userId: string,
  projectId: string,
): ProjectRole | null {
  return (
    members.find((m) => m.projectId === projectId && m.userId === userId)
      ?.role ?? null
  );
}
// Project configuration authority: organization administrators, or the
// project's administrators while the project is active.
export function canManageProject(
  directory: Pick<Directory, "projects" | "projectMembers">,
  userId: string,
  organizationAdmin: boolean,
  projectId: string,
) {
  if (organizationAdmin) return true;
  const project = directory.projects.find((p) => p.id === projectId);
  return (
    !!project &&
    !project.archivedAt &&
    projectRoleOf(directory.projectMembers, userId, projectId) === "admin"
  );
}
export const memberSearchSchema = z.object({
  organizationId: id,
  q: z.string().max(120).optional().default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const memberPageSchema = z.object({
  members: z.array(memberSchema),
  hasMore: z.boolean(),
});
export type MemberPage = z.infer<typeof memberPageSchema>;
export const epicSummarySchema = z.object({
  id,
  projectId: id,
  typeId: id.optional(),
  number: z.number().int().positive(),
  title: z.string(),
});
export type EpicSummary = z.infer<typeof epicSummarySchema>;
export const epicSearchSchema = z.object({
  organizationId: id,
  projectId: id,
  // Omitted by legacy callers searching top-level work. New parent pickers
  // pass the child type so every strictly higher level is eligible.
  childTypeId: id.optional(),
  q: z.string().max(120).optional().default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const epicPageSchema = z.object({
  epics: z.array(epicSummarySchema),
  hasMore: z.boolean(),
});
export type EpicPage = z.infer<typeof epicPageSchema>;
export const workflowStatusSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  color: z.enum(labelColors),
  category: z.enum(statusCategories),
  position: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
// A team is a group of people working on one vertical of a project. It owns
// no configuration; boards and backlogs can be filtered to it.
export const teamSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  description: z.string().nullable(),
  memberIds: z.array(id),
  archivedAt: z.string().nullable(),
});
export type Team = z.infer<typeof teamSchema>;
export const projectTypeSchema = z.object({ projectId: id, typeId: id });
export const workItemTypeSchema = z.object({
  id,
  name: z.string(),
  icon: z.enum(typeIcons),
  color: z.enum(labelColors),
  level: z.number().int(),
  hasSpecification: z.boolean(),
  position: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type WorkItemType = z.infer<typeof workItemTypeSchema>;
export const iterationSchema = z.object({
  id,
  projectId: id,
  number: z.number().int(),
  name: z.string().nullable(),
  goal: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  state: z.enum(iterationStates),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type Iteration = z.infer<typeof iterationSchema>;
// What a project calls its time-boxes: sprints are planned by hand, cycles
// run on a schedule. "Iteration" remains the neutral word when the cadence is
// unknown (or off).
export function iterationNoun(mode?: IterationMode) {
  return mode === "manual"
    ? "Sprint"
    : mode === "automatic"
      ? "Cycle"
      : "Iteration";
}
// An unnamed iteration is numbered with its project's word for it.
export function iterationLabel(
  i: Pick<Iteration, "name" | "number">,
  mode?: IterationMode,
) {
  return i.name?.trim().length
    ? i.name.trim()
    : `${iterationNoun(mode)} ${i.number}`;
}
// Estimate values offered per scale. T-shirt sizes are stored as points.
export const estimateOptions: Record<
  EstimateScale,
  { value: number; label: string }[]
> = {
  none: [],
  fibonacci: [0, 1, 2, 3, 5, 8, 13, 21].map((v) => ({
    value: v,
    label: String(v),
  })),
  linear: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({
    value: v,
    label: String(v),
  })),
  tshirt: [
    { value: 1, label: "XS" },
    { value: 2, label: "S" },
    { value: 3, label: "M" },
    { value: 5, label: "L" },
    { value: 8, label: "XL" },
  ],
};
export const iterationReportQuerySchema = z.object({
  organizationId: id,
  iterationId: id,
});
const tally = z.object({ count: z.number().int(), points: z.number().int() });
export const iterationReportSchema = z.object({
  iterationId: id,
  // Daily samples from start to end (or now), replayed from recorded events.
  series: z.array(
    z.object({
      at: z.string(),
      scope: z.number().int(),
      remaining: z.number().int(),
      scopeCount: z.number().int(),
      remainingCount: z.number().int(),
    }),
  ),
  totals: z.object({
    atStart: tally,
    final: tally,
    completed: tally,
    addedAfterStart: tally,
    removedAfterStart: tally,
  }),
  // Frozen at completion; null while the iteration is open.
  summary: z
    .object({ carriedOver: tally, carriedOverTo: id.nullable() })
    .passthrough()
    .nullable(),
  // Completed points of the project's recent iterations, oldest first.
  velocity: z.array(
    z.object({
      iterationId: id,
      number: z.number().int(),
      name: z.string().nullable(),
      committed: z.number().int(),
      completed: z.number().int(),
    }),
  ),
});
export type IterationReport = z.infer<typeof iterationReportSchema>;
// Delivery metadata carries no secrets. Configuration and publish authorization
// remain server checks; directory visibility alone grants no capability.
export const deliveryConnectionSchema = z.object({
  id,
  provider: z.enum(["jira_cloud"]),
  name: z.string(),
  baseUrl: z.string(),
  accountLabel: z.string(),
  status: z.enum(["active", "invalid"]),
  lastError: z.string().nullable(),
});
export type DeliveryConnectionSummary = z.infer<
  typeof deliveryConnectionSchema
>;
export const deliveryTargetSchema = z.object({
  id,
  connectionId: id,
  projectId: id,
  externalProjectId: z.string(),
  externalProjectKey: z.string(),
  typeMapping: z.record(z.string(), z.string()),
});
export type DeliveryTargetSummary = z.infer<typeof deliveryTargetSchema>;
// One immutable version of a project's Definition of Ready. Number 0 with a
// null id stands for Lictory's defaults, used until administrators publish.
export const readinessRevisionSchema = z.object({
  id: id.nullable(),
  projectId: id,
  number: z.number().int(),
  rules: readinessRulesSchema,
  summary: z.string().nullable(),
  // Null for Lictory's defaults.
  authorId: id.nullable(),
  createdAt: z.string().nullable(),
});
export type ReadinessRevision = z.infer<typeof readinessRevisionSchema>;
export const readinessHistoryQuerySchema = z.object({
  organizationId: id,
  projectId: id,
});
export const readinessHistorySchema = z.object({
  revisions: z.array(readinessRevisionSchema),
});
export const readinessPreviewQuerySchema = z.object({
  organizationId: id,
  projectId: id,
  rules: readinessRulesSchema,
});
export const directorySchema = z.object({
  organizations: z.array(
    z.object({
      id,
      name: z.string(),
      slug: z.string(),
      role: z.string(),
      // Same-origin image URLs for the organization's branding, if uploaded.
      logos: z
        .object({ mark: z.string().nullable(), full: z.string().nullable() })
        .default({ mark: null, full: null }),
      // Set while the organization is scheduled for deletion (locked).
      deletion: z
        .object({ deleteAfter: z.string(), requestedBy: z.string().nullable() })
        .nullable()
        .optional(),
    }),
  ),
  projects: z.array(entitySchema.options[0]),
  members: z.array(directoryMemberSchema),
  // People who left (or deleted their account), by name only, so their
  // history stays attributed. They grant and receive nothing.
  formerMembers: z.array(z.object({ id, name: z.string() })).default([]),
  projectMembers: z.array(projectMemberSchema),
  disciplines: z.array(disciplineSchema),
  teams: z.array(teamSchema),
  // Organization type registry, and the types each project uses.
  types: z.array(workItemTypeSchema),
  projectTypes: z.array(projectTypeSchema),
  statuses: z.array(workflowStatusSchema),
  // Planned and active iterations plus recent completed ones.
  iterations: z.array(iterationSchema),
  delivery: z.object({
    connections: z.array(deliveryConnectionSchema),
    targets: z.array(deliveryTargetSchema),
  }),
  // The readiness checks each project currently requires (latest revision).
  readiness: z.array(readinessRevisionSchema).default([]),
  // enabled: the organization allows sending its content to the AI provider.
  // available: this deployment has a configured provider.
  ai: z
    .object({ enabled: z.boolean(), available: z.boolean() })
    .default({ enabled: false, available: false }),
});
export type Directory = z.infer<typeof directorySchema>;
// How history names someone who is no longer in the organization.
export const formerMemberName = (name: string) =>
  name.trim() ? `${name} (former member)` : "Former member";
// A person's name in the directory, including people who left.
export function directoryName(
  directory: Pick<Directory, "members" | "formerMembers">,
  userId: string,
) {
  const member = directory.members.find((m) => m.id === userId);
  if (member) return member.name;
  const former = directory.formerMembers.find((m) => m.id === userId);
  return formerMemberName(former?.name ?? "");
}
// Lictory Spaces (docs/internals/spaces.md). Space projections travel in their
// own table (`space_entity`) and union (`SpaceEntity`), never as an `Entity`,
// so space data cannot reach `sync_entity`, the directory or the organization
// and work item queries.
export const spaceAccessModes = ["inherited", "restricted"] as const;
export type SpaceAccessMode = (typeof spaceAccessModes)[number];
export const spacePublishingPolicies = ["direct", "reviewed"] as const;
export type SpacePublishing = (typeof spacePublishingPolicies)[number];
// Ordered from least to most access.
export const spaceAccessLevels = ["view", "comment", "edit"] as const;
export type SpaceAccessLevel = (typeof spaceAccessLevels)[number];
export function spaceLevelAtLeast(
  level: SpaceAccessLevel | null | undefined,
  minimum: SpaceAccessLevel,
) {
  return (
    level != null &&
    spaceAccessLevels.indexOf(level) >= spaceAccessLevels.indexOf(minimum)
  );
}
const inSpace = { id, organizationId: id, spaceId: id };
// Where a page discussion is anchored (docs/internals/spaces.md#comments).
// Versioned: `v` changes when a shape changes, and readers keep
// understanding older versions.
// - commit: a range of one block of an immutable commit. `from` and `to`
//   are offsets into the block's text, `quote` the text they covered; a
//   commit never changes, so the anchor never moves.
// - draft: a range of a live draft within one epoch, as base64 encodings of
//   Yjs relative positions (`Y.encodeRelativePosition`), which follow
//   concurrent edits. Committing the draft freezes it to a commit anchor.
// - page: the whole page.
// The server checks the shape, the bounds and that the commit or draft
// belongs to the page; it never resolves positions.
export const PAGE_THREAD_QUOTE_MAX = 2000;
const anchorQuote = z.string().min(1).max(PAGE_THREAD_QUOTE_MAX);
const relativePosition = z
  .string()
  .min(4)
  .max(512)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Use a base64 Yjs relative position.");
export const pageThreadAnchorSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      v: z.literal(1),
      kind: z.literal("commit"),
      commitId: id,
      // The block's stable id (Tiptap UniqueID).
      blockId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/, "Use the block's id."),
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      quote: anchorQuote,
    })
    .refine((a) => a.from < a.to, {
      message: "An anchor range ends after it starts.",
      path: ["to"],
    }),
  z.strictObject({
    v: z.literal(1),
    kind: z.literal("draft"),
    draftId: id,
    epoch: z.number().int().positive(),
    start: relativePosition,
    end: relativePosition,
    quote: anchorQuote,
  }),
  z.strictObject({ v: z.literal(1), kind: z.literal("page") }),
]);
export type PageThreadAnchor = z.infer<typeof pageThreadAnchorSchema>;
// Anchors as stored and synchronized: the shapes above plus `detached`, a
// draft anchor whose text no longer existed when its draft was committed.
// It keeps the quote and names that commit ("Original text removed").
// Only the commit command writes it; clients never create one.
const pageThreadDetachedAnchorSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal("detached"),
  commitId: id,
  quote: anchorQuote,
});
export const storedPageThreadAnchorSchema = z.union([
  pageThreadAnchorSchema,
  pageThreadDetachedAnchorSchema,
]);
export type StoredPageThreadAnchor = z.infer<
  typeof storedPageThreadAnchorSchema
>;
// Discussions a branch deletion or a merge removes, by state (see
// spaces/discussion-lifecycle.ts).
export const pageDiscussionCountsSchema = z.object({
  open: z.number().int().min(0),
  openBlocking: z.number().int().min(0),
  resolved: z.number().int().min(0),
  resolvedBlocking: z.number().int().min(0),
});
// The live draft of a line as the browser needs it to connect: the
// collaboration document name (`<draftId>.<epoch>`), the last sequence
// sealed into a commit and whether stored edits exist beyond it. The stored
// sequence itself changes with every keystroke batch and is never
// projected; the collaboration service tells connected editors.
export const pageDraftSummarySchema = z.object({
  id,
  epoch: z.number().int().positive(),
  documentName: z.string(),
  committedSequence: z.number().int().min(0),
  uncommittedChanges: z.boolean(),
});
export type PageDraftSummary = z.infer<typeof pageDraftSummarySchema>;
// Why an open page pull request cannot merge yet, computed from the page's
// history, drafts, threads and reviews (access is checked when merging).
// Why a page is attached to a work item.
export const pageAttachmentPurposes = [
  "background",
  "design",
  "runbook",
] as const;
export type PageAttachmentPurpose = (typeof pageAttachmentPurposes)[number];
// Committed page content a work item is created from: the page, the exact
// commit, optionally the top-level block and the selected text.
export const PAGE_SOURCE_QUOTE_MAX = 2000;
export const workItemPageSourceSchema = z.strictObject({
  pageId: id,
  commitId: id,
  blockId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, "Use the block's id.")
    .nullable()
    .optional(),
  quote: z.string().trim().min(1).max(PAGE_SOURCE_QUOTE_MAX).optional(),
});
export type WorkItemPageSource = z.infer<typeof workItemPageSourceSchema>;
// The work item revision a page branch is opened from.
export const pageBranchOriginSchema = z.strictObject({
  workItemId: id,
  revisionId: id,
});
export const pageMergeBlockers = [
  "draft",
  "no_merge_base",
  "conflicts",
  "no_changes",
  "uncommitted_source",
  "uncommitted_target",
  "blocking_threads",
  "no_required_review",
  "review_pending",
  "changes_requested",
] as const;
export type PageMergeBlocker = (typeof pageMergeBlockers)[number];
export const spaceEntitySchema = z.discriminatedUnion("type", [
  // Space-level rows (`page_id` NULL): the space, its named grants and its
  // page tree. No per-reader data: effective access is `space_reader`.
  z.object({
    id,
    organizationId: id,
    type: z.literal("space"),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    // Home: neither (organization), a project, or a team of that project.
    projectId: id.nullable(),
    teamId: id.nullable(),
    accessMode: z.enum(spaceAccessModes),
    publishing: z.enum(spacePublishingPolicies),
    createdById: id,
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  }),
  // `id` is `${spaceId}:${userId}`.
  z.object({
    ...inSpace,
    type: z.literal("spaceGrant"),
    userId: id,
    level: z.enum(spaceAccessLevels),
    grantedById: id,
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  // A node of the page tree, with the title and commit main publishes.
  z.object({
    ...inSpace,
    type: z.literal("page"),
    parentId: id.nullable(),
    rank: z.string(),
    title: z.string(),
    publishedCommitId: id,
    // The published commit when it merged with valid approvals in a
    // Reviewed space ("Approved" names it); null otherwise.
    approvedCommitId: id.nullable(),
    // Main's live draft in Direct spaces (null in Reviewed spaces).
    // `uncommittedChanges` there means "unpublished changes".
    mainDraft: pageDraftSummarySchema.nullable(),
    createdById: id,
    createdAt: z.string(),
    // When main last moved (the published commit's time).
    updatedAt: z.string(),
    // Who made the published commit and its message, so lists can say what
    // changed without the page's history (absent on rows projected before
    // they were added, until the projection is rebuilt).
    publishedById: id.optional(),
    publishedMessage: z.string().nullable().optional(),
    archivedAt: z.string().nullable(),
    // Open discussions on the page, and how many of them block merging.
    openThreads: z.number().int().min(0),
    blockingThreads: z.number().int().min(0),
  }),
  // Page-level rows (`page_id` set): the page's history.
  z.object({
    ...inSpace,
    type: z.literal("pageCommit"),
    pageId: id,
    parentIds: z.array(id),
    title: z.string(),
    // Canonical Tiptap JSON; Markdown is derived from it.
    content: z.record(z.string(), z.unknown()),
    markdown: z.string(),
    hash: z.string(),
    schemaVersion: z.number().int(),
    message: z.string().nullable(),
    authorId: id,
    contributorIds: z.array(id),
    // The pull request this commit merged and the reviewers whose approval
    // of exactly this result was valid when it merged.
    pullRequestId: id.nullable(),
    approverIds: z.array(id),
    createdAt: z.string(),
  }),
  z.object({
    ...inSpace,
    type: z.literal("pageBranch"),
    pageId: id,
    name: z.string(),
    isMain: z.boolean(),
    headCommitId: id,
    baseCommitId: id.nullable(),
    authorId: id,
    collaboratorIds: z.array(id),
    // The open live draft of this line; null for main in Reviewed spaces.
    draft: pageDraftSummarySchema.nullable(),
    createdAt: z.string(),
    // The discussions deleting this branch removes (absent for main and in
    // rows projected before this field existed).
    discussionsOnDelete: pageDiscussionCountsSchema.optional(),
  }),
  // A pull request between two lines of the page (deleted ones are not
  // projected). `mergeability` is null once merged.
  z.object({
    ...inSpace,
    type: z.literal("pagePullRequest"),
    pageId: id,
    sourceBranchId: id,
    targetBranchId: id,
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(["draft", "open", "merged"]),
    authorId: id,
    reviewers: z.array(
      z.object({
        userId: id,
        required: z.boolean(),
        requestedById: id,
        createdAt: z.string().optional(),
      }),
    ),
    createdAt: z.string(),
    updatedAt: z.string(),
    mergedAt: z.string().nullable(),
    mergedById: id.nullable(),
    mergeCommitId: id.nullable(),
    mergeability: z
      .object({
        sourceHeadId: id,
        targetHeadId: id,
        baseCommitId: id.nullable(),
        // `documentHash` of the merged title and content; null while the
        // merge has conflicts or no single merge base.
        resultHash: z.string().nullable(),
        conflicts: z.number().int().min(0),
        // People whose commits are in the result: they cannot approve it.
        contributorIds: z.array(id),
        blockingThreads: z.number().int().min(0),
        requiredReviews: z.number().int().min(0),
        // Required reviewers whose current approval binds this result.
        requiredApprovals: z.number().int().min(0),
        approvals: z.number().int().min(0),
        changesRequested: z.number().int().min(0),
        staleReviews: z.number().int().min(0),
        blockers: z.array(z.enum(pageMergeBlockers)),
        // What merging now does beyond the content: whether the source
        // branch is deleted and the discussions removed with it.
        onMerge: z
          .object({
            sourceRetired: z.boolean(),
            discussions: pageDiscussionCountsSchema,
          })
          .optional(),
      })
      .nullable(),
  }),
  // One review decision (append-only). Current decisions have neither
  // `staleAt` nor `withdrawnAt`; stale ones name why.
  z.object({
    ...inSpace,
    type: z.literal("pagePullRequestReview"),
    pageId: id,
    pullRequestId: id,
    reviewerId: id,
    decision: z.enum(["approved", "changes_requested"]),
    resultHash: z.string(),
    sourceHeadId: id,
    targetHeadId: id,
    staleAt: z.string().nullable(),
    staleReason: z.string().nullable(),
    withdrawnAt: z.string().nullable(),
    createdAt: z.string(),
  }),
  // A discussion on the page. Messages are separate rows, so a reply
  // replicates one new row instead of the whole thread.
  z.object({
    ...inSpace,
    type: z.literal("pageThread"),
    pageId: id,
    authorId: id,
    status: z.enum(["open", "resolved"]),
    blocking: z.boolean(),
    anchor: storedPageThreadAnchorSchema,
    commitId: id.nullable(),
    branchId: id.nullable(),
    pullRequestId: id.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    resolvedById: id.nullable(),
    resolvedAt: z.string().nullable(),
  }),
  z.object({
    ...inSpace,
    type: z.literal("pageThreadMessage"),
    pageId: id,
    threadId: id,
    authorId: id,
    body: z.string(),
    createdAt: z.string(),
  }),
  // Discussion events (opened, resolved, reopened, blocking changed) that
  // the threads' current state no longer shows.
  z.object({
    ...inSpace,
    type: z.literal("pageActivity"),
    pageId: id,
    actorId: id,
    action: z.string(),
    detail: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  }),
  // Knowledge links (docs/internals/knowledge-links.md). Each row carries
  // the page it concerns and its space, so only readers of that space ever
  // receive it, and also names the work item (`work_item_id` column) or the
  // project (`project_id` column) it concerns. Rows of archived pages and
  // spaces are not projected. Titles are never part of them: readers
  // resolve the page from the `page` summaries they can read, the item from
  // the organization's work items.
  //
  // A work item referenced in the page's published version (main's head
  // `commitId`), with the top-level blocks that mention it in document
  // order. `id` is `${pageId}:${workItemId}`.
  z.object({
    ...inSpace,
    type: z.literal("pageReference"),
    pageId: id,
    workItemId: id,
    commitId: id,
    blockIds: z.array(z.string()),
  }),
  // The main specification revisions of a work item that cite the page,
  // oldest first: `commitIds` are the pinned versions they cite (in order of
  // appearance), `latest` whether they also cite it unpinned. Whether the
  // item's current revision cites the page is `revisionId` of the work item
  // among them. `id` is `${workItemId}:${pageId}`.
  z.object({
    ...inSpace,
    type: z.literal("specificationCitation"),
    pageId: id,
    workItemId: id,
    revisions: z.array(
      z.object({
        revisionId: id,
        number: z.number().int().positive(),
        commitIds: z.array(id),
        latest: z.boolean(),
      }),
    ),
  }),
  // A page deliberately attached to a work item (active attachments only).
  z.object({
    ...inSpace,
    type: z.literal("pageAttachment"),
    pageId: id,
    workItemId: id,
    purpose: z.enum(pageAttachmentPurposes),
    // The pinned version; null follows the published page.
    commitId: id.nullable(),
    createdById: id,
    createdAt: z.string(),
  }),
  // Where a work item came from: committed page content. `id` is the work
  // item's id.
  z.object({
    ...inSpace,
    type: z.literal("workItemSource"),
    pageId: id,
    workItemId: id,
    commitId: id,
    blockId: z.string().nullable(),
    quote: z.string().nullable(),
    createdById: id,
    createdAt: z.string(),
  }),
  // A page branch opened from a work item revision ("Propose page
  // update"), kept after the branch is merged or deleted. `id` is the
  // branch id; `pullRequests` are the branch's pull requests (`closed`:
  // deleted without merging).
  z.object({
    ...inSpace,
    type: z.literal("pageBranchOrigin"),
    pageId: id,
    branchId: id,
    workItemId: id,
    revisionId: id,
    // The number of the revision it was proposed from (absent in rows
    // projected before it was added; a projection rebuild fills it).
    revisionNumber: z.number().int().nullable().optional(),
    name: z.string(),
    authorId: id,
    createdAt: z.string(),
    deletedAt: z.string().nullable(),
    pullRequests: z.array(
      z.object({
        id,
        // The change's title (absent in rows projected before it was added).
        title: z.string().optional(),
        status: z.enum(["draft", "open", "merged", "closed"]),
        targetBranchId: id,
        mergeCommitId: id.nullable(),
      }),
    ),
  }),
  // A page a project, one of its teams or one of its iterations keeps as
  // context, ordered by `rank` within that scope (active links only).
  z.object({
    ...inSpace,
    type: z.literal("pageContextLink"),
    pageId: id,
    projectId: id,
    teamId: id.nullable(),
    iterationId: id.nullable(),
    rank: z.string(),
    createdById: id,
    createdAt: z.string(),
  }),
]);
// Knowledge link rows of `space_entity` (see above).
export const knowledgeEntityTypes = [
  "pageReference",
  "specificationCitation",
  "pageAttachment",
  "workItemSource",
  "pageBranchOrigin",
  "pageContextLink",
] as const;
export type SpaceEntity = z.infer<typeof spaceEntitySchema>;
export type SpaceEntityType = SpaceEntity["type"];
export type SpaceEntityOf<T extends SpaceEntityType> = Extract<
  SpaceEntity,
  { type: T }
>;
// Projection key, as in `sync_entity`.
export function spaceEntityKey(e: Pick<SpaceEntity, "type" | "id">) {
  return `${e.type}:${e.id}`;
}
// Protocol 16 adds Lictory Spaces commands (spaces, pages, page
// discussions and page history); their projections use the separate
// `space_entity` table.
export const PROTOCOL = 16 as const;
export const pageSchema = z.object({
  protocol: z.literal(PROTOCOL),
  changes: z.array(changeSchema),
  nextCursor: checkpointSchema,
  hasMore: z.boolean(),
  directory: directorySchema,
});
export type SyncPage = z.infer<typeof pageSchema>;
const itemCommand = { workItemId: id };
const revisionCommand = { ...itemCommand, baseRevisionId: id };
const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Use 2-10 letters or digits, e.g. PAY.");
export const projectSettingsSchema = z.object({
  deliveryMode: z.enum(deliveryModes),
  readinessPolicy: z.enum(readinessPolicies),
  estimateScale: z.enum(estimateScales),
  iterationMode: z.enum(iterationModes),
  iterationWeeks: z.number().int().min(1).max(8),
  iterationStartDay: z.number().int().min(0).max(6),
  upcomingIterations: z.number().int().min(0).max(6),
  aiActionPolicy: z.enum(aiActionPolicies),
  mergeReadyNotice: z.boolean(),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export const onboardingSetupSchema = z
  .object({
    deliveryMode: z.enum(deliveryModes),
    readinessPolicy: z.enum(readinessPolicies),
    estimateScale: z.enum(estimateScales),
    iterationMode: z.enum(iterationModes),
    iterationWeeks: z.number().int().min(1).max(8),
    iterationStartDay: z.number().int().min(0).max(6),
    // Older clients did not ask for Lictory Intelligence consent; preserve
    // their existing policy.
    aiEnabled: z.boolean().optional(),
    // Invitations are Better Auth operations sent after setup commits.
    invitations: z.number().int().min(0).max(50).default(0),
  })
  .refine(
    (s) =>
      s.deliveryMode !== "external" ||
      (s.iterationMode === "off" && s.estimateScale === "none"),
    {
      message:
        "Projects delivered in an external tool plan and estimate there.",
    },
  );
export type OnboardingSetup = z.infer<typeof onboardingSetupSchema>;

const spaceSlug = z
  .string()
  .trim()
  .toLowerCase()
  .max(60)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Use lowercase letters, digits and single hyphens, e.g. payments-handbook.",
  );
// A space's home: {} is the organization, { projectId } a project and
// { projectId, teamId } a team of that project.
const spaceHome = z
  .strictObject({ projectId: id.optional(), teamId: id.optional() })
  .refine((home) => !home.teamId || home.projectId, {
    message: "A team home also names the team's project.",
  });
const pageTitle = z.string().trim().min(1).max(200);
const pageCommitMessage = z.string().trim().max(2000);
// A ProseMirror node of page content; the document engine validates it.
const pageNodeInput = z.record(z.string(), z.json());
// How one merge conflict of a page is resolved (`resolveMerge`): keep one
// side, keep both, or replace it with edited blocks. The title conflict
// (`page-conflict:title`) takes "ours", "theirs" or { title }.
export const pageMergeResolutionSchema = z.union([
  z.enum(["ours", "theirs", "both"]),
  z.strictObject({
    manual: z.union([pageNodeInput, z.array(pageNodeInput).min(1)]),
  }),
  z.strictObject({ title: pageTitle }),
]);
export type PageMergeResolution = z.infer<typeof pageMergeResolutionSchema>;
// Siblings to place a page between (both omitted: last under its parent).
const pagePosition = {
  afterId: id.nullable().optional(),
  beforeId: id.nullable().optional(),
};

export const commandSchema = z.discriminatedUnion("type", [
  // Lictory Spaces. Anyone in the organization may create a space; its
  // administrators (creator, organization administrators, home project
  // administrators) manage access, home, publishing and archiving.
  z.object({
    type: z.literal("createSpace"),
    spaceId: z.uuid(),
    name: text.max(120),
    slug: spaceSlug,
    description: z.string().trim().max(2000).optional(),
    icon: z.string().trim().min(1).max(32).optional(),
    home: spaceHome.optional(),
    accessMode: z.enum(spaceAccessModes).optional(),
    publishing: z.enum(spacePublishingPolicies).optional(),
  }),
  // Editors change name, slug, description and icon; home and publishing
  // are administrators' decisions.
  z.object({
    type: z.literal("updateSpace"),
    spaceId: id,
    name: text.max(120).optional(),
    slug: spaceSlug.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    icon: z.string().trim().min(1).max(32).nullable().optional(),
    home: spaceHome.optional(),
    publishing: z.enum(spacePublishingPolicies).optional(),
  }),
  z.object({
    type: z.literal("setSpaceAccessMode"),
    spaceId: id,
    accessMode: z.enum(spaceAccessModes),
  }),
  // null removes the person's named access.
  z.object({
    type: z.literal("setSpaceGrant"),
    spaceId: id,
    userId: id,
    level: z.enum(spaceAccessLevels).nullable(),
  }),
  z.object({
    type: z.literal("archiveSpace"),
    spaceId: id,
    archived: z.boolean(),
  }),
  // Creates the page with its main branch, an initial commit and, in Direct
  // spaces, main's live draft.
  z.object({
    type: z.literal("createPage"),
    spaceId: id,
    pageId: z.uuid(),
    parentId: id.nullable().optional(),
    title: pageTitle,
    // Starting content (canonical page JSON, e.g. a template); absent: an
    // empty page. It becomes the page's first version.
    content: pageNodeInput.optional(),
    // Also links the new page as a context page of the project, one of its
    // teams or iterations, in the same transaction (both or neither), with
    // the rules of `linkContextPage`: iteration notes are created this way.
    contextLink: z
      .strictObject({
        projectId: id,
        linkId: z.uuid(),
        teamId: id.nullable().optional(),
        iterationId: id.nullable().optional(),
      })
      .optional(),
    ...pagePosition,
  }),
  z.object({
    type: z.literal("movePage"),
    pageId: id,
    parentId: id.nullable(),
    ...pagePosition,
  }),
  // Archiving hides the page and its subtree; restoring brings back what
  // was archived with it.
  z.object({
    type: z.literal("archivePage"),
    pageId: id,
    archived: z.boolean(),
  }),
  // Discussions on pages: commenters (comment or edit access) start, answer,
  // resolve and reopen them and mark them blocking, as on specifications.
  // Messages are never edited or deleted.
  z.object({
    type: z.literal("createPageThread"),
    pageId: id,
    threadId: z.uuid(),
    messageId: z.uuid(),
    anchor: pageThreadAnchorSchema,
    body: text,
    blocking: z.boolean().optional(),
    // The line the thread was written on; required for draft anchors
    // (the draft's branch) and otherwise optional.
    branchId: id.optional(),
    // The pull request the thread is about (a review comment); blocking
    // threads of a pull request block its merge.
    pullRequestId: id.optional(),
  }),
  z.object({
    type: z.literal("replyToPageThread"),
    threadId: id,
    messageId: z.uuid(),
    body: text,
  }),
  z.object({ type: z.literal("resolvePageThread"), threadId: id }),
  z.object({ type: z.literal("reopenPageThread"), threadId: id }),
  z.object({
    type: z.literal("setPageThreadBlocking"),
    threadId: id,
    blocking: z.boolean(),
  }),
  // Page history (docs/internals/spaces.md#history-commits-branches-and-pull-requests).
  // Seals the live draft of a line at exactly `expectedSequence` (the
  // stored sequence the editor last saw) into an immutable commit with this
  // title. On main in a Direct space this is "Publish".
  z.object({
    type: z.literal("commitDraft"),
    pageId: id,
    branchId: id,
    draftId: id,
    epoch: z.number().int().positive(),
    expectedSequence: z.number().int().min(0),
    title: pageTitle,
    message: pageCommitMessage.optional(),
  }),
  // A new commit on the line with an earlier commit's title and content;
  // the line's draft starts a new epoch from it.
  z.object({
    type: z.literal("restorePageCommit"),
    pageId: id,
    branchId: id,
    commitId: id,
    expectedHead: id,
    discardDraftChanges: z.boolean().optional(),
    message: pageCommitMessage.optional(),
  }),
  // `origin`: the work item revision the branch proposes to document
  // ("Propose page update"), kept with the branch.
  z.object({
    type: z.literal("createPageBranch"),
    pageId: id,
    branchId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    fromCommitId: id.optional(),
    origin: pageBranchOriginSchema.optional(),
  }),
  z.object({
    type: z.literal("setPageBranchCollaborator"),
    branchId: id,
    userId: id,
    collaborator: z.boolean(),
  }),
  // Deleting a branch removes its discussions (`discussionsOnDelete` of the
  // branch). `discussionsToRemove` is how many the person was shown before
  // confirming; the command is refused when the count changed.
  z.object({
    type: z.literal("deletePageBranch"),
    branchId: id,
    discussionsToRemove: z.number().int().min(0).optional(),
  }),
  // Merges another line (main unless `fromBranchId`) into a branch with a
  // merge commit. Conflicts are refused (kind `page_merge_conflicts`; see
  // previewPageMerge) until `resolutions` names a choice for each.
  z.object({
    type: z.literal("syncPageBranch"),
    branchId: id,
    fromBranchId: id.optional(),
    expectedHead: id,
    expectedTargetHead: id,
    resolutions: z.record(z.string(), pageMergeResolutionSchema).optional(),
  }),
  z.object({
    type: z.literal("createPagePullRequest"),
    pageId: id,
    pullRequestId: z.uuid(),
    sourceBranchId: id,
    targetBranchId: id.optional(),
    title: pageTitle,
    description: z.string().trim().max(20_000).optional(),
    draft: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("updatePagePullRequest"),
    pullRequestId: id,
    title: pageTitle.optional(),
    description: z.string().trim().max(20_000).nullable().optional(),
    draft: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("deletePagePullRequest"),
    pullRequestId: id,
  }),
  z.object({
    type: z.literal("requestPageReview"),
    pullRequestId: id,
    userId: id,
    required: z.boolean(),
  }),
  z.object({
    type: z.literal("cancelPageReview"),
    pullRequestId: id,
    userId: id,
  }),
  // Binds the decision to the merge result of exactly these heads.
  z.object({
    type: z.literal("decidePagePullRequest"),
    pullRequestId: id,
    decision: z.enum(["approve", "request_changes", "revoke"]),
    inspectedSourceHead: id,
    inspectedTargetHead: id,
  }),
  // Merging removes the source's discussions and the pull request's own
  // (`mergeability.onMerge`); `discussionsToRemove` as for deletePageBranch.
  // `deletesSourceBranch` is whether the person was told the source branch
  // is deleted; the merge is refused when that changed.
  z.object({
    type: z.literal("mergePagePullRequest"),
    pullRequestId: id,
    inspectedSourceHead: id,
    inspectedTargetHead: id,
    discussionsToRemove: z.number().int().min(0).optional(),
    deletesSourceBranch: z.boolean().optional(),
  }),
  // Proposes new content for a page without publishing it: a branch from
  // main, a commit with this title and content (Markdown or canonical
  // Tiptap JSON) and an open pull request into main.
  z
    .object({
      type: z.literal("proposePageChange"),
      pageId: id,
      branchId: z.uuid(),
      pullRequestId: z.uuid(),
      title: pageTitle,
      markdown: z.string().max(1_000_000).optional(),
      content: pageNodeInput.optional(),
      message: z.string().trim().min(1).max(2000),
      description: z.string().trim().max(20_000).optional(),
      branchName: z.string().trim().min(1).max(80).optional(),
      origin: pageBranchOriginSchema.optional(),
    })
    .refine((c) => (c.markdown === undefined) !== (c.content === undefined), {
      message: "Provide the new page as either markdown or content.",
      path: ["markdown"],
    }),
  // Organization administrators create and archive projects. The creator
  // becomes a project administrator and joins its first discipline.
  z.object({
    type: z.literal("createProject"),
    projectId: z.uuid(),
    name: text.max(120),
    key: projectKey,
    description: z.string().trim().max(2000).optional(),
    setup: onboardingSetupSchema.optional(),
  }),
  // Project administrators.
  z.object({
    type: z.literal("updateProject"),
    projectId: id,
    name: text.max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    ...projectSettingsSchema.partial().shape,
  }),
  // Publishes the next version of the project's Definition of Ready: checks
  // per work item type (types left out use Lictory's defaults).
  // `baseRevisionId` is the version the editor started from (null: defaults).
  z.object({
    type: z.literal("publishReadinessChecks"),
    projectId: id,
    baseRevisionId: id.nullable(),
    rules: readinessRulesSchema,
    summary: z.string().trim().max(500).optional(),
  }),
  z.object({
    type: z.literal("archiveProject"),
    projectId: id,
    archived: z.boolean(),
  }),
  // null removes the person from the project (and its disciplines).
  z.object({
    type: z.literal("setProjectMember"),
    projectId: id,
    userId: id,
    role: z.enum(projectRoles).nullable(),
  }),
  z.object({
    type: z.literal("createDiscipline"),
    projectId: id,
    disciplineId: z.uuid(),
    name: text.max(60),
    description: z.string().trim().max(500).optional(),
    capabilities: capabilitySchema,
  }),
  z.object({
    type: z.literal("updateDiscipline"),
    projectId: id,
    disciplineId: id,
    name: text.max(60).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    capabilities: capabilitySchema.optional(),
    archived: z.boolean().optional(),
  }),
  // Adding someone to a discipline also adds them to the project.
  z.object({
    type: z.literal("setDisciplineMember"),
    projectId: id,
    disciplineId: id,
    userId: id,
    member: z.boolean(),
  }),
  z.object({
    type: z.literal("createWorkItem"),
    projectId: id,
    workItemId: z.uuid(),
    typeId: id,
    // Optional team of the project.
    teamId: id.nullable().optional(),
    parentId: id.nullable(),
    title: text.max(240),
    description: document.optional(),
    statusId: id.optional(),
    iterationId: id.nullable().optional(),
    assigneeId: id.nullable().optional(),
    // Committed page content the item is created from (provenance, kept
    // immutably with the item).
    source: workItemPageSourceSchema.optional(),
  }),
  // Knowledge links (docs/internals/knowledge-links.md). Attaching needs
  // change-properties in the item's project and read access to the page;
  // `commitId` pins one version of the page (null: the published page).
  // Attaching a page that is already attached with another purpose or pin
  // replaces that attachment.
  z.object({
    type: z.literal("attachPage"),
    ...itemCommand,
    attachmentId: z.uuid(),
    pageId: id,
    purpose: z.enum(pageAttachmentPurposes),
    commitId: id.nullable().optional(),
  }),
  z.object({
    type: z.literal("detachPage"),
    ...itemCommand,
    attachmentId: id,
  }),
  // Context pages of a project, a team (`teamId`) or an iteration
  // (`iterationId`), placed between `afterId` and `beforeId` among the links
  // of that scope (both omitted: last). Project administrators and members
  // whose discipline changes item properties manage them.
  z.object({
    type: z.literal("linkContextPage"),
    projectId: id,
    linkId: z.uuid(),
    pageId: id,
    teamId: id.nullable().optional(),
    iterationId: id.nullable().optional(),
    afterId: id.nullable().optional(),
    beforeId: id.nullable().optional(),
  }),
  z.object({
    type: z.literal("unlinkContextPage"),
    projectId: id,
    linkId: id,
  }),
  z.object({
    type: z.literal("moveContextPage"),
    projectId: id,
    linkId: id,
    afterId: id.nullable(),
    beforeId: id.nullable(),
  }),
  // Non-material properties: they never create a revision or stale approvals.
  // `refinementState` accepts manual moves before ready; `ready` itself is
  // derived from readiness checks.
  z.object({
    type: z.literal("updateWorkItem"),
    ...itemCommand,
    statusId: id.optional(),
    refinementState: z.enum(["draft", "refinement", "in_review"]).optional(),
    typeId: id.optional(),
    teamId: id.nullable().optional(),
    priority: z.enum(workItemPriorities).optional(),
    assigneeId: id.nullable().optional(),
    parentId: id.nullable().optional(),
    milestoneId: id.nullable().optional(),
    iterationId: id.nullable().optional(),
    estimate: z.number().int().min(0).max(1000).nullable().optional(),
    labelIds: z.array(id).max(50).optional(),
  }),
  // Backlog/board order: place between two neighbours (null = open end).
  z.object({
    type: z.literal("acceptDeliveryScope"),
    ...revisionCommand,
  }),
  z.object({
    type: z.literal("rankWorkItem"),
    ...itemCommand,
    afterId: id.nullable(),
    beforeId: id.nullable(),
  }),
  z.object({
    type: z.literal("addRelation"),
    ...itemCommand,
    relationId: z.uuid(),
    toId: id,
    kind: z.enum(relationKinds),
  }),
  z.object({
    type: z.literal("removeRelation"),
    ...itemCommand,
    relationId: id,
  }),
  // Manual ordering among siblings: place before `beforeId` (null = last).
  z.object({
    type: z.literal("reorderWorkItem"),
    ...itemCommand,
    beforeId: id.nullable(),
  }),
  z.object({
    type: z.literal("createLabel"),
    projectId: id,
    labelId: z.uuid(),
    name: text.max(60),
    color: z.enum(labelColors),
  }),
  z.object({
    type: z.literal("updateLabel"),
    projectId: id,
    labelId: id,
    name: text.max(60).optional(),
    color: z.enum(labelColors).optional(),
    archived: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("createMilestone"),
    projectId: id,
    milestoneId: z.uuid(),
    name: text.max(120),
    targetDate: z.string().date().nullable(),
  }),
  z.object({
    type: z.literal("updateMilestone"),
    projectId: id,
    milestoneId: id,
    name: text.max(120).optional(),
    targetDate: z.string().date().nullable().optional(),
    status: z.enum(milestoneStatuses).optional(),
    archived: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("archiveWorkItem"),
    ...itemCommand,
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("recordDecision"),
    ...revisionCommand,
    decisionId: z.uuid(),
    title: text.max(240),
    body: text.max(20_000),
    sourceThreadId: id.optional(),
  }),
  z.object({
    type: z.literal("setDecisionArchived"),
    ...itemCommand,
    decisionId: id,
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("updateSpecification"),
    ...revisionCommand,
    title: text.max(240),
    content: document,
    summary: z.string().trim().max(500).optional(),
  }),
  z.object({
    type: z.literal("createThread"),
    ...revisionCommand,
    threadId: z.uuid(),
    messageId: z.uuid(),
    body: text,
    blocking: z.boolean(),
    section: z
      .string()
      .max(200)
      .describe(
        "Heading this discussion is anchored to. An empty string anchors the thread to the whole text. An unknown heading is rejected.",
      ),
    quote: z.string().max(2000).optional(),
    occurrence: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .optional()
      .describe(
        "When the quote appears more than once under its section: which appearance (0 is the first).",
      ),
    // Discuss a suggestion's proposed text instead of the specification.
    suggestionId: id.optional(),
    pullRequestId: id.optional(),
    commitId: id
      .optional()
      .describe(
        "Required when pullRequestId is set: the commit this discussion concerns.",
      ),
  }),
  z.object({
    type: z.literal("replyToThread"),
    ...itemCommand,
    threadId: id,
    messageId: z.uuid(),
    body: text,
  }),
  z.object({
    type: z.literal("setThreadState"),
    ...itemCommand,
    threadId: id,
    resolved: z.boolean(),
    blocking: z.boolean(),
  }),
  z.object({
    type: z.literal("createBranch"),
    ...revisionCommand,
    branchId: z.uuid(),
    name: z
      .string()
      .trim()
      .superRefine((name, ctx) => {
        const problem = branchNameProblem(name);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      })
      .describe(
        "At most 80 characters. Letters, numbers, “-”, “_”, “.” and “/”. No “..” or “//”, no trailing separator, no part ending in “.lock”, and not the name main.",
      ),
    fromBranchId: id.optional(),
  }),
  z.object({
    type: z.literal("setBranchCollaborator"),
    ...itemCommand,
    branchId: id,
    userId: id,
    assigned: z.boolean(),
  }),
  z.object({
    type: z.literal("commitBranch"),
    ...itemCommand,
    branchId: id,
    baseCommitId: id,
    title: text.max(240),
    content: document,
    proposedChildren: proposedChildrenSchema.optional(),
    message: text.max(500),
    // A conflict resolution may only replace the exact head shown to the user.
    expectedHeadId: id.optional(),
  }),
  // Live drafts of a specification line
  // (docs/internals/specification-drafts.md). Opens the shared draft of main
  // (no `branchId`) or a branch: creates it, or reopens a closed one as a new
  // epoch. Its document name is projected (`specDraft`).
  z.object({
    type: z.literal("openSpecificationDraft"),
    ...itemCommand,
    branchId: id.optional(),
    // Start again from the line's head, for everyone editing the draft.
    discardChanges: z.boolean().optional(),
  }),
  // Seals the draft at exactly `expectedSequence` (the stored sequence the
  // editor last saw): on main a new revision ("Save revision"; `message` is
  // its change summary), on a branch a commit. The content is the stored cut,
  // never sent by the client. A branch commit may carry the person's
  // breakdown edits, made from `breakdownBaseCommitId`.
  z.object({
    type: z.literal("commitSpecificationDraft"),
    ...itemCommand,
    draftId: id,
    epoch: z.number().int().positive(),
    expectedSequence: z.number().int().min(0),
    message: z.string().trim().max(500).optional(),
    proposedChildren: proposedChildrenSchema.optional(),
    breakdownBaseCommitId: id.optional(),
  }),
  z.object({
    type: z.literal("syncBranch"),
    ...itemCommand,
    branchId: id,
    targetId: id,
    sourceHeadId: id,
    targetHeadId: id,
    title: text.max(240).optional(),
    content: document.optional(),
    proposedChildren: proposedChildrenSchema.optional(),
  }),
  z.object({ type: z.literal("deleteBranch"), ...itemCommand, branchId: id }),
  z.object({
    type: z.literal("createPullRequest"),
    ...itemCommand,
    pullRequestId: z.uuid(),
    sourceId: id,
    targetId: id,
    title: text.max(120),
    description: text.max(10000),
    draft: z.boolean(),
  }),
  z.object({
    type: z.literal("setPullRequestDraft"),
    ...itemCommand,
    pullRequestId: id,
    draft: z.boolean(),
  }),
  z.object({
    type: z.literal("deletePullRequest"),
    ...itemCommand,
    pullRequestId: id,
  }),
  z.object({
    type: z.literal("requestPullRequestReview"),
    ...itemCommand,
    pullRequestId: id,
    disciplineId: id,
    userId: id.nullable(),
    required: z.boolean(),
  }),
  z.object({
    type: z.literal("decidePullRequest"),
    ...itemCommand,
    pullRequestId: id,
    reviewId: id,
    sourceHeadId: id,
    targetHeadId: id,
    decision: z.enum(["approve", "changes_requested", "revoke"]),
  }),
  z.object({
    type: z.literal("mergePullRequest"),
    ...itemCommand,
    pullRequestId: id,
    sourceHeadId: id,
    targetHeadId: id,
  }),
  z.object({
    type: z.literal("revertSpecification"),
    ...revisionCommand,
    revisionId: id,
  }),
  // Suggestions follow a pull-request lifecycle. Anyone in the organization
  // can draft one; only the author manages it; only assigned reviewers (members
  // of a role that can both edit specifications and review) approve and merge.
  z.object({
    type: z.literal("createSuggestion"),
    ...revisionCommand,
    suggestionId: z.uuid(),
    replacement: document,
    title: text.max(120),
    rationale: text.max(10_000),
    // Open for review immediately instead of saving a private draft.
    open: z.boolean(),
  }),
  // Author updates the proposed text (and re-bases onto the current revision).
  // A content change bumps the version and supersedes existing decisions.
  z.object({
    type: z.literal("updateSuggestion"),
    ...revisionCommand,
    suggestionId: id,
    replacement: document,
    title: text.max(120),
    rationale: text.max(10_000),
  }),
  // draft ⇄ open, open/draft → closed, closed → draft/open. Never merged.
  z.object({
    type: z.literal("setSuggestionState"),
    ...itemCommand,
    suggestionId: id,
    status: z.enum(["draft", "open", "closed"]),
  }),
  z.object({
    type: z.literal("setSuggestionReviewer"),
    ...itemCommand,
    suggestionId: id,
    userId: id,
    assigned: z.boolean(),
  }),
  z.object({
    type: z.literal("decideSuggestion"),
    ...itemCommand,
    suggestionId: id,
    version: z.number().int().positive(),
    decision: z.enum(["approve", "changes_requested", "revoke"]),
  }),
  // Merging creates the next mainline revision from the suggestion text.
  z.object({
    type: z.literal("mergeSuggestion"),
    ...revisionCommand,
    suggestionId: id,
  }),
  // Reviews are requested from a reviewing discipline of the item's project;
  // its name becomes the review responsibility. Optionally a specific member
  // of that discipline is asked.
  z.object({
    type: z.literal("requestReview"),
    ...revisionCommand,
    reviewId: z.uuid(),
    disciplineId: id,
    userId: id.nullable(),
    required: z.boolean(),
  }),
  z.object({
    type: z.literal("cancelReview"),
    ...itemCommand,
    reviewId: id,
  }),
  z.object({
    type: z.literal("decideReview"),
    ...revisionCommand,
    reviewId: id,
    decision: z.enum(["approve", "changes_requested", "revoke"]),
  }),
  // Confirms (or withdraws) a manual readiness check for the current revision.
  z.object({
    type: z.literal("signOffReadinessCheck"),
    ...revisionCommand,
    checkId: id,
    signedOff: z.boolean(),
  }),
  // Lictory Intelligence. Organization administrators decide whether content
  // may be sent to the AI provider; runs are recorded and never change content
  // by themselves.
  z.object({ type: z.literal("setAiPolicy"), enabled: z.boolean() }),
  z.object({
    type: z.literal("requestAiReview"),
    ...itemCommand,
    runId: z.uuid(),
  }),
  z.object({
    type: z.literal("rerunAiAction"),
    ...itemCommand,
    pullRequestId: id,
    runId: z.uuid(),
  }),
  // Opens one Lictory Intelligence pull request on this item with the chosen
  // fixable findings of a current review (which may belong to an ancestor's
  // review).
  z.object({
    type: z.literal("createAiCorrectivePr"),
    ...itemCommand,
    runId: id,
    findingIds: z.array(id).min(1).max(50),
    branchId: z.uuid(),
    pullRequestId: z.uuid(),
  }),
  // Commits a Lictory Intelligence review action suggestion to the pull
  // request's source branch.
  z.object({
    type: z.literal("applyAiSuggestion"),
    ...itemCommand,
    runId: id,
    findingId: id,
  }),
  // Project configuration (project administrators).
  z.object({
    type: z.literal("createTeam"),
    projectId: id,
    teamId: z.uuid(),
    name: text.max(60),
    description: z.string().trim().max(500).optional(),
  }),
  z.object({
    type: z.literal("updateTeam"),
    projectId: id,
    teamId: id,
    name: text.max(60).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    archived: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("setTeamMembership"),
    projectId: id,
    teamId: id,
    userId: id,
    member: z.boolean(),
  }),
  z.object({
    type: z.literal("setProjectType"),
    projectId: id,
    typeId: id,
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("createStatus"),
    projectId: id,
    statusId: z.uuid(),
    name: text.max(40),
    color: z.enum(labelColors),
    category: z.enum(statusCategories),
  }),
  z.object({
    type: z.literal("updateStatus"),
    projectId: id,
    statusId: id,
    name: text.max(40).optional(),
    color: z.enum(labelColors).optional(),
    category: z.enum(statusCategories).optional(),
    // Place before this status (null = last).
    beforeId: id.nullable().optional(),
  }),
  // Archiving moves the status's items explicitly; never a silent default.
  z.object({
    type: z.literal("archiveStatus"),
    projectId: id,
    statusId: id,
    replacementId: id,
  }),
  // Iteration planning (project administrators and disciplines that change
  // properties).
  z.object({
    type: z.literal("createIteration"),
    projectId: id,
    iterationId: z.uuid(),
    name: z.string().trim().max(80).nullable(),
    goal: z.string().trim().max(500).nullable(),
    startsAt: z.string().date(),
    endsAt: z.string().date(),
  }),
  z.object({
    type: z.literal("updateIteration"),
    projectId: id,
    iterationId: id,
    name: z.string().trim().max(80).nullable().optional(),
    goal: z.string().trim().max(500).nullable().optional(),
    startsAt: z.string().date().optional(),
    endsAt: z.string().date().optional(),
  }),
  z.object({
    type: z.literal("startIteration"),
    projectId: id,
    iterationId: id,
  }),
  // Unfinished items move to the chosen iteration or back to the backlog.
  z.object({
    type: z.literal("completeIteration"),
    projectId: id,
    iterationId: id,
    carryOverTo: id.nullable(),
  }),
  // Organization type registry (organization administrators).
  z.object({
    type: z.literal("createType"),
    typeId: z.uuid(),
    name: text.max(40),
    icon: z.enum(typeIcons),
    color: z.enum(labelColors),
    level: z.number().int().min(0).max(3),
    hasSpecification: z.boolean(),
  }),
  z.object({
    type: z.literal("updateType"),
    typeId: id,
    name: text.max(40).optional(),
    icon: z.enum(typeIcons).optional(),
    color: z.enum(labelColors).optional(),
    hasSpecification: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
]);
// Commands that change one project's configuration and may move its items.
export type ProjectConfigurationCommand = Extract<
  Command,
  {
    type:
      | "updateProject"
      | "publishReadinessChecks"
      | "archiveProject"
      | "setProjectMember"
      | "createDiscipline"
      | "updateDiscipline"
      | "setDisciplineMember"
      | "createTeam"
      | "updateTeam"
      | "setTeamMembership"
      | "setProjectType"
      | "createStatus"
      | "updateStatus"
      | "archiveStatus"
      | "createIteration"
      | "updateIteration"
      | "startIteration"
      | "completeIteration";
  }
>;
const projectConfigurationCommandTypes = new Set<string>([
  "updateProject",
  "publishReadinessChecks",
  "archiveProject",
  "setProjectMember",
  "createDiscipline",
  "updateDiscipline",
  "setDisciplineMember",
  "createTeam",
  "updateTeam",
  "setTeamMembership",
  "setProjectType",
  "createStatus",
  "updateStatus",
  "archiveStatus",
  "createIteration",
  "updateIteration",
  "startIteration",
  "completeIteration",
]);
export function isProjectConfigurationCommand(
  c: Command,
): c is ProjectConfigurationCommand {
  return projectConfigurationCommandTypes.has(c.type);
}
export type TypeCommand = Extract<
  Command,
  { type: "createType" | "updateType" }
>;
export function isTypeCommand(c: Command): c is TypeCommand {
  return c.type === "createType" || c.type === "updateType";
}
export type SpaceCommand = Extract<
  Command,
  {
    type:
      | "createSpace"
      | "updateSpace"
      | "setSpaceAccessMode"
      | "setSpaceGrant"
      | "archiveSpace"
      | "createPage"
      | "movePage"
      | "archivePage"
      | PageDiscussionCommand["type"]
      | PageHistoryCommand["type"];
  }
>;
export type PageHistoryCommand = Extract<
  Command,
  {
    type:
      | "commitDraft"
      | "restorePageCommit"
      | "createPageBranch"
      | "setPageBranchCollaborator"
      | "deletePageBranch"
      | "syncPageBranch"
      | "createPagePullRequest"
      | "updatePagePullRequest"
      | "deletePagePullRequest"
      | "requestPageReview"
      | "cancelPageReview"
      | "decidePagePullRequest"
      | "mergePagePullRequest"
      | "proposePageChange";
  }
>;
const pageHistoryCommandTypes = new Set<string>([
  "commitDraft",
  "restorePageCommit",
  "createPageBranch",
  "setPageBranchCollaborator",
  "deletePageBranch",
  "syncPageBranch",
  "createPagePullRequest",
  "updatePagePullRequest",
  "deletePagePullRequest",
  "requestPageReview",
  "cancelPageReview",
  "decidePagePullRequest",
  "mergePagePullRequest",
  "proposePageChange",
]);
export function isPageHistoryCommand(c: Command): c is PageHistoryCommand {
  return pageHistoryCommandTypes.has(c.type);
}
export type PageDiscussionCommand = Extract<
  Command,
  {
    type:
      | "createPageThread"
      | "replyToPageThread"
      | "resolvePageThread"
      | "reopenPageThread"
      | "setPageThreadBlocking";
  }
>;
const pageDiscussionCommandTypes = new Set<string>([
  "createPageThread",
  "replyToPageThread",
  "resolvePageThread",
  "reopenPageThread",
  "setPageThreadBlocking",
]);
export function isPageDiscussionCommand(
  c: Command,
): c is PageDiscussionCommand {
  return pageDiscussionCommandTypes.has(c.type);
}
const spaceCommandTypes = new Set<string>([
  "createSpace",
  "updateSpace",
  "setSpaceAccessMode",
  "setSpaceGrant",
  "archiveSpace",
  "createPage",
  "movePage",
  "archivePage",
  ...pageDiscussionCommandTypes,
  ...pageHistoryCommandTypes,
]);
export function isSpaceCommand(c: Command): c is SpaceCommand {
  return spaceCommandTypes.has(c.type);
}
// Knowledge link commands: they write knowledge rows and Spaces
// projections only (docs/internals/knowledge-links.md).
export type KnowledgeCommand = Extract<
  Command,
  {
    type:
      | "attachPage"
      | "detachPage"
      | "linkContextPage"
      | "unlinkContextPage"
      | "moveContextPage";
  }
>;
const knowledgeCommandTypes = new Set<string>([
  "attachPage",
  "detachPage",
  "linkContextPage",
  "unlinkContextPage",
  "moveContextPage",
]);
export function isKnowledgeCommand(c: Command): c is KnowledgeCommand {
  return knowledgeCommandTypes.has(c.type);
}
export type Command = z.infer<typeof commandSchema>;
export const mutationSchema = z.object({
  protocol: z.literal(PROTOCOL),
  id: z.uuid(),
  organizationId: id,
  command: commandSchema,
});
export type Mutation = z.infer<typeof mutationSchema>;
export const resultSchema = z.object({
  protocol: z.literal(PROTOCOL),
  mutationId: z.uuid(),
  cursor: checkpointSchema,
});
export const errorSchema = z.object({
  error: z.object({
    category: z.enum([
      "unauthorized",
      "forbidden",
      "unavailable",
      "not_found",
      "validation",
      "conflict",
      "server",
    ]),
    message: z.string(),
    currentRevisionId: z.string().optional(),
  }),
});
export function entityKey(e: Pick<Entity, "type" | "id">) {
  return `${e.type}:${e.id}`;
}
