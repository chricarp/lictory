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
    createdById: id,
    createdAt: z.string(),
    // When main last moved (the published commit's time).
    updatedAt: z.string(),
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
    anchor: pageThreadAnchorSchema,
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
]);
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
// Protocol 16 adds Lictory Spaces commands (spaces, pages and page
// discussions); their projections use the separate `space_entity` table.
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
      | PageDiscussionCommand["type"];
  }
>;
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
]);
export function isSpaceCommand(c: Command): c is SpaceCommand {
  return spaceCommandTypes.has(c.type);
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
