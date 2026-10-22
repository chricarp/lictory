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
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  applicationRoleOf,
  canManageProject,
  canReviewSuggestions,
  capabilitiesOf,
  entityKey,
  entitySchema,
  isProjectConfigurationCommand,
  isTypeCommand,
  noCapabilities,
  type Capabilities,
  type Directory,
  type Discipline,
  type Entity,
  type EntityOf,
  type Mutation,
  type ReadinessCheck,
  type ReadinessRevision,
  type Scope,
  type Change,
  type Iteration,
  type IterationReport,
  type RefinementState,
  type StatusCategory,
  type WorkflowStatus,
  type WorkItemType,
} from "@lictory/core/contracts/protocol";
import { rankBetween } from "@lictory/core/contracts/rank";
import {
  checksFor,
  evaluateReadiness,
  type ReadinessCheckDefinition,
  type ReadinessImpact,
  type ReadinessRules,
  type ReadinessSignOff,
  sameReadinessChecks,
} from "@lictory/core/contracts/readiness";
import {
  applyProjectCommand,
  applyTypeCommand,
  normalizeReadinessRules,
  seedProject,
} from "@lictory/core/domain/projects";
import { auditConfiguration } from "@lictory/core/domain/audit";
import {
  applyBranchCommand,
  branchCommands,
  recordMain,
  pullRequestResultHash,
} from "@lictory/core/domain/branches";
import { notifyItemActivity } from "@lictory/core/notifications/server";
import {
  actionCheckProblem,
  aiCommands,
  aiConfigured,
  aiPolicy,
  aiRunEntities,
  aiRunEntity,
  applyAiCommand,
  invalidateItemReviews,
  runsById,
  scheduleActionRuns,
  setAiPolicy,
} from "@lictory/core/domain/ai";

export type Database = PostgresJsDatabase<typeof s>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
import { DomainError } from "@lictory/core/domain/errors";
import { logoUrl, type LogoKind } from "@lictory/core/branding/logo";
import {
  advanceProjectSchedule,
  automaticProjects,
  iterationReportRows,
} from "@lictory/core/domain/delivery";
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
  tx: Database | Tx,
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
  const [joined, logos] = await Promise.all([
    db
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
      ),
    db
      .select({
        organizationId: s.organizationLogo.organizationId,
        kind: s.organizationLogo.kind,
        sha256: s.organizationLogo.sha256,
      })
      .from(s.organizationLogo)
      .where(
        inArray(
          s.organizationLogo.organizationId,
          db
            .select({ id: s.member.organizationId })
            .from(s.member)
            .where(eq(s.member.userId, userId)),
        ),
      ),
  ]);
  const organizations = joined.map((o) => {
    const url = (kind: LogoKind) => {
      const logo = logos.find(
        (l) => l.organizationId === o.id && l.kind === kind,
      );
      return logo ? logoUrl(o.id, kind, logo.sha256) : null;
    };
    return { ...o, logos: { mark: url("mark"), full: url("full") } };
  });
  if (!organizationId)
    return {
      organizations,
      projects: [],
      members: [],
      projectMembers: [],
      disciplines: [],
      teams: [],
      types: [],
      projectTypes: [],
      statuses: [],
      iterations: [],
      delivery: { connections: [], targets: [] },
      readiness: [],
      ai: { enabled: false, available: aiConfigured() },
    };
  requireValue(
    organizations.find((o) => o.id === organizationId),
    "Organization access has been removed.",
    "forbidden",
  );
  // Independent reads are issued together; inside a transaction postgres.js
  // pipelines them on one connection, so the directory costs one round trip.
  const [
    projectRows,
    memberRows,
    projectMemberRows,
    disciplineMembers,
    disciplineRows,
    configurationRows,
    delivery,
    ai,
    readinessRows,
  ] = await Promise.all([
    db
      .select()
      .from(s.project)
      .where(eq(s.project.organizationId, organizationId))
      .orderBy(asc(s.project.createdAt)),
    db
      .select({
        id: s.user.id,
        name: s.user.name,
        image: s.user.image,
        email: s.user.email,
        handle: s.user.handle,
        memberId: s.member.id,
        rawRole: s.member.role,
      })
      .from(s.member)
      .innerJoin(s.user, eq(s.member.userId, s.user.id))
      .where(eq(s.member.organizationId, organizationId))
      .orderBy(asc(s.user.name), asc(s.user.email)),
    db
      .select()
      .from(s.projectMember)
      .where(eq(s.projectMember.organizationId, organizationId))
      .orderBy(asc(s.projectMember.createdAt)),
    db
      .select()
      .from(s.disciplineMember)
      .where(eq(s.disciplineMember.organizationId, organizationId)),
    db
      .select()
      .from(s.discipline)
      .where(eq(s.discipline.organizationId, organizationId))
      .orderBy(asc(s.discipline.createdAt)),
    deliveryDirectoryRows(db, organizationId),
    deliveryConfiguration(db, organizationId),
    aiPolicy(db, organizationId),
    db
      .selectDistinctOn([s.readinessRevision.projectId])
      .from(s.readinessRevision)
      .where(eq(s.readinessRevision.organizationId, organizationId))
      .orderBy(s.readinessRevision.projectId, desc(s.readinessRevision.number)),
  ]);
  const projects = projectRows.map((row) =>
    serialize("project", row),
  ) as Directory["projects"];
  const members = memberRows.map(({ rawRole, ...m }) => ({
    ...m,
    role: applicationRoleOf(rawRole),
    owner: rawRole.split(",").includes("owner"),
  }));
  const memberIds = new Set(members.map((m) => m.id));
  // Project and discipline memberships never outlive organization membership.
  const projectMembers = projectMemberRows
    .filter((m) => memberIds.has(m.userId))
    .map((m) => ({ projectId: m.projectId, userId: m.userId, role: m.role }));
  const projectMemberKeys = new Set(
    projectMembers.map((m) => `${m.projectId}:${m.userId}`),
  );
  // Archived disciplines stay in the directory so historical reviews keep
  // their name and an administrator can restore them; they grant nothing.
  const disciplines: Discipline[] = disciplineRows.map((d) => ({
    id: d.id,
    projectId: d.projectId,
    name: d.name,
    description: d.description,
    capabilities: {
      editSpecifications: d.canEditSpecifications,
      changeProperties: d.canChangeProperties,
      requestReviews: d.canRequestReviews,
      review: d.canReview,
      publishDelivery: d.canPublishDelivery,
    },
    userIds: disciplineMembers
      .filter(
        (m) =>
          m.disciplineId === d.id &&
          projectMemberKeys.has(`${d.projectId}:${m.userId}`),
      )
      .map((m) => m.userId)
      .sort(),
    archivedAt: d.archivedAt?.toISOString() ?? null,
  }));
  const configuration = deliveryDirectory(configurationRows, memberIds);
  const latestReadiness = new Map(readinessRows.map((r) => [r.projectId, r]));
  return {
    organizations,
    projects,
    members,
    projectMembers,
    disciplines,
    ...configuration,
    delivery,
    readiness: projects.map((p) =>
      readinessRevisionSummary(p.id, latestReadiness.get(p.id)),
    ),
    ai,
  };
}

// The wire shape of a readiness checks revision; no row means the defaults.
export function readinessRevisionSummary(
  projectId: string,
  row: typeof s.readinessRevision.$inferSelect | undefined,
): ReadinessRevision {
  return row
    ? {
        id: row.id,
        projectId,
        number: row.number,
        rules: row.rules,
        summary: row.summary,
        authorId: row.authorId,
        createdAt: row.createdAt.toISOString(),
      }
    : {
        id: null,
        projectId,
        number: 0,
        rules: {},
        summary: null,
        authorId: null,
        createdAt: null,
      };
}

// Connections and targets, never credentials.
async function deliveryConfiguration(
  db: Database | Tx,
  organizationId: string,
): Promise<Directory["delivery"]> {
  const [connections, targetRows] = await Promise.all([
    db
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
      .orderBy(asc(s.deliveryConnection.createdAt)),
    db
      .select({
        id: s.deliveryTarget.id,
        connectionId: s.deliveryTarget.connectionId,
        projectId: s.deliveryTarget.projectId,
        externalProjectId: s.deliveryTarget.externalProjectId,
        externalProjectKey: s.deliveryTarget.externalProjectKey,
        typeMapping: s.deliveryTarget.typeMapping,
      })
      .from(s.deliveryTarget)
      .where(eq(s.deliveryTarget.organizationId, organizationId))
      .orderBy(asc(s.deliveryTarget.createdAt)),
  ]);
  const active = new Set(connections.map((c) => c.id));
  const targets = targetRows.filter((t) => active.has(t.connectionId));
  return { connections, targets };
}

// Delivery configuration is small and read on every sync, like disciplines,
// so its commands need no entity changes: the refreshed directory carries them.
async function deliveryDirectoryRows(
  db: Database | Tx,
  organizationId: string,
) {
  const [
    teamRows,
    teamMembers,
    projectTypes,
    statuses,
    typeRows,
    iterationRows,
  ] = await Promise.all([
    db
      .select()
      .from(s.team)
      .where(eq(s.team.organizationId, organizationId))
      .orderBy(asc(s.team.createdAt), asc(s.team.name)),
    db
      .select()
      .from(s.teamMember)
      .where(eq(s.teamMember.organizationId, organizationId)),
    db
      .select({
        projectId: s.projectWorkItemType.projectId,
        typeId: s.projectWorkItemType.typeId,
      })
      .from(s.projectWorkItemType)
      .where(eq(s.projectWorkItemType.organizationId, organizationId))
      .orderBy(
        asc(s.projectWorkItemType.projectId),
        asc(s.projectWorkItemType.typeId),
      ),
    db
      .select()
      .from(s.workflowStatus)
      .where(eq(s.workflowStatus.organizationId, organizationId))
      .orderBy(asc(s.workflowStatus.position), asc(s.workflowStatus.createdAt)),
    db
      .select()
      .from(s.workItemType)
      .where(eq(s.workItemType.organizationId, organizationId))
      .orderBy(asc(s.workItemType.position), asc(s.workItemType.createdAt)),
    // Completed iterations are bounded to the most recent per project; reports
    // for older ones are fetched on demand.
    db
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          or(
            sql`${s.iteration.state} <> 'completed'`,
            sql`${s.iteration.number} > (select coalesce(max(i2.number), 0) - 12 from ${s.iteration} i2 where i2.organization_id = ${s.iteration.organizationId} and i2.project_id = ${s.iteration.projectId} and i2.state = 'completed')`,
          ),
        ),
      )
      .orderBy(asc(s.iteration.projectId), asc(s.iteration.number)),
  ]);
  return {
    teamRows,
    teamMembers,
    projectTypes,
    statuses,
    typeRows,
    iterationRows,
  };
}

function deliveryDirectory(
  {
    teamRows,
    teamMembers,
    projectTypes,
    statuses,
    typeRows,
    iterationRows,
  }: Awaited<ReturnType<typeof deliveryDirectoryRows>>,
  memberIds: Set<string>,
) {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    teams: teamRows.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      description: t.description,
      memberIds: teamMembers
        .filter((m) => m.teamId === t.id && memberIds.has(m.userId))
        .map((m) => m.userId)
        .sort(),
      archivedAt: iso(t.archivedAt),
    })),
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
    projectTypes,
    statuses: statuses.map((x) => ({
      id: x.id,
      projectId: x.projectId,
      name: x.name,
      color: x.color as WorkflowStatus["color"],
      category: x.category,
      position: x.position,
      archivedAt: iso(x.archivedAt),
    })) satisfies WorkflowStatus[],
    iterations: iterationRows.map((i) => ({
      id: i.id,
      projectId: i.projectId,
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
// Capability failures name the missing capability so a project administrator
// knows which discipline to adjust, rather than a generic "not allowed".
const capabilityMessages: Record<keyof Capabilities, string> = {
  editSpecifications:
    "Your disciplines in this project cannot edit specifications directly. Create a branch and pull request instead.",
  changeProperties:
    "Your disciplines in this project cannot change item properties such as status, priority, owner, labels or milestones.",
  requestReviews:
    "Your disciplines in this project cannot request or cancel reviews.",
  review: "Your disciplines in this project cannot be asked to review.",
  publishDelivery:
    "Your disciplines in this project cannot hand work off to external delivery tools. Ask a project administrator to grant “Hand off to delivery tools”.",
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
      image: s.user.image,
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
type ReadinessRevisionRow = typeof s.readinessRevision.$inferSelect;
type SignOffRow = Omit<ReadinessSignOff, "createdAt"> & {
  workItemId: string;
  createdAt: Date;
};

// Everything a list, inbox or readiness evaluation needs about a set of items.
// Lists and readiness need only each item's current revision; the full history
// (with its content) is loaded only for `historyFor`, the item being opened.
async function loadItemContext(
  tx: Tx,
  organizationId: string,
  items: ItemRow[],
  historyFor?: string,
) {
  const ids = items.map((i) => i.id);
  const [typeRows, categoryRows, readinessRows, disciplineRows] =
    await Promise.all([
      tx
        .select()
        .from(s.workItemType)
        .where(eq(s.workItemType.organizationId, organizationId)),
      tx
        .select({
          id: s.workflowStatus.id,
          category: s.workflowStatus.category,
        })
        .from(s.workflowStatus)
        .where(eq(s.workflowStatus.organizationId, organizationId)),
      // Readiness revisions are few per project: latest ones and those
      // pinned items keep are both needed.
      tx
        .select()
        .from(s.readinessRevision)
        .where(eq(s.readinessRevision.organizationId, organizationId)),
      tx
        .select({ id: s.discipline.id, name: s.discipline.name })
        .from(s.discipline)
        .where(eq(s.discipline.organizationId, organizationId)),
    ]);
  const types = new Map(typeRows.map((t) => [t.id, t]));
  const categories = new Map(categoryRows.map((x) => [x.id, x.category]));
  const readinessRevisions = new Map(readinessRows.map((r) => [r.id, r]));
  const latestReadiness = new Map<string, ReadinessRevisionRow>();
  for (const r of readinessRows)
    if ((latestReadiness.get(r.projectId)?.number ?? 0) < r.number)
      latestReadiness.set(r.projectId, r);
  const disciplineNames = new Map(disciplineRows.map((d) => [d.id, d.name]));
  const configuration = {
    types,
    categories,
    readinessRevisions,
    latestReadiness,
    disciplineNames,
  };
  if (ids.length === 0)
    return indexItemContext({
      ...configuration,
      revisions: new Map<string, RevisionRow[]>(),
      threads: [] as ThreadRow[],
      suggestions: [] as SuggestionRow[],
      suggestionReviewers: [] as SuggestionReviewerRow[],
      suggestionDecisions: [] as SuggestionDecisionRow[],
      reviews: [] as ReviewRow[],
      assignments: [] as AssignmentRow[],
      approvals: [] as ApprovalRow[],
      labels: [] as (typeof s.workItemLabel.$inferSelect)[],
      signOffs: [] as SignOffRow[],
    });
  const where = (t: { organizationId: AnyPgColumn; workItemId: AnyPgColumn }) =>
    and(eq(t.organizationId, organizationId), inArray(t.workItemId, ids));
  const revisionColumns = {
    id: s.specificationRevision.id,
    organizationId: s.specificationRevision.organizationId,
    workItemId: s.specificationRevision.workItemId,
    number: s.specificationRevision.number,
    title: s.specificationRevision.title,
    content: s.specificationRevision.content,
    changeSummary: s.specificationRevision.changeSummary,
    authorId: s.specificationRevision.authorId,
    createdAt: s.specificationRevision.createdAt,
  };
  const [
    currentRevisions,
    history,
    threads,
    suggestions,
    suggestionReviewers,
    suggestionDecisions,
    reviews,
    assignments,
    approvals,
    labels,
    signOffs,
  ] = await Promise.all([
    tx
      .selectDistinctOn([s.specificationRevision.workItemId], revisionColumns)
      .from(s.specificationRevision)
      .where(where(s.specificationRevision))
      .orderBy(
        s.specificationRevision.workItemId,
        desc(s.specificationRevision.number),
      ),
    historyFor && ids.includes(historyFor)
      ? tx
          .select(revisionColumns)
          .from(s.specificationRevision)
          .where(
            and(
              eq(s.specificationRevision.organizationId, organizationId),
              eq(s.specificationRevision.workItemId, historyFor),
            ),
          )
          .orderBy(desc(s.specificationRevision.number))
      : Promise.resolve([] as RevisionRow[]),
    tx.select().from(s.thread).where(where(s.thread)),
    tx.select().from(s.suggestion).where(where(s.suggestion)),
    tx.select().from(s.suggestionReviewer).where(where(s.suggestionReviewer)),
    tx.select().from(s.suggestionDecision).where(where(s.suggestionDecision)),
    tx.select().from(s.review).where(where(s.review)),
    tx
      .select()
      .from(s.reviewAssignment)
      .where(
        and(
          eq(s.reviewAssignment.organizationId, organizationId),
          inArray(
            s.reviewAssignment.reviewId,
            tx
              .select({ id: s.review.id })
              .from(s.review)
              .where(where(s.review)),
          ),
        ),
      ),
    tx.select().from(s.approval).where(where(s.approval)),
    tx.select().from(s.workItemLabel).where(where(s.workItemLabel)),
    tx
      .select({
        workItemId: s.readinessSignOff.workItemId,
        checkId: s.readinessSignOff.checkId,
        userId: s.readinessSignOff.userId,
        revisionId: s.readinessSignOff.revisionId,
        revisionNumber: s.specificationRevision.number,
        createdAt: s.readinessSignOff.createdAt,
      })
      .from(s.readinessSignOff)
      .innerJoin(
        s.specificationRevision,
        and(
          eq(
            s.specificationRevision.organizationId,
            s.readinessSignOff.organizationId,
          ),
          eq(s.specificationRevision.id, s.readinessSignOff.revisionId),
        ),
      )
      .where(
        and(where(s.readinessSignOff), isNull(s.readinessSignOff.withdrawnAt)),
      )
      .orderBy(asc(s.readinessSignOff.createdAt)),
  ]);
  const revisions = new Map<string, RevisionRow[]>();
  for (const r of currentRevisions) revisions.set(r.workItemId, [r]);
  if (history.length) revisions.set(historyFor!, history);
  return indexItemContext({
    ...configuration,
    revisions,
    threads,
    suggestions,
    suggestionReviewers,
    suggestionDecisions,
    reviews,
    assignments,
    approvals,
    labels,
    signOffs,
  });
}
function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}
// Lookups built once per context so summaries stay linear in the item count.
function indexItemContext<
  T extends {
    threads: ThreadRow[];
    suggestions: SuggestionRow[];
    suggestionReviewers: SuggestionReviewerRow[];
    suggestionDecisions: SuggestionDecisionRow[];
    reviews: ReviewRow[];
    assignments: AssignmentRow[];
    approvals: ApprovalRow[];
    labels: (typeof s.workItemLabel.$inferSelect)[];
    signOffs: SignOffRow[];
  },
>(ctx: T) {
  // Latest active sign-off of each manual check, per item.
  const signOffsByItem = new Map<string, Map<string, ReadinessSignOff>>();
  for (const row of ctx.signOffs) {
    const checks =
      signOffsByItem.get(row.workItemId) ?? new Map<string, ReadinessSignOff>();
    checks.set(row.checkId, {
      checkId: row.checkId,
      userId: row.userId,
      revisionId: row.revisionId,
      revisionNumber: row.revisionNumber,
      createdAt: row.createdAt.toISOString(),
    });
    signOffsByItem.set(row.workItemId, checks);
  }
  return {
    ...ctx,
    signOffsByItem,
    threadsByItem: groupBy(ctx.threads, (t) => t.workItemId),
    suggestionsByItem: groupBy(ctx.suggestions, (x) => x.workItemId),
    reviewersBySuggestion: groupBy(
      ctx.suggestionReviewers,
      (r) => r.suggestionId,
    ),
    approvedSuggestionVersions: new Set(
      ctx.suggestionDecisions
        .filter((d) => d.decision === "approved" && !d.supersededAt)
        .map((d) => `${d.suggestionId}:${d.reviewerId}:${d.version}`),
    ),
    reviewsByItem: groupBy(ctx.reviews, (r) => r.workItemId),
    assignmentsByReview: groupBy(ctx.assignments, (a) => a.reviewId),
    approvalsByReview: groupBy(ctx.approvals, (a) => a.reviewId),
    labelsByItem: groupBy(ctx.labels, (l) => l.workItemId),
    children: new WeakMap<ItemRow[], Map<string, ItemRow[]>>(),
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
  let byParent = ctx.children.get(all);
  if (!byParent) {
    byParent = groupBy(
      all.filter(
        (c) =>
          c.parentId !== null &&
          !c.archivedAt &&
          ctx.categories.get(c.statusId) !== "canceled",
      ),
      (c) => c.parentId!,
    );
    ctx.children.set(all, byParent);
  }
  return byParent.get(item.id) ?? [];
}

// Reviewers of open suggestions still waiting to approve the current version.
function pendingSuggestionReviewers(itemId: string, ctx: ItemContext) {
  const ids = new Set<string>();
  for (const x of ctx.suggestionsByItem.get(itemId) ?? [])
    if (x.status === "open")
      for (const r of ctx.reviewersBySuggestion.get(x.id) ?? [])
        if (
          !r.withdrawnAt &&
          !ctx.approvedSuggestionVersions.has(
            `${x.id}:${r.userId}:${x.version}`,
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
  const threads = (ctx.threadsByItem.get(item.id) ?? []).filter(
    (t) => !t.suggestionId && !t.pullRequestId,
  );
  const reviews = (ctx.reviewsByItem.get(item.id) ?? []).filter(
    (r) => r.status !== "cancelled" && r.revisionId === current?.id,
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
    mainProtected: item.mainProtected,
    priority: item.priority,
    assigneeId: item.assigneeId,
    milestoneId: item.milestoneId,
    iterationId: item.iterationId,
    estimate: item.estimate,
    labelIds: (ctx.labelsByItem.get(item.id) ?? [])
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
    openSuggestions: (ctx.suggestionsByItem.get(item.id) ?? []).filter(
      (x) => x.status === "open",
    ).length,
    suggestionReviewerIds: pendingSuggestionReviewers(item.id, ctx),
    reviews: reviews.map((r) => ({
      id: r.id,
      responsibility: r.responsibility,
      status: r.status,
      required: r.required,
      assigneeIds: (ctx.assignmentsByReview.get(r.id) ?? [])
        .filter((a) => !a.withdrawnAt)
        .map((a) => a.userId ?? a.disciplineId!)
        .filter(Boolean),
      approved: (ctx.approvalsByReview.get(r.id) ?? []).some(
        (a) => a.status === "granted",
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

// The checks an item is evaluated under: the revision it is pinned to (it was
// ready or done when newer checks were published), else the project's latest,
// else Lictory's defaults.
function readinessPolicy(item: ItemRow, ctx: ItemContext) {
  const pinned = item.readinessRevisionId
    ? ctx.readinessRevisions.get(item.readinessRevisionId)
    : undefined;
  const revision = pinned ?? ctx.latestReadiness.get(item.projectId);
  return {
    revisionId: revision?.id ?? null,
    number: revision?.number ?? 0,
    pinned: Boolean(pinned),
    checks: checksFor(revision?.rules ?? {}, item.typeId),
  };
}

function readiness(
  item: ItemRow,
  all: ItemRow[],
  ctx: ItemContext,
  definitions?: ReadinessCheckDefinition[],
): ReadinessCheck[] {
  // Readiness is evidence about a specification; plain work has none.
  if (!isSpecBacked(item, ctx)) return [];
  const current = ctx.revisions.get(item.id)?.[0];
  const threads = (ctx.threadsByItem.get(item.id) ?? []).filter(
    (t) => !t.suggestionId && !t.pullRequestId,
  );
  const reviews = (ctx.reviewsByItem.get(item.id) ?? []).filter(
    (r) => r.status !== "cancelled",
  );
  const approvedOnCurrent = (r: ReviewRow) =>
    r.revisionId === current?.id &&
    r.status === "completed" &&
    (ctx.approvalsByReview.get(r.id) ?? []).some(
      (a) => a.status === "granted" && a.revisionId === current?.id,
    );
  const responsibilities = [
    ...new Set(reviews.filter((r) => r.required).map((r) => r.responsibility)),
  ];
  const missing = responsibilities.filter((responsibility) => {
    const candidates = reviews.filter(
      (r) =>
        r.required &&
        r.revisionId === current?.id &&
        r.responsibility === responsibility,
    );
    return candidates.length === 0 || !candidates.every(approvedOnCurrent);
  });
  // Only spec-backed children carry readiness; plain tasks never block it.
  const children = activeChildren(item, all, ctx).filter((c) =>
    isSpecBacked(c, ctx),
  );
  return evaluateReadiness(definitions ?? readinessPolicy(item, ctx).checks, {
    content: current?.content ?? "",
    revisionId: current?.id ?? null,
    revisionNumber: current?.number ?? null,
    blockingThreads: threads.filter((t) => t.status === "open" && t.blocking)
      .length,
    requiredResponsibilities: responsibilities,
    missingResponsibilities: missing,
    approvedResponsibilities: [
      ...new Set(
        reviews.filter(approvedOnCurrent).map((r) => r.responsibility),
      ),
    ],
    disciplineNames: ctx.disciplineNames,
    childSpecifications: children.length,
    childSpecificationsNotReady: children.filter(
      (c) => c.refinementState !== "ready",
    ).length,
    signOffs:
      ctx.signOffsByItem.get(item.id) ?? new Map<string, ReadinessSignOff>(),
  });
}

function readinessEntity(
  item: ItemRow,
  all: ItemRow[],
  ctx: ItemContext,
): EntityOf<"readiness"> {
  const policy = readinessPolicy(item, ctx);
  return {
    type: "readiness",
    id: item.id,
    organizationId: item.organizationId,
    workItemId: item.id,
    checks: readiness(item, all, ctx),
    policyRevisionId: policy.revisionId,
    policyRevisionNumber: policy.number,
    pinned: policy.pinned,
  };
}

export async function snapshot(tx: Tx, scope: Scope): Promise<Entity[]> {
  const { organizationId, projectId, workItemId } = scope;
  const projectFilter = <
    T extends { organizationId: AnyPgColumn; projectId: AnyPgColumn },
  >(
    t: T,
  ) =>
    and(
      eq(t.organizationId, organizationId),
      projectId ? eq(t.projectId, projectId) : undefined,
    );
  // Pull requests, their reviews and relations are read only for items in scope.
  const scopeItemIds = () =>
    tx
      .select({ id: s.workItem.id })
      .from(s.workItem)
      .where(projectFilter(s.workItem));
  const scopePullRequests = () =>
    and(
      eq(s.specificationPullRequest.organizationId, organizationId),
      isNull(s.specificationPullRequest.deletedAt),
      projectId
        ? inArray(s.specificationPullRequest.workItemId, scopeItemIds())
        : undefined,
    );
  const [
    projects,
    items,
    pullRequests,
    prReviews,
    labels,
    milestones,
    relationRows,
    links,
  ] = await Promise.all([
    tx
      .select()
      .from(s.project)
      .where(
        and(
          eq(s.project.organizationId, organizationId),
          projectId ? eq(s.project.id, projectId) : undefined,
        ),
      ),
    tx
      .select()
      .from(s.workItem)
      .where(projectFilter(s.workItem))
      .orderBy(asc(s.workItem.createdAt)),
    tx.select().from(s.specificationPullRequest).where(scopePullRequests()),
    tx
      .select()
      .from(s.pullRequestReview)
      .where(
        and(
          eq(s.pullRequestReview.organizationId, organizationId),
          inArray(
            s.pullRequestReview.pullRequestId,
            tx
              .select({ id: s.specificationPullRequest.id })
              .from(s.specificationPullRequest)
              .where(scopePullRequests()),
          ),
        ),
      ),
    tx.select().from(s.label).where(projectFilter(s.label)),
    tx.select().from(s.milestone).where(projectFilter(s.milestone)),
    tx
      .select()
      .from(s.workItemRelation)
      .where(
        and(
          eq(s.workItemRelation.organizationId, organizationId),
          projectId
            ? inArray(s.workItemRelation.fromId, scopeItemIds())
            : undefined,
        ),
      )
      .orderBy(asc(s.workItemRelation.createdAt)),
    externalLinks(tx, organizationId, { projectId }),
  ]);
  if (projectId) requireValue(projects[0]);
  // Result hashes need the commit graph of items with an open pull request.
  const openPrItemIds = [
    ...new Set(
      pullRequests.filter((p) => p.status === "open").map((p) => p.workItemId),
    ),
  ];
  const [ctx, prBranches, prCommits, disciplineMemberships] = await Promise.all(
    [
      loadItemContext(tx, organizationId, items, workItemId),
      openPrItemIds.length
        ? tx
            .select()
            .from(s.specificationBranch)
            .where(
              and(
                eq(s.specificationBranch.organizationId, organizationId),
                inArray(s.specificationBranch.workItemId, openPrItemIds),
                isNull(s.specificationBranch.deletedAt),
              ),
            )
        : Promise.resolve([]),
      openPrItemIds.length
        ? tx
            .select()
            .from(s.specificationCommit)
            .where(
              and(
                eq(s.specificationCommit.organizationId, organizationId),
                inArray(s.specificationCommit.workItemId, openPrItemIds),
              ),
            )
        : Promise.resolve([]),
      prReviews.length
        ? tx
            .select()
            .from(s.disciplineMember)
            .where(eq(s.disciplineMember.organizationId, organizationId))
        : Promise.resolve([]),
    ],
  );
  const itemProject = new Map(items.map((i) => [i.id, i.projectId]));
  const relations = relationRows.filter((r) => itemProject.has(r.fromId));
  const openPullRequests = groupBy(
    pullRequests.filter((p) => p.status === "open"),
    (p) => p.workItemId,
  );
  const reviewsByPullRequest = groupBy(prReviews, (r) => r.pullRequestId);
  const membersByDiscipline = groupBy(
    disciplineMemberships,
    (m) => m.disciplineId,
  );
  const resultHashes = new Map<string, string | null>();
  const resultHash = (pr: (typeof pullRequests)[number]) => {
    if (!resultHashes.has(pr.id))
      resultHashes.set(pr.id, pullRequestResultHash(pr, prBranches, prCommits));
    return resultHashes.get(pr.id);
  };
  const entities: Entity[] = [
    ...projects.map((p) => serialize("project", p)),
    ...labels.map((l) => serialize("label", l)),
    ...milestones.map((m) => serialize("milestone", m)),
    ...items.map((item) => {
      const summary = summarize(item, items, ctx);
      const active = openPullRequests.get(item.id) ?? [];
      return {
        ...summary,
        openSuggestions: summary.openSuggestions + active.length,
        suggestionReviewerIds: [
          ...new Set([
            ...summary.suggestionReviewerIds,
            ...active
              .flatMap((pr) =>
                (reviewsByPullRequest.get(pr.id) ?? []).filter(
                  (r) =>
                    r.decision !== "approved" ||
                    r.resultHash !== resultHash(pr),
                ),
              )
              .flatMap((r) =>
                r.userId
                  ? [r.userId]
                  : (membersByDiscipline.get(r.disciplineId) ?? []).map(
                      (m) => m.userId,
                    ),
              ),
          ]),
        ],
      };
    }),
    ...relations.map((r) =>
      serialize("relation", { ...r, projectId: itemProject.get(r.fromId) }),
    ),
    ...links,
  ];
  if (!workItemId) return entities;
  const item = requireValue(items.find((p) => p.id === workItemId));
  const revisions = ctx.revisions.get(workItemId) ?? [];
  const activePrIds = new Set(
    pullRequests.filter((p) => p.workItemId === workItemId).map((p) => p.id),
  );
  const threads = ctx.threads.filter(
    (t) =>
      t.workItemId === workItemId &&
      (!t.pullRequestId || activePrIds.has(t.pullRequestId)),
  );
  const [branchRows, commitRows, messages, activity, runs] = await Promise.all([
    tx
      .select()
      .from(s.specificationBranch)
      .where(
        and(
          eq(s.specificationBranch.organizationId, organizationId),
          eq(s.specificationBranch.workItemId, workItemId),
          isNull(s.specificationBranch.deletedAt),
        ),
      ),
    tx
      .select()
      .from(s.specificationCommit)
      .where(
        and(
          eq(s.specificationCommit.organizationId, organizationId),
          eq(s.specificationCommit.workItemId, workItemId),
        ),
      ),
    threads.length
      ? tx
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
      : Promise.resolve([]),
    tx
      .select()
      .from(s.activity)
      .where(
        and(
          eq(s.activity.organizationId, organizationId),
          eq(s.activity.workItemId, workItemId),
        ),
      )
      .orderBy(asc(s.activity.createdAt)),
    aiRunEntities(tx, organizationId, workItemId),
  ]);
  const reviews = ctx.reviews.filter((r) => r.workItemId === workItemId);
  const reviewIds = new Set(reviews.map((r) => r.id));
  for (const [type, rows] of [
    ["revision", revisions],
    ["specBranch", branchRows],
    ["specCommit", commitRows],
    ["pullRequest", pullRequests.filter((p) => p.workItemId === workItemId)],
    ["prReview", prReviews.filter((r) => activePrIds.has(r.pullRequestId))],
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
  entities.push(readinessEntity(item, items, ctx));
  entities.push(...runs);
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
        externalStatusCategory: link.externalStatusCategory,
        externalAssignee: link.externalAssignee,
        status: link.status,
        publishedRevisionId: link.publishedRevisionId,
        publishedRevisionNumber: revisionNumber ?? null,
        lastError: link.lastError,
        syncedAt: link.syncedAt?.toISOString() ?? null,
      }) as EntityOf<"externalLink">,
  );
}

const preReadyStates: RefinementState[] = ["draft", "refinement", "in_review"];

// Readiness projections of a project's spec-backed items.
async function projectReadiness(
  tx: Tx,
  organizationId: string,
  projectId: string,
) {
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
  return new Map(
    rows
      .filter((row) => isSpecBacked(row, ctx))
      .map((row) => [row.id, readinessEntity(row, rows, ctx)]),
  );
}

// After new readiness checks are published, items that follow them move with
// their evidence: those that now pass become ready, those that no longer pass
// leave ready. A child's readiness feeds its parent's, so this repeats until
// nothing moves. Returns the item-scope changes to emit.
async function followReadinessChecks(
  tx: Tx,
  organizationId: string,
  projectId: string,
  userId: string,
  before: Map<string, EntityOf<"readiness">>,
) {
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
  const moved = new Map<
    string,
    { from: RefinementState; to: RefinementState }
  >();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const row of rows) {
      const state = row.refinementState;
      if (row.archivedAt || !state || !isSpecBacked(row, ctx)) continue;
      const checks = readiness(row, rows, ctx);
      const ready = checks.length > 0 && checks.every((check) => check.passed);
      const next: RefinementState | undefined =
        ready && preReadyStates.includes(state)
          ? "ready"
          : !ready && state === "ready"
            ? "in_review"
            : undefined;
      if (!next) continue;
      moved.set(row.id, { from: moved.get(row.id)?.from ?? state, to: next });
      // Rows are shared with the context, so parents see the new state.
      row.refinementState = next;
      changed = true;
    }
    if (!changed) break;
  }
  const now = new Date();
  const revision = ctx.latestReadiness.get(projectId)?.number ?? 0;
  const activities: (typeof s.activity.$inferInsert)[] = [];
  for (const [workItemId, { from, to }] of moved) {
    if (from === to) continue;
    await tx
      .update(s.workItem)
      .set({
        refinementState: to,
        ...(to === "ready" ? { mainProtected: true } : {}),
      })
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.id, workItemId),
        ),
      );
    activities.push({
      id: crypto.randomUUID(),
      organizationId,
      projectId,
      workItemId,
      actorId: userId,
      action: "refinement_changed",
      detail: {
        from,
        to,
        automatic: true,
        reason: "readiness_checks_published",
        readinessRevision: revision,
      },
      createdAt: now,
    });
  }
  const inserted = activities.length
    ? await tx.insert(s.activity).values(activities).returning()
    : [];
  const changes: { workItemId: string; entity: Entity }[] = [];
  for (const row of rows) {
    if (!isSpecBacked(row, ctx)) continue;
    const entity = readinessEntity(row, rows, ctx);
    if (JSON.stringify(entity) !== JSON.stringify(before.get(row.id)))
      changes.push({ workItemId: row.id, entity });
  }
  for (const row of inserted)
    changes.push({
      workItemId: row.workItemId,
      entity: serialize("activity", row),
    });
  return changes;
}

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
      // Reads take no organization lock. Writers commit the clock together
      // with their change rows while holding the lock, so commits become
      // visible in cursor order; one REPEATABLE READ snapshot therefore sees
      // a gap-free prefix of the change log that matches the clock it reads.
      return db.transaction(
        async (tx) => {
          const [, head, roster, scopedItem] = await Promise.all([
            authorize(tx, userId, scope.organizationId),
            clock(tx, scope.organizationId),
            directory(tx, userId, scope.organizationId),
            scope.workItemId && scope.projectId
              ? tx
                  .select({ id: s.workItem.id })
                  .from(s.workItem)
                  .where(
                    and(
                      eq(s.workItem.organizationId, scope.organizationId),
                      eq(s.workItem.projectId, scope.projectId),
                      eq(s.workItem.id, scope.workItemId),
                    ),
                  )
              : Promise.resolve([]),
          ]);
          if (cursor !== undefined && BigInt(cursor) > head)
            throw new DomainError(
              "conflict",
              "Checkpoint is ahead of the server. Reset this workspace cache.",
            );
          if (scope.projectId !== undefined)
            requireValue(roster.projects.find((p) => p.id === scope.projectId));
          if (scope.workItemId && scope.projectId) requireValue(scopedItem[0]);
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
                lte(s.syncChange.cursor, head),
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
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
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
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(c))
          .digest("hex");
        const [membership, receipts, roster] = await Promise.all([
          authorize(tx, userId, organizationId),
          tx
            .select()
            .from(s.syncMutation)
            .where(
              and(
                eq(s.syncMutation.organizationId, organizationId),
                eq(s.syncMutation.id, mutation.id),
              ),
            ),
          directory(tx, userId, organizationId),
        ]);
        const previous = receipts[0];
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
        if (isTypeCommand(c)) {
          await applyTypeCommand(
            tx,
            { organizationId, userId, admin, roster },
            c,
          );
          return commit(
            tx,
            organizationId,
            mutation.id,
            userId,
            fingerprint,
            await clock(tx, organizationId),
          );
        }
        if (c.type === "setAiPolicy") {
          require(admin, "An organization administrator must decide whether Lictory Intelligence may be used.");
          await setAiPolicy(tx, organizationId, userId, c.enabled);
          return commit(
            tx,
            organizationId,
            mutation.id,
            userId,
            fingerprint,
            await clock(tx, organizationId),
          );
        }
        if (isProjectConfigurationCommand(c)) {
          // Configuration lives in the directory; commands that also move
          // items (status replacement, iteration carry-over, automatic
          // cycles) or change the project emit those entities.
          const scope = { organizationId, projectId: c.projectId };
          requireValue(
            roster.projects.find((p) => p.id === c.projectId),
            "This project is unavailable.",
          );
          const readinessBefore =
            c.type === "publishReadinessChecks"
              ? await projectReadiness(tx, organizationId, c.projectId)
              : undefined;
          const before = await snapshot(tx, scope);
          await applyProjectCommand(
            tx,
            {
              organizationId,
              userId,
              admin,
              capabilities: capabilitiesOf(
                roster.disciplines,
                userId,
                c.projectId,
              ),
              roster,
            },
            c,
          );
          // Readiness and activity live in each item's own scope.
          const itemChanges = readinessBefore
            ? await followReadinessChecks(
                tx,
                organizationId,
                c.projectId,
                userId,
                readinessBefore,
              )
            : [];
          const after = await snapshot(tx, scope);
          snapshots = { before, after, directory: roster };
          let cursor = await emitChanges(
            tx,
            organizationId,
            before,
            after,
            await clock(tx, organizationId),
          );
          const rows: (typeof s.syncChange.$inferInsert)[] = [];
          for (const { workItemId, entity } of itemChanges) {
            cursor++;
            rows.push({
              organizationId,
              cursor,
              projectId: c.projectId,
              workItemId,
              change: {
                operation: "upsert",
                cursor: cursor.toString(),
                entity,
              },
            });
          }
          await insertChanges(tx, rows);
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
          if (
            (specCommands.has(c.type) ||
              branchCommands.has(c.type) ||
              aiCommands.has(c.type)) &&
            !itemType?.hasSpecification
          )
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
        // Work item capabilities come from the disciplines held in this
        // project; organization administration grants none of them.
        const capabilities =
          c.type === "createProject"
            ? noCapabilities
            : capabilitiesOf(roster.disciplines, userId, projectId);
        const projectManager =
          c.type !== "createProject" &&
          canManageProject(roster, userId, admin, projectId);
        const project = () =>
          requireValue(
            roster.projects.find((p) => p.id === projectId),
            "This project is unavailable.",
          );
        const projectStatuses = () =>
          roster.statuses.filter((x) => x.projectId === projectId);
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
        if (
          "baseRevisionId" in c &&
          !(c.type === "createThread" && c.pullRequestId) &&
          c.baseRevisionId !== latest?.id
        )
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
        // Lictory Intelligence runs owned by other items (an Epic review
        // covering this Story) whose projection this command changed.
        const touchedRuns = new Set<string>();
        const revision = async (
          title: string,
          content: string,
          summary: string | undefined,
          previous = latest,
          mergeParents?: string[],
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
          await recordMain(
            tx,
            {
              id: revisionId,
              organizationId,
              workItemId: workItemId!,
              number,
              title,
              content,
              changeSummary: summary,
              authorId: userId,
            },
            mergeParents,
          );
          await tx
            .update(s.workItem)
            .set({ title })
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.id, workItemId!),
              ),
            );
          for (const run of await invalidateItemReviews(
            tx,
            organizationId,
            workItemId!,
            `${projectRow?.key ?? "Item"}-${item?.number ?? ""} changed to revision ${number}`,
          ))
            if (run.workItemId !== workItemId) touchedRuns.add(run.id);
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
                    disciplineId: t.disciplineId,
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
            roster.teams.find(
              (t) =>
                t.id === teamId && !t.archivedAt && t.projectId === projectId,
            ),
            "The team is unavailable in this project.",
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
        const openIteration = (iterationId: string) => {
          const found = requireValue(
            roster.iterations.find(
              (i) => i.id === iterationId && i.projectId === projectId,
            ),
            "The iteration is unavailable in this project.",
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
            .set({
              refinementState: state,
              ...(state === "ready" ? { mainProtected: true } : {}),
            })
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.id, workItemId!),
              ),
            );
          log("refinement_changed", { from, to: state, automatic });
        };
        if (branchCommands.has(c.type)) {
          await applyBranchCommand(tx, c, {
            organizationId,
            projectId,
            workItemId: workItemId!,
            userId,
            capabilities,
            roster,
            latest: latest!,
            revision: (title, content, summary, parents) =>
              revision(title, content, summary, latest, parents),
            log,
            actionCheck: (pullRequestId, sourceHeadId) =>
              roster.ai.enabled &&
              roster.ai.available &&
              project().aiActionPolicy === "required"
                ? actionCheckProblem(
                    tx,
                    organizationId,
                    pullRequestId,
                    sourceHeadId,
                  )
                : Promise.resolve(undefined),
          });
        }
        if (aiCommands.has(c.type))
          await applyAiCommand(tx, c, {
            organizationId,
            projectId,
            workItemId: workItemId!,
            userId,
            capabilities,
            roster,
            latest: latest!,
            itemKey: `${projectRow!.key}-${item!.number}`,
            log,
            touched: touchedRuns,
          });
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
              if (c.setup.aiEnabled !== undefined)
                await setAiPolicy(
                  tx,
                  organizationId,
                  userId,
                  c.setup.aiEnabled,
                );
            }
            await tx.insert(s.project).values({
              id: projectId,
              organizationId,
              name: c.name,
              slug: c.key.toLowerCase(),
              key: c.key,
              description: c.description?.trim() ? c.description.trim() : null,
              createdById: userId,
              ...(c.setup
                ? {
                    deliveryMode: c.setup.deliveryMode,
                    readinessPolicy: c.setup.readinessPolicy,
                    estimateScale: c.setup.estimateScale,
                    iterationMode: c.setup.iterationMode,
                    iterationWeeks: c.setup.iterationWeeks,
                    iterationStartDay: c.setup.iterationStartDay,
                  }
                : {}),
            });
            await seedProject(tx, organizationId, projectId, userId);
            if (c.setup) {
              await tx.insert(s.organizationOnboarding).values({
                organizationId,
                projectId,
                decidedById: userId,
                decisions: c.setup,
              });
              if (c.setup.iterationMode === "automatic")
                await advanceProjectSchedule(
                  tx,
                  organizationId,
                  projectId,
                  now,
                  userId,
                );
            }
            break;
          }
          case "createWorkItem": {
            const type = typeOf(c.typeId);
            // Spec-backed work starts a specification; plain work only
            // needs the right to shape the project's delivery.
            if (type.hasSpecification || !capabilities.changeProperties)
              requireCapability(capabilities, "editSpecifications");
            if (type.archivedAt)
              throw new DomainError(
                "validation",
                `${type.name} is archived. Restore it or choose another type.`,
              );
            if (
              !roster.projectTypes.some(
                (x) => x.projectId === projectId && x.typeId === type.id,
              )
            )
              throw new DomainError(
                "validation",
                `${projectRow!.name} does not use ${type.name} items. Enable the type in project settings.`,
              );
            const teamId = c.teamId ? teamOf(c.teamId).id : null;
            const parent = await validateParent(c.parentId, c.typeId);
            const statuses = projectStatuses().filter((x) => !x.archivedAt);
            const status = c.statusId
              ? requireValue(
                  statuses.find((x) => x.id === c.statusId),
                  "The status is unavailable in this project.",
                )
              : (statuses.find((x) => x.category === "backlog") ??
                statuses.find((x) => x.category === "unstarted") ??
                statuses[0]);
            if (!status)
              throw new DomainError(
                "validation",
                `${projectRow!.name} has no workflow statuses.`,
              );
            if (c.iterationId) {
              if (projectRow!.deliveryMode === "external")
                throw new DomainError(
                  "validation",
                  `${projectRow!.name} hands delivery to an external tool; plan iterations there.`,
                );
              openIteration(c.iterationId);
            }
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
                  eq(s.workItem.projectId, projectId),
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
              teamId,
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
            let statusId = item!.statusId;
            let iterationId = item!.iterationId;
            let typeId = item!.typeId;
            if (c.typeId !== undefined && c.typeId !== item!.typeId) {
              const to = typeOf(c.typeId);
              const from = typeOf(item!.typeId);
              if (to.archivedAt)
                throw new DomainError("validation", `${to.name} is archived.`);
              if (
                !roster.projectTypes.some(
                  (x) => x.projectId === projectId && x.typeId === to.id,
                )
              )
                throw new DomainError(
                  "validation",
                  `${projectRow!.name} does not use ${to.name} items.`,
                );
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
            // Team is an optional grouping inside the project: changing it
            // keeps the key, status and iteration.
            if (c.teamId !== undefined && c.teamId !== item!.teamId) {
              const to = c.teamId ? teamOf(c.teamId) : null;
              patch.teamId = to?.id ?? null;
              log("team_changed", {
                from: item!.teamId,
                to: to?.id ?? null,
                fromName:
                  roster.teams.find((t) => t.id === item!.teamId)?.name ?? null,
                toName: to?.name ?? null,
              });
            }
            const statuses = projectStatuses();
            if (c.statusId !== undefined && c.statusId !== statusId) {
              const to = requireValue(
                statuses.find((x) => x.id === c.statusId && !x.archivedAt),
                "The status is unavailable in this project.",
              );
              const from = statuses.find((x) => x.id === statusId);
              // Readiness gates starting spec-backed work, per project
              // policy. `warn` lets the move through but records the override.
              let override: string[] | undefined;
              if (
                to.category === "started" &&
                from?.category !== "started" &&
                typeOf(typeId).hasSpecification &&
                item!.refinementState !== "ready" &&
                projectRow!.readinessPolicy !== "off"
              ) {
                const failing = failingChecks().map((k) => k.label);
                if (projectRow!.readinessPolicy === "block")
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
              statusId = to.id;
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
                if (projectRow!.deliveryMode === "external")
                  throw new DomainError(
                    "validation",
                    `${projectRow!.name} hands delivery to an external tool; plan iterations there.`,
                  );
                openIteration(c.iterationId);
              }
              await iterationEvent(iterationId, "removed", item!.estimate);
              await iterationEvent(c.iterationId, "added", item!.estimate);
              // Already-finished work counts as completed scope, not remaining.
              const category = statuses.find(
                (x) => x.id === statusId,
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
              if (projectRow!.estimateScale === "none")
                throw new DomainError(
                  "validation",
                  `${projectRow!.name} does not estimate work in Lictory.`,
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
            if (!projectManager)
              requireCapability(capabilities, "changeProperties");
            await auditConfiguration(tx, organizationId, userId, c);
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
            if (!projectManager)
              requireCapability(capabilities, "changeProperties");
            await auditConfiguration(tx, organizationId, userId, c);
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
            if (item!.mainProtected)
              throw new DomainError(
                "conflict",
                "This specification is ready. Use a branch and pull request to change main.",
              );
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
            if (c.pullRequestId) {
              const pr = before.find(
                (e) => e.type === "pullRequest" && e.id === c.pullRequestId,
              );
              require(pr?.type === "pullRequest" &&
                pr.status !==
                  "merged", "This pull request is unavailable for discussion.");
              require(!c.suggestionId, "Choose one discussion context.");
              require(before.some(
                (e) => e.type === "specCommit" && e.id === c.commitId,
              ), "Choose the commit this discussion concerns.");
            }
            await tx.insert(s.thread).values({
              id: c.threadId,
              ...context,
              suggestionId,
              pullRequestId: c.pullRequestId ?? null,
              commitId: c.commitId ?? null,
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
              ...(c.pullRequestId
                ? { pullRequestId: c.pullRequestId, commitId: c.commitId }
                : {}),
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
                    roster.disciplines,
                    c.userId,
                    projectId,
                  ), "Suggestion reviewers need a discipline in this project that can both edit specifications and be asked to review.", "validation");
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
            const discipline = requireValue(
              roster.disciplines.find(
                (d) =>
                  d.id === c.disciplineId &&
                  d.projectId === projectId &&
                  !d.archivedAt,
              ),
              "The reviewing discipline is unavailable in this project.",
            );
            require(discipline.capabilities
              .review, `${discipline.name} cannot be asked to review. A project administrator can change the discipline's capabilities.`, "validation");
            if (c.userId)
              require(discipline.userIds.includes(
                c.userId,
              ), `The chosen reviewer is not a member of ${discipline.name}.`, "validation");
            await tx.insert(s.review).values({
              id: c.reviewId,
              ...context,
              responsibility: discipline.name,
              required: c.required,
              requestedById: userId,
            });
            await tx.insert(s.reviewAssignment).values({
              organizationId,
              reviewId: c.reviewId,
              assignedById: userId,
              userId: c.userId,
              disciplineId: c.userId ? null : c.disciplineId,
            });
            log("review_requested", {
              reviewId: c.reviewId,
              responsibility: discipline.name,
              targetType: c.userId ? "user" : "discipline",
              targetId: c.userId ?? c.disciplineId,
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
                  roster.disciplines.some(
                    (d) =>
                      d.id === e.disciplineId &&
                      !d.archivedAt &&
                      d.userIds.includes(userId),
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
          case "signOffReadinessCheck": {
            const evaluated = before.find(
              (e): e is EntityOf<"readiness"> =>
                e.type === "readiness" && e.workItemId === workItemId,
            );
            const check = evaluated?.checks.find((k) => k.key === c.checkId);
            if (!check?.signOff)
              throw new DomainError(
                "validation",
                "This item has no such sign-off. Its readiness checks may have changed; reload it and try again.",
              );
            const eligible = check.signOff.disciplineIds;
            require(roster.disciplines.some(
              (d) =>
                d.projectId === projectId &&
                !d.archivedAt &&
                d.userIds.includes(userId) &&
                (eligible.length === 0 || eligible.includes(d.id)),
            ), eligible.length
              ? `Only members of ${eligible
                  .map(
                    (id) =>
                      roster.disciplines.find((d) => d.id === id)?.name ??
                      "a former discipline",
                  )
                  .join(" or ")} can sign off “${check.label}”.`
              : `Only people holding a discipline in this project can sign off “${check.label}”.`);
            const [existing] = await tx
              .select()
              .from(s.readinessSignOff)
              .where(
                and(
                  eq(s.readinessSignOff.organizationId, organizationId),
                  eq(s.readinessSignOff.workItemId, workItemId!),
                  eq(s.readinessSignOff.revisionId, latest!.id),
                  eq(s.readinessSignOff.checkId, c.checkId),
                  isNull(s.readinessSignOff.withdrawnAt),
                ),
              );
            const detail = {
              checkId: c.checkId,
              label: check.label,
              revision: latest!.number,
            };
            if (c.signedOff) {
              if (existing)
                throw new DomainError(
                  "conflict",
                  `“${check.label}” is already signed off for revision ${latest!.number}.`,
                );
              await tx.insert(s.readinessSignOff).values({
                organizationId,
                workItemId: workItemId!,
                revisionId: latest!.id,
                checkId: c.checkId,
                userId,
              });
              log("readiness_signed_off", detail);
            } else {
              if (!existing)
                throw new DomainError(
                  "conflict",
                  `“${check.label}” has no sign-off to withdraw for revision ${latest!.number}.`,
                );
              await tx
                .update(s.readinessSignOff)
                .set({ withdrawnAt: now, withdrawnById: userId })
                .where(
                  and(
                    eq(s.readinessSignOff.organizationId, organizationId),
                    eq(s.readinessSignOff.id, existing.id),
                  ),
                );
              log("readiness_sign_off_withdrawn", {
                ...detail,
                signedOffBy: existing.userId,
              });
            }
            break;
          }
        }
        if (item && (branchCommands.has(c.type) || aiCommands.has(c.type)))
          await scheduleActionRuns(tx, {
            organizationId,
            workItemId: item.id,
            userId,
            before,
            policy: project().aiActionPolicy,
            ai: roster.ai,
          });
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
        // Notify once when a previously approved PR result becomes stale.
        const oldBranches = before.filter(
            (e): e is EntityOf<"specBranch"> => e.type === "specBranch",
          ),
          newBranches = after.filter(
            (e): e is EntityOf<"specBranch"> => e.type === "specBranch",
          );
        const oldCommits = before.filter(
            (e): e is EntityOf<"specCommit"> => e.type === "specCommit",
          ),
          newCommits = after.filter(
            (e): e is EntityOf<"specCommit"> => e.type === "specCommit",
          );
        for (const pr of after.filter(
          (e): e is EntityOf<"pullRequest"> =>
            e.type === "pullRequest" && e.status !== "merged",
        )) {
          const oldHash = pullRequestResultHash(pr, oldBranches, oldCommits),
            newHash = pullRequestResultHash(pr, newBranches, newCommits);
          if (oldHash && oldHash !== newHash) {
            const reviewerIds = before
              .filter(
                (e): e is EntityOf<"prReview"> =>
                  e.type === "prReview" &&
                  e.pullRequestId === pr.id &&
                  e.decision === "approved" &&
                  e.resultHash === oldHash,
              )
              .flatMap((r) => (r.reviewerId ? [r.reviewerId] : []));
            if (reviewerIds.length)
              log("pull_request_approval_invalidated", {
                pullRequestId: pr.id,
                title: pr.title,
                reviewerIds,
              });
          }
        }
        // Readiness drives `ready` automatically in both directions while the
        // item is still owned by refinement. Later statuses are never touched.
        let readinessState = after.find((e) => e.type === "readiness");
        const itemState = after.find(
          (e) => e.type === "workItem" && e.id === workItemId,
        );
        // An item keeps the readiness checks it met only while it stays
        // ready or done; otherwise it follows the project's latest checks.
        if (
          readinessState?.type === "readiness" &&
          readinessState.pinned &&
          itemState?.type === "workItem" &&
          !itemState.archivedAt
        ) {
          const category = projectStatuses().find(
            (x) => x.id === itemState.statusId,
          )?.category;
          const passing =
            readinessState.checks.length > 0 &&
            readinessState.checks.every((check) => check.passed);
          if (!passing && !(category && closedCategories.includes(category))) {
            await tx
              .update(s.workItem)
              .set({ readinessRevisionId: null })
              .where(
                and(
                  eq(s.workItem.organizationId, organizationId),
                  eq(s.workItem.id, workItemId!),
                ),
              );
            after = await snapshot(tx, scope);
            const followed = after.find((e) => e.type === "readiness");
            log("readiness_checks_followed", {
              from: readinessState.policyRevisionNumber,
              to:
                followed?.type === "readiness"
                  ? followed.policyRevisionNumber
                  : null,
            });
            readinessState = followed;
          }
        }
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
          // Activity is the only thing this insert changes in the item scope,
          // so append it instead of projecting the scope again.
          const inserted = await tx
            .insert(s.activity)
            .values(
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
            )
            .returning();
          after = [
            ...after,
            ...inserted.map((row) => serialize("activity", row)),
          ];
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
                entity: readinessEntity(parent, rows, ctx),
              });
          }
        }
        let cursor = await clock(tx, organizationId);
        const extraChanges: (typeof s.syncChange.$inferInsert)[] = [];
        for (const { workItemId: parentId, entity } of parentReadiness) {
          cursor++;
          extraChanges.push({
            organizationId,
            cursor,
            projectId,
            workItemId: parentId,
            change: { operation: "upsert", cursor: cursor.toString(), entity },
          });
        }
        for (const run of await runsById(tx, organizationId, [
          ...touchedRuns,
        ])) {
          cursor++;
          extraChanges.push({
            organizationId,
            cursor,
            projectId,
            workItemId: run.workItemId,
            change: {
              operation: "upsert",
              cursor: cursor.toString(),
              entity: aiRunEntity(run),
            },
          });
        }
        await insertChanges(tx, extraChanges);
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
  "PROJECTS",
  "INTELLIGENCE",
  "NOTIFICATIONS",
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
  "signOffReadinessCheck",
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
  const rows: (typeof s.syncChange.$inferInsert)[] = [];
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
    rows.push({
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
    rows.push({
      organizationId,
      cursor,
      ...route(entity),
      change,
    });
  }
  await insertChanges(tx, rows);
  return cursor;
}

// Change rows are written in multi-row statements, bounded to stay far below
// PostgreSQL's parameter limit.
async function insertChanges(
  tx: Tx,
  rows: (typeof s.syncChange.$inferInsert)[],
) {
  for (let index = 0; index < rows.length; index += 500)
    await tx.insert(s.syncChange).values(rows.slice(index, index + 500));
}

// Scheduled job (Trigger.dev, cron route or the Bun worker): starts and
// completes automatic cycles. Idempotent; each organization commits
// separately under its lock with the same change-log guarantees as commands.
export async function advanceSchedules(db: Database, now = new Date()) {
  const projects = await automaticProjects(db);
  const byOrganization = new Map<string, string[]>();
  for (const p of projects)
    byOrganization.set(p.organizationId, [
      ...(byOrganization.get(p.organizationId) ?? []),
      p.projectId,
    ]);
  let changedOrganizations = 0;
  for (const [organizationId, projectIds] of byOrganization)
    await db.transaction(async (tx) => {
      await lock(tx, organizationId);
      const before = await snapshot(tx, { organizationId });
      let changed = false;
      for (const projectId of projectIds)
        changed =
          (await advanceProjectSchedule(tx, organizationId, projectId, now)) ||
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
  return { projects: projects.length, changedOrganizations };
}

// Every published revision of a project's readiness checks, newest first,
// ending with Lictory's defaults when nothing was recorded yet.
export async function readinessHistory(
  db: Database,
  userId: string,
  organizationId: string,
  projectId: string,
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    requireValue(
      (
        await tx
          .select({ id: s.project.id })
          .from(s.project)
          .where(
            and(
              eq(s.project.organizationId, organizationId),
              eq(s.project.id, projectId),
            ),
          )
      )[0],
      "This project is unavailable.",
    );
    const rows = await tx
      .select()
      .from(s.readinessRevision)
      .where(
        and(
          eq(s.readinessRevision.organizationId, organizationId),
          eq(s.readinessRevision.projectId, projectId),
        ),
      )
      .orderBy(desc(s.readinessRevision.number));
    return {
      revisions: rows.length
        ? rows.map((row) => readinessRevisionSummary(projectId, row))
        : [readinessRevisionSummary(projectId, undefined)],
    };
  });
}

// What publishing `input` would do to the project's items, without writing.
// Items that are ready or done keep their version; the others are evaluated
// under the draft and compared with the checks they follow today.
export async function readinessPreview(
  db: Database,
  userId: string,
  organizationId: string,
  projectId: string,
  input: ReadinessRules,
): Promise<ReadinessImpact> {
  return db.transaction(
    async (tx) => {
      const roster = await directory(tx, userId, organizationId);
      const project = requireValue(
        roster.projects.find((p) => p.id === projectId),
        "This project is unavailable.",
      );
      const draft = normalizeReadinessRules(roster, projectId, input);
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
      const current = ctx.latestReadiness.get(projectId)?.rules ?? {};
      const impact: ReadinessImpact = {
        kept: 0,
        becomeReady: [],
        needMoreWork: [],
        reasons: [],
        unaffected: 0,
      };
      const reasons = new Map<string, number>();
      for (const row of rows) {
        if (row.archivedAt || !row.refinementState || !isSpecBacked(row, ctx))
          continue;
        const category = ctx.categories.get(row.statusId);
        if (
          row.refinementState === "ready" ||
          row.readinessRevisionId ||
          (category && closedCategories.includes(category))
        ) {
          impact.kept++;
          continue;
        }
        const today = checksFor(current, row.typeId);
        const next = checksFor(draft, row.typeId);
        const changed = new Set(
          next
            .filter(
              (c) =>
                !today.some(
                  (old) => old.id === c.id && sameReadinessChecks([old], [c]),
                ),
            )
            .map((c) => c.id),
        );
        const failingToday = new Set(
          readiness(row, rows, ctx, today)
            .filter((c) => !c.passed)
            .map((c) => c.key),
        );
        const after = readiness(row, rows, ctx, next);
        const summary = {
          id: row.id,
          key: `${project.key}-${row.number}`,
          title: row.title,
        };
        if (after.length > 0 && after.every((c) => c.passed)) {
          impact.becomeReady.push(summary);
          continue;
        }
        const newlyFailing = after.filter(
          (c) => !c.passed && (changed.has(c.key) || !failingToday.has(c.key)),
        );
        if (!newlyFailing.length) {
          impact.unaffected++;
          continue;
        }
        impact.needMoreWork.push(summary);
        for (const c of newlyFailing)
          reasons.set(c.label, (reasons.get(c.label) ?? 0) + 1);
      }
      impact.reasons = [...reasons]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
      return impact;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
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
          eq(s.iteration.projectId, it.projectId),
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
