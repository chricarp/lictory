import { z } from "zod";

const id = z.string().min(1).max(160);
const text = z.string().trim().min(1).max(200_000);
const document = z
  .string()
  .max(200_000)
  .refine(
    (value) => value.trim().length > 0,
    "Specification content is required.",
  );
const base = { id, organizationId: id };
const context = { proposalId: id, revisionId: id };
export const entitySchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("product"),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("proposal"),
    productId: id,
    title: z.string(),
    problemStatement: z.string().nullable(),
    status: z.string(),
    archivedAt: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("revision"),
    proposalId: id,
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
    anchor: z
      .object({
        version: z.literal(1),
        kind: z.literal("document"),
        section: z.string(),
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
    replacement: z.string(),
    rationale: z.string().nullable(),
    status: z.enum(["pending", "accepted", "rejected"]),
    acceptedRevisionId: id.nullable(),
  }),
  z.object({
    ...base,
    ...context,
    type: z.literal("approval"),
    reviewId: id,
    reviewerId: id,
    status: z.enum(["granted", "revoked", "stale"]),
  }),
  z.object({
    ...base,
    type: z.literal("readiness"),
    proposalId: id,
    checks: z.array(z.object({ label: z.string(), passed: z.boolean() })),
  }),
  z.object({
    ...base,
    type: z.literal("activity"),
    proposalId: id,
    actorId: id,
    action: z.string(),
    createdAt: z.string(),
  }),
]);
export type Entity = z.infer<typeof entitySchema>;
export type EntityType = Entity["type"];
export const scopeSchema = z
  .object({
    organizationId: id,
    productId: id.optional(),
    proposalId: id.optional(),
  })
  .refine(
    (scope) => !scope.proposalId || Boolean(scope.productId),
    "A proposal scope requires a product.",
  );
export type Scope = z.infer<typeof scopeSchema>;
export const checkpointSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/);
export const changeSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("upsert"),
    cursor: checkpointSchema,
    entity: entitySchema,
  }),
  z.object({
    operation: z.literal("delete"),
    cursor: checkpointSchema,
    type: z.enum([
      "product",
      "proposal",
      "revision",
      "review",
      "assignment",
      "thread",
      "message",
      "suggestion",
      "approval",
      "readiness",
      "activity",
    ]),
    id,
  }),
]);
export type Change = z.infer<typeof changeSchema>;
export const directorySchema = z.object({
  organizations: z.array(z.object({ id, name: z.string(), role: z.string() })),
  products: z.array(entitySchema.options[0]),
  members: z.array(z.object({ id, name: z.string() })),
  groups: z.array(z.object({ id, name: z.string(), userIds: z.array(id) })),
});
export type Directory = z.infer<typeof directorySchema>;
export const pageSchema = z.object({
  protocol: z.literal(1),
  changes: z.array(changeSchema),
  nextCursor: checkpointSchema,
  hasMore: z.boolean(),
  directory: directorySchema,
});
export type SyncPage = z.infer<typeof pageSchema>;
const proposalCommand = { proposalId: id };
const revisionCommand = { ...proposalCommand, baseRevisionId: id };
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createProduct"),
    name: text.max(120),
    slug: text.max(120),
  }),
  z.object({
    type: z.literal("renameProduct"),
    productId: id,
    name: text.max(120),
  }),
  z.object({
    type: z.literal("createProposal"),
    productId: id,
    proposalId: z.uuid(),
    title: text.max(240),
    problem: text,
  }),
  z.object({
    type: z.literal("archiveProposal"),
    ...proposalCommand,
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("updateSpecification"),
    ...revisionCommand,
    title: text.max(240),
    content: document,
    summary: text.max(500),
  }),
  z.object({
    type: z.literal("createThread"),
    ...revisionCommand,
    threadId: z.uuid(),
    body: text,
    blocking: z.boolean(),
    section: z.string().max(200),
  }),
  z.object({
    type: z.literal("replyToThread"),
    ...proposalCommand,
    threadId: id,
    messageId: z.uuid(),
    body: text,
  }),
  z.object({
    type: z.literal("setThreadState"),
    ...proposalCommand,
    threadId: id,
    resolved: z.boolean(),
    blocking: z.boolean(),
  }),
  z.object({
    type: z.literal("createSuggestion"),
    ...revisionCommand,
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
    responsibility: text.max(120),
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("user"), id }),
      z.object({ type: z.literal("group"), id }),
    ]),
    required: z.boolean(),
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
  protocol: z.literal(1),
  id: z.uuid(),
  organizationId: id,
  command: commandSchema,
});
export type Mutation = z.infer<typeof mutationSchema>;
export const resultSchema = z.object({
  protocol: z.literal(1),
  mutationId: z.uuid(),
  cursor: checkpointSchema,
});
export const errorSchema = z.object({
  error: z.object({
    category: z.enum([
      "unauthorized",
      "forbidden",
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
