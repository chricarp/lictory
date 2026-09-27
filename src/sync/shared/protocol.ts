import { z } from "zod";

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
// Fixed categories that give meaning to team-defined workflow statuses.
export const statusCategories = [
  "backlog",
  "unstarted",
  "started",
  "done",
  "canceled",
] as const;
export type StatusCategory = (typeof statusCategories)[number];
export const deliveryModes = ["native", "external"] as const;
export const readinessPolicies = ["off", "warn", "block"] as const;
export const iterationModes = ["off", "manual", "automatic"] as const;
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
});
export const entitySchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("project"),
    name: z.string(),
    slug: z.string(),
    key: z.string(),
    description: z.string().nullable(),
    defaultTeamId: id.nullable(),
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
    teamId: id,
    typeId: id,
    parentId: id.nullable(),
    number: z.number().int(),
    title: z.string(),
    statusId: id,
    // Null for types without a specification.
    refinementState: z.enum(refinementStates).nullable(),
    priority: z.enum(workItemPriorities),
    assigneeId: id.nullable(),
    milestoneId: id.nullable(),
    iterationId: id.nullable(),
    estimate: z.number().int().nullable(),
    labelIds: z.array(id),
    position: z.number().int(),
    rank: z.string(),
    sourceRevisionId: id.nullable(),
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
    roleId: id.nullable(),
    withdrawnAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal("thread"),
    // Discussions about a suggestion's proposed text block that suggestion's
    // merge rather than the work item's readiness.
    suggestionId: id.nullable(),
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
  "review",
  "assignment",
  "thread",
  "message",
  "suggestion",
  "suggestionReviewer",
  "suggestionDecision",
  "approval",
  "readiness",
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
// Fixed application roles. `admin` (Better Auth owner/admin) manages the
// organization, its projects and roles; `member` has every other feature.
// Workflow capabilities come only from organization roles, never from these.
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
  email: z.string(),
});
export type DirectoryMember = z.infer<typeof memberSchema>;
export const directoryMemberSchema = memberSchema.extend({
  // Better Auth member row, needed to change the application role.
  memberId: id,
  role: z.enum(applicationRoles),
  owner: z.boolean(),
});
// Workflow capabilities an organization role grants to its members.
export const capabilitySchema = z.object({
  editSpecifications: z.boolean(),
  changeProperties: z.boolean(),
  requestReviews: z.boolean(),
  review: z.boolean(),
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
};
export const roleSchema = z.object({
  id,
  name: z.string(),
  description: z.string().nullable(),
  capabilities: capabilitySchema,
  userIds: z.array(id),
  archivedAt: z.string().nullable(),
});
export type Role = z.infer<typeof roleSchema>;
// Union of capabilities over the active roles a user holds.
export function capabilitiesOf(roles: Role[], userId: string): Capabilities {
  const mine = roles.filter((r) => !r.archivedAt && r.userIds.includes(userId));
  return {
    editSpecifications: mine.some((r) => r.capabilities.editSpecifications),
    changeProperties: mine.some((r) => r.capabilities.changeProperties),
    requestReviews: mine.some((r) => r.capabilities.requestReviews),
    review: mine.some((r) => r.capabilities.review),
  };
}
// Suggestion reviewers merge into the mainline, so they must hold an active
// role that both edits specifications and can be asked to review.
export function canReviewSuggestions(roles: Role[], userId: string) {
  return roles.some(
    (r) =>
      !r.archivedAt &&
      r.userIds.includes(userId) &&
      r.capabilities.editSpecifications &&
      r.capabilities.review,
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
  number: z.number().int().positive(),
  title: z.string(),
});
export type EpicSummary = z.infer<typeof epicSummarySchema>;
export const epicSearchSchema = z.object({
  organizationId: id,
  projectId: id,
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
  name: z.string(),
  color: z.enum(labelColors),
  category: z.enum(statusCategories),
  position: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export const teamSchema = z.object({
  id,
  name: z.string(),
  description: z.string().nullable(),
  deliveryMode: z.enum(deliveryModes),
  readinessPolicy: z.enum(readinessPolicies),
  estimateScale: z.enum(estimateScales),
  iterationMode: z.enum(iterationModes),
  iterationWeeks: z.number().int(),
  iterationStartDay: z.number().int(),
  upcomingIterations: z.number().int(),
  memberIds: z.array(id),
  typeIds: z.array(id),
  statuses: z.array(workflowStatusSchema),
  archivedAt: z.string().nullable(),
});
export type Team = z.infer<typeof teamSchema>;
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
  teamId: id,
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
export function iterationLabel(i: Pick<Iteration, "name" | "number">) {
  return i.name?.trim().length ? i.name.trim() : `Iteration ${i.number}`;
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
  // Completed points of the team's recent iterations, oldest first.
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
export const directorySchema = z.object({
  organizations: z.array(
    z.object({ id, name: z.string(), slug: z.string(), role: z.string() }),
  ),
  projects: z.array(entitySchema.options[0]),
  members: z.array(directoryMemberSchema),
  roles: z.array(roleSchema),
  teams: z.array(teamSchema),
  types: z.array(workItemTypeSchema),
  // Planned and active iterations plus recent completed ones.
  iterations: z.array(iterationSchema),
});
export type Directory = z.infer<typeof directorySchema>;
export const PROTOCOL = 7 as const;
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
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createProject"),
    projectId: z.uuid(),
    name: text.max(120),
    key: projectKey,
  }),
  z.object({
    type: z.literal("updateProject"),
    projectId: id,
    name: text.max(120),
    defaultTeamId: id.optional(),
  }),
  z.object({
    type: z.literal("createWorkItem"),
    projectId: id,
    workItemId: z.uuid(),
    typeId: id,
    // Defaults to the project's default team.
    teamId: id.optional(),
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
    teamId: id.optional(),
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
    section: z.string().max(200),
    quote: z.string().max(2000).optional(),
    // Discuss a suggestion's proposed text instead of the specification.
    suggestionId: id.optional(),
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
  // Reviews are requested from a reviewer role; the role's name becomes the
  // review responsibility. Optionally a specific member of that role is asked.
  z.object({
    type: z.literal("requestReview"),
    ...revisionCommand,
    reviewId: z.uuid(),
    roleId: id,
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
  // Team configuration (application-role admins only).
  z.object({
    type: z.literal("createTeam"),
    teamId: z.uuid(),
    name: text.max(60),
  }),
  z.object({
    type: z.literal("updateTeam"),
    teamId: id,
    name: text.max(60).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    deliveryMode: z.enum(deliveryModes).optional(),
    readinessPolicy: z.enum(readinessPolicies).optional(),
    estimateScale: z.enum(estimateScales).optional(),
    iterationMode: z.enum(iterationModes).optional(),
    iterationWeeks: z.number().int().min(1).max(8).optional(),
    iterationStartDay: z.number().int().min(0).max(6).optional(),
    upcomingIterations: z.number().int().min(0).max(6).optional(),
    archived: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("setTeamMembership"),
    teamId: id,
    userId: id,
    member: z.boolean(),
  }),
  z.object({
    type: z.literal("setTeamType"),
    teamId: id,
    typeId: id,
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("createStatus"),
    teamId: id,
    statusId: z.uuid(),
    name: text.max(40),
    color: z.enum(labelColors),
    category: z.enum(statusCategories),
  }),
  z.object({
    type: z.literal("updateStatus"),
    teamId: id,
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
    teamId: id,
    statusId: id,
    replacementId: id,
  }),
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
  // Iteration planning (roles that change properties).
  z.object({
    type: z.literal("createIteration"),
    teamId: id,
    iterationId: z.uuid(),
    name: z.string().trim().max(80).nullable(),
    goal: z.string().trim().max(500).nullable(),
    startsAt: z.string().date(),
    endsAt: z.string().date(),
  }),
  z.object({
    type: z.literal("updateIteration"),
    teamId: id,
    iterationId: id,
    name: z.string().trim().max(80).nullable().optional(),
    goal: z.string().trim().max(500).nullable().optional(),
    startsAt: z.string().date().optional(),
    endsAt: z.string().date().optional(),
  }),
  z.object({
    type: z.literal("startIteration"),
    teamId: id,
    iterationId: id,
  }),
  // Unfinished items move to the chosen iteration or back to the backlog.
  z.object({
    type: z.literal("completeIteration"),
    teamId: id,
    iterationId: id,
    carryOverTo: id.nullable(),
  }),
  // Organization role administration (application-role admins only).
  z.object({
    type: z.literal("createRole"),
    roleId: z.uuid(),
    name: text.max(60),
    description: z.string().trim().max(500).optional(),
    capabilities: capabilitySchema,
  }),
  z.object({
    type: z.literal("updateRole"),
    roleId: id,
    name: text.max(60).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    capabilities: capabilitySchema.optional(),
    archived: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("setRoleMembership"),
    roleId: id,
    userId: id,
    member: z.boolean(),
  }),
]);
export type RoleCommand = Extract<
  Command,
  { type: "createRole" | "updateRole" | "setRoleMembership" }
>;
export type TeamCommand = Extract<
  Command,
  {
    type:
      | "createTeam"
      | "updateTeam"
      | "setTeamMembership"
      | "setTeamType"
      | "createStatus"
      | "updateStatus"
      | "archiveStatus"
      | "createType"
      | "updateType"
      | "createIteration"
      | "updateIteration"
      | "startIteration"
      | "completeIteration";
  }
>;
const teamCommandTypes = new Set<string>([
  "createTeam",
  "updateTeam",
  "setTeamMembership",
  "setTeamType",
  "createStatus",
  "updateStatus",
  "archiveStatus",
  "createType",
  "updateType",
  "createIteration",
  "updateIteration",
  "startIteration",
  "completeIteration",
]);
export function isTeamCommand(c: Command): c is TeamCommand {
  return teamCommandTypes.has(c.type);
}
export function isRoleCommand(c: Command): c is RoleCommand {
  return (
    c.type === "createRole" ||
    c.type === "updateRole" ||
    c.type === "setRoleMembership"
  );
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
