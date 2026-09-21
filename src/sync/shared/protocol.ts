import { z } from "zod";

const id = z.string().min(1).max(160);
const text = z.string().trim().min(1).max(200_000);
// Specifications may be empty while an item is being drafted; readiness reports it.
const document = z.string().max(200_000);
const base = { id, organizationId: id };
const context = { workItemId: id, revisionId: id };

export const workItemKinds = ["epic", "story", "task"] as const;
export const workItemStatuses = [
  "backlog",
  "draft",
  "refinement",
  "in_review",
  "ready",
  "in_progress",
  "done",
  "cancelled",
] as const;
export const workItemPriorities = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type WorkItemKind = (typeof workItemKinds)[number];
export type WorkItemStatus = (typeof workItemStatuses)[number];
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

// Review information every list, inbox and filter needs without loading the
// item's full history. Computed server-side from the current revision only.
export const reviewSummarySchema = z.object({
  id,
  responsibility: z.string(),
  status: z.string(),
  required: z.boolean(),
  // Users and groups currently assigned; the client derives "needs my review".
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
    type: z.literal("product"),
    name: z.string(),
    slug: z.string(),
    key: z.string(),
    description: z.string().nullable(),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("label"),
    productId: id,
    name: z.string(),
    color: z.enum(labelColors),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("milestone"),
    productId: id,
    name: z.string(),
    targetDate: z.string().nullable(),
    status: z.enum(milestoneStatuses),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("workItem"),
    productId: id,
    parentId: id.nullable(),
    kind: z.enum(workItemKinds),
    number: z.number().int(),
    title: z.string(),
    status: z.enum(workItemStatuses),
    priority: z.enum(workItemPriorities),
    assigneeId: id.nullable(),
    milestoneId: id.nullable(),
    labelIds: z.array(id),
    position: z.number().int(),
    createdById: id,
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
    revisionId: id,
    revisionNumber: z.number().int(),
    openThreads: z.number().int(),
    blockingThreads: z.number().int(),
    pendingSuggestions: z.number().int(),
    reviews: z.array(reviewSummarySchema),
    readinessPassed: z.number().int(),
    readinessTotal: z.number().int(),
    childCount: z.number().int(),
    childReadyCount: z.number().int(),
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
    groupId: id.nullable(),
    withdrawnAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal("thread"),
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
  z.object({
    ...base,
    ...context,
    type: z.literal("suggestion"),
    authorId: id,
    replacement: z.string(),
    rationale: z.string().nullable(),
    status: z.enum(["pending", "accepted", "rejected"]),
    acceptedRevisionId: id.nullable(),
    createdAt: z.string(),
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

// Organization scope: products and every work item summary. Item scope adds the
// item's revisions, discussions, suggestions, reviews, approvals and activity.
export const scopeSchema = z
  .object({
    organizationId: id,
    productId: id.optional(),
    workItemId: id.optional(),
  })
  .refine(
    (scope) => !scope.workItemId || Boolean(scope.productId),
    "A work item scope requires a product.",
  );
export type Scope = z.infer<typeof scopeSchema>;
export const checkpointSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/);
const entityTypes = z.enum([
  "product",
  "label",
  "milestone",
  "workItem",
  "revision",
  "review",
  "assignment",
  "thread",
  "message",
  "suggestion",
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
export const memberSchema = z.object({
  id,
  name: z.string(),
  email: z.string(),
});
export type DirectoryMember = z.infer<typeof memberSchema>;
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
export const directorySchema = z.object({
  organizations: z.array(
    z.object({ id, name: z.string(), slug: z.string(), role: z.string() }),
  ),
  products: z.array(entitySchema.options[0]),
  members: z.array(memberSchema),
  groups: z.array(z.object({ id, name: z.string(), userIds: z.array(id) })),
});
export type Directory = z.infer<typeof directorySchema>;
export const PROTOCOL = 2 as const;
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
const productKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Use 2-10 letters or digits, e.g. PAY.");
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createProduct"),
    productId: z.uuid(),
    name: text.max(120),
    key: productKey,
  }),
  z.object({
    type: z.literal("updateProduct"),
    productId: id,
    name: text.max(120),
  }),
  z.object({
    type: z.literal("createWorkItem"),
    productId: id,
    workItemId: z.uuid(),
    kind: z.enum(workItemKinds),
    parentId: id.nullable(),
    title: text.max(240),
    description: document.optional(),
  }),
  // Non-material properties: they never create a revision or stale approvals.
  z.object({
    type: z.literal("updateWorkItem"),
    ...itemCommand,
    status: z.enum(workItemStatuses).optional(),
    priority: z.enum(workItemPriorities).optional(),
    assigneeId: id.nullable().optional(),
    parentId: id.nullable().optional(),
    milestoneId: id.nullable().optional(),
    labelIds: z.array(id).max(50).optional(),
  }),
  // Manual ordering among siblings: place before `beforeId` (null = last).
  z.object({
    type: z.literal("reorderWorkItem"),
    ...itemCommand,
    beforeId: id.nullable(),
  }),
  z.object({
    type: z.literal("createLabel"),
    productId: id,
    labelId: z.uuid(),
    name: text.max(60),
    color: z.enum(labelColors),
  }),
  z.object({
    type: z.literal("updateLabel"),
    productId: id,
    labelId: id,
    name: text.max(60).optional(),
    color: z.enum(labelColors).optional(),
    archived: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("createMilestone"),
    productId: id,
    milestoneId: z.uuid(),
    name: text.max(120),
    targetDate: z.string().date().nullable(),
  }),
  z.object({
    type: z.literal("updateMilestone"),
    productId: id,
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
    type: z.literal("createSuggestion"),
    ...revisionCommand,
    suggestionId: z.uuid(),
    replacement: document,
    rationale: text.max(2000),
  }),
  z.object({
    type: z.literal("decideSuggestion"),
    ...revisionCommand,
    suggestionId: id,
    accept: z.boolean(),
  }),
  z.object({
    type: z.literal("requestReview"),
    ...revisionCommand,
    reviewId: z.uuid(),
    responsibility: text.max(120),
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("user"), id }),
      z.object({ type: z.literal("group"), id }),
    ]),
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
]);
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
