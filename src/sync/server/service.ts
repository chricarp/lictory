import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "../../db/schema";
import {
  PROTOCOL,
  entityKey,
  entitySchema,
  type Entity,
  type EntityOf,
  type Mutation,
  type ReadinessCheck,
  type Scope,
  type Change,
  type WorkItemStatus,
} from "../shared/protocol";
import { hasAcceptanceCriteria } from "../shared/specification";

type Database = PostgresJsDatabase<typeof s>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export class DomainError extends Error {
  constructor(
    public category: "forbidden" | "unavailable" | "conflict" | "validation",
    message: string,
    public currentRevisionId?: string,
  ) {
    super(message);
  }
}
// Missing or out-of-scope entities are "unavailable" (404) so a stale link never
// looks like a revoked membership. Organization access failures stay forbidden.
function requireValue<T>(
  v: T | undefined,
  message = "This item is unavailable.",
  category: "forbidden" | "unavailable" = "unavailable",
): T {
  if (!v) throw new DomainError(category, message);
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
    "forbidden",
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
      slug: s.organization.slug,
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
    "forbidden",
  );
  const products = (
    await db
      .select()
      .from(s.product)
      .where(eq(s.product.organizationId, organizationId))
      .orderBy(asc(s.product.createdAt))
  ).map((row) => serialize("product", row));
  const members = await db
    .select({ id: s.user.id, name: s.user.name, email: s.user.email })
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

type ItemRow = typeof s.workItem.$inferSelect;
type RevisionRow = typeof s.specificationRevision.$inferSelect;
type ReviewRow = typeof s.review.$inferSelect;
type AssignmentRow = typeof s.reviewAssignment.$inferSelect;
type ApprovalRow = typeof s.approval.$inferSelect;
type ThreadRow = typeof s.thread.$inferSelect;
type SuggestionRow = typeof s.suggestion.$inferSelect;

// Everything a list, inbox or readiness evaluation needs about a set of items.
async function loadItemContext(
  tx: Tx,
  organizationId: string,
  items: ItemRow[],
) {
  const ids = items.map((i) => i.id);
  if (ids.length === 0)
    return {
      revisions: new Map<string, RevisionRow[]>(),
      threads: [] as ThreadRow[],
      suggestions: [] as SuggestionRow[],
      reviews: [] as ReviewRow[],
      assignments: [] as AssignmentRow[],
      approvals: [] as ApprovalRow[],
    };
  const where = (t: { organizationId: AnyPgColumn; workItemId: AnyPgColumn }) =>
    and(eq(t.organizationId, organizationId), inArray(t.workItemId, ids));
  const revisionRows = await tx
    .select({
      id: s.specificationRevision.id,
      organizationId: s.specificationRevision.organizationId,
      workItemId: s.specificationRevision.workItemId,
      number: s.specificationRevision.number,
      title: s.specificationRevision.title,
      content: s.specificationRevision.content,
      changeSummary: s.specificationRevision.changeSummary,
      authorId: s.specificationRevision.authorId,
      createdAt: s.specificationRevision.createdAt,
    })
    .from(s.specificationRevision)
    .where(where(s.specificationRevision))
    .orderBy(desc(s.specificationRevision.number));
  const revisions = new Map<string, RevisionRow[]>();
  for (const r of revisionRows) {
    const list = revisions.get(r.workItemId) ?? [];
    list.push(r);
    revisions.set(r.workItemId, list);
  }
  const threads = await tx.select().from(s.thread).where(where(s.thread));
  const suggestions = await tx
    .select()
    .from(s.suggestion)
    .where(where(s.suggestion));
  const reviews = await tx.select().from(s.review).where(where(s.review));
  const reviewIds = reviews.map((r) => r.id);
  const assignments = reviewIds.length
    ? await tx
        .select()
        .from(s.reviewAssignment)
        .where(
          and(
            eq(s.reviewAssignment.organizationId, organizationId),
            inArray(s.reviewAssignment.reviewId, reviewIds),
          ),
        )
    : [];
  const approvals = await tx.select().from(s.approval).where(where(s.approval));
  return { revisions, threads, suggestions, reviews, assignments, approvals };
}
type ItemContext = Awaited<ReturnType<typeof loadItemContext>>;

function summarize(
  item: ItemRow,
  all: ItemRow[],
  ctx: ItemContext,
): EntityOf<"workItem"> {
  const current = ctx.revisions.get(item.id)?.[0];
  const threads = ctx.threads.filter((t) => t.workItemId === item.id);
  const reviews = ctx.reviews.filter(
    (r) =>
      r.workItemId === item.id &&
      r.status !== "cancelled" &&
      r.revisionId === current?.id,
  );
  const children = all.filter(
    (c) => c.parentId === item.id && !c.archivedAt && c.status !== "cancelled",
  );
  const checks = readiness(item, all, ctx);
  return entitySchema.parse({
    type: "workItem",
    id: item.id,
    organizationId: item.organizationId,
    productId: item.productId,
    parentId: item.parentId,
    kind: item.kind,
    number: item.number,
    title: item.title,
    status: item.status,
    priority: item.priority,
    assigneeId: item.assigneeId,
    createdById: item.createdById,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    archivedAt: item.archivedAt?.toISOString() ?? null,
    revisionId: current?.id ?? "",
    revisionNumber: current?.number ?? 0,
    openThreads: threads.filter((t) => t.status === "open").length,
    blockingThreads: threads.filter((t) => t.status === "open" && t.blocking)
      .length,
    pendingSuggestions: ctx.suggestions.filter(
      (x) => x.workItemId === item.id && x.status === "pending",
    ).length,
    reviews: reviews.map((r) => ({
      id: r.id,
      responsibility: r.responsibility,
      status: r.status,
      required: r.required,
      assigneeIds: ctx.assignments
        .filter((a) => a.reviewId === r.id && !a.withdrawnAt)
        .map((a) => a.userId ?? a.groupId!)
        .filter(Boolean),
      approved: ctx.approvals.some(
        (a) => a.reviewId === r.id && a.status === "granted",
      ),
    })),
    readinessPassed: checks.filter((c) => c.passed).length,
    readinessTotal: checks.length,
    childCount: children.length,
    childReadyCount: children.filter((c) =>
      ["ready", "in_progress", "done"].includes(c.status),
    ).length,
  }) as EntityOf<"workItem">;
}

// Readiness is evidence. Each check explains itself so the UI never has to
// reduce readiness to a percentage without a reason.
function readiness(
  item: ItemRow,
  all: ItemRow[],
  ctx: ItemContext,
): ReadinessCheck[] {
  const current = ctx.revisions.get(item.id)?.[0];
  const content = current?.content ?? "";
  const threads = ctx.threads.filter((t) => t.workItemId === item.id);
  const reviews = ctx.reviews.filter(
    (r) => r.workItemId === item.id && r.status !== "cancelled",
  );
  const responsibilities = [
    ...new Set(reviews.filter((r) => r.required).map((r) => r.responsibility)),
  ];
  const currentRequired = reviews.filter(
    (r) => r.required && r.revisionId === current?.id,
  );
  const approvedResponsibilities = responsibilities.filter((responsibility) => {
    const candidates = currentRequired.filter(
      (r) => r.responsibility === responsibility,
    );
    return (
      candidates.length > 0 &&
      candidates.every(
        (r) =>
          r.status === "completed" &&
          ctx.approvals.some(
            (a) =>
              a.reviewId === r.id &&
              a.status === "granted" &&
              a.revisionId === current?.id,
          ),
      )
    );
  });
  const missing = responsibilities.filter(
    (r) => !approvedResponsibilities.includes(r),
  );
  const blocking = threads.filter((t) => t.status === "open" && t.blocking);
  const children = all.filter(
    (c) => c.parentId === item.id && !c.archivedAt && c.status !== "cancelled",
  );
  const childrenNotReady = children.filter(
    (c) => !["ready", "in_progress", "done"].includes(c.status),
  );
  const checks: ReadinessCheck[] = [
    {
      key: "specification",
      label: "Specification written",
      passed: content.trim().length > 0,
      detail: content.trim() ? undefined : "The description is empty.",
    },
  ];
  if (item.kind !== "epic")
    checks.push({
      key: "acceptance_criteria",
      label: "Acceptance criteria defined",
      passed: hasAcceptanceCriteria(content),
      detail: hasAcceptanceCriteria(content)
        ? undefined
        : "Add at least one criterion under “Acceptance criteria”.",
    });
  checks.push(
    {
      key: "no_blocking_threads",
      label: "No open blocking discussions",
      passed: blocking.length === 0,
      detail: blocking.length
        ? `${blocking.length} blocking ${blocking.length === 1 ? "discussion" : "discussions"} open.`
        : undefined,
    },
    {
      key: "reviews_requested",
      label: "Required reviews requested",
      passed: responsibilities.length > 0,
      detail: responsibilities.length
        ? undefined
        : "Request at least one required review.",
    },
    {
      key: "reviews_approved",
      label: "Current revision approved by every required review",
      passed: responsibilities.length > 0 && missing.length === 0,
      detail:
        responsibilities.length === 0
          ? "No required review exists yet."
          : missing.length
            ? `Waiting on ${missing.join(", ")} for revision ${current?.number ?? ""}.`
            : undefined,
    },
  );
  if (item.kind === "epic" && children.length > 0)
    checks.push({
      key: "stories_ready",
      label: "Every story is ready",
      passed: childrenNotReady.length === 0,
      detail: childrenNotReady.length
        ? `${childrenNotReady.length} of ${children.length} stories are not ready.`
        : undefined,
    });
  // Keep the projection JSON-stable: bootstrap and delta must compare equal.
  return checks.map((c) =>
    c.detail === undefined
      ? { key: c.key, label: c.label, passed: c.passed }
      : c,
  );
}

export async function snapshot(tx: Tx, scope: Scope): Promise<Entity[]> {
  const { organizationId, productId, workItemId } = scope;
  const products = await tx
    .select()
    .from(s.product)
    .where(
      and(
        eq(s.product.organizationId, organizationId),
        productId ? eq(s.product.id, productId) : undefined,
      ),
    );
  if (productId) requireValue(products[0]);
  const items = await tx
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        productId ? eq(s.workItem.productId, productId) : undefined,
      ),
    )
    .orderBy(asc(s.workItem.createdAt));
  const ctx = await loadItemContext(tx, organizationId, items);
  const entities: Entity[] = [
    ...products.map((p) => serialize("product", p)),
    ...items.map((item) => summarize(item, items, ctx)),
  ];
  if (!workItemId) return entities;
  const item = requireValue(items.find((p) => p.id === workItemId));
  const revisions = ctx.revisions.get(workItemId) ?? [];
  const threads = ctx.threads.filter((t) => t.workItemId === workItemId);
  const reviews = ctx.reviews.filter((r) => r.workItemId === workItemId);
  const reviewIds = new Set(reviews.map((r) => r.id));
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
        eq(s.activity.workItemId, workItemId),
      ),
    )
    .orderBy(asc(s.activity.createdAt));
  for (const [type, rows] of [
    ["revision", revisions],
    ["review", reviews],
    ["thread", threads],
    ["approval", ctx.approvals.filter((a) => a.workItemId === workItemId)],
    ["suggestion", ctx.suggestions.filter((x) => x.workItemId === workItemId)],
    ["assignment", ctx.assignments.filter((a) => reviewIds.has(a.reviewId))],
    ["message", messages],
    ["activity", activity],
  ] as const)
    entities.push(...rows.map((row) => serialize(type, row)));
  entities.push({
    type: "readiness",
    id: workItemId,
    organizationId,
    workItemId,
    checks: readiness(item, items, ctx),
  });
  return entities;
}

const preReadyStatuses: WorkItemStatus[] = [
  "backlog",
  "draft",
  "refinement",
  "in_review",
];

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
        if (scope.workItemId && scope.productId)
          requireValue(
            (
              await tx
                .select({ id: s.workItem.id })
                .from(s.workItem)
                .where(
                  and(
                    eq(s.workItem.organizationId, scope.organizationId),
                    eq(s.workItem.productId, scope.productId),
                    eq(s.workItem.id, scope.workItemId),
                  ),
                )
            )[0],
          );
        if (cursor === undefined)
          return {
            protocol: PROTOCOL,
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
              scope.workItemId
                ? or(
                    isNull(s.syncChange.workItemId),
                    eq(s.syncChange.workItemId, scope.workItemId),
                  )
                : isNull(s.syncChange.workItemId),
            ),
          )
          .orderBy(asc(s.syncChange.cursor))
          .limit(pageSize + 1);
        const hasMore = rows.length > pageSize;
        const page = rows.slice(0, pageSize);
        return {
          protocol: PROTOCOL,
          changes: page.map((r) => r.change),
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
            protocol: PROTOCOL,
            mutationId: mutation.id,
            cursor: previous.cursor.toString(),
          };
        }
        const canManageProduct = membership.role
          .split(",")
          .some((r) => r === "owner" || r === "admin");
        let productId: string;
        let workItemId: string | undefined;
        let item: ItemRow | undefined;
        if ("productId" in c) productId = c.productId;
        else {
          workItemId = c.workItemId;
          item = requireValue(
            (
              await tx
                .select()
                .from(s.workItem)
                .where(
                  and(
                    eq(s.workItem.organizationId, organizationId),
                    eq(s.workItem.id, workItemId),
                  ),
                )
            )[0],
          );
          if (item.archivedAt && c.type !== "archiveWorkItem")
            throw new DomainError(
              "conflict",
              "Restore this item before changing it.",
            );
          productId = item.productId;
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
        if (c.type === "createWorkItem") workItemId = c.workItemId;
        const scope = { organizationId, productId, workItemId };
        const before =
          c.type === "createProduct"
            ? []
            : await snapshot(tx, {
                ...scope,
                workItemId:
                  c.type === "createWorkItem" ? undefined : workItemId,
              });
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
          workItemId: workItemId!,
          revisionId: latest?.id ?? "",
        };
        const activities: {
          action: string;
          detail?: Record<string, unknown>;
        }[] = [];
        const log = (action: string, detail?: Record<string, unknown>) =>
          activities.push({ action, detail });
        const revision = async (
          title: string,
          content: string,
          summary: string | undefined,
          previous = latest,
        ) => {
          if (previous?.title === title && previous.content === content)
            return previous.id;
          const revisionId = crypto.randomUUID();
          const number = (previous?.number ?? 0) + 1;
          await tx.insert(s.specificationRevision).values({
            id: revisionId,
            organizationId,
            workItemId: workItemId!,
            number,
            title,
            content,
            changeSummary: summary?.trim() ? summary.trim() : null,
            authorId: userId,
          });
          await tx
            .update(s.workItem)
            .set({ title })
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.id, workItemId!),
              ),
            );
          if (previous) {
            await tx
              .update(s.approval)
              .set({
                status: "stale",
                endedAt: now,
                endedById: userId,
                endReason: `Specification revised (revision ${number})`,
              })
              .where(
                and(
                  eq(s.approval.organizationId, organizationId),
                  eq(s.approval.workItemId, workItemId!),
                  eq(s.approval.status, "granted"),
                ),
              );
            // Responsibilities persist across revisions: every active review on
            // the previous revision is re-requested on the new one with the same
            // assignments. Old review rows stay as history of what was decided.
            const carried = before.filter(
              (e): e is EntityOf<"review"> =>
                e.type === "review" &&
                e.revisionId === previous.id &&
                e.status !== "cancelled",
            );
            for (const old of carried) {
              const reviewId = crypto.randomUUID();
              await tx.insert(s.review).values({
                id: reviewId,
                organizationId,
                workItemId: workItemId!,
                revisionId,
                responsibility: old.responsibility,
                required: old.required,
                requestedById: userId,
              });
              const targets = before.filter(
                (e): e is EntityOf<"assignment"> =>
                  e.type === "assignment" &&
                  e.reviewId === old.id &&
                  !e.withdrawnAt,
              );
              if (targets.length)
                await tx.insert(s.reviewAssignment).values(
                  targets.map((t) => ({
                    organizationId,
                    reviewId,
                    assignedById: userId,
                    userId: t.userId,
                    groupId: t.groupId,
                  })),
                );
            }
            log("revised", {
              number,
              summary: summary?.trim() ? summary.trim() : null,
            });
          }
          return revisionId;
        };
        const validateParent = async (
          parentId: string | null,
          kind: string,
        ) => {
          if (!parentId) return;
          if (kind === "epic")
            throw new DomainError("validation", "Epics cannot have a parent.");
          const parent = requireValue(
            (
              await tx
                .select()
                .from(s.workItem)
                .where(
                  and(
                    eq(s.workItem.organizationId, organizationId),
                    eq(s.workItem.productId, productId),
                    eq(s.workItem.id, parentId),
                    isNull(s.workItem.archivedAt),
                  ),
                )
            )[0],
            "The parent item is unavailable in this product.",
          );
          if (parent.id === workItemId)
            throw new DomainError(
              "validation",
              "An item cannot be its own parent.",
            );
          if (kind === "story" && parent.kind !== "epic")
            throw new DomainError("validation", "Stories belong to an Epic.");
          if (kind === "task" && parent.kind === "task")
            throw new DomainError(
              "validation",
              "Tasks belong to an Epic or a Story.",
            );
        };
        const setStatus = async (
          status: WorkItemStatus,
          from: WorkItemStatus,
          automatic = false,
        ) => {
          if (status === from) return;
          await tx
            .update(s.workItem)
            .set({ status })
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.id, workItemId!),
              ),
            );
          log("status_changed", { from, to: status, automatic });
        };
        switch (c.type) {
          case "createProduct": {
            if (!canManageProduct)
              throw new DomainError(
                "forbidden",
                "An organization administrator must create products.",
              );
            const taken = (
              await tx
                .select({ id: s.product.id })
                .from(s.product)
                .where(
                  and(
                    eq(s.product.organizationId, organizationId),
                    eq(s.product.key, c.key),
                  ),
                )
            )[0];
            if (taken)
              throw new DomainError(
                "validation",
                `The key ${c.key} is already used by another product.`,
              );
            await tx.insert(s.product).values({
              id: productId,
              organizationId,
              name: c.name,
              slug: c.key.toLowerCase(),
              key: c.key,
              createdById: userId,
            });
            break;
          }
          case "updateProduct":
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
          case "createWorkItem": {
            await validateParent(c.parentId, c.kind);
            const [{ next }] = (await tx
              .select({
                next: sql<number>`coalesce(max(${s.workItem.number}), 0) + 1`,
              })
              .from(s.workItem)
              .where(
                and(
                  eq(s.workItem.organizationId, organizationId),
                  eq(s.workItem.productId, productId),
                ),
              )) as [{ next: number }];
            await tx.insert(s.workItem).values({
              id: workItemId!,
              organizationId,
              productId,
              parentId: c.parentId,
              kind: c.kind,
              number: Number(next),
              title: c.title,
              status: "draft",
              createdById: userId,
            });
            await revision(c.title, c.description ?? "", "Created", undefined);
            log("created", { kind: c.kind, number: Number(next) });
            break;
          }
          case "updateWorkItem": {
            const patch: Partial<ItemRow> = {};
            if (c.status !== undefined && c.status !== item!.status) {
              if (c.status === "ready") {
                const checks = before.find(
                  (e) => e.type === "readiness" && e.id === workItemId,
                );
                const failing =
                  checks?.type === "readiness"
                    ? checks.checks.filter((k) => !k.passed)
                    : [];
                if (failing.length)
                  throw new DomainError(
                    "validation",
                    `Not ready yet: ${failing.map((k) => k.label.toLowerCase()).join("; ")}.`,
                  );
              }
              patch.status = c.status;
              log("status_changed", {
                from: item!.status,
                to: c.status,
                automatic: false,
              });
            }
            if (c.priority !== undefined && c.priority !== item!.priority) {
              patch.priority = c.priority;
              log("priority_changed", { from: item!.priority, to: c.priority });
            }
            if (
              c.assigneeId !== undefined &&
              c.assigneeId !== item!.assigneeId
            ) {
              if (c.assigneeId) {
                const roster = await directory(tx, userId, organizationId);
                requireValue(
                  roster.members.find((m) => m.id === c.assigneeId),
                  "Assignee is outside this organization.",
                );
              }
              patch.assigneeId = c.assigneeId;
              log("assignee_changed", {
                from: item!.assigneeId,
                to: c.assigneeId,
              });
            }
            if (c.parentId !== undefined && c.parentId !== item!.parentId) {
              await validateParent(c.parentId, item!.kind);
              patch.parentId = c.parentId;
              log("parent_changed", { from: item!.parentId, to: c.parentId });
            }
            if (Object.keys(patch).length)
              await tx
                .update(s.workItem)
                .set(patch)
                .where(
                  and(
                    eq(s.workItem.organizationId, organizationId),
                    eq(s.workItem.id, workItemId!),
                  ),
                );
            break;
          }
          case "archiveWorkItem":
            await tx
              .update(s.workItem)
              .set({ archivedAt: c.archived ? now : null })
              .where(
                and(
                  eq(s.workItem.organizationId, organizationId),
                  eq(s.workItem.id, workItemId!),
                ),
              );
            log(c.archived ? "archived" : "restored");
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
              anchor: {
                version: 1,
                kind: "document",
                section: c.section,
                ...(c.quote ? { quote: c.quote } : {}),
              },
            });
            await tx.insert(s.threadMessage).values({
              id: c.messageId,
              organizationId,
              threadId: c.threadId,
              authorId: userId,
              body: c.body,
            });
            log("thread_opened", {
              threadId: c.threadId,
              blocking: c.blocking,
            });
            break;
          case "replyToThread":
          case "setThreadState": {
            const thread = requireValue(
              before.find((e) => e.type === "thread" && e.id === c.threadId),
            );
            if (thread.type !== "thread") break;
            if (c.type === "replyToThread")
              await tx.insert(s.threadMessage).values({
                id: c.messageId,
                organizationId,
                threadId: c.threadId,
                authorId: userId,
                body: c.body,
              });
            else {
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
              const wasResolved = thread.status === "resolved";
              if (wasResolved !== c.resolved)
                log(c.resolved ? "thread_resolved" : "thread_reopened", {
                  threadId: c.threadId,
                });
              if (thread.blocking !== c.blocking)
                log("thread_blocking_changed", {
                  threadId: c.threadId,
                  blocking: c.blocking,
                });
            }
            break;
          }
          case "createSuggestion":
            if (c.replacement === latest?.content)
              throw new DomainError(
                "validation",
                "This suggestion makes no content change.",
              );
            await tx.insert(s.suggestion).values({
              id: c.suggestionId,
              ...context,
              authorId: userId,
              replacement: c.replacement,
              rationale: c.rationale,
            });
            log("suggestion_created", { suggestionId: c.suggestionId });
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
                  suggestion.rationale ?? "Accepted suggestion",
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
            log(c.accept ? "suggestion_accepted" : "suggestion_rejected", {
              suggestionId: c.suggestionId,
              authorId: suggestion.authorId,
            });
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
            await tx.insert(s.review).values({
              id: c.reviewId,
              ...context,
              responsibility: c.responsibility,
              required: c.required,
              requestedById: userId,
            });
            await tx.insert(s.reviewAssignment).values({
              organizationId,
              reviewId: c.reviewId,
              assignedById: userId,
              userId: c.target.type === "user" ? c.target.id : null,
              groupId: c.target.type === "group" ? c.target.id : null,
            });
            log("review_requested", {
              reviewId: c.reviewId,
              responsibility: c.responsibility,
              targetType: c.target.type,
              targetId: c.target.id,
              required: c.required,
            });
            if (
              (["backlog", "draft", "refinement"] as string[]).includes(
                item!.status,
              )
            )
              await setStatus("in_review", item!.status, true);
            break;
          }
          case "cancelReview": {
            const review = requireValue(
              before.find((e) => e.type === "review" && e.id === c.reviewId),
            );
            if (review.type !== "review" || review.status === "cancelled")
              throw new DomainError("conflict", "This review is not active.");
            await tx
              .update(s.review)
              .set({ status: "cancelled" })
              .where(
                and(
                  eq(s.review.organizationId, organizationId),
                  eq(s.review.id, c.reviewId),
                ),
              );
            log("review_cancelled", {
              reviewId: c.reviewId,
              responsibility: review.responsibility,
            });
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
            if (review.status === "cancelled")
              throw new DomainError("conflict", "This review was cancelled.");
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
            log(
              c.decision === "approve"
                ? "approved"
                : c.decision === "revoke"
                  ? "approval_revoked"
                  : "changes_requested",
              {
                reviewId: c.reviewId,
                responsibility: review.responsibility,
                revision: latest.number,
              },
            );
            break;
          }
        }
        if (workItemId && c.type !== "createWorkItem")
          await tx
            .update(s.workItem)
            .set({ updatedAt: now })
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.id, workItemId),
              ),
            );
        let after = await snapshot(tx, scope);
        // Readiness drives `ready` automatically in both directions while the
        // item is still owned by refinement. Later statuses are never touched.
        const readinessState = after.find((e) => e.type === "readiness");
        const itemState = after.find(
          (e) => e.type === "workItem" && e.id === workItemId,
        );
        if (
          readinessState?.type === "readiness" &&
          itemState?.type === "workItem" &&
          !itemState.archivedAt
        ) {
          const ready = readinessState.checks.every((check) => check.passed);
          const next: WorkItemStatus | undefined =
            ready && preReadyStatuses.includes(itemState.status)
              ? "ready"
              : !ready && itemState.status === "ready"
                ? "in_review"
                : undefined;
          if (next) {
            await setStatus(next, itemState.status, true);
            after = await snapshot(tx, scope);
          }
        }
        if (workItemId && activities.length) {
          await tx.insert(s.activity).values(
            activities.map((a, index) => ({
              id: crypto.randomUUID(),
              organizationId,
              productId,
              workItemId: workItemId,
              actorId: userId,
              action: a.action,
              detail: a.detail ?? null,
              createdAt: new Date(now.getTime() + index),
            })),
          );
          after = await snapshot(tx, scope);
        }
        // A child's change can alter its Epic's readiness (stories_ready), which
        // lives in the Epic's own scope. Emit that projection explicitly.
        const parentIds = new Set(
          [
            item?.parentId,
            c.type === "createWorkItem" ? c.parentId : undefined,
            c.type === "updateWorkItem" ? c.parentId : undefined,
          ].filter((v): v is string => typeof v === "string"),
        );
        const parentReadiness: { workItemId: string; entity: Entity }[] = [];
        if (parentIds.size) {
          const rows = await tx
            .select()
            .from(s.workItem)
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.productId, productId),
              ),
            );
          const ctx = await loadItemContext(tx, organizationId, rows);
          for (const parentId of parentIds) {
            const parent = rows.find((r) => r.id === parentId);
            if (parent)
              parentReadiness.push({
                workItemId: parentId,
                entity: {
                  type: "readiness",
                  id: parentId,
                  organizationId,
                  workItemId: parentId,
                  checks: readiness(parent, rows, ctx),
                },
              });
          }
        }
        const old = new Map(
          before.map((e) => [entityKey(e), JSON.stringify(e)]),
        );
        let cursor = await clock(tx, organizationId);
        for (const { workItemId: parentId, entity } of parentReadiness) {
          cursor++;
          await tx.insert(s.syncChange).values({
            organizationId,
            cursor,
            productId,
            workItemId: parentId,
            change: { operation: "upsert", cursor: cursor.toString(), entity },
          });
        }
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
            workItemId:
              entity.type === "workItem" || entity.type === "product"
                ? null
                : workItemId,
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
          protocol: PROTOCOL,
          mutationId: mutation.id,
          cursor: cursor.toString(),
        };
      });
    },
  };
}
