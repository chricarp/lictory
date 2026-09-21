import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../../db/schema";
import {
  entityKey,
  entitySchema,
  type Entity,
  type Mutation,
  type Scope,
  type Change,
} from "../shared/protocol";

type Database = PostgresJsDatabase<typeof s>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export class DomainError extends Error {
  constructor(
    public category: "forbidden" | "conflict" | "validation",
    message: string,
    public currentRevisionId?: string,
  ) {
    super(message);
  }
}
function requireValue<T>(
  v: T | undefined,
  message = "This item is unavailable.",
): T {
  if (!v) throw new DomainError("forbidden", message);
  return v;
}
export function serialize(type: Entity["type"], row: unknown): Entity {
  return entitySchema.parse({
    ...(JSON.parse(JSON.stringify(row)) as Record<string, unknown>),
    type,
  });
}
export async function authorize(
  tx: Tx,
  userId: string,
  organizationId: string,
) {
  return requireValue(
    (
      await tx
        .select()
        .from(s.member)
        .where(
          and(
            eq(s.member.organizationId, organizationId),
            eq(s.member.userId, userId),
          ),
        )
    )[0],
    "Organization access has been removed.",
  );
}
async function lock(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
  );
}
async function clock(tx: Tx, organizationId: string) {
  return (
    (
      await tx
        .select()
        .from(s.syncClock)
        .where(eq(s.syncClock.organizationId, organizationId))
    )[0]?.cursor ?? 0n
  );
}
export async function directory(
  db: Database | Tx,
  userId: string,
  organizationId?: string,
) {
  const organizations = await db
    .select({
      id: s.organization.id,
      name: s.organization.name,
      role: s.member.role,
    })
    .from(s.organization)
    .innerJoin(
      s.member,
      and(
        eq(s.member.organizationId, s.organization.id),
        eq(s.member.userId, userId),
      ),
    );
  if (!organizationId)
    return { organizations, products: [], members: [], groups: [] };
  requireValue(
    organizations.find((o) => o.id === organizationId),
    "Organization access has been removed.",
  );
  const products = (
    await db
      .select()
      .from(s.product)
      .where(eq(s.product.organizationId, organizationId))
  ).map((row) => serialize("product", row));
  const members = await db
    .select({ id: s.user.id, name: s.user.name })
    .from(s.member)
    .innerJoin(s.user, eq(s.member.userId, s.user.id))
    .where(eq(s.member.organizationId, organizationId));
  const memberships = await db
    .select()
    .from(s.groupMember)
    .where(eq(s.groupMember.organizationId, organizationId));
  const groups = (
    await db
      .select()
      .from(s.group)
      .where(
        and(
          eq(s.group.organizationId, organizationId),
          isNull(s.group.archivedAt),
        ),
      )
  ).map((g) => ({
    id: g.id,
    name: g.name,
    userIds: memberships.filter((m) => m.groupId === g.id).map((m) => m.userId),
  }));
  return { organizations, products, members, groups };
}
export async function snapshot(tx: Tx, scope: Scope): Promise<Entity[]> {
  const { organizationId, productId, proposalId } = scope;
  if (!productId)
    return (
      await tx
        .select()
        .from(s.product)
        .where(eq(s.product.organizationId, organizationId))
    ).map((p) => serialize("product", p));
  const product = requireValue(
    (
      await tx
        .select()
        .from(s.product)
        .where(
          and(
            eq(s.product.organizationId, organizationId),
            eq(s.product.id, productId),
          ),
        )
    )[0],
  );
  const proposals = await tx
    .select()
    .from(s.proposal)
    .where(
      and(
        eq(s.proposal.organizationId, organizationId),
        eq(s.proposal.productId, productId),
      ),
    );
  const entities: Entity[] = [
    serialize("product", product),
    ...proposals.map((p) => serialize("proposal", p)),
  ];
  if (!proposalId) return entities;
  requireValue(proposals.find((p) => p.id === proposalId));
  const revisions = await tx
    .select()
    .from(s.specificationRevision)
    .where(
      and(
        eq(s.specificationRevision.organizationId, organizationId),
        eq(s.specificationRevision.proposalId, proposalId),
      ),
    )
    .orderBy(desc(s.specificationRevision.number));
  const reviews = await tx
    .select()
    .from(s.review)
    .where(
      and(
        eq(s.review.organizationId, organizationId),
        eq(s.review.proposalId, proposalId),
      ),
    );
  const threads = await tx
    .select()
    .from(s.thread)
    .where(
      and(
        eq(s.thread.organizationId, organizationId),
        eq(s.thread.proposalId, proposalId),
      ),
    );
  const approvals = await tx
    .select()
    .from(s.approval)
    .where(
      and(
        eq(s.approval.organizationId, organizationId),
        eq(s.approval.proposalId, proposalId),
      ),
    );
  const suggestions = await tx
    .select()
    .from(s.suggestion)
    .where(
      and(
        eq(s.suggestion.organizationId, organizationId),
        eq(s.suggestion.proposalId, proposalId),
      ),
    );
  const assignments = reviews.length
    ? await tx
        .select()
        .from(s.reviewAssignment)
        .where(
          and(
            eq(s.reviewAssignment.organizationId, organizationId),
            inArray(
              s.reviewAssignment.reviewId,
              reviews.map((r) => r.id),
            ),
          ),
        )
    : [];
  const messages = threads.length
    ? await tx
        .select()
        .from(s.threadMessage)
        .where(
          and(
            eq(s.threadMessage.organizationId, organizationId),
            inArray(
              s.threadMessage.threadId,
              threads.map((t) => t.id),
            ),
          ),
        )
        .orderBy(asc(s.threadMessage.createdAt), asc(s.threadMessage.id))
    : [];
  const activity = await tx
    .select()
    .from(s.activity)
    .where(
      and(
        eq(s.activity.organizationId, organizationId),
        eq(s.activity.proposalId, proposalId),
      ),
    )
    .orderBy(asc(s.activity.createdAt));
  for (const [type, rows] of [
    ["revision", revisions],
    ["review", reviews],
    ["thread", threads],
    ["approval", approvals],
    ["suggestion", suggestions],
    ["assignment", assignments],
    ["message", messages],
    ["activity", activity],
  ] as const)
    entities.push(...rows.map((row) => serialize(type, row)));
  const current = revisions[0];
  // Required responsibilities persist across revisions; fresh requests satisfy them.
  const responsibilities = [
    ...new Set(
      reviews
        .filter((r) => r.required && r.status !== "cancelled")
        .map((r) => r.responsibility),
    ),
  ];
  const currentRequired = reviews.filter(
    (r) =>
      r.required && r.status !== "cancelled" && r.revisionId === current?.id,
  );
  entities.push({
    type: "readiness",
    id: proposalId,
    organizationId,
    proposalId,
    checks: [
      {
        label: "Specification content defined",
        passed: Boolean(current?.content.trim()),
      },
      {
        label: "No open blocking discussions",
        passed: !threads.some((t) => t.blocking && t.status === "open"),
      },
      {
        label: "Required reviews and current approvals complete",
        passed:
          responsibilities.length > 0 &&
          responsibilities.every((responsibility) =>
            currentRequired.some((r) => r.responsibility === responsibility),
          ) &&
          currentRequired.every(
            (r) =>
              r.status === "completed" &&
              approvals.some(
                (a) =>
                  a.reviewId === r.id &&
                  a.status === "granted" &&
                  a.revisionId === current?.id,
              ),
          ),
      },
    ],
  });
  return entities;
}
export function createSyncService(db: Database) {
  return {
    async read(userId: string, scope: Scope, cursor?: string, limit = 100) {
      const pageSize = Math.min(500, Math.max(1, Math.floor(limit)));
      return db.transaction(async (tx) => {
        await lock(tx, scope.organizationId);
        await authorize(tx, userId, scope.organizationId);
        const head = await clock(tx, scope.organizationId);
        if (cursor !== undefined && BigInt(cursor) > head)
          throw new DomainError(
            "conflict",
            "Checkpoint is ahead of the server. Reset this workspace cache.",
          );
        const roster = await directory(tx, userId, scope.organizationId);
        if (scope.productId !== undefined)
          requireValue(roster.products.find((p) => p.id === scope.productId));
        if (scope.proposalId && scope.productId)
          requireValue(
            (
              await tx
                .select({ id: s.proposal.id })
                .from(s.proposal)
                .where(
                  and(
                    eq(s.proposal.organizationId, scope.organizationId),
                    eq(s.proposal.productId, scope.productId),
                    eq(s.proposal.id, scope.proposalId),
                  ),
                )
            )[0],
          );
        if (cursor === undefined)
          return {
            protocol: 1 as const,
            changes: (await snapshot(tx, scope)).map((entity) => ({
              operation: "upsert" as const,
              cursor: head.toString(),
              entity,
            })),
            nextCursor: head.toString(),
            hasMore: false,
            directory: roster,
          };
        const rows = await tx
          .select()
          .from(s.syncChange)
          .where(
            and(
              eq(s.syncChange.organizationId, scope.organizationId),
              !scope.productId
                ? undefined
                : eq(s.syncChange.productId, scope.productId),
              gt(s.syncChange.cursor, BigInt(cursor)),
              scope.proposalId
                ? or(
                    isNull(s.syncChange.proposalId),
                    eq(s.syncChange.proposalId, scope.proposalId),
                  )
                : isNull(s.syncChange.proposalId),
            ),
          )
          .orderBy(asc(s.syncChange.cursor))
          .limit(pageSize + 1);
        const hasMore = rows.length > pageSize;
        const page = rows.slice(0, pageSize);
        return {
          protocol: 1 as const,
          changes: page
            .map((r) => r.change)
            .filter(
              (c) =>
                scope.productId !== undefined ||
                (c.operation === "upsert"
                  ? c.entity.type === "product"
                  : c.type === "product"),
            ),
          nextCursor: hasMore
            ? page.at(-1)!.cursor.toString()
            : head.toString(),
          hasMore,
          directory: roster,
        };
      });
    },
    async mutate(userId: string, mutation: Mutation) {
      const { organizationId, command: c } = mutation;
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const membership = await authorize(tx, userId, organizationId);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(c))
          .digest("hex");
        const previous = (
          await tx
            .select()
            .from(s.syncMutation)
            .where(
              and(
                eq(s.syncMutation.organizationId, organizationId),
                eq(s.syncMutation.id, mutation.id),
              ),
            )
        )[0];
        if (previous) {
          if (
            previous.userId !== userId ||
            previous.fingerprint !== fingerprint
          )
            throw new DomainError(
              "conflict",
              "Mutation ID was already used for a different command.",
            );
          return {
            protocol: 1 as const,
            mutationId: mutation.id,
            cursor: previous.cursor.toString(),
          };
        }
        const canManageProduct = membership.role
          .split(",")
          .some((r) => r === "owner" || r === "admin");
        let productId: string;
        let proposalId: string | undefined;
        if (c.type === "createProduct") productId = crypto.randomUUID();
        else if ("productId" in c) productId = c.productId;
        else {
          proposalId = c.proposalId;
          const proposal = requireValue(
            (
              await tx
                .select()
                .from(s.proposal)
                .where(
                  and(
                    eq(s.proposal.organizationId, organizationId),
                    eq(s.proposal.id, proposalId),
                  ),
                )
            )[0],
          );
          if (proposal.archivedAt && c.type !== "archiveProposal")
            throw new DomainError(
              "conflict",
              "Restore this proposal before changing it.",
            );
          productId = proposal.productId;
        }
        if (c.type !== "createProduct")
          requireValue(
            (
              await tx
                .select()
                .from(s.product)
                .where(
                  and(
                    eq(s.product.organizationId, organizationId),
                    eq(s.product.id, productId),
                    isNull(s.product.archivedAt),
                  ),
                )
            )[0],
          );
        const scope = { organizationId, productId, proposalId };
        const before =
          c.type === "createProduct" ? [] : await snapshot(tx, scope);
        const latest = before
          .filter((e) => e.type === "revision")
          .sort((a, b) => b.number - a.number)[0];
        if ("baseRevisionId" in c && c.baseRevisionId !== latest?.id)
          throw new DomainError(
            "conflict",
            "The specification changed. Compare your draft with the latest revision before resubmitting.",
            latest?.id,
          );
        const now = new Date();
        const context = {
          organizationId,
          proposalId: proposalId!,
          revisionId: latest?.id ?? "",
        };
        const revision = async (
          title: string,
          content: string,
          summary: string,
        ) => {
          if (latest?.title === title && latest.content === content)
            return latest.id;
          const revisionId = crypto.randomUUID();
          await tx.insert(s.specificationRevision).values({
            id: revisionId,
            organizationId,
            proposalId: proposalId!,
            number: (latest?.number ?? 0) + 1,
            title,
            content,
            changeSummary: summary,
            authorId: userId,
          });
          await tx
            .update(s.proposal)
            .set({ title, status: "refinement" })
            .where(
              and(
                eq(s.proposal.organizationId, organizationId),
                eq(s.proposal.id, proposalId!),
              ),
            );
          await tx
            .update(s.approval)
            .set({
              status: "stale",
              endedAt: now,
              endedById: userId,
              endReason: "Specification revised",
            })
            .where(
              and(
                eq(s.approval.organizationId, organizationId),
                eq(s.approval.proposalId, proposalId!),
                eq(s.approval.status, "granted"),
              ),
            );
          return revisionId;
        };
        switch (c.type) {
          case "createProduct":
            if (!canManageProduct)
              throw new DomainError(
                "forbidden",
                "An organization administrator must create products.",
              );
            await tx.insert(s.product).values({
              id: productId,
              organizationId,
              name: c.name,
              slug: c.slug,
              createdById: userId,
            });
            break;
          case "renameProduct":
            if (!canManageProduct)
              throw new DomainError(
                "forbidden",
                "An organization administrator must update products.",
              );
            await tx
              .update(s.product)
              .set({ name: c.name })
              .where(
                and(
                  eq(s.product.organizationId, organizationId),
                  eq(s.product.id, productId),
                ),
              );
            break;
          case "createProposal":
            proposalId = c.proposalId;
            await tx.insert(s.proposal).values({
              id: proposalId,
              organizationId,
              productId,
              title: c.title,
              problemStatement: c.problem,
              createdById: userId,
            });
            await revision(
              c.title,
              `# Intent\n\n${c.problem}\n\n## Acceptance criteria\n\n`,
              "Initial proposal",
            );
            break;
          case "archiveProposal":
            await tx
              .update(s.proposal)
              .set({ archivedAt: c.archived ? now : null })
              .where(
                and(
                  eq(s.proposal.organizationId, organizationId),
                  eq(s.proposal.id, proposalId!),
                ),
              );
            break;
          case "updateSpecification":
            await revision(c.title, c.content, c.summary);
            break;
          case "createThread":
            await tx.insert(s.thread).values({
              id: c.threadId,
              ...context,
              authorId: userId,
              blocking: c.blocking,
              anchor: { version: 1, kind: "document", section: c.section },
            });
            await tx.insert(s.threadMessage).values({
              organizationId,
              threadId: c.threadId,
              authorId: userId,
              body: c.body,
            });
            break;
          case "replyToThread":
          case "setThreadState": {
            requireValue(
              before.find((e) => e.type === "thread" && e.id === c.threadId),
            );
            if (c.type === "replyToThread")
              await tx.insert(s.threadMessage).values({
                id: c.messageId,
                organizationId,
                threadId: c.threadId,
                authorId: userId,
                body: c.body,
              });
            else
              await tx
                .update(s.thread)
                .set({
                  status: c.resolved ? "resolved" : "open",
                  blocking: c.blocking,
                  resolvedById: c.resolved ? userId : null,
                  resolvedAt: c.resolved ? now : null,
                })
                .where(
                  and(
                    eq(s.thread.organizationId, organizationId),
                    eq(s.thread.id, c.threadId),
                  ),
                );
            break;
          }
          case "createSuggestion":
            await tx.insert(s.suggestion).values({
              ...context,
              authorId: userId,
              replacement: c.replacement,
              rationale: c.rationale,
            });
            break;
          case "decideSuggestion": {
            const suggestion = requireValue(
              before.find(
                (e) => e.type === "suggestion" && e.id === c.suggestionId,
              ),
            );
            if (
              suggestion.type !== "suggestion" ||
              suggestion.status !== "pending"
            )
              throw new DomainError(
                "conflict",
                "This suggestion was already decided.",
              );
            if (c.accept && suggestion.revisionId !== latest?.id)
              throw new DomainError(
                "conflict",
                "This suggestion targets an older revision. Create an updated suggestion.",
                latest?.id,
              );
            if (c.accept && suggestion.replacement === latest?.content)
              throw new DomainError(
                "validation",
                "This suggestion makes no content change.",
              );
            const acceptedRevisionId = c.accept
              ? await revision(
                  latest!.title,
                  suggestion.replacement,
                  "Accepted suggestion",
                )
              : null;
            await tx
              .update(s.suggestion)
              .set({
                status: c.accept ? "accepted" : "rejected",
                resolvedAt: now,
                resolvedById: userId,
                acceptedRevisionId,
              })
              .where(
                and(
                  eq(s.suggestion.organizationId, organizationId),
                  eq(s.suggestion.id, c.suggestionId),
                ),
              );
            break;
          }
          case "requestReview": {
            const roster = await directory(tx, userId, organizationId);
            requireValue(
              (c.target.type === "user" ? roster.members : roster.groups).find(
                (t) => t.id === c.target.id,
              ),
              "Reviewer is outside this organization.",
            );
            const reviewId = crypto.randomUUID();
            await tx.insert(s.review).values({
              id: reviewId,
              ...context,
              responsibility: c.responsibility,
              required: c.required,
              requestedById: userId,
            });
            await tx.insert(s.reviewAssignment).values({
              organizationId,
              reviewId,
              assignedById: userId,
              userId: c.target.type === "user" ? c.target.id : null,
              groupId: c.target.type === "group" ? c.target.id : null,
            });
            await tx
              .update(s.proposal)
              .set({ status: "in_review" })
              .where(
                and(
                  eq(s.proposal.organizationId, organizationId),
                  eq(s.proposal.id, proposalId!),
                ),
              );
            break;
          }
          case "decideReview": {
            const review = requireValue(
              before.find((e) => e.type === "review" && e.id === c.reviewId),
            );
            if (review.type !== "review" || review.revisionId !== latest?.id)
              throw new DomainError(
                "conflict",
                "Request a review of the current revision.",
                latest?.id,
              );
            const roster = await directory(tx, userId, organizationId);
            const canReviewSpecification = before.some(
              (e) =>
                e.type === "assignment" &&
                e.reviewId === c.reviewId &&
                !e.withdrawnAt &&
                (e.userId === userId ||
                  roster.groups.some(
                    (g) => g.id === e.groupId && g.userIds.includes(userId),
                  )),
            );
            if (!canReviewSpecification)
              throw new DomainError(
                "forbidden",
                "Only an assigned reviewer can decide this review.",
              );
            await tx
              .update(s.approval)
              .set({
                status: "revoked",
                endedAt: now,
                endedById: userId,
                endReason: "Reviewer decision changed",
              })
              .where(
                and(
                  eq(s.approval.organizationId, organizationId),
                  eq(s.approval.reviewId, c.reviewId),
                  eq(s.approval.reviewerId, userId),
                  eq(s.approval.status, "granted"),
                ),
              );
            if (c.decision === "approve")
              await tx.insert(s.approval).values({
                ...context,
                reviewId: c.reviewId,
                reviewerId: userId,
              });
            await tx
              .update(s.review)
              .set({
                status:
                  c.decision === "approve"
                    ? "completed"
                    : c.decision === "revoke"
                      ? "requested"
                      : "changes_requested",
                completedAt: c.decision === "approve" ? now : null,
              })
              .where(
                and(
                  eq(s.review.organizationId, organizationId),
                  eq(s.review.id, c.reviewId),
                ),
              );
            await tx
              .update(s.proposal)
              .set({
                status:
                  c.decision === "changes_requested"
                    ? "changes_requested"
                    : "in_review",
              })
              .where(
                and(
                  eq(s.proposal.organizationId, organizationId),
                  eq(s.proposal.id, proposalId!),
                ),
              );
            break;
          }
        }
        if (proposalId)
          await tx.insert(s.activity).values({
            id: crypto.randomUUID(),
            organizationId,
            productId,
            proposalId,
            actorId: userId,
            action:
              c.type === "setThreadState"
                ? `${c.resolved ? "Resolved" : "Reopened"} ${c.blocking ? "blocking" : "non-blocking"} discussion ${c.threadId}`
                : c.type === "decideReview"
                  ? `${c.decision === "approve" ? "Approved" : c.decision === "revoke" ? "Revoked approval for" : "Requested changes to"} revision ${latest?.number ?? ""}`
                  : c.type === "decideSuggestion"
                    ? `${c.accept ? "Accepted" : "Rejected"} suggestion ${c.suggestionId}`
                    : c.type === "archiveProposal"
                      ? c.archived
                        ? "Archived proposal"
                        : "Restored proposal"
                      : c.type,
          });
        let after = await snapshot(tx, {
          organizationId,
          productId,
          proposalId,
        });
        const readiness = after.find((e) => e.type === "readiness");
        const proposalState = after.find(
          (e) => e.type === "proposal" && e.id === proposalId,
        );
        if (
          readiness?.type === "readiness" &&
          proposalState?.type === "proposal"
        ) {
          const ready = readiness.checks.every((check) => check.passed);
          const status = ready
            ? "approved"
            : proposalState.status === "approved"
              ? "in_review"
              : undefined;
          if (status && status !== proposalState.status) {
            await tx
              .update(s.proposal)
              .set({ status })
              .where(
                and(
                  eq(s.proposal.organizationId, organizationId),
                  eq(s.proposal.id, proposalId!),
                ),
              );
            after = after.map((e) =>
              e.type === "proposal" && e.id === proposalId
                ? { ...e, status }
                : e,
            );
          }
        }
        const old = new Map(
          before.map((e) => [entityKey(e), JSON.stringify(e)]),
        );
        let cursor = await clock(tx, organizationId);
        for (const entity of after) {
          if (old.get(entityKey(entity)) === JSON.stringify(entity)) continue;
          cursor++;
          const change: Change = {
            operation: "upsert",
            cursor: cursor.toString(),
            entity,
          };
          await tx.insert(s.syncChange).values({
            organizationId,
            cursor,
            productId,
            proposalId:
              entity.type === "proposal" || entity.type === "product"
                ? null
                : proposalId,
            change,
          });
        }
        await tx
          .insert(s.syncClock)
          .values({ organizationId, cursor })
          .onConflictDoUpdate({
            target: s.syncClock.organizationId,
            set: { cursor },
          });
        await tx.insert(s.syncMutation).values({
          organizationId,
          id: mutation.id,
          userId,
          fingerprint,
          cursor,
        });
        // PostgreSQL delivers NOTIFY only after COMMIT. It is an invalidation, never data.
        await tx.execute(
          sql`select pg_notify('lictory_sync', ${JSON.stringify({ organizationId, cursor: cursor.toString() })})`,
        );
        return {
          protocol: 1 as const,
          mutationId: mutation.id,
          cursor: cursor.toString(),
        };
      });
    },
  };
}
