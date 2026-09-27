import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "../../db/schema";
import type {
  Capabilities,
  Directory,
  StatusCategory,
  Team,
  TeamCommand,
} from "../shared/protocol";
import type { labelColors } from "../shared/protocol";
import { DomainError } from "./errors";
import { notifyIteration } from "../../notifications/server";

type Database = PostgresJsDatabase<typeof s>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

const fail = (
  message: string,
  category: DomainError["category"] = "validation",
): never => {
  throw new DomainError(category, message);
};
function found<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new DomainError("unavailable", message);
  return value;
}

const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
// Activity actor for scheduled changes; rendered as "Lictory" by clients.
export const SYSTEM_ACTOR = "system";
const DAY = 86_400_000;
const closed: StatusCategory[] = ["done", "canceled"];

export const defaultTypes = [
  {
    name: "Epic",
    icon: "epic",
    color: "purple",
    level: 2,
    hasSpecification: true,
  },
  {
    name: "Story",
    icon: "story",
    color: "green",
    level: 1,
    hasSpecification: true,
  },
  {
    name: "Task",
    icon: "task",
    color: "blue",
    level: 1,
    hasSpecification: false,
  },
  { name: "Bug", icon: "bug", color: "red", level: 1, hasSpecification: false },
  {
    name: "Subtask",
    icon: "subtask",
    color: "gray",
    level: 0,
    hasSpecification: false,
  },
] as const;

export const defaultStatuses: {
  name: string;
  color: (typeof labelColors)[number];
  category: StatusCategory;
}[] = [
  { name: "Backlog", color: "gray", category: "backlog" },
  { name: "Todo", color: "gray", category: "unstarted" },
  { name: "In Progress", color: "amber", category: "started" },
  { name: "In Review", color: "blue", category: "started" },
  { name: "Done", color: "green", category: "done" },
  { name: "Canceled", color: "gray", category: "canceled" },
];

// Idempotent: an organization that already has types or teams keeps them.
export async function seedDelivery(
  tx: Executor,
  organizationId: string,
  teamName: string,
  memberIds: string[],
) {
  const hasTypes = await tx
    .select({ id: s.workItemType.id })
    .from(s.workItemType)
    .where(eq(s.workItemType.organizationId, organizationId))
    .limit(1);
  if (!hasTypes.length)
    await tx.insert(s.workItemType).values(
      defaultTypes.map((t, position) => ({
        organizationId,
        ...t,
        position,
      })),
    );
  const hasTeams = await tx
    .select({ id: s.team.id })
    .from(s.team)
    .where(eq(s.team.organizationId, organizationId))
    .limit(1);
  if (hasTeams.length) return hasTeams[0]!.id;
  const teamId = crypto.randomUUID();
  await createTeamRows(tx, organizationId, teamId, teamName);
  if (memberIds.length)
    await tx
      .insert(s.teamMember)
      .values(memberIds.map((userId) => ({ organizationId, teamId, userId })));
  return teamId;
}

async function createTeamRows(
  tx: Executor,
  organizationId: string,
  teamId: string,
  name: string,
) {
  await tx.insert(s.team).values({ id: teamId, organizationId, name });
  await tx.insert(s.workflowStatus).values(
    defaultStatuses.map((x, position) => ({
      organizationId,
      teamId,
      ...x,
      position,
    })),
  );
  const types = await tx
    .select({ id: s.workItemType.id })
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, organizationId),
        isNull(s.workItemType.archivedAt),
      ),
    );
  if (types.length)
    await tx
      .insert(s.teamWorkItemType)
      .values(types.map((t) => ({ organizationId, teamId, typeId: t.id })));
}

type Context = {
  organizationId: string;
  userId: string;
  admin: boolean;
  capabilities: Capabilities;
  roster: Directory;
};

async function activity(
  tx: Tx,
  organizationId: string,
  actorId: string,
  rows: { projectId: string; workItemId: string }[],
  action: string,
  detail: Record<string, unknown>,
  now: Date,
) {
  if (!rows.length) return;
  await tx.insert(s.activity).values(
    rows.map((r) => ({
      id: crypto.randomUUID(),
      organizationId,
      projectId: r.projectId,
      workItemId: r.workItemId,
      actorId,
      action,
      detail,
      createdAt: now,
    })),
  );
}

export async function applyTeamCommand(tx: Tx, ctx: Context, c: TeamCommand) {
  const { organizationId, roster } = ctx;
  const now = new Date();
  const planning =
    c.type === "createIteration" ||
    c.type === "updateIteration" ||
    c.type === "startIteration" ||
    c.type === "completeIteration";
  if (planning) {
    if (!ctx.capabilities.changeProperties)
      fail(
        "Your roles cannot plan iterations. A role that changes item properties is required.",
        "forbidden",
      );
  } else if (!ctx.admin)
    fail(
      "An organization administrator must configure teams and types.",
      "forbidden",
    );
  const team = (teamId: string) =>
    found(
      roster.teams.find((t) => t.id === teamId),
      "The team is unavailable.",
    );
  const where = (
    table: { organizationId: AnyPgColumn; id: AnyPgColumn },
    id: string,
  ) => and(eq(table.organizationId, organizationId), eq(table.id, id));
  switch (c.type) {
    case "createTeam": {
      if (
        roster.teams.some(
          (t) => !t.archivedAt && t.name.toLowerCase() === c.name.toLowerCase(),
        )
      )
        fail(`A team named “${c.name}” already exists.`);
      await createTeamRows(tx, organizationId, c.teamId, c.name);
      return;
    }
    case "updateTeam": {
      const t = team(c.teamId);
      if (
        c.name &&
        roster.teams.some(
          (x) =>
            x.id !== t.id &&
            !x.archivedAt &&
            x.name.toLowerCase() === c.name!.toLowerCase(),
        )
      )
        fail(`A team named “${c.name}” already exists.`);
      if (c.archived) {
        if (roster.teams.filter((x) => !x.archivedAt).length <= 1)
          fail("An organization needs at least one active team.");
        const defaults = roster.projects.filter(
          (p) => p.defaultTeamId === t.id && !p.archivedAt,
        );
        if (defaults.length)
          fail(
            `${defaults.map((p) => p.name).join(", ")} ${defaults.length === 1 ? "uses" : "use"} this team by default. Choose another default team first.`,
          );
      }
      const { type: _type, teamId: _id, archived, ...patch } = c;
      void _type;
      void _id;
      await tx
        .update(s.team)
        .set({
          ...Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== undefined),
          ),
          ...(archived !== undefined
            ? { archivedAt: archived ? now : null }
            : {}),
        })
        .where(where(s.team, t.id));
      if (
        c.iterationMode === "automatic" ||
        (t.iterationMode === "automatic" && c.iterationMode === undefined)
      )
        await advanceTeamSchedule(tx, organizationId, t.id, now, ctx.userId);
      return;
    }
    case "setTeamMembership": {
      const t = team(c.teamId);
      found(
        roster.members.find((m) => m.id === c.userId),
        "That person is not a member of this organization.",
      );
      if (c.member)
        await tx
          .insert(s.teamMember)
          .values({ organizationId, teamId: t.id, userId: c.userId })
          .onConflictDoNothing();
      else
        await tx
          .delete(s.teamMember)
          .where(
            and(
              eq(s.teamMember.organizationId, organizationId),
              eq(s.teamMember.teamId, t.id),
              eq(s.teamMember.userId, c.userId),
            ),
          );
      return;
    }
    case "setTeamType": {
      const t = team(c.teamId);
      const type = found(
        roster.types.find((x) => x.id === c.typeId),
        "The work item type is unavailable.",
      );
      if (c.enabled) {
        await tx
          .insert(s.teamWorkItemType)
          .values({ organizationId, teamId: t.id, typeId: type.id })
          .onConflictDoNothing();
        return;
      }
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            eq(s.workItem.teamId, t.id),
            eq(s.workItem.typeId, type.id),
            isNull(s.workItem.archivedAt),
          ),
        )) as [{ count: number }];
      if (count > 0)
        fail(
          `${count} ${type.name} ${count === 1 ? "item belongs" : "items belong"} to ${t.name}. Change their type or team before disabling it.`,
        );
      await tx
        .delete(s.teamWorkItemType)
        .where(
          and(
            eq(s.teamWorkItemType.organizationId, organizationId),
            eq(s.teamWorkItemType.teamId, t.id),
            eq(s.teamWorkItemType.typeId, type.id),
          ),
        );
      return;
    }
    case "createStatus": {
      const t = team(c.teamId);
      if (
        t.statuses.some(
          (x) => !x.archivedAt && x.name.toLowerCase() === c.name.toLowerCase(),
        )
      )
        fail(`${t.name} already has a status named “${c.name}”.`);
      await tx.insert(s.workflowStatus).values({
        id: c.statusId,
        organizationId,
        teamId: t.id,
        name: c.name,
        color: c.color,
        category: c.category,
        position: Math.max(-1, ...t.statuses.map((x) => x.position)) + 1,
      });
      return;
    }
    case "updateStatus": {
      const t = team(c.teamId);
      const status = found(
        t.statuses.find((x) => x.id === c.statusId && !x.archivedAt),
        "The status is unavailable.",
      );
      if (
        c.name &&
        t.statuses.some(
          (x) =>
            x.id !== status.id &&
            !x.archivedAt &&
            x.name.toLowerCase() === c.name!.toLowerCase(),
        )
      )
        fail(`${t.name} already has a status named “${c.name}”.`);
      await tx
        .update(s.workflowStatus)
        .set({
          ...(c.name !== undefined ? { name: c.name } : {}),
          ...(c.color !== undefined ? { color: c.color } : {}),
          ...(c.category !== undefined ? { category: c.category } : {}),
        })
        .where(where(s.workflowStatus, status.id));
      if (c.beforeId !== undefined) {
        const others = t.statuses.filter((x) => x.id !== status.id);
        const index = c.beforeId
          ? others.findIndex((x) => x.id === c.beforeId)
          : others.length;
        if (index < 0) fail("The target status is not part of this team.");
        const ordered = [
          ...others.slice(0, index),
          status,
          ...others.slice(index),
        ];
        for (const [position, x] of ordered.entries())
          if (x.position !== position)
            await tx
              .update(s.workflowStatus)
              .set({ position })
              .where(where(s.workflowStatus, x.id));
      }
      return;
    }
    case "archiveStatus": {
      const t = team(c.teamId);
      const status = found(
        t.statuses.find((x) => x.id === c.statusId && !x.archivedAt),
        "The status is unavailable.",
      );
      const replacement = found(
        t.statuses.find(
          (x) =>
            x.id === c.replacementId && !x.archivedAt && x.id !== status.id,
        ),
        "Choose another active status of this team to move its items to.",
      );
      const items = await tx
        .select()
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            eq(s.workItem.teamId, t.id),
            eq(s.workItem.statusId, status.id),
          ),
        );
      if (items.length) {
        await tx
          .update(s.workItem)
          .set({ statusId: replacement.id, updatedAt: now })
          .where(
            and(
              eq(s.workItem.organizationId, organizationId),
              inArray(
                s.workItem.id,
                items.map((i) => i.id),
              ),
            ),
          );
        const flips =
          closed.includes(status.category) !==
          closed.includes(replacement.category);
        if (flips)
          await iterationEvents(
            tx,
            organizationId,
            items,
            closed.includes(replacement.category) ? "completed" : "reopened",
            ctx.userId,
            now,
          );
        await activity(
          tx,
          organizationId,
          ctx.userId,
          items.map((i) => ({ projectId: i.projectId, workItemId: i.id })),
          "status_changed",
          {
            from: status.name,
            to: replacement.name,
            category: replacement.category,
            reason: "status_archived",
          },
          now,
        );
      }
      await tx
        .update(s.workflowStatus)
        .set({ archivedAt: now })
        .where(where(s.workflowStatus, status.id));
      return;
    }
    case "createType": {
      if (
        roster.types.some(
          (x) => !x.archivedAt && x.name.toLowerCase() === c.name.toLowerCase(),
        )
      )
        fail(`A type named “${c.name}” already exists.`);
      await tx.insert(s.workItemType).values({
        id: c.typeId,
        organizationId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        level: c.level,
        hasSpecification: c.hasSpecification,
        position: Math.max(-1, ...roster.types.map((x) => x.position)) + 1,
      });
      // New types are available to every active team; teams can opt out.
      const teams = roster.teams.filter((t) => !t.archivedAt);
      if (teams.length)
        await tx.insert(s.teamWorkItemType).values(
          teams.map((t) => ({
            organizationId,
            teamId: t.id,
            typeId: c.typeId,
          })),
        );
      return;
    }
    case "updateType": {
      const type = found(
        roster.types.find((x) => x.id === c.typeId),
        "The work item type is unavailable.",
      );
      if (
        c.name &&
        roster.types.some(
          (x) =>
            x.id !== type.id &&
            !x.archivedAt &&
            x.name.toLowerCase() === c.name!.toLowerCase(),
        )
      )
        fail(`A type named “${c.name}” already exists.`);
      if (
        c.archived &&
        roster.types.filter((x) => !x.archivedAt && x.id !== type.id).length ===
          0
      )
        fail("At least one work item type must remain active.");
      await tx
        .update(s.workItemType)
        .set({
          ...(c.name !== undefined ? { name: c.name } : {}),
          ...(c.icon !== undefined ? { icon: c.icon } : {}),
          ...(c.color !== undefined ? { color: c.color } : {}),
          ...(c.hasSpecification !== undefined
            ? { hasSpecification: c.hasSpecification }
            : {}),
          ...(c.archived !== undefined
            ? { archivedAt: c.archived ? now : null }
            : {}),
        })
        .where(where(s.workItemType, type.id));
      // Turning a specification on starts refinement at draft; turning it off
      // hides refinement but never deletes revisions or discussions.
      if (
        c.hasSpecification !== undefined &&
        c.hasSpecification !== type.hasSpecification
      )
        await tx
          .update(s.workItem)
          .set({ refinementState: c.hasSpecification ? "draft" : null })
          .where(
            and(
              eq(s.workItem.organizationId, organizationId),
              eq(s.workItem.typeId, type.id),
            ),
          );
      return;
    }
    case "createIteration": {
      const t = team(c.teamId);
      if (t.deliveryMode === "external")
        fail(
          `${t.name} tracks delivery in an external tool; plan iterations there.`,
        );
      if (t.iterationMode === "off")
        fail(
          `${t.name} does not use iterations. Enable sprints or cycles in team settings.`,
        );
      if (t.iterationMode === "automatic")
        fail(`${t.name} schedules cycles automatically.`);
      const startsAt = new Date(`${c.startsAt}T00:00:00.000Z`);
      const endsAt = new Date(`${c.endsAt}T00:00:00.000Z`);
      if (endsAt <= startsAt) fail("An iteration must end after it starts.");
      await tx.insert(s.iteration).values({
        id: c.iterationId,
        organizationId,
        teamId: t.id,
        number: (await lastNumber(tx, organizationId, t.id)) + 1,
        name: blank(c.name),
        goal: blank(c.goal),
        startsAt,
        endsAt,
      });
      return;
    }
    case "updateIteration": {
      const it = found(
        roster.iterations.find(
          (i) => i.id === c.iterationId && i.teamId === c.teamId,
        ),
        "The iteration is unavailable.",
      );
      if (it.state === "completed")
        fail("Completed iterations cannot be changed.");
      const startsAt = c.startsAt
        ? new Date(`${c.startsAt}T00:00:00.000Z`)
        : new Date(it.startsAt);
      const endsAt = c.endsAt
        ? new Date(`${c.endsAt}T00:00:00.000Z`)
        : new Date(it.endsAt);
      if (endsAt <= startsAt) fail("An iteration must end after it starts.");
      await tx
        .update(s.iteration)
        .set({
          ...(c.name !== undefined ? { name: blank(c.name) } : {}),
          ...(c.goal !== undefined ? { goal: blank(c.goal) } : {}),
          startsAt,
          endsAt,
        })
        .where(where(s.iteration, it.id));
      return;
    }
    case "startIteration": {
      const t = team(c.teamId);
      const it = found(
        roster.iterations.find(
          (i) => i.id === c.iterationId && i.teamId === t.id,
        ),
        "The iteration is unavailable.",
      );
      if (it.state !== "planned")
        fail("Only a planned iteration can be started.");
      const active = roster.iterations.find(
        (i) => i.teamId === t.id && i.state === "active",
      );
      if (active)
        fail(
          `${t.name} already has an active iteration (${active.name ?? `Iteration ${active.number}`}). Complete it first.`,
          "conflict",
        );
      await tx
        .update(s.iteration)
        .set({ state: "active", startedAt: now })
        .where(where(s.iteration, it.id));
      await notifyIteration(tx, {
        organizationId,
        iterationId: it.id,
        kind: "iteration_started",
        actorId: ctx.userId,
      });
      return;
    }
    case "completeIteration": {
      const t = team(c.teamId);
      await completeIteration(
        tx,
        organizationId,
        t,
        c.iterationId,
        c.carryOverTo,
        ctx.userId,
        now,
      );
      return;
    }
  }
}

async function lastNumber(tx: Tx, organizationId: string, teamId: string) {
  const [row] = await tx
    .select({ n: max(s.iteration.number) })
    .from(s.iteration)
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        eq(s.iteration.teamId, teamId),
      ),
    );
  return row?.n ?? 0;
}

async function iterationEvents(
  tx: Tx,
  organizationId: string,
  items: (typeof s.workItem.$inferSelect)[],
  kind: (typeof s.iterationEvent.$inferInsert)["kind"],
  actorId: string,
  at: Date,
  iterationId?: string,
) {
  const rows = items
    .filter((i) => iterationId ?? i.iterationId)
    .map((i) => ({
      organizationId,
      iterationId: (iterationId ?? i.iterationId)!,
      workItemId: i.id,
      kind,
      points: i.estimate ?? 0,
      actorId: actorId === SYSTEM_ACTOR ? null : actorId,
      createdAt: at,
    }));
  if (rows.length) await tx.insert(s.iterationEvent).values(rows);
}

async function completeIteration(
  tx: Tx,
  organizationId: string,
  team: Pick<Team, "id" | "statuses" | "name">,
  iterationId: string,
  carryOverTo: string | null,
  actorId: string,
  now: Date,
) {
  const [it] = await tx
    .select()
    .from(s.iteration)
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        eq(s.iteration.teamId, team.id),
        eq(s.iteration.id, iterationId),
      ),
    );
  if (!it) fail("The iteration is unavailable.");
  if (it!.state !== "active")
    fail("Only the active iteration can be completed.");
  if (carryOverTo) {
    const [target] = await tx
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          eq(s.iteration.teamId, team.id),
          eq(s.iteration.id, carryOverTo),
        ),
      );
    if (target?.state !== "planned")
      fail(
        "Unfinished work can only move to a planned iteration of this team.",
      );
  }
  const category = new Map(team.statuses.map((x) => [x.id, x.category]));
  const items = await tx
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.iterationId, iterationId),
        isNull(s.workItem.archivedAt),
      ),
    );
  const unfinished = items.filter(
    (i) => !closed.includes(category.get(i.statusId) ?? "backlog"),
  );
  const report = await iterationReportRows(tx, organizationId, it!, now);
  const summary = {
    ...report.totals,
    carriedOver: {
      count: unfinished.length,
      points: unfinished.reduce((sum, i) => sum + (i.estimate ?? 0), 0),
    },
    carriedOverTo: carryOverTo,
  };
  if (unfinished.length) {
    await iterationEvents(
      tx,
      organizationId,
      unfinished,
      "removed",
      actorId,
      now,
      iterationId,
    );
    if (carryOverTo)
      await iterationEvents(
        tx,
        organizationId,
        unfinished,
        "added",
        actorId,
        now,
        carryOverTo,
      );
    await tx
      .update(s.workItem)
      .set({ iterationId: carryOverTo, updatedAt: now })
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          inArray(
            s.workItem.id,
            unfinished.map((i) => i.id),
          ),
        ),
      );
    await activity(
      tx,
      organizationId,
      actorId,
      unfinished.map((i) => ({ projectId: i.projectId, workItemId: i.id })),
      "iteration_changed",
      { from: iterationId, to: carryOverTo, reason: "carried_over" },
      now,
    );
  }
  await tx
    .update(s.iteration)
    .set({ state: "completed", completedAt: now, summary })
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        eq(s.iteration.id, iterationId),
      ),
    );
  await notifyIteration(tx, {
    organizationId,
    iterationId,
    kind: "iteration_completed",
    actorId: actorId === SYSTEM_ACTOR ? null : actorId,
  });
}

// Automatic cycles. Deterministic from stored state and `now`, so running it
// twice (or from two workers under the organization lock) changes nothing.
export async function advanceTeamSchedule(
  tx: Tx,
  organizationId: string,
  teamId: string,
  now: Date,
  actorId = SYSTEM_ACTOR,
) {
  const [team] = await tx
    .select()
    .from(s.team)
    .where(
      and(eq(s.team.organizationId, organizationId), eq(s.team.id, teamId)),
    );
  if (!team || team.archivedAt || team.iterationMode !== "automatic")
    return false;
  const statuses = await tx
    .select()
    .from(s.workflowStatus)
    .where(
      and(
        eq(s.workflowStatus.organizationId, organizationId),
        eq(s.workflowStatus.teamId, teamId),
      ),
    );
  const length = team.iterationWeeks * 7 * DAY;
  let changed = false;
  const open = async () =>
    tx
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          eq(s.iteration.teamId, teamId),
          sql`${s.iteration.state} <> 'completed'`,
        ),
      )
      .orderBy(asc(s.iteration.number));
  const create = async (startsAt: Date) => {
    changed = true;
    const id = crypto.randomUUID();
    await tx.insert(s.iteration).values({
      id,
      organizationId,
      teamId,
      number: (await lastNumber(tx, organizationId, teamId)) + 1,
      startsAt,
      endsAt: new Date(startsAt.getTime() + length),
    });
    return id;
  };
  let iterations = await open();
  if (!iterations.length) {
    const [last] = await tx
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          eq(s.iteration.teamId, teamId),
        ),
      )
      .orderBy(sql`${s.iteration.number} desc`)
      .limit(1);
    // First cycle starts on the most recent configured weekday (UTC).
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const back = (today.getUTCDay() - team.iterationStartDay + 7) % 7;
    const start =
      last && last.endsAt > new Date(today.getTime() - back * DAY)
        ? last.endsAt
        : new Date(today.getTime() - back * DAY);
    await create(start);
    iterations = await open();
  }
  for (let guard = 0; guard < 200; guard++) {
    const active = iterations.find((i) => i.state === "active");
    const planned = iterations.filter((i) => i.state === "planned");
    if (active && active.endsAt <= now) {
      const nextId = planned[0]?.id ?? (await create(active.endsAt));
      await completeIteration(
        tx,
        organizationId,
        {
          id: teamId,
          name: team.name,
          statuses: statuses.map((x) => ({
            ...x,
            color: x.color as never,
            archivedAt: null,
          })),
        },
        active.id,
        nextId,
        actorId,
        now,
      );
      changed = true;
      iterations = await open();
      continue;
    }
    if (!active && planned[0] && planned[0].startsAt <= now) {
      await tx
        .update(s.iteration)
        .set({ state: "active", startedAt: planned[0].startsAt })
        .where(
          and(
            eq(s.iteration.organizationId, organizationId),
            eq(s.iteration.id, planned[0].id),
          ),
        );
      await notifyIteration(tx, {
        organizationId,
        iterationId: planned[0].id,
        kind: "iteration_started",
        actorId: actorId === SYSTEM_ACTOR ? null : actorId,
      });
      changed = true;
      iterations = await open();
      continue;
    }
    const upcoming = planned.length;
    if (upcoming < team.upcomingIterations) {
      const last = iterations.at(-1)!;
      await create(last.endsAt);
      iterations = await open();
      continue;
    }
    break;
  }
  return changed;
}

export async function automaticTeams(db: Database) {
  return db
    .select({ organizationId: s.team.organizationId, teamId: s.team.id })
    .from(s.team)
    .where(
      and(eq(s.team.iterationMode, "automatic"), isNull(s.team.archivedAt)),
    );
}

type IterationRow = typeof s.iteration.$inferSelect;
export type IterationPoint = {
  at: string;
  scope: number;
  remaining: number;
  scopeCount: number;
  remainingCount: number;
};
// Replays recorded events: burndown, scope change and totals never depend on
// the current state of items, so later edits cannot rewrite history.
export async function iterationReportRows(
  tx: Executor,
  organizationId: string,
  it: IterationRow,
  now = new Date(),
) {
  const events = await tx
    .select()
    .from(s.iterationEvent)
    .where(
      and(
        eq(s.iterationEvent.organizationId, organizationId),
        eq(s.iterationEvent.iterationId, it.id),
      ),
    )
    .orderBy(asc(s.iterationEvent.createdAt), asc(s.iterationEvent.id))
    .then((rows) =>
      // Carry-over is written at the completion instant and is not progress.
      it.completedAt ? rows.filter((e) => e.createdAt < it.completedAt!) : rows,
    );
  const state = new Map<
    string,
    { in: boolean; done: boolean; points: number }
  >();
  const measure = () => {
    let scope = 0,
      remaining = 0,
      scopeCount = 0,
      remainingCount = 0;
    for (const x of state.values()) {
      if (!x.in) continue;
      scope += x.points;
      scopeCount++;
      if (!x.done) {
        remaining += x.points;
        remainingCount++;
      }
    }
    return { scope, remaining, scopeCount, remainingCount };
  };
  const start = it.startedAt ?? it.startsAt;
  const end = it.completedAt ?? (now < it.endsAt ? now : it.endsAt);
  const series: IterationPoint[] = [];
  // Added-after-start work is measured at its latest estimate, so an item
  // added unestimated and sized later still counts as scope change.
  const addedIds = new Set<string>();
  let removed = { count: 0, points: 0 };
  const completed = new Set<string>();
  let cursor = 0;
  const apply = (e: (typeof events)[number]) => {
    const x = state.get(e.workItemId) ?? { in: false, done: false, points: 0 };
    const afterStart = e.createdAt > start;
    if (e.kind === "added") {
      x.in = true;
      x.points = e.points;
      if (afterStart) addedIds.add(e.workItemId);
    } else if (e.kind === "removed") {
      x.in = false;
      if (afterStart)
        removed = {
          count: removed.count + 1,
          points: removed.points + x.points,
        };
    } else if (e.kind === "estimate_changed") x.points += e.points;
    else if (e.kind === "completed") x.done = true;
    else if (e.kind === "reopened") x.done = false;
    state.set(e.workItemId, x);
  };
  for (; cursor < events.length && events[cursor]!.createdAt <= start; cursor++)
    apply(events[cursor]!);
  const atStart = measure();
  series.push({ at: start.toISOString(), ...atStart });
  for (let day = start.getTime() + DAY; ; day += DAY) {
    const until = new Date(Math.min(day, end.getTime()));
    for (
      ;
      cursor < events.length && events[cursor]!.createdAt <= until;
      cursor++
    )
      apply(events[cursor]!);
    series.push({ at: until.toISOString(), ...measure() });
    if (until >= end) break;
  }
  for (; cursor < events.length; cursor++) apply(events[cursor]!);
  for (const [id, x] of state) if (x.in && x.done) completed.add(id);
  const final = measure();
  const added = {
    count: addedIds.size,
    points: [...addedIds].reduce(
      (sum, id) => sum + (state.get(id)?.points ?? 0),
      0,
    ),
  };
  return {
    series,
    totals: {
      atStart: { count: atStart.scopeCount, points: atStart.scope },
      final: { count: final.scopeCount, points: final.scope },
      completed: {
        count: final.scopeCount - final.remainingCount,
        points: final.scope - final.remaining,
      },
      addedAfterStart: added,
      removedAfterStart: removed,
    },
  };
}
