import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "../../db/schema";
import {
  PROTOCOL,
  applicationRoleOf,
  canReviewSuggestions,
  capabilitiesOf,
  entityKey,
  entitySchema,
  isRoleCommand,
  type Capabilities,
  type Directory,
  type Entity,
  type EntityOf,
  type Mutation,
  type ReadinessCheck,
  type Role,
  type RoleCommand,
  type Scope,
  type Change,
  type Iteration,
  type IterationReport,
  type RefinementState,
  type StatusCategory,
  type Team,
  type WorkItemType,
  isTeamCommand,
} from "../shared/protocol";
import { rankBetween } from "../shared/rank";
import { hasAcceptanceCriteria } from "../shared/specification";
import { roleColumns } from "./roles";
import { notifyItemActivity } from "../../notifications/server";

export type Database = PostgresJsDatabase<typeof s>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
import { DomainError } from "./errors";
import {
  advanceTeamSchedule,
  applyTeamCommand,
  automaticTeams,
  iterationReportRows,
} from "./delivery";
export { DomainError };
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
// The suggestion row keeps legacy columns; the wire shape names the merge result.
function serializeSuggestion(row: SuggestionRow): Entity {
  const { anchor, threadId, acceptedRevisionId, ...rest } = row;
  void anchor;
  void threadId;
  return serialize("suggestion", {
    ...rest,
    mergedRevisionId: acceptedRevisionId,
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
export async function lock(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
  );
}
export async function clock(tx: Tx, organizationId: string) {
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
    return {
      organizations,
      projects: [],
      members: [],
      roles: [],
      teams: [],
      types: [],
      iterations: [],
      delivery: { connections: [], targets: [] },
    };
  requireValue(
    organizations.find((o) => o.id === organizationId),
    "Organization access has been removed.",
    "forbidden",
  );
  const projects = (
    await db
      .select()
      .from(s.project)
      .where(eq(s.project.organizationId, organizationId))
      .orderBy(asc(s.project.createdAt))
  ).map((row) => serialize("project", row)) as Directory["projects"];
  const members = (
    await db
      .select({
        id: s.user.id,
        name: s.user.name,
        email: s.user.email,
        handle: s.user.handle,
        memberId: s.member.id,
        rawRole: s.member.role,
      })
      .from(s.member)
      .innerJoin(s.user, eq(s.member.userId, s.user.id))
      .where(eq(s.member.organizationId, organizationId))
      .orderBy(asc(s.user.name), asc(s.user.email))
  ).map(({ rawRole, ...m }) => ({
    ...m,
    role: applicationRoleOf(rawRole),
    owner: rawRole.split(",").includes("owner"),
  }));
  const memberIds = new Set(members.map((m) => m.id));
  const memberships = await db
    .select()
    .from(s.organizationRoleMember)
    .where(eq(s.organizationRoleMember.organizationId, organizationId));
  // Archived roles stay in the directory so historical assignments keep their
  // name and an administrator can restore them; they grant nothing.
  const roles: Role[] = (
    await db
      .select()
      .from(s.organizationRole)
      .where(eq(s.organizationRole.organizationId, organizationId))
      .orderBy(asc(s.organizationRole.createdAt))
  ).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    capabilities: {
      editSpecifications: r.canEditSpecifications,
      changeProperties: r.canChangeProperties,
      requestReviews: r.canRequestReviews,
      review: r.canReview,
      publishDelivery: r.canPublishDelivery,
    },
    // Role membership never outlives organization membership.
    userIds: memberships
      .filter((m) => m.roleId === r.id && memberIds.has(m.userId))
      .map((m) => m.userId)
      .sort(),
    archivedAt: r.archivedAt?.toISOString() ?? null,
  }));
  const { teams, types, iterations } = await deliveryDirectory(
    db,
    organizationId,
    memberIds,
  );
  const delivery = await deliveryConfiguration(db, organizationId);
  return {
    organizations,
    projects,
    members,
    roles,
    teams,
    types,
    iterations,
    delivery,
  };
}

// Connections and targets, never credentials.
async function deliveryConfiguration(
  db: Database | Tx,
  organizationId: string,
): Promise<Directory["delivery"]> {
  const connections = await db
    .select({
      id: s.deliveryConnection.id,
      provider: s.deliveryConnection.provider,
      name: s.deliveryConnection.name,
      baseUrl: s.deliveryConnection.baseUrl,
      accountLabel: s.deliveryConnection.accountLabel,
      status: s.deliveryConnection.status,
      lastError: s.deliveryConnection.lastError,
    })
    .from(s.deliveryConnection)
    .where(
      and(
        eq(s.deliveryConnection.organizationId, organizationId),
        isNull(s.deliveryConnection.archivedAt),
      ),
    )
    .orderBy(asc(s.deliveryConnection.createdAt));
  const active = new Set(connections.map((c) => c.id));
  const targets = (
    await db
      .select({
        id: s.deliveryTarget.id,
        connectionId: s.deliveryTarget.connectionId,
        teamId: s.deliveryTarget.teamId,
        externalProjectId: s.deliveryTarget.externalProjectId,
        externalProjectKey: s.deliveryTarget.externalProjectKey,
        typeMapping: s.deliveryTarget.typeMapping,
      })
      .from(s.deliveryTarget)
      .where(eq(s.deliveryTarget.organizationId, organizationId))
      .orderBy(asc(s.deliveryTarget.createdAt))
  ).filter((t) => active.has(t.connectionId));
  return { connections, targets };
}

// Delivery configuration is small and read on every sync, like roles, so its
// commands need no entity changes: the refreshed directory carries them.
async function deliveryDirectory(
  db: Database | Tx,
  organizationId: string,
  memberIds: Set<string>,
) {
  const teamRows = await db
    .select()
    .from(s.team)
    .where(eq(s.team.organizationId, organizationId))
    .orderBy(asc(s.team.createdAt), asc(s.team.name));
  const teamMembers = await db
    .select()
    .from(s.teamMember)
    .where(eq(s.teamMember.organizationId, organizationId));
  const teamTypes = await db
    .select()
    .from(s.teamWorkItemType)
    .where(eq(s.teamWorkItemType.organizationId, organizationId));
  const statuses = await db
    .select()
    .from(s.workflowStatus)
    .where(eq(s.workflowStatus.organizationId, organizationId))
    .orderBy(asc(s.workflowStatus.position), asc(s.workflowStatus.createdAt));
  const typeRows = await db
    .select()
    .from(s.workItemType)
    .where(eq(s.workItemType.organizationId, organizationId))
    .orderBy(asc(s.workItemType.position), asc(s.workItemType.createdAt));
  // Completed iterations are bounded to the most recent per team; reports for
  // older ones are fetched on demand.
  const iterationRows = await db
    .select()
    .from(s.iteration)
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        or(
          sql`${s.iteration.state} <> 'completed'`,
          sql`${s.iteration.number} > (select coalesce(max(i2.number), 0) - 12 from ${s.iteration} i2 where i2.organization_id = ${s.iteration.organizationId} and i2.team_id = ${s.iteration.teamId} and i2.state = 'completed')`,
        ),
      ),
    )
    .orderBy(asc(s.iteration.teamId), asc(s.iteration.number));
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    teams: teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      deliveryMode: t.deliveryMode,
      readinessPolicy: t.readinessPolicy,
      estimateScale: t.estimateScale,
      iterationMode: t.iterationMode,
      iterationWeeks: t.iterationWeeks,
      iterationStartDay: t.iterationStartDay,
      upcomingIterations: t.upcomingIterations,
      memberIds: teamMembers
        .filter((m) => m.teamId === t.id && memberIds.has(m.userId))
        .map((m) => m.userId)
        .sort(),
      typeIds: teamTypes
        .filter((x) => x.teamId === t.id)
        .map((x) => x.typeId)
        .sort(),
      statuses: statuses
        .filter((x) => x.teamId === t.id)
        .map((x) => ({
          id: x.id,
          name: x.name,
          color: x.color as Team["statuses"][number]["color"],
          category: x.category,
          position: x.position,
          archivedAt: iso(x.archivedAt),
        })),
      archivedAt: iso(t.archivedAt),
    })) satisfies Team[],
    types: typeRows.map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon as WorkItemType["icon"],
      color: t.color as WorkItemType["color"],
      level: t.level,
      hasSpecification: t.hasSpecification,
      position: t.position,
      archivedAt: iso(t.archivedAt),
    })) satisfies WorkItemType[],
    iterations: iterationRows.map((i) => ({
      id: i.id,
      teamId: i.teamId,
      number: i.number,
      name: i.name,
      goal: i.goal,
      startsAt: i.startsAt.toISOString(),
      endsAt: i.endsAt.toISOString(),
      state: i.state,
      startedAt: iso(i.startedAt),
      completedAt: iso(i.completedAt),
    })) satisfies Iteration[],
  };
}
export function isAdmin(membership: { role: string }) {
  return applicationRoleOf(membership.role) === "admin";
}
function require(
  allowed: boolean,
  message: string,
  category: "forbidden" | "validation" = "forbidden",
) {
  if (!allowed) throw new DomainError(category, message);
}
// Capability failures name the missing capability so an administrator knows
// which role to adjust, rather than a generic "not allowed".
const capabilityMessages: Record<keyof Capabilities, string> = {
  editSpecifications:
    "Your roles cannot edit specifications directly. Propose the change as a suggestion instead.",
  changeProperties:
    "Your roles cannot change item properties such as status, priority, owner, labels or milestones.",
  requestReviews: "Your roles cannot request or cancel reviews.",
  review: "Your roles cannot be asked to review.",
  publishDelivery:
    "Your roles cannot export work to external delivery systems. Ask an administrator to grant “Export to delivery tools”.",
};
function requireCapability(
  capabilities: Capabilities,
  key: keyof Capabilities,
) {
  require(capabilities[key], capabilityMessages[key]);
}
export async function searchMembers(
  db: Database | Tx,
  userId: string,
  organizationId: string,
  query = "",
  offset = 0,
  limit = 20,
) {
  const organizations = await db
    .select({ id: s.organization.id })
    .from(s.organization)
    .innerJoin(
      s.member,
      and(
        eq(s.member.organizationId, s.organization.id),
        eq(s.member.userId, userId),
      ),
    )
    .where(eq(s.organization.id, organizationId));
  requireValue(
    organizations[0],
    "Organization access has been removed.",
    "forbidden",
  );
  const raw = query.trim();
  // "@alex" searches handles only; plain text also matches name and email.
  const handleOnly = raw.startsWith("@");
  const term = raw.replace(/^@+/, "").replace(/[%_\\]/g, (c) => `\\${c}`);
  const rows = await db
    .select({
      id: s.user.id,
      name: s.user.name,
      email: s.user.email,
      handle: s.user.handle,
    })
    .from(s.member)
    .innerJoin(s.user, eq(s.member.userId, s.user.id))
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        term
          ? handleOnly
            ? ilike(s.user.handle, `${term}%`)
            : or(
                ilike(s.user.handle, `${term}%`),
                ilike(s.user.name, `%${term}%`),
                ilike(s.user.email, `%${term}%`),
              )
          : undefined,
      ),
    )
    .orderBy(
      sql`case when ${s.user.id} = ${userId} then 0 else 1 end`,
      asc(s.user.name),
      asc(s.user.email),
    )
    .limit(limit + 1)
    .offset(offset);
  return {
    members: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}
export async function searchEpics(
  db: Database | Tx,
  userId: string,
  organizationId: string,
  projectId: string,
  query = "",
  offset = 0,
  limit = 20,
) {
  const membership = await db
    .select({ id: s.member.id })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, userId),
      ),
    );
  requireValue(
    membership[0],
    "Organization access has been removed.",
    "forbidden",
  );
  requireValue(
    (
      await db
        .select({ id: s.project.id })
        .from(s.project)
        .where(
          and(
            eq(s.project.organizationId, organizationId),
            eq(s.project.id, projectId),
            isNull(s.project.archivedAt),
          ),
        )
    )[0],
  );
  const term = query.trim().replace(/[%_]/g, "");
  const numberText = /(?:^|-)(\d+)$/.exec(term)?.[1];
  const candidateNumber = numberText ? Number(numberText) : undefined;
  const numberMatch =
    candidateNumber !== undefined &&
    Number.isSafeInteger(candidateNumber) &&
    candidateNumber > 0 &&
    candidateNumber <= 2_147_483_647
      ? candidateNumber
      : undefined;
  const rows = await db
    .select({
      id: s.workItem.id,
      projectId: s.workItem.projectId,
      number: s.workItem.number,
      title: s.workItem.title,
    })
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.projectId, projectId),
        inArray(
          s.workItem.typeId,
          db
            .select({ id: s.workItemType.id })
            .from(s.workItemType)
            .where(
              and(
                eq(s.workItemType.organizationId, organizationId),
                eq(s.workItemType.level, 2),
              ),
            ),
        ),
        isNull(s.workItem.archivedAt),
        term
          ? or(
              ilike(s.workItem.title, `%${term}%`),
              numberMatch === undefined
                ? undefined
                : eq(s.workItem.number, numberMatch),
            )
          : undefined,
      ),
    )
    .orderBy(asc(s.workItem.title), asc(s.workItem.number))
    .limit(limit + 1)
    .offset(offset);
  return {
    epics: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}

type ItemRow = typeof s.workItem.$inferSelect;
type RevisionRow = typeof s.specificationRevision.$inferSelect;
type ReviewRow = typeof s.review.$inferSelect;
type AssignmentRow = typeof s.reviewAssignment.$inferSelect;
type ApprovalRow = typeof s.approval.$inferSelect;
type ThreadRow = typeof s.thread.$inferSelect;
type SuggestionRow = typeof s.suggestion.$inferSelect;
type SuggestionReviewerRow = typeof s.suggestionReviewer.$inferSelect;
type SuggestionDecisionRow = typeof s.suggestionDecision.$inferSelect;

// Everything a list, inbox or readiness evaluation needs about a set of items.
async function loadItemContext(
  tx: Tx,
  organizationId: string,
  items: ItemRow[],
) {
  const ids = items.map((i) => i.id);
  const types = new Map(
    (
      await tx
        .select()
        .from(s.workItemType)
        .where(eq(s.workItemType.organizationId, organizationId))
    ).map((t) => [t.id, t]),
  );
  const categories = new Map(
    (
      await tx
        .select({
          id: s.workflowStatus.id,
          category: s.workflowStatus.category,
        })
        .from(s.workflowStatus)
        .where(eq(s.workflowStatus.organizationId, organizationId))
    ).map((x) => [x.id, x.category]),
  );
  if (ids.length === 0)
    return {
      types,
      categories,
      revisions: new Map<string, RevisionRow[]>(),
      threads: [] as ThreadRow[],
      suggestions: [] as SuggestionRow[],
      suggestionReviewers: [] as SuggestionReviewerRow[],
      suggestionDecisions: [] as SuggestionDecisionRow[],
      reviews: [] as ReviewRow[],
      assignments: [] as AssignmentRow[],
      approvals: [] as ApprovalRow[],
      labels: [] as (typeof s.workItemLabel.$inferSelect)[],
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
  const suggestionReviewers = await tx
    .select()
    .from(s.suggestionReviewer)
    .where(where(s.suggestionReviewer));
  const suggestionDecisions = await tx
    .select()
    .from(s.suggestionDecision)
    .where(where(s.suggestionDecision));
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
  const labels = await tx
    .select()
    .from(s.workItemLabel)
    .where(where(s.workItemLabel));
  return {
    types,
    categories,
    revisions,
    threads,
    suggestions,
    suggestionReviewers,
    suggestionDecisions,
    reviews,
    assignments,
    approvals,
    labels,
  };
}
type ItemContext = Awaited<ReturnType<typeof loadItemContext>>;
const closedCategories: StatusCategory[] = ["done", "canceled"];
function isSpecBacked(item: ItemRow, ctx: ItemContext) {
  return ctx.types.get(item.typeId)?.hasSpecification ?? false;
}
function isClosed(item: ItemRow, ctx: ItemContext) {
  const category = ctx.categories.get(item.statusId);
  return category !== undefined && closedCategories.includes(category);
}
function activeChildren(item: ItemRow, all: ItemRow[], ctx: ItemContext) {
  return all.filter(
    (c) =>
      c.parentId === item.id &&
      !c.archivedAt &&
      ctx.categories.get(c.statusId) !== "canceled",
  );
}

// Reviewers of open suggestions still waiting to approve the current version.
function pendingSuggestionReviewers(itemId: string, ctx: ItemContext) {
  const ids = new Set<string>();
  for (const x of ctx.suggestions)
    if (x.workItemId === itemId && x.status === "open")
      for (const r of ctx.suggestionReviewers)
        if (
          r.suggestionId === x.id &&
          !r.withdrawnAt &&
          !ctx.suggestionDecisions.some(
            (d) =>
              d.suggestionId === x.id &&
              d.reviewerId === r.userId &&
              d.version === x.version &&
              d.decision === "approved" &&
              !d.supersededAt,
          )
        )
          ids.add(r.userId);
  return [...ids].sort();
}

function summarize(
  item: ItemRow,
  all: ItemRow[],
  ctx: ItemContext,
): EntityOf<"workItem"> {
  const current = ctx.revisions.get(item.id)?.[0];
  // Discussions about a suggestion belong to that suggestion's review.
  const threads = ctx.threads.filter(
    (t) => t.workItemId === item.id && !t.suggestionId,
  );
  const reviews = ctx.reviews.filter(
    (r) =>
      r.workItemId === item.id &&
      r.status !== "cancelled" &&
      r.revisionId === current?.id,
  );
  const children = activeChildren(item, all, ctx);
  const checks = readiness(item, all, ctx);
  return entitySchema.parse({
    type: "workItem",
    id: item.id,
    organizationId: item.organizationId,
    projectId: item.projectId,
    teamId: item.teamId,
    typeId: item.typeId,
    parentId: item.parentId,
    number: item.number,
    title: item.title,
    statusId: item.statusId,
    refinementState: item.refinementState,
    priority: item.priority,
    assigneeId: item.assigneeId,
    milestoneId: item.milestoneId,
    iterationId: item.iterationId,
    estimate: item.estimate,
    labelIds: ctx.labels
      .filter((l) => l.workItemId === item.id)
      .map((l) => l.labelId)
      .sort(),
    position: item.position,
    rank: item.rank,
    sourceRevisionId: item.sourceRevisionId,
    createdById: item.createdById,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    archivedAt: item.archivedAt?.toISOString() ?? null,
    revisionId: current?.id ?? "",
    revisionNumber: current?.number ?? 0,
    openThreads: threads.filter((t) => t.status === "open").length,
    blockingThreads: threads.filter((t) => t.status === "open" && t.blocking)
      .length,
    openSuggestions: ctx.suggestions.filter(
      (x) => x.workItemId === item.id && x.status === "open",
    ).length,
    suggestionReviewerIds: pendingSuggestionReviewers(item.id, ctx),
    reviews: reviews.map((r) => ({
      id: r.id,
      responsibility: r.responsibility,
      status: r.status,
      required: r.required,
      assigneeIds: ctx.assignments
        .filter((a) => a.reviewId === r.id && !a.withdrawnAt)
        .map((a) => a.userId ?? a.roleId!)
        .filter(Boolean),
      approved: ctx.approvals.some(
        (a) => a.reviewId === r.id && a.status === "granted",
      ),
    })),
    readinessPassed: checks.filter((c) => c.passed).length,
    readinessTotal: checks.length,
    childCount: children.length,
    childReadyCount: children.filter((c) => c.refinementState === "ready")
      .length,
    childDoneCount: children.filter((c) => isClosed(c, ctx)).length,
    childEstimate: children.reduce((sum, c) => sum + (c.estimate ?? 0), 0),
  }) as EntityOf<"workItem">;
}

// Readiness is evidence. Each check explains itself so the UI never has to
// reduce readiness to a percentage without a reason.
function readiness(
  item: ItemRow,
  all: ItemRow[],
  ctx: ItemContext,
): ReadinessCheck[] {
  // Readiness is evidence about a specification; plain work has none.
  if (!isSpecBacked(item, ctx)) return [];
  const level = ctx.types.get(item.typeId)?.level ?? 1;
  const current = ctx.revisions.get(item.id)?.[0];
  const content = current?.content ?? "";
  const threads = ctx.threads.filter(
    (t) => t.workItemId === item.id && !t.suggestionId,
  );
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
  // Only spec-backed children carry readiness; plain tasks never block it.
  const children = activeChildren(item, all, ctx).filter((c) =>
    isSpecBacked(c, ctx),
  );
  const childrenNotReady = children.filter(
    (c) => c.refinementState !== "ready",
  );
  const checks: ReadinessCheck[] = [
    {
      key: "specification",
      label: "Specification written",
      passed: content.trim().length > 0,
      detail: content.trim() ? undefined : "The description is empty.",
    },
  ];
  if (level <= 1)
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
  if (children.length > 0)
    checks.push({
      key: "children_ready",
      label: "Every child specification is ready",
      passed: childrenNotReady.length === 0,
      detail: childrenNotReady.length
        ? `${childrenNotReady.length} of ${children.length} child specifications are not ready.`
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
  const { organizationId, projectId, workItemId } = scope;
  const projects = await tx
    .select()
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, organizationId),
        projectId ? eq(s.project.id, projectId) : undefined,
      ),
    );
  if (projectId) requireValue(projects[0]);
  const items = await tx
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        projectId ? eq(s.workItem.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(s.workItem.createdAt));
  const ctx = await loadItemContext(tx, organizationId, items);
  const projectFilter = <
    T extends { organizationId: AnyPgColumn; projectId: AnyPgColumn },
  >(
    t: T,
  ) =>
    and(
      eq(t.organizationId, organizationId),
      projectId ? eq(t.projectId, projectId) : undefined,
    );
  const labels = await tx.select().from(s.label).where(projectFilter(s.label));
  const milestones = await tx
    .select()
    .from(s.milestone)
    .where(projectFilter(s.milestone));
  const itemProject = new Map(items.map((i) => [i.id, i.projectId]));
  const relations = (
    await tx
      .select()
      .from(s.workItemRelation)
      .where(eq(s.workItemRelation.organizationId, organizationId))
      .orderBy(asc(s.workItemRelation.createdAt))
  ).filter((r) => itemProject.has(r.fromId));
  const links = await externalLinks(tx, organizationId, {
    projectId,
  });
  const entities: Entity[] = [
    ...projects.map((p) => serialize("project", p)),
    ...labels.map((l) => serialize("label", l)),
    ...milestones.map((m) => serialize("milestone", m)),
    ...items.map((item) => summarize(item, items, ctx)),
    ...relations.map((r) =>
      serialize("relation", { ...r, projectId: itemProject.get(r.fromId) }),
    ),
    ...links,
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
    [
      "suggestionReviewer",
      ctx.suggestionReviewers.filter((r) => r.workItemId === workItemId),
    ],
    [
      "suggestionDecision",
      ctx.suggestionDecisions.filter((d) => d.workItemId === workItemId),
    ],
    ["assignment", ctx.assignments.filter((a) => reviewIds.has(a.reviewId))],
    ["message", messages],
    ["activity", activity],
  ] as const)
    entities.push(...rows.map((row) => serialize(type, row)));
  entities.push(
    ...ctx.suggestions
      .filter((x) => x.workItemId === workItemId)
      .map(serializeSuggestion),
  );
  entities.push({
    type: "readiness",
    id: workItemId,
    organizationId,
    workItemId,
    checks: readiness(item, items, ctx),
  });
  return entities;
}

// External links as sync entities, optionally narrowed to items.
export async function externalLinks(
  tx: Tx,
  organizationId: string,
  filter: { projectId?: string; workItemIds?: string[] },
): Promise<EntityOf<"externalLink">[]> {
  if (filter.workItemIds?.length === 0) return [];
  const rows = await tx
    .select({
      link: s.workItemExternalLink,
      projectId: s.workItem.projectId,
      revisionNumber: s.specificationRevision.number,
    })
    .from(s.workItemExternalLink)
    .innerJoin(
      s.workItem,
      and(
        eq(s.workItem.organizationId, s.workItemExternalLink.organizationId),
        eq(s.workItem.id, s.workItemExternalLink.workItemId),
      ),
    )
    .leftJoin(
      s.specificationRevision,
      and(
        eq(
          s.specificationRevision.organizationId,
          s.workItemExternalLink.organizationId,
        ),
        eq(
          s.specificationRevision.id,
          s.workItemExternalLink.publishedRevisionId,
        ),
      ),
    )
    .where(
      and(
        eq(s.workItemExternalLink.organizationId, organizationId),
        filter.projectId
          ? eq(s.workItem.projectId, filter.projectId)
          : undefined,
        filter.workItemIds
          ? inArray(s.workItemExternalLink.workItemId, filter.workItemIds)
          : undefined,
      ),
    )
    .orderBy(asc(s.workItemExternalLink.createdAt));
  return rows.map(
    ({ link, projectId, revisionNumber }) =>
      entitySchema.parse({
        type: "externalLink",
        id: link.id,
        organizationId: link.organizationId,
        projectId,
        workItemId: link.workItemId,
        connectionId: link.connectionId,
        externalKey: link.externalKey,
        externalUrl: link.externalUrl,
        externalStatus: link.externalStatus,
        status: link.status,
        publishedRevisionId: link.publishedRevisionId,
        publishedRevisionNumber: revisionNumber ?? null,
        lastError: link.lastError,
        syncedAt: link.syncedAt?.toISOString() ?? null,
      }) as EntityOf<"externalLink">,
  );
}

const preReadyStates: RefinementState[] = ["draft", "refinement", "in_review"];

export function createSyncService(
  db: Database,
  options: {
    onMutationCommitted?: (
      userId: string,
      mutation: Mutation,
      snapshots: { before: Entity[]; after: Entity[]; directory?: Directory },
    ) => void;
  } = {},
) {
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
        if (scope.projectId !== undefined)
          requireValue(roster.projects.find((p) => p.id === scope.projectId));
        if (scope.workItemId && scope.projectId)
          requireValue(
            (
              await tx
                .select({ id: s.workItem.id })
                .from(s.workItem)
                .where(
                  and(
                    eq(s.workItem.organizationId, scope.organizationId),
                    eq(s.workItem.projectId, scope.projectId),
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
              !scope.projectId
                ? undefined
                : eq(s.syncChange.projectId, scope.projectId),
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
      let replayed = false;
      let snapshots: {
        before: Entity[];
        after: Entity[];
        directory?: Directory;
      } = { before: [], after: [] };
      const result = await db.transaction(async (tx) => {
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
          replayed = true;
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
        const admin = isAdmin(membership);
        const roster = await directory(tx, userId, organizationId);
        const capabilities = capabilitiesOf(roster.roles, userId);
        if (isRoleCommand(c)) {
          require(admin, "An organization administrator must manage roles.");
          await applyRoleCommand(tx, organizationId, roster, c);
          return commit(
            tx,
            organizationId,
            mutation.id,
            userId,
            fingerprint,
            await clock(tx, organizationId),
          );
        }
        if (isTeamCommand(c)) {
          // Team configuration and iteration planning can touch items across
          // projects (carry-over, status replacement): diff the whole org.
          const before = await snapshot(tx, { organizationId });
          await applyTeamCommand(
            tx,
            { organizationId, userId, admin, capabilities, roster },
            c,
          );
          const after = await snapshot(tx, { organizationId });
          snapshots = { before, after, directory: roster };
          const cursor = await emitChanges(
            tx,
            organizationId,
            before,
            after,
            await clock(tx, organizationId),
          );
          return commit(
            tx,
            organizationId,
            mutation.id,
            userId,
            fingerprint,
            cursor,
          );
        }
        let projectId: string;
        let projectRow: typeof s.project.$inferSelect | undefined;
        let workItemId: string | undefined;
        let item: ItemRow | undefined;
        if ("projectId" in c) projectId = c.projectId;
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
          projectId = item.projectId;
          const itemType = roster.types.find((t) => t.id === item!.typeId);
          if (specCommands.has(c.type) && !itemType?.hasSpecification)
            throw new DomainError(
              "validation",
              `${itemType?.name ?? "This type"} items have no specification to review. Change the type to one with a specification first.`,
            );
        }
        if (c.type !== "createProject")
          projectRow = requireValue(
            (
              await tx
                .select()
                .from(s.project)
                .where(
                  and(
                    eq(s.project.organizationId, organizationId),
                    eq(s.project.id, projectId),
                    isNull(s.project.archivedAt),
                  ),
                )
            )[0],
          );
        if (c.type === "createWorkItem") workItemId = c.workItemId;
        const scope = { organizationId, projectId, workItemId };
        const before =
          c.type === "createProject"
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
                    roleId: t.roleId,
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
        const typeOf = (typeId: string) =>
          requireValue(
            roster.types.find((t) => t.id === typeId),
            "The work item type is unavailable.",
          );
        // Hierarchy follows type levels: a parent sits strictly above its
        // children (Epic > Story/Task/Bug > Subtask).
        const validateParent = async (
          parentId: string | null,
          typeId: string,
        ) => {
          if (!parentId) return;
          const child = typeOf(typeId);
          const parent = requireValue(
            (
              await tx
                .select()
                .from(s.workItem)
                .where(
                  and(
                    eq(s.workItem.organizationId, organizationId),
                    eq(s.workItem.projectId, projectId),
                    eq(s.workItem.id, parentId),
                    isNull(s.workItem.archivedAt),
                  ),
                )
            )[0],
            "The parent item is unavailable in this project.",
          );
          if (parent.id === workItemId)
            throw new DomainError(
              "validation",
              "An item cannot be its own parent.",
            );
          const parentType = typeOf(parent.typeId);
          if (parentType.level <= child.level)
            throw new DomainError(
              "validation",
              `A ${child.name} cannot be placed under a ${parentType.name}.`,
            );
          return parent;
        };
        const teamOf = (teamId: string) =>
          requireValue(
            roster.teams.find((t) => t.id === teamId && !t.archivedAt),
            "The team is unavailable.",
          );
        const iterationEvent = async (
          iterationId: string | null,
          kind: (typeof s.iterationEvent.$inferInsert)["kind"],
          points: number | null,
          at = now,
        ) => {
          if (!iterationId) return;
          // Completed iterations are history: later edits never change them.
          const known = roster.iterations.find((i) => i.id === iterationId);
          if (!known || known.state === "completed") return;
          await tx.insert(s.iterationEvent).values({
            organizationId,
            iterationId,
            workItemId: workItemId!,
            kind,
            points: points ?? 0,
            actorId: userId,
            createdAt: at,
          });
        };
        const openIteration = (teamId: string, iterationId: string) => {
          const found = requireValue(
            roster.iterations.find(
              (i) => i.id === iterationId && i.teamId === teamId,
            ),
            "The iteration is unavailable for this team.",
          );
          if (found.state === "completed")
            throw new DomainError(
              "validation",
              "That iteration is completed. Choose an active or planned one.",
            );
          return found;
        };
        const setRefinement = async (
          state: RefinementState,
          from: RefinementState | null,
          automatic = false,
        ) => {
          if (state === from || from === null) return;
          await tx
            .update(s.workItem)
            .set({ refinementState: state })
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.id, workItemId!),
              ),
            );
          log("refinement_changed", { from, to: state, automatic });
        };
        switch (c.type) {
          case "createProject": {
            require(admin, "An organization administrator must create projects.");
            // Keys become URL segments beside fixed workspace routes.
            if (reservedKeys.has(c.key))
              throw new DomainError(
                "validation",
                `${c.key} is reserved by Lictory. Choose another key.`,
              );
            const taken = (
              await tx
                .select({ id: s.project.id })
                .from(s.project)
                .where(
                  and(
                    eq(s.project.organizationId, organizationId),
                    eq(s.project.key, c.key),
                  ),
                )
            )[0];
            if (taken)
              throw new DomainError(
                "validation",
                `The key ${c.key} is already used by another project.`,
              );
            if (c.setup) {
              const previousSetup = await tx
                .select({ id: s.organizationOnboarding.organizationId })
                .from(s.organizationOnboarding)
                .where(
                  eq(s.organizationOnboarding.organizationId, organizationId),
                )
                .limit(1);
              require(!roster.projects.length &&
                !previousSetup.length, "Initial setup has already been completed. Use settings to change configuration.");
              const setupTeam = teamOf(c.setup.teamId);
              require(!setupTeam.archivedAt, "Choose an active team.");
              await applyTeamCommand(
                tx,
                { organizationId, userId, admin, capabilities, roster },
                {
                  type: "updateTeam",
                  teamId: setupTeam.id,
                  name: c.setup.teamName,
                  deliveryMode: c.setup.deliveryMode,
                  readinessPolicy: c.setup.readinessPolicy,
                  estimateScale: c.setup.estimateScale,
                  iterationMode: c.setup.iterationMode,
                  iterationWeeks: c.setup.iterationWeeks,
                  iterationStartDay: c.setup.iterationStartDay,
                  upcomingIterations: 2,
                },
              );
            }
            await tx.insert(s.project).values({
              id: projectId,
              organizationId,
              name: c.name,
              slug: c.key.toLowerCase(),
              key: c.key,
              defaultTeamId:
                c.setup?.teamId ??
                roster.teams.find((t) => !t.archivedAt)?.id ??
                null,
              createdById: userId,
            });
            if (c.setup)
              await tx.insert(s.organizationOnboarding).values({
                organizationId,
                projectId,
                teamId: c.setup.teamId,
                decidedById: userId,
                decisions: c.setup,
              });
            break;
          }
          case "updateProject":
            require(admin, "An organization administrator must update projects.");
            if (c.defaultTeamId) teamOf(c.defaultTeamId);
            await tx
              .update(s.project)
              .set({
                name: c.name,
                ...(c.defaultTeamId ? { defaultTeamId: c.defaultTeamId } : {}),
              })
              .where(
                and(
                  eq(s.project.organizationId, organizationId),
                  eq(s.project.id, projectId),
                ),
              );
            break;
          case "createWorkItem": {
            requireCapability(capabilities, "editSpecifications");
            const type = typeOf(c.typeId);
            if (type.archivedAt)
              throw new DomainError(
                "validation",
                `${type.name} is archived. Restore it or choose another type.`,
              );
            const teamId = c.teamId ?? projectRow!.defaultTeamId;
            if (!teamId)
              throw new DomainError(
                "validation",
                "Choose a team for this item; the project has no default team.",
              );
            const team = teamOf(teamId);
            if (!team.typeIds.includes(type.id))
              throw new DomainError(
                "validation",
                `${team.name} does not use ${type.name} items. Enable the type in team settings.`,
              );
            const parent = await validateParent(c.parentId, c.typeId);
            const statuses = team.statuses.filter((x) => !x.archivedAt);
            const status = c.statusId
              ? requireValue(
                  statuses.find((x) => x.id === c.statusId),
                  "The status is unavailable for this team.",
                )
              : (statuses.find((x) => x.category === "backlog") ??
                statuses.find((x) => x.category === "unstarted") ??
                statuses[0]);
            if (!status)
              throw new DomainError(
                "validation",
                `${team.name} has no workflow statuses.`,
              );
            if (c.iterationId) openIteration(team.id, c.iterationId);
            if (c.assigneeId)
              requireValue(
                roster.members.find((m) => m.id === c.assigneeId),
                "Assignee is outside this organization.",
              );
            const [{ next }] = (await tx
              .select({
                next: sql<number>`coalesce(max(${s.workItem.number}), 0) + 1`,
              })
              .from(s.workItem)
              .where(
                and(
                  eq(s.workItem.organizationId, organizationId),
                  eq(s.workItem.projectId, projectId),
                ),
              )) as [{ next: number }];
            const [{ last }] = (await tx
              .select({ last: sql<string | null>`max(${s.workItem.rank})` })
              .from(s.workItem)
              .where(
                and(
                  eq(s.workItem.organizationId, organizationId),
                  eq(s.workItem.teamId, team.id),
                ),
              )) as [{ last: string | null }];
            // Decomposition keeps traceability: a child of a specification
            // records which parent revision it was derived from.
            const parentRevision =
              parent && typeOf(parent.typeId).hasSpecification
                ? (
                    await tx
                      .select({ id: s.specificationRevision.id })
                      .from(s.specificationRevision)
                      .where(
                        and(
                          eq(
                            s.specificationRevision.organizationId,
                            organizationId,
                          ),
                          eq(s.specificationRevision.workItemId, parent.id),
                        ),
                      )
                      .orderBy(desc(s.specificationRevision.number))
                      .limit(1)
                  )[0]?.id
                : undefined;
            await tx.insert(s.workItem).values({
              id: workItemId!,
              organizationId,
              projectId,
              teamId: team.id,
              typeId: type.id,
              parentId: c.parentId,
              number: Number(next),
              title: c.title,
              statusId: status.id,
              refinementState: type.hasSpecification ? "draft" : null,
              iterationId: c.iterationId ?? null,
              assigneeId: c.assigneeId ?? null,
              rank: rankBetween(last, null),
              sourceRevisionId: parentRevision ?? null,
              createdById: userId,
            });
            await revision(c.title, c.description ?? "", "Created", undefined);
            await iterationEvent(c.iterationId ?? null, "added", null);
            log("created", {
              type: type.name,
              number: Number(next),
              ...(parentRevision ? { sourceRevisionId: parentRevision } : {}),
            });
            break;
          }
          case "updateWorkItem": {
            requireCapability(capabilities, "changeProperties");
            const patch: Partial<ItemRow> = {};
            const failingChecks = () => {
              const checks = before.find(
                (e) => e.type === "readiness" && e.id === workItemId,
              );
              return checks?.type === "readiness"
                ? checks.checks.filter((k) => !k.passed)
                : [];
            };
            // Team change: the key stays, the workflow follows the new team.
            let teamId = item!.teamId;
            let statusId = item!.statusId;
            let iterationId = item!.iterationId;
            let typeId = item!.typeId;
            if (c.typeId !== undefined && c.typeId !== item!.typeId) {
              const to = typeOf(c.typeId);
              const from = typeOf(item!.typeId);
              if (to.archivedAt)
                throw new DomainError("validation", `${to.name} is archived.`);
              await validateParent(item!.parentId, to.id);
              const children = before.filter(
                (e): e is EntityOf<"workItem"> =>
                  e.type === "workItem" &&
                  e.parentId === workItemId &&
                  !e.archivedAt,
              );
              if (children.some((ch) => typeOf(ch.typeId).level >= to.level))
                throw new DomainError(
                  "validation",
                  `This item has children that cannot sit under a ${to.name}.`,
                );
              typeId = to.id;
              patch.typeId = to.id;
              // Revisions are never deleted; they reappear if the type
              // regains a specification.
              if (to.hasSpecification && !from.hasSpecification)
                patch.refinementState = "draft";
              if (!to.hasSpecification) patch.refinementState = null;
              log("type_changed", { from: from.name, to: to.name });
            }
            if (c.teamId !== undefined && c.teamId !== item!.teamId) {
              const to = teamOf(c.teamId);
              const category = roster.teams
                .find((t) => t.id === item!.teamId)
                ?.statuses.find((x) => x.id === item!.statusId)?.category;
              const statuses = to.statuses.filter((x) => !x.archivedAt);
              const mapped =
                statuses.find((x) => x.category === category) ?? statuses[0];
              if (!mapped)
                throw new DomainError(
                  "validation",
                  `${to.name} has no workflow statuses.`,
                );
              teamId = to.id;
              statusId = mapped.id;
              patch.teamId = to.id;
              patch.statusId = mapped.id;
              if (item!.iterationId) {
                await iterationEvent(
                  item!.iterationId,
                  "removed",
                  item!.estimate,
                );
                iterationId = null;
                patch.iterationId = null;
              }
              log("team_changed", {
                from: item!.teamId,
                to: to.id,
                statusId: mapped.id,
              });
            }
            const team = teamOf(teamId);
            if (!team.typeIds.includes(typeId))
              throw new DomainError(
                "validation",
                `${team.name} does not use ${typeOf(typeId).name} items.`,
              );
            if (c.statusId !== undefined && c.statusId !== statusId) {
              const to = requireValue(
                team.statuses.find((x) => x.id === c.statusId && !x.archivedAt),
                "The status is unavailable for this team.",
              );
              const from = team.statuses.find((x) => x.id === statusId);
              // Readiness gates starting spec-backed work, per team policy.
              // `warn` lets the move through but records the override.
              let override: string[] | undefined;
              if (
                to.category === "started" &&
                from?.category !== "started" &&
                typeOf(typeId).hasSpecification &&
                item!.refinementState !== "ready" &&
                team.readinessPolicy !== "off"
              ) {
                const failing = failingChecks().map((k) => k.label);
                if (team.readinessPolicy === "block")
                  throw new DomainError(
                    "validation",
                    `${projectRow!.key}-${item!.number} is not ready to start${failing.length ? `: ${failing.map((f) => f.toLowerCase()).join("; ")}` : ""}.`,
                  );
                override = failing;
              }
              const wasClosed = closedCategories.includes(
                from?.category ?? "backlog",
              );
              const nowClosed = closedCategories.includes(to.category);
              if (wasClosed !== nowClosed)
                await iterationEvent(
                  iterationId,
                  nowClosed ? "completed" : "reopened",
                  item!.estimate,
                );
              patch.statusId = to.id;
              log("status_changed", {
                from: from?.name ?? null,
                to: to.name,
                category: to.category,
                ...(override ? { startedBeforeReady: override } : {}),
              });
            }
            if (
              c.refinementState !== undefined &&
              c.refinementState !== item!.refinementState
            ) {
              if (item!.refinementState === null)
                throw new DomainError(
                  "validation",
                  "This item has no specification to refine.",
                );
              patch.refinementState = c.refinementState;
              log("refinement_changed", {
                from: item!.refinementState,
                to: c.refinementState,
                automatic: false,
              });
            }
            if (c.iterationId !== undefined && c.iterationId !== iterationId) {
              if (c.iterationId) {
                if (team.deliveryMode === "external")
                  throw new DomainError(
                    "validation",
                    `${team.name} tracks delivery in an external tool; plan iterations there.`,
                  );
                openIteration(teamId, c.iterationId);
              }
              await iterationEvent(iterationId, "removed", item!.estimate);
              await iterationEvent(c.iterationId, "added", item!.estimate);
              // Already-finished work counts as completed scope, not remaining.
              const category = team.statuses.find(
                (x) => x.id === (patch.statusId ?? statusId),
              )?.category;
              if (category && closedCategories.includes(category))
                await iterationEvent(
                  c.iterationId,
                  "completed",
                  item!.estimate,
                );
              patch.iterationId = c.iterationId;
              log("iteration_changed", {
                from: iterationId,
                to: c.iterationId,
              });
              iterationId = c.iterationId;
            }
            if (c.estimate !== undefined && c.estimate !== item!.estimate) {
              if (team.estimateScale === "none")
                throw new DomainError(
                  "validation",
                  `${team.name} does not estimate work.`,
                );
              if (iterationId && c.iterationId === undefined)
                await iterationEvent(
                  iterationId,
                  "estimate_changed",
                  (c.estimate ?? 0) - (item!.estimate ?? 0),
                );
              patch.estimate = c.estimate;
              log("estimate_changed", { from: item!.estimate, to: c.estimate });
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
              await validateParent(c.parentId, typeId);
              patch.parentId = c.parentId;
              log("parent_changed", { from: item!.parentId, to: c.parentId });
            }
            if (
              c.milestoneId !== undefined &&
              c.milestoneId !== item!.milestoneId
            ) {
              if (c.milestoneId)
                requireValue(
                  before.find(
                    (e) =>
                      e.type === "milestone" &&
                      e.id === c.milestoneId &&
                      e.projectId === projectId &&
                      !e.archivedAt,
                  ),
                  "The milestone is unavailable in this project.",
                );
              patch.milestoneId = c.milestoneId;
              log("milestone_changed", {
                from: item!.milestoneId,
                to: c.milestoneId,
              });
            }
            if (c.labelIds !== undefined) {
              const wanted = [...new Set(c.labelIds)];
              for (const labelId of wanted)
                requireValue(
                  before.find(
                    (e) =>
                      e.type === "label" &&
                      e.id === labelId &&
                      e.projectId === projectId &&
                      !e.archivedAt,
                  ),
                  "A label is unavailable in this project.",
                );
              const current = before.find(
                (e) => e.type === "workItem" && e.id === workItemId,
              );
              const existing =
                current?.type === "workItem" ? current.labelIds : [];
              const added = wanted.filter((l) => !existing.includes(l));
              const removed = existing.filter((l) => !wanted.includes(l));
              if (removed.length)
                await tx
                  .delete(s.workItemLabel)
                  .where(
                    and(
                      eq(s.workItemLabel.workItemId, workItemId!),
                      inArray(s.workItemLabel.labelId, removed),
                    ),
                  );
              if (added.length)
                await tx.insert(s.workItemLabel).values(
                  added.map((labelId) => ({
                    organizationId,
                    workItemId: workItemId!,
                    labelId,
                  })),
                );
              if (added.length || removed.length)
                log("labels_changed", { added, removed });
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
          case "reorderWorkItem": {
            requireCapability(capabilities, "changeProperties");
            // Siblings share the parent; positions are sparse so a move only
            // rewrites one row unless neighbours collide, then all siblings.
            const siblings = before
              .filter(
                (e): e is EntityOf<"workItem"> =>
                  e.type === "workItem" &&
                  e.projectId === projectId &&
                  e.parentId === item!.parentId &&
                  !e.archivedAt &&
                  e.id !== workItemId,
              )
              .sort((a, b) => a.position - b.position || a.number - b.number);
            const index = c.beforeId
              ? siblings.findIndex((x) => x.id === c.beforeId)
              : siblings.length;
            if (c.beforeId && index === -1)
              throw new DomainError(
                "validation",
                "The target item is not a sibling.",
              );
            const prev = siblings[index - 1]?.position ?? 0;
            const next = siblings[index]?.position;
            let position: number;
            if (next === undefined) position = prev + 1000;
            else if (next - prev > 1) position = Math.floor((prev + next) / 2);
            else {
              const reordered = [
                ...siblings.slice(0, index),
                item!,
                ...siblings.slice(index),
              ];
              for (const [i, sibling] of reordered.entries())
                await tx
                  .update(s.workItem)
                  .set({ position: (i + 1) * 1000 })
                  .where(
                    and(
                      eq(s.workItem.organizationId, organizationId),
                      eq(s.workItem.id, sibling.id),
                    ),
                  );
              position = (index + 1) * 1000;
            }
            await tx
              .update(s.workItem)
              .set({ position })
              .where(
                and(
                  eq(s.workItem.organizationId, organizationId),
                  eq(s.workItem.id, workItemId!),
                ),
              );
            break;
          }
          case "rankWorkItem": {
            requireCapability(capabilities, "changeProperties");
            const neighbour = (id: string | null) =>
              id === null
                ? null
                : requireValue(
                    before.find(
                      (e): e is EntityOf<"workItem"> =>
                        e.type === "workItem" && e.id === id,
                    ),
                    "The neighbouring item is unavailable.",
                  ).rank;
            let low = neighbour(c.afterId);
            let high = neighbour(c.beforeId);
            // Stale neighbours (another client moved them) must not produce
            // an invalid range; fall back to placing after `afterId`.
            if (low !== null && high !== null && low >= high) high = null;
            if (low === null && high === null)
              low =
                before
                  .filter(
                    (e): e is EntityOf<"workItem"> =>
                      e.type === "workItem" && e.id !== workItemId,
                  )
                  .map((e) => e.rank)
                  .sort()
                  .at(-1) ?? null;
            await tx
              .update(s.workItem)
              .set({ rank: rankBetween(low, high) })
              .where(
                and(
                  eq(s.workItem.organizationId, organizationId),
                  eq(s.workItem.id, workItemId!),
                ),
              );
            break;
          }
          case "addRelation": {
            requireCapability(capabilities, "changeProperties");
            if (c.toId === workItemId)
              throw new DomainError(
                "validation",
                "An item cannot relate to itself.",
              );
            // Relations may cross projects and teams, never organizations.
            const target = requireValue(
              (
                await tx
                  .select({ id: s.workItem.id })
                  .from(s.workItem)
                  .where(
                    and(
                      eq(s.workItem.organizationId, organizationId),
                      eq(s.workItem.id, c.toId),
                    ),
                  )
              )[0],
              "The related item is unavailable.",
            );
            const existing = await tx
              .select({ id: s.workItemRelation.id })
              .from(s.workItemRelation)
              .where(
                and(
                  eq(s.workItemRelation.organizationId, organizationId),
                  eq(s.workItemRelation.kind, c.kind),
                  or(
                    and(
                      eq(s.workItemRelation.fromId, workItemId!),
                      eq(s.workItemRelation.toId, target.id),
                    ),
                    c.kind === "blocks"
                      ? undefined
                      : and(
                          eq(s.workItemRelation.fromId, target.id),
                          eq(s.workItemRelation.toId, workItemId!),
                        ),
                  ),
                ),
              );
            if (existing.length) break;
            if (c.kind === "blocks") {
              const reverse = await tx
                .select({ id: s.workItemRelation.id })
                .from(s.workItemRelation)
                .where(
                  and(
                    eq(s.workItemRelation.organizationId, organizationId),
                    eq(s.workItemRelation.kind, "blocks"),
                    eq(s.workItemRelation.fromId, target.id),
                    eq(s.workItemRelation.toId, workItemId!),
                  ),
                );
              if (reverse.length)
                throw new DomainError(
                  "validation",
                  "These items already block each other the other way round.",
                );
            }
            await tx.insert(s.workItemRelation).values({
              id: c.relationId,
              organizationId,
              fromId: workItemId!,
              toId: target.id,
              kind: c.kind,
              createdById: userId,
            });
            log("relation_added", { kind: c.kind, toId: target.id });
            break;
          }
          case "removeRelation": {
            requireCapability(capabilities, "changeProperties");
            const relation = requireValue(
              (
                await tx
                  .select()
                  .from(s.workItemRelation)
                  .where(
                    and(
                      eq(s.workItemRelation.organizationId, organizationId),
                      eq(s.workItemRelation.id, c.relationId),
                      or(
                        eq(s.workItemRelation.fromId, workItemId!),
                        eq(s.workItemRelation.toId, workItemId!),
                      ),
                    ),
                  )
              )[0],
              "The relation is unavailable.",
            );
            await tx
              .delete(s.workItemRelation)
              .where(
                and(
                  eq(s.workItemRelation.organizationId, organizationId),
                  eq(s.workItemRelation.id, relation.id),
                ),
              );
            log("relation_removed", {
              kind: relation.kind,
              fromId: relation.fromId,
              toId: relation.toId,
            });
            break;
          }
          case "createLabel":
          case "updateLabel": {
            requireCapability(capabilities, "changeProperties");
            if (c.type === "createLabel") {
              const taken = before.some(
                (e) =>
                  e.type === "label" &&
                  e.projectId === projectId &&
                  e.name.toLowerCase() === c.name.toLowerCase() &&
                  !e.archivedAt,
              );
              if (taken)
                throw new DomainError(
                  "validation",
                  `A label named “${c.name}” already exists.`,
                );
              await tx.insert(s.label).values({
                id: c.labelId,
                organizationId,
                projectId,
                name: c.name,
                color: c.color,
              });
            } else {
              requireValue(
                before.find(
                  (e) =>
                    e.type === "label" &&
                    e.id === c.labelId &&
                    e.projectId === projectId,
                ),
              );
              await tx
                .update(s.label)
                .set({
                  ...(c.name !== undefined ? { name: c.name } : {}),
                  ...(c.color !== undefined ? { color: c.color } : {}),
                  ...(c.archived !== undefined
                    ? { archivedAt: c.archived ? now : null }
                    : {}),
                })
                .where(
                  and(
                    eq(s.label.organizationId, organizationId),
                    eq(s.label.id, c.labelId),
                  ),
                );
            }
            break;
          }
          case "createMilestone":
          case "updateMilestone": {
            requireCapability(capabilities, "changeProperties");
            if (c.type === "createMilestone") {
              const taken = before.some(
                (e) =>
                  e.type === "milestone" &&
                  e.projectId === projectId &&
                  e.name.toLowerCase() === c.name.toLowerCase() &&
                  !e.archivedAt,
              );
              if (taken)
                throw new DomainError(
                  "validation",
                  `A milestone named “${c.name}” already exists.`,
                );
              await tx.insert(s.milestone).values({
                id: c.milestoneId,
                organizationId,
                projectId,
                name: c.name,
                targetDate: c.targetDate ? new Date(c.targetDate) : null,
              });
            } else {
              requireValue(
                before.find(
                  (e) =>
                    e.type === "milestone" &&
                    e.id === c.milestoneId &&
                    e.projectId === projectId,
                ),
              );
              await tx
                .update(s.milestone)
                .set({
                  ...(c.name !== undefined ? { name: c.name } : {}),
                  ...(c.targetDate !== undefined
                    ? {
                        targetDate: c.targetDate
                          ? new Date(c.targetDate)
                          : null,
                      }
                    : {}),
                  ...(c.status !== undefined ? { status: c.status } : {}),
                  ...(c.archived !== undefined
                    ? { archivedAt: c.archived ? now : null }
                    : {}),
                })
                .where(
                  and(
                    eq(s.milestone.organizationId, organizationId),
                    eq(s.milestone.id, c.milestoneId),
                  ),
                );
            }
            break;
          }
          case "archiveWorkItem":
            requireCapability(capabilities, "changeProperties");
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
            requireCapability(capabilities, "editSpecifications");
            await revision(c.title, c.content, c.summary);
            break;
          case "createThread": {
            if (!typeOf(item!.typeId).hasSpecification && c.blocking)
              throw new DomainError(
                "validation",
                "Plain work item comments cannot block readiness.",
              );
            let suggestionId: string | null = null;
            if (c.suggestionId) {
              const target = requireValue(
                before.find(
                  (e) => e.type === "suggestion" && e.id === c.suggestionId,
                ),
                "This suggestion is unavailable.",
              );
              if (
                target.type !== "suggestion" ||
                (target.status !== "open" && target.status !== "draft")
              )
                throw new DomainError(
                  "conflict",
                  "This suggestion is no longer open for discussion.",
                );
              suggestionId = target.id;
            }
            await tx.insert(s.thread).values({
              id: c.threadId,
              ...context,
              suggestionId,
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
              ...(suggestionId ? { suggestionId } : {}),
            });
            break;
          }
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
              if (
                !typeOf(item!.typeId).hasSpecification &&
                c.blocking &&
                !thread.blocking
              )
                throw new DomainError(
                  "validation",
                  "Plain work item comments cannot block readiness.",
                );
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
              title: c.title,
              rationale: c.rationale,
              status: c.open ? "open" : "draft",
              openedAt: c.open ? now : null,
            });
            log("suggestion_created", {
              suggestionId: c.suggestionId,
              draft: !c.open,
            });
            break;
          case "updateSuggestion":
          case "setSuggestionState":
          case "setSuggestionReviewer":
          case "decideSuggestion":
          case "mergeSuggestion": {
            const suggestion = requireValue(
              before.find(
                (e) => e.type === "suggestion" && e.id === c.suggestionId,
              ),
              "This suggestion is unavailable.",
            );
            if (suggestion.type !== "suggestion") break;
            const isAuthor = suggestion.authorId === userId;
            const reviewers = before.filter(
              (e): e is EntityOf<"suggestionReviewer"> =>
                e.type === "suggestionReviewer" &&
                e.suggestionId === suggestion.id &&
                !e.withdrawnAt,
            );
            const decisions = before.filter(
              (e): e is EntityOf<"suggestionDecision"> =>
                e.type === "suggestionDecision" &&
                e.suggestionId === suggestion.id &&
                !e.supersededAt,
            );
            const isReviewer = reviewers.some((r) => r.userId === userId);
            const settled =
              suggestion.status === "merged" || suggestion.status === "closed";
            const patch = (values: Partial<SuggestionRow>) =>
              tx
                .update(s.suggestion)
                .set(values)
                .where(
                  and(
                    eq(s.suggestion.organizationId, organizationId),
                    eq(s.suggestion.id, suggestion.id),
                  ),
                );
            // Ends the reviewers' current decisions; a new version or a new
            // decision by the same reviewer replaces rather than rewrites.
            const supersede = async (reason: string, reviewerId?: string) => {
              await tx
                .update(s.suggestionDecision)
                .set({ supersededAt: now, supersededReason: reason })
                .where(
                  and(
                    eq(s.suggestionDecision.organizationId, organizationId),
                    eq(s.suggestionDecision.suggestionId, suggestion.id),
                    isNull(s.suggestionDecision.supersededAt),
                    reviewerId
                      ? eq(s.suggestionDecision.reviewerId, reviewerId)
                      : undefined,
                  ),
                );
            };
            switch (c.type) {
              case "updateSuggestion": {
                require(isAuthor, "Only the author can update a suggestion.");
                if (settled)
                  throw new DomainError(
                    "conflict",
                    `This suggestion was ${suggestion.status}; open a new one.`,
                  );
                if (c.replacement === latest?.content)
                  throw new DomainError(
                    "validation",
                    "This suggestion makes no content change.",
                  );
                const rebased = suggestion.revisionId !== latest!.id;
                const changed = c.replacement !== suggestion.replacement;
                const detailsChanged =
                  c.title !== suggestion.title ||
                  c.rationale !== suggestion.rationale;
                const version = changed
                  ? suggestion.version + 1
                  : suggestion.version;
                await patch({
                  replacement: c.replacement,
                  title: c.title,
                  rationale: c.rationale,
                  revisionId: latest!.id,
                  version,
                });
                if (changed && decisions.length)
                  await supersede(`Suggestion updated (version ${version})`);
                if (changed || rebased || detailsChanged)
                  log("suggestion_updated", {
                    suggestionId: suggestion.id,
                    version,
                    rebased,
                    revision: latest!.number,
                  });
                break;
              }
              case "setSuggestionState": {
                if (c.status === suggestion.status) break;
                if (suggestion.status === "merged")
                  throw new DomainError(
                    "conflict",
                    "A merged suggestion cannot change state.",
                  );
                if (c.status === "closed")
                  require(isAuthor ||
                    capabilities.editSpecifications, "Only the author or someone who can edit specifications can close a suggestion.");
                else
                  require(isAuthor, "Only the author can open or draft a suggestion.");
                await patch({
                  status: c.status,
                  ...(c.status === "open" && !suggestion.openedAt
                    ? { openedAt: now }
                    : {}),
                  resolvedAt: c.status === "closed" ? now : null,
                  resolvedById: c.status === "closed" ? userId : null,
                });
                log(
                  c.status === "closed"
                    ? "suggestion_closed"
                    : suggestion.status === "closed"
                      ? "suggestion_reopened"
                      : c.status === "open"
                        ? "suggestion_opened"
                        : "suggestion_drafted",
                  {
                    suggestionId: suggestion.id,
                    authorId: suggestion.authorId,
                  },
                );
                break;
              }
              case "setSuggestionReviewer": {
                require(isAuthor, "Only the author can choose reviewers for a suggestion.");
                if (settled)
                  throw new DomainError(
                    "conflict",
                    `This suggestion was ${suggestion.status}.`,
                  );
                requireValue(
                  roster.members.find((m) => m.id === c.userId),
                  "That person is not a member of this organization.",
                );
                const existing = reviewers.find((r) => r.userId === c.userId);
                if (c.assigned) {
                  require(canReviewSuggestions(
                    roster.roles,
                    c.userId,
                  ), "Suggestion reviewers need a role that can both edit Epics and Stories and be asked to review.", "validation");
                  require(c.userId !==
                    userId, "You cannot review your own suggestion.", "validation");
                  if (existing) break;
                  await tx.insert(s.suggestionReviewer).values({
                    organizationId,
                    workItemId: workItemId!,
                    suggestionId: suggestion.id,
                    userId: c.userId,
                    assignedById: userId,
                  });
                  log("suggestion_reviewer_assigned", {
                    suggestionId: suggestion.id,
                    userId: c.userId,
                  });
                } else {
                  if (!existing) break;
                  await tx
                    .update(s.suggestionReviewer)
                    .set({ withdrawnAt: now })
                    .where(
                      and(
                        eq(s.suggestionReviewer.organizationId, organizationId),
                        eq(s.suggestionReviewer.id, existing.id),
                      ),
                    );
                  log("suggestion_reviewer_unassigned", {
                    suggestionId: suggestion.id,
                    userId: c.userId,
                  });
                }
                break;
              }
              case "decideSuggestion": {
                require(isReviewer, "Only an assigned reviewer can decide this suggestion.");
                if (suggestion.status !== "open")
                  throw new DomainError(
                    "conflict",
                    "This suggestion is not open for review.",
                  );
                if (c.version !== suggestion.version)
                  throw new DomainError(
                    "conflict",
                    `The suggestion changed (version ${suggestion.version}). Review the latest version.`,
                  );
                const mine = decisions.find((d) => d.reviewerId === userId);
                if (c.decision === "revoke") {
                  if (!mine) break;
                  await supersede("Reviewer revoked their decision", userId);
                  log("suggestion_decision_revoked", {
                    suggestionId: suggestion.id,
                    version: suggestion.version,
                  });
                  break;
                }
                const decision =
                  c.decision === "approve" ? "approved" : "changes_requested";
                if (mine?.decision === decision && mine.version === c.version)
                  break;
                if (mine) await supersede("Reviewer decision changed", userId);
                await tx.insert(s.suggestionDecision).values({
                  organizationId,
                  workItemId: workItemId!,
                  suggestionId: suggestion.id,
                  reviewerId: userId,
                  version: c.version,
                  decision,
                });
                log(
                  decision === "approved"
                    ? "suggestion_approved"
                    : "suggestion_changes_requested",
                  {
                    suggestionId: suggestion.id,
                    version: c.version,
                    authorId: suggestion.authorId,
                  },
                );
                break;
              }
              case "mergeSuggestion": {
                require(isReviewer, "Only an assigned reviewer can merge this suggestion.");
                // Merging writes the mainline: the reviewer must still hold
                // the editing capability they were chosen for.
                requireCapability(capabilities, "editSpecifications");
                if (suggestion.status !== "open")
                  throw new DomainError(
                    "conflict",
                    "Only an open suggestion can be merged.",
                  );
                if (suggestion.revisionId !== latest?.id)
                  throw new DomainError(
                    "conflict",
                    `The specification moved to revision ${latest?.number}. The author must update the suggestion before it can be merged.`,
                    latest?.id,
                  );
                const approved = decisions.filter(
                  (d) =>
                    d.decision === "approved" &&
                    d.version === suggestion.version &&
                    reviewers.some((r) => r.userId === d.reviewerId),
                );
                require(approved.length >
                  0, `Version ${suggestion.version} needs at least one reviewer approval before merging.`, "validation");
                const blocking = before.filter(
                  (e) =>
                    e.type === "thread" &&
                    e.suggestionId === suggestion.id &&
                    e.status === "open" &&
                    e.blocking,
                );
                require(blocking.length ===
                  0, `${blocking.length} blocking ${blocking.length === 1 ? "discussion" : "discussions"} on this suggestion must be resolved before merging.`, "validation");
                if (suggestion.replacement === latest.content)
                  throw new DomainError(
                    "validation",
                    "This suggestion makes no content change.",
                  );
                const mergedRevisionId = await revision(
                  latest.title,
                  suggestion.replacement,
                  suggestion.title ??
                    suggestion.rationale ??
                    "Merged suggestion",
                );
                await patch({
                  status: "merged",
                  resolvedAt: now,
                  resolvedById: userId,
                  acceptedRevisionId: mergedRevisionId,
                });
                log("suggestion_merged", {
                  suggestionId: suggestion.id,
                  authorId: suggestion.authorId,
                  version: suggestion.version,
                  approvedBy: approved.map((d) => d.reviewerId).sort(),
                });
                break;
              }
            }
            break;
          }
          case "requestReview": {
            requireCapability(capabilities, "requestReviews");
            const role = requireValue(
              roster.roles.find((r) => r.id === c.roleId && !r.archivedAt),
              "The reviewer role is unavailable in this organization.",
            );
            require(role.capabilities
              .review, `${role.name} cannot be asked to review. An administrator can change the role's capabilities.`, "validation");
            if (c.userId)
              require(role.userIds.includes(
                c.userId,
              ), `The chosen reviewer is not a member of ${role.name}.`, "validation");
            await tx.insert(s.review).values({
              id: c.reviewId,
              ...context,
              responsibility: role.name,
              required: c.required,
              requestedById: userId,
            });
            await tx.insert(s.reviewAssignment).values({
              organizationId,
              reviewId: c.reviewId,
              assignedById: userId,
              userId: c.userId,
              roleId: c.userId ? null : c.roleId,
            });
            log("review_requested", {
              reviewId: c.reviewId,
              responsibility: role.name,
              targetType: c.userId ? "user" : "role",
              targetId: c.userId ?? c.roleId,
              required: c.required,
            });
            if (
              item!.refinementState === "draft" ||
              item!.refinementState === "refinement"
            )
              await setRefinement("in_review", item!.refinementState, true);
            break;
          }
          case "cancelReview": {
            requireCapability(capabilities, "requestReviews");
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
            const canReviewSpecification = before.some(
              (e) =>
                e.type === "assignment" &&
                e.reviewId === c.reviewId &&
                !e.withdrawnAt &&
                (e.userId === userId ||
                  roster.roles.some(
                    (r) =>
                      r.id === e.roleId &&
                      !r.archivedAt &&
                      r.userIds.includes(userId),
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
          const state = itemState.refinementState;
          const ready =
            readinessState.checks.length > 0 &&
            readinessState.checks.every((check) => check.passed);
          const next: RefinementState | undefined =
            state && ready && preReadyStates.includes(state)
              ? "ready"
              : !ready && state === "ready"
                ? "in_review"
                : undefined;
          if (next) {
            await setRefinement(next, state, true);
            after = await snapshot(tx, scope);
          }
        }
        if (workItemId && activities.length) {
          await tx.insert(s.activity).values(
            activities.map((a, index) => ({
              id: crypto.randomUUID(),
              organizationId,
              projectId,
              workItemId: workItemId,
              actorId: userId,
              action: a.action,
              detail: a.detail ?? null,
              createdAt: new Date(now.getTime() + index),
            })),
          );
          after = await snapshot(tx, scope);
        }
        // Replies log no activity but still notify participants and mentions.
        if (
          workItemId &&
          projectRow &&
          (activities.length || c.type === "replyToThread")
        )
          await notifyItemActivity(tx, {
            organizationId,
            projectId,
            projectKey: projectRow.key,
            workItemId,
            actorId: userId,
            command: c,
            activities,
            after,
            roster,
          });
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
                eq(s.workItem.projectId, projectId),
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
        let cursor = await clock(tx, organizationId);
        for (const { workItemId: parentId, entity } of parentReadiness) {
          cursor++;
          await tx.insert(s.syncChange).values({
            organizationId,
            cursor,
            projectId,
            workItemId: parentId,
            change: { operation: "upsert", cursor: cursor.toString(), entity },
          });
        }
        snapshots = { before, after, directory: roster };
        cursor = await emitChanges(tx, organizationId, before, after, cursor, {
          projectId,
          workItemId,
        });
        return commit(
          tx,
          organizationId,
          mutation.id,
          userId,
          fingerprint,
          cursor,
        );
      });
      if (!replayed) {
        try {
          options.onMutationCommitted?.(userId, mutation, snapshots);
        } catch {
          // Observability cannot turn a committed mutation into an apparent failure.
        }
      }
      return result;
    },
  };
}

const reservedKeys = new Set([
  "INBOX",
  "SETTINGS",
  "ACCOUNT",
  "ITEMS",
  "TEAMS",
]);
// Commands that operate on a specification and its review. Types without a
// specification still keep a revisioned description, but are not reviewed.
const specCommands = new Set<string>([
  "createSuggestion",
  "updateSuggestion",
  "setSuggestionState",
  "setSuggestionReviewer",
  "decideSuggestion",
  "mergeSuggestion",
  "requestReview",
  "cancelReview",
  "decideReview",
]);

// Entities listed in every project-level scope (workItemId = null).
const projectLevel = new Set<Entity["type"]>([
  "project",
  "label",
  "milestone",
  "workItem",
  "relation",
  "externalLink",
]);
function projectOf(entity: Entity) {
  if (entity.type === "project") return entity.id;
  if ("projectId" in entity) return entity.projectId;
  return undefined;
}
// Diff two snapshots into change-log rows: changed entities become upserts and
// vanished ones become tombstones, in the same transaction as the writes.
export async function emitChanges(
  tx: Tx,
  organizationId: string,
  before: Entity[],
  after: Entity[],
  start: bigint,
  fallback?: { projectId: string; workItemId?: string },
) {
  let cursor = start;
  const old = new Map(before.map((e) => [entityKey(e), e]));
  const seen = new Set<string>();
  const route = (entity: Entity) => {
    const projectId = projectOf(entity) ?? fallback?.projectId;
    if (!projectId)
      throw new Error(`No sync scope for ${entity.type}:${entity.id}.`);
    return {
      projectId,
      workItemId: projectLevel.has(entity.type)
        ? null
        : (fallback?.workItemId ?? null),
    };
  };
  for (const entity of after) {
    const key = entityKey(entity);
    seen.add(key);
    const previous = old.get(key);
    if (previous && JSON.stringify(previous) === JSON.stringify(entity))
      continue;
    cursor++;
    await tx.insert(s.syncChange).values({
      organizationId,
      cursor,
      ...route(entity),
      change: { operation: "upsert", cursor: cursor.toString(), entity },
    });
  }
  for (const [key, entity] of old) {
    if (seen.has(key)) continue;
    cursor++;
    const change: Change = {
      operation: "delete",
      cursor: cursor.toString(),
      type: entity.type,
      id: entity.id,
    };
    await tx.insert(s.syncChange).values({
      organizationId,
      cursor,
      ...route(entity),
      change,
    });
  }
  return cursor;
}

// Scheduled job (Trigger.dev, cron route or the Bun worker): starts and
// completes automatic cycles. Idempotent; each organization commits
// separately under its lock with the same change-log guarantees as commands.
export async function advanceSchedules(db: Database, now = new Date()) {
  const teams = await automaticTeams(db);
  const byOrganization = new Map<string, string[]>();
  for (const t of teams)
    byOrganization.set(t.organizationId, [
      ...(byOrganization.get(t.organizationId) ?? []),
      t.teamId,
    ]);
  let changedOrganizations = 0;
  for (const [organizationId, teamIds] of byOrganization)
    await db.transaction(async (tx) => {
      await lock(tx, organizationId);
      const before = await snapshot(tx, { organizationId });
      let changed = false;
      for (const teamId of teamIds)
        changed =
          (await advanceTeamSchedule(tx, organizationId, teamId, now)) ||
          changed;
      if (!changed) return;
      changedOrganizations++;
      const after = await snapshot(tx, { organizationId });
      const cursor = await emitChanges(
        tx,
        organizationId,
        before,
        after,
        await clock(tx, organizationId),
      );
      await publish(tx, organizationId, cursor);
    });
  return { teams: teams.length, changedOrganizations };
}

export async function iterationReport(
  db: Database,
  userId: string,
  organizationId: string,
  iterationId: string,
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const it = requireValue(
      (
        await tx
          .select()
          .from(s.iteration)
          .where(
            and(
              eq(s.iteration.organizationId, organizationId),
              eq(s.iteration.id, iterationId),
            ),
          )
      )[0],
      "The iteration is unavailable.",
    );
    const { series, totals } = await iterationReportRows(
      tx,
      organizationId,
      it,
    );
    const history = await tx
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          eq(s.iteration.teamId, it.teamId),
          eq(s.iteration.state, "completed"),
        ),
      )
      .orderBy(desc(s.iteration.number))
      .limit(8);
    const tallyOf = (v: unknown) =>
      (v as { points?: number } | undefined)?.points ?? 0;
    return {
      iterationId,
      series,
      // A completed iteration reports what was frozen at completion.
      totals: (it.summary
        ? {
            atStart: it.summary.atStart,
            final: it.summary.final,
            completed: it.summary.completed,
            addedAfterStart: it.summary.addedAfterStart,
            removedAfterStart: it.summary.removedAfterStart,
          }
        : totals) as IterationReport["totals"],
      summary: (it.summary ?? null) as IterationReport["summary"],
      velocity: history.reverse().map((h) => ({
        iterationId: h.id,
        number: h.number,
        name: h.name,
        committed: tallyOf(h.summary?.atStart),
        completed: tallyOf(h.summary?.completed),
      })),
    } satisfies IterationReport;
  });
}

export async function publish(tx: Tx, organizationId: string, cursor: bigint) {
  await tx
    .insert(s.syncClock)
    .values({ organizationId, cursor })
    .onConflictDoUpdate({
      target: s.syncClock.organizationId,
      set: { cursor },
    });
  // PostgreSQL delivers NOTIFY only after COMMIT. It is an invalidation, never data.
  await tx.execute(
    sql`select pg_notify('lictory_sync', ${JSON.stringify({ organizationId, cursor: cursor.toString() })})`,
  );
}

// Clock, receipt and invalidation commit together with the domain writes.
async function commit(
  tx: Tx,
  organizationId: string,
  mutationId: string,
  userId: string,
  fingerprint: string,
  cursor: bigint,
) {
  await tx.insert(s.syncMutation).values({
    organizationId,
    id: mutationId,
    userId,
    fingerprint,
    cursor,
  });
  await publish(tx, organizationId, cursor);
  return {
    protocol: PROTOCOL,
    mutationId,
    cursor: cursor.toString(),
  };
}

const blankToNull = (value: string | null | undefined) =>
  value?.trim().length ? value.trim() : null;
// Roles live in the directory, which every sync response refreshes, so these
// writes emit no entity changes; the invalidation still wakes other clients.
async function applyRoleCommand(
  tx: Tx,
  organizationId: string,
  roster: Directory,
  c: RoleCommand,
) {
  const nameTaken = (name: string, exceptId?: string) =>
    roster.roles.some(
      (r) =>
        r.id !== exceptId &&
        !r.archivedAt &&
        r.name.toLowerCase() === name.toLowerCase(),
    );
  switch (c.type) {
    case "createRole":
      require(!nameTaken(
        c.name,
      ), `A role named “${c.name}” already exists.`, "validation");
      await tx.insert(s.organizationRole).values({
        id: c.roleId,
        organizationId,
        name: c.name,
        description: blankToNull(c.description),
        ...roleColumns(c.capabilities),
      });
      break;
    case "updateRole": {
      const role = requireValue(
        roster.roles.find((r) => r.id === c.roleId),
        "This role is unavailable.",
      );
      if (c.name !== undefined)
        require(!nameTaken(
          c.name,
          role.id,
        ), `A role named “${c.name}” already exists.`, "validation");
      if (c.archived === false)
        require(!nameTaken(
          c.name ?? role.name,
          role.id,
        ), `Rename the active role named “${c.name ?? role.name}” before restoring this one.`, "validation");
      await tx
        .update(s.organizationRole)
        .set({
          ...(c.name !== undefined ? { name: c.name } : {}),
          ...(c.description !== undefined
            ? { description: blankToNull(c.description) }
            : {}),
          ...(c.capabilities ? roleColumns(c.capabilities) : {}),
          ...(c.archived !== undefined
            ? { archivedAt: c.archived ? new Date() : null }
            : {}),
        })
        .where(
          and(
            eq(s.organizationRole.organizationId, organizationId),
            eq(s.organizationRole.id, c.roleId),
          ),
        );
      break;
    }
    case "setRoleMembership": {
      const role = requireValue(
        roster.roles.find((r) => r.id === c.roleId && !r.archivedAt),
        "This role is unavailable.",
      );
      requireValue(
        roster.members.find((m) => m.id === c.userId),
        "That person is not a member of this organization.",
      );
      if (c.member) {
        if (!role.userIds.includes(c.userId))
          await tx.insert(s.organizationRoleMember).values({
            organizationId,
            roleId: c.roleId,
            userId: c.userId,
          });
      } else
        await tx
          .delete(s.organizationRoleMember)
          .where(
            and(
              eq(s.organizationRoleMember.organizationId, organizationId),
              eq(s.organizationRoleMember.roleId, c.roleId),
              eq(s.organizationRoleMember.userId, c.userId),
            ),
          );
      break;
    }
  }
}
