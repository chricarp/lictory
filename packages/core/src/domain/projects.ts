import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  not,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "@lictory/core/db/schema";
import {
  canManageProject,
  type Capabilities,
  type Directory,
  type ProjectConfigurationCommand,
  type TypeCommand,
} from "@lictory/core/contracts/protocol";
import {
  defaultReadinessChecks,
  sameReadinessChecks,
  sameReadinessRules,
  type ReadinessCheckDefinition,
  type ReadinessRules,
} from "@lictory/core/contracts/readiness";
import { auditConfiguration } from "@lictory/core/domain/audit";
import {
  activity,
  advanceProjectSchedule,
  completeIteration,
  defaultStatuses,
  iterationEvents,
  lastIterationNumber,
} from "@lictory/core/domain/delivery";
import { DomainError } from "@lictory/core/domain/errors";
import { notifyIteration } from "@lictory/core/notifications/server";
import type { Tx } from "@lictory/core/domain/service";

const fail = (
  message: string,
  category: DomainError["category"] = "validation",
): never => {
  throw new DomainError(category, message);
};
function found<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new DomainError("not_found", message);
  return value;
}
const day = (value: Date) => value.toISOString().slice(0, 10);
async function rejectOverlappingIteration(
  tx: Tx,
  organizationId: string,
  projectId: string,
  startsAt: Date,
  endsAt: Date,
  exceptId?: string,
) {
  const rows = await tx
    .select({
      id: s.iteration.id,
      name: s.iteration.name,
      number: s.iteration.number,
      startsAt: s.iteration.startsAt,
      endsAt: s.iteration.endsAt,
    })
    .from(s.iteration)
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        eq(s.iteration.projectId, projectId),
        not(eq(s.iteration.state, "completed")),
        exceptId ? not(eq(s.iteration.id, exceptId)) : undefined,
      ),
    );
  const overlap = rows.find(
    (row) => row.startsAt < endsAt && row.endsAt > startsAt,
  );
  if (!overlap) return;
  const label = overlap.name?.trim()
    ? overlap.name.trim()
    : `Iteration ${overlap.number}`;
  fail(
    `These dates overlap ${label} (${day(overlap.startsAt)}–${day(overlap.endsAt)}). Choose a range that does not overlap another open iteration.`,
  );
}
const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
const closed = ["done", "canceled"];

// Every project starts with these disciplines. Project administrators rename,
// re-scope, archive or add disciplines afterwards; nothing here is fixed.
export const defaultDisciplines: {
  name: string;
  description: string;
  capabilities: Capabilities;
}[] = [
  {
    name: "Product",
    description: "Owns the intent: writes and decides specifications.",
    capabilities: {
      editSpecifications: true,
      changeProperties: true,
      requestReviews: true,
      review: true,
      publishDelivery: true,
    },
  },
  {
    name: "Engineering",
    description: "Reviews feasibility, architecture and failure behavior.",
    capabilities: {
      editSpecifications: false,
      changeProperties: true,
      requestReviews: true,
      review: true,
      publishDelivery: false,
    },
  },
  {
    name: "QA",
    description: "Reviews testability, edge cases and acceptance criteria.",
    capabilities: {
      editSpecifications: false,
      changeProperties: false,
      requestReviews: true,
      review: true,
      publishDelivery: false,
    },
  },
];

export function disciplineColumns(c: Capabilities) {
  return {
    canEditSpecifications: c.editSpecifications,
    canChangeProperties: c.changeProperties,
    canRequestReviews: c.requestReviews,
    canReview: c.review,
    canPublishDelivery: c.publishDelivery,
  };
}

// A new project is usable immediately: the default workflow, every active
// type, the default disciplines, and its creator as administrator in the
// first discipline.
export async function seedProject(
  tx: Tx,
  organizationId: string,
  projectId: string,
  creatorId: string,
) {
  await tx.insert(s.workflowStatus).values(
    defaultStatuses.map((x, position) => ({
      organizationId,
      projectId,
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
      .insert(s.projectWorkItemType)
      .values(types.map((t) => ({ organizationId, projectId, typeId: t.id })));
  // Creation order is display order (Product, Engineering, QA, ...): one
  // statement would give every default the same timestamp.
  const created = Date.now();
  const disciplines = defaultDisciplines.map((d, index) => ({
    id: crypto.randomUUID(),
    organizationId,
    projectId,
    name: d.name,
    description: d.description,
    createdAt: new Date(created + index),
    ...disciplineColumns(d.capabilities),
  }));
  await tx.insert(s.discipline).values(disciplines);
  await tx
    .insert(s.projectMember)
    .values({ organizationId, projectId, userId: creatorId, role: "admin" });
  await tx.insert(s.disciplineMember).values({
    organizationId,
    disciplineId: disciplines[0]!.id,
    userId: creatorId,
  });
}

type Context = {
  organizationId: string;
  userId: string;
  admin: boolean;
  // Capabilities of the user in the command's project.
  capabilities: Capabilities;
  roster: Directory;
};

const planningCommands = new Set([
  "createIteration",
  "updateIteration",
  "startIteration",
  "completeIteration",
]);

async function ensureProjectMember(
  tx: Tx,
  organizationId: string,
  projectId: string,
  userId: string,
) {
  await tx
    .insert(s.projectMember)
    .values({ organizationId, projectId, userId, role: "member" })
    .onConflictDoNothing();
}

export async function applyProjectCommand(
  tx: Tx,
  ctx: Context,
  c: ProjectConfigurationCommand,
) {
  const { organizationId, roster, userId } = ctx;
  const now = new Date();
  const project = found(
    roster.projects.find((p) => p.id === c.projectId),
    "This project is unavailable.",
  );
  const manager = canManageProject(roster, userId, ctx.admin, project.id);
  if (c.type === "archiveProject") {
    if (!ctx.admin)
      fail(
        "An organization administrator must archive or restore projects.",
        "forbidden",
      );
  } else {
    if (project.archivedAt)
      fail("Restore this project before changing it.", "conflict");
    if (planningCommands.has(c.type)) {
      if (!manager && !ctx.capabilities.changeProperties)
        fail(
          "Your disciplines cannot plan iterations in this project.",
          "forbidden",
        );
    } else if (!manager)
      fail(
        "Only this project's administrators can change its configuration.",
        "forbidden",
      );
  }
  if (!planningCommands.has(c.type))
    await auditConfiguration(tx, organizationId, userId, c, project);
  const where = (
    table: { organizationId: AnyPgColumn; id: AnyPgColumn },
    id: string,
  ) => and(eq(table.organizationId, organizationId), eq(table.id, id));
  const statuses = roster.statuses.filter((x) => x.projectId === project.id);
  const member = (id: string) =>
    found(
      roster.members.find((m) => m.id === id),
      "That person is not a member of this organization.",
    );
  switch (c.type) {
    case "updateProject": {
      const {
        type: _type,
        projectId: _projectId,
        name,
        description,
        ...settings
      } = c;
      void _type;
      void _projectId;
      const mode = settings.deliveryMode ?? project.deliveryMode;
      if (mode === "external") {
        // Exactly one system owns delivery: the external tool plans and
        // estimates, so Lictory stops scheduling iterations for the project.
        if (
          (settings.iterationMode && settings.iterationMode !== "off") ||
          (settings.estimateScale && settings.estimateScale !== "none")
        )
          fail(
            `${project.name} hands work off to an external tool, which plans and estimates it. Switch the project to Lictory delivery to use sprints or estimates.`,
          );
        if (project.deliveryMode === "native") {
          const active = roster.iterations.find(
            (i) => i.projectId === project.id && i.state === "active",
          );
          if (active)
            fail(
              `Complete the active iteration (${active.name ?? `Iteration ${active.number}`}) before handing ${project.name}'s delivery to an external tool.`,
              "conflict",
            );
          settings.iterationMode = "off";
          settings.estimateScale = "none";
        }
      }
      await tx
        .update(s.project)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined
            ? { description: blank(description) }
            : {}),
          ...Object.fromEntries(
            Object.entries(settings).filter(([, v]) => v !== undefined),
          ),
          updatedAt: now,
        })
        .where(where(s.project, project.id));
      if (
        mode === "native" &&
        (settings.iterationMode ?? project.iterationMode) === "automatic"
      )
        await advanceProjectSchedule(
          tx,
          organizationId,
          project.id,
          now,
          userId,
        );
      return;
    }
    case "archiveProject": {
      await tx
        .update(s.project)
        .set({ archivedAt: c.archived ? now : null, updatedAt: now })
        .where(where(s.project, project.id));
      return;
    }
    case "publishReadinessChecks": {
      await publishReadinessChecks(tx, ctx, project.id, c);
      return;
    }
    case "setProjectMember": {
      member(c.userId);
      if (c.role) {
        await tx
          .insert(s.projectMember)
          .values({
            organizationId,
            projectId: project.id,
            userId: c.userId,
            role: c.role,
          })
          .onConflictDoUpdate({
            target: [s.projectMember.projectId, s.projectMember.userId],
            set: { role: c.role },
          });
        return;
      }
      // Leaving a project ends its discipline and team memberships too, so a
      // former member never keeps capabilities there.
      const disciplineIds = roster.disciplines
        .filter((d) => d.projectId === project.id)
        .map((d) => d.id);
      if (disciplineIds.length)
        await tx
          .delete(s.disciplineMember)
          .where(
            and(
              eq(s.disciplineMember.organizationId, organizationId),
              eq(s.disciplineMember.userId, c.userId),
              inArray(s.disciplineMember.disciplineId, disciplineIds),
            ),
          );
      const teamIds = roster.teams
        .filter((t) => t.projectId === project.id)
        .map((t) => t.id);
      if (teamIds.length)
        await tx
          .delete(s.teamMember)
          .where(
            and(
              eq(s.teamMember.organizationId, organizationId),
              eq(s.teamMember.userId, c.userId),
              inArray(s.teamMember.teamId, teamIds),
            ),
          );
      await tx
        .delete(s.projectMember)
        .where(
          and(
            eq(s.projectMember.organizationId, organizationId),
            eq(s.projectMember.projectId, project.id),
            eq(s.projectMember.userId, c.userId),
          ),
        );
      return;
    }
    case "createDiscipline":
    case "updateDiscipline": {
      const existing =
        c.type === "updateDiscipline"
          ? found(
              roster.disciplines.find(
                (d) => d.id === c.disciplineId && d.projectId === project.id,
              ),
              "This discipline is unavailable.",
            )
          : undefined;
      const name = c.name ?? existing!.name;
      const activeAfter =
        c.type === "createDiscipline" ||
        (c.archived === undefined ? !existing!.archivedAt : !c.archived);
      if (
        activeAfter &&
        roster.disciplines.some(
          (d) =>
            d.projectId === project.id &&
            d.id !== c.disciplineId &&
            !d.archivedAt &&
            d.name.toLowerCase() === name.toLowerCase(),
        )
      )
        fail(`${project.name} already has a discipline named “${name}”.`);
      if (c.type === "createDiscipline") {
        await tx.insert(s.discipline).values({
          id: c.disciplineId,
          organizationId,
          projectId: project.id,
          name: c.name,
          description: blank(c.description),
          ...disciplineColumns(c.capabilities),
        });
        return;
      }
      await tx
        .update(s.discipline)
        .set({
          ...(c.name !== undefined ? { name: c.name } : {}),
          ...(c.description !== undefined
            ? { description: blank(c.description) }
            : {}),
          ...(c.capabilities ? disciplineColumns(c.capabilities) : {}),
          ...(c.archived !== undefined
            ? { archivedAt: c.archived ? now : null }
            : {}),
        })
        .where(where(s.discipline, existing!.id));
      return;
    }
    case "setDisciplineMember": {
      const discipline = found(
        roster.disciplines.find(
          (d) =>
            d.id === c.disciplineId &&
            d.projectId === project.id &&
            !d.archivedAt,
        ),
        "This discipline is unavailable.",
      );
      member(c.userId);
      if (c.member) {
        await ensureProjectMember(tx, organizationId, project.id, c.userId);
        await tx
          .insert(s.disciplineMember)
          .values({
            organizationId,
            disciplineId: discipline.id,
            userId: c.userId,
          })
          .onConflictDoNothing();
      } else
        await tx
          .delete(s.disciplineMember)
          .where(
            and(
              eq(s.disciplineMember.organizationId, organizationId),
              eq(s.disciplineMember.disciplineId, discipline.id),
              eq(s.disciplineMember.userId, c.userId),
            ),
          );
      return;
    }
    case "createTeam":
    case "updateTeam": {
      const existing =
        c.type === "updateTeam"
          ? found(
              roster.teams.find(
                (t) => t.id === c.teamId && t.projectId === project.id,
              ),
              "This team is unavailable.",
            )
          : undefined;
      const name = c.name ?? existing!.name;
      const activeAfter =
        c.type === "createTeam" ||
        (c.archived === undefined ? !existing!.archivedAt : !c.archived);
      if (
        activeAfter &&
        roster.teams.some(
          (t) =>
            t.projectId === project.id &&
            t.id !== c.teamId &&
            !t.archivedAt &&
            t.name.toLowerCase() === name.toLowerCase(),
        )
      )
        fail(`${project.name} already has a team named “${name}”.`);
      if (c.type === "createTeam") {
        await tx.insert(s.team).values({
          id: c.teamId,
          organizationId,
          projectId: project.id,
          name: c.name,
          description: blank(c.description),
        });
        return;
      }
      // Archiving keeps the team on its items as history; it can no longer be
      // chosen for work until it is restored.
      await tx
        .update(s.team)
        .set({
          ...(c.name !== undefined ? { name: c.name } : {}),
          ...(c.description !== undefined
            ? { description: blank(c.description) }
            : {}),
          ...(c.archived !== undefined
            ? { archivedAt: c.archived ? now : null }
            : {}),
          updatedAt: now,
        })
        .where(where(s.team, existing!.id));
      return;
    }
    case "setTeamMembership": {
      const team = found(
        roster.teams.find(
          (t) => t.id === c.teamId && t.projectId === project.id,
        ),
        "This team is unavailable.",
      );
      member(c.userId);
      if (c.member) {
        await ensureProjectMember(tx, organizationId, project.id, c.userId);
        await tx
          .insert(s.teamMember)
          .values({ organizationId, teamId: team.id, userId: c.userId })
          .onConflictDoNothing();
      } else
        await tx
          .delete(s.teamMember)
          .where(
            and(
              eq(s.teamMember.organizationId, organizationId),
              eq(s.teamMember.teamId, team.id),
              eq(s.teamMember.userId, c.userId),
            ),
          );
      return;
    }
    case "setProjectType": {
      const type = found(
        roster.types.find((x) => x.id === c.typeId),
        "The work item type is unavailable.",
      );
      if (c.enabled) {
        if (type.archivedAt)
          fail(
            `${type.name} is archived. Restore it in organization settings.`,
          );
        await tx
          .insert(s.projectWorkItemType)
          .values({ organizationId, projectId: project.id, typeId: type.id })
          .onConflictDoNothing();
        return;
      }
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            eq(s.workItem.projectId, project.id),
            eq(s.workItem.typeId, type.id),
            isNull(s.workItem.archivedAt),
          ),
        )) as [{ count: number }];
      if (count > 0)
        fail(
          `${count} ${count === 1 ? "item" : "items"} of type ${type.name} ${count === 1 ? "belongs" : "belong"} to ${project.name}. Change their type before disabling it.`,
        );
      await tx
        .delete(s.projectWorkItemType)
        .where(
          and(
            eq(s.projectWorkItemType.organizationId, organizationId),
            eq(s.projectWorkItemType.projectId, project.id),
            eq(s.projectWorkItemType.typeId, type.id),
          ),
        );
      return;
    }
    case "createStatus": {
      if (
        statuses.some(
          (x) => !x.archivedAt && x.name.toLowerCase() === c.name.toLowerCase(),
        )
      )
        fail(`${project.name} already has a status named “${c.name}”.`);
      await tx.insert(s.workflowStatus).values({
        id: c.statusId,
        organizationId,
        projectId: project.id,
        name: c.name,
        color: c.color,
        category: c.category,
        position: Math.max(-1, ...statuses.map((x) => x.position)) + 1,
      });
      return;
    }
    case "updateStatus": {
      const status = found(
        statuses.find((x) => x.id === c.statusId && !x.archivedAt),
        "The status is unavailable.",
      );
      if (
        c.name &&
        statuses.some(
          (x) =>
            x.id !== status.id &&
            !x.archivedAt &&
            x.name.toLowerCase() === c.name!.toLowerCase(),
        )
      )
        fail(`${project.name} already has a status named “${c.name}”.`);
      await tx
        .update(s.workflowStatus)
        .set({
          ...(c.name !== undefined ? { name: c.name } : {}),
          ...(c.color !== undefined ? { color: c.color } : {}),
          ...(c.category !== undefined ? { category: c.category } : {}),
        })
        .where(where(s.workflowStatus, status.id));
      if (c.beforeId !== undefined) {
        const others = statuses.filter((x) => x.id !== status.id);
        const index = c.beforeId
          ? others.findIndex((x) => x.id === c.beforeId)
          : others.length;
        if (index < 0) fail("The target status is not part of this project.");
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
      const status = found(
        statuses.find((x) => x.id === c.statusId && !x.archivedAt),
        "The status is unavailable.",
      );
      const replacement = found(
        statuses.find(
          (x) =>
            x.id === c.replacementId && !x.archivedAt && x.id !== status.id,
        ),
        "Choose another active status of this project to move its items to.",
      );
      const items = await tx
        .select()
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            eq(s.workItem.projectId, project.id),
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
        if (
          closed.includes(status.category) !==
          closed.includes(replacement.category)
        )
          await iterationEvents(
            tx,
            organizationId,
            items,
            closed.includes(replacement.category) ? "completed" : "reopened",
            userId,
            now,
          );
        await activity(
          tx,
          organizationId,
          userId,
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
    case "createIteration": {
      if (project.deliveryMode === "external")
        fail(
          `${project.name} hands delivery to an external tool; plan iterations there.`,
        );
      if (project.iterationMode === "off")
        fail(
          `${project.name} does not use iterations. Enable sprints or cycles in project settings.`,
        );
      if (project.iterationMode === "automatic")
        fail(`${project.name} schedules cycles automatically.`);
      const startsAt = new Date(`${c.startsAt}T00:00:00.000Z`);
      const endsAt = new Date(`${c.endsAt}T00:00:00.000Z`);
      if (endsAt <= startsAt) fail("An iteration must end after it starts.");
      await rejectOverlappingIteration(
        tx,
        organizationId,
        project.id,
        startsAt,
        endsAt,
      );
      await tx.insert(s.iteration).values({
        id: c.iterationId,
        organizationId,
        projectId: project.id,
        number: (await lastIterationNumber(tx, organizationId, project.id)) + 1,
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
          (i) => i.id === c.iterationId && i.projectId === project.id,
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
      await rejectOverlappingIteration(
        tx,
        organizationId,
        project.id,
        startsAt,
        endsAt,
        it.id,
      );
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
      if (project.deliveryMode === "external")
        fail(
          `${project.name} hands delivery to an external tool; plan iterations there.`,
        );
      const it = found(
        roster.iterations.find(
          (i) => i.id === c.iterationId && i.projectId === project.id,
        ),
        "The iteration is unavailable.",
      );
      if (it.state !== "planned")
        fail("Only a planned iteration can be started.");
      const active = roster.iterations.find(
        (i) => i.projectId === project.id && i.state === "active",
      );
      if (active)
        fail(
          `${project.name} already has an active iteration (${active.name ?? `Iteration ${active.number}`}). Complete it first.`,
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
        actorId: userId,
      });
      return;
    }
    case "completeIteration": {
      await completeIteration(
        tx,
        organizationId,
        { id: project.id, statuses },
        c.iterationId,
        c.carryOverTo,
        userId,
        now,
      );
      return;
    }
  }
}

// Publishing creates the next immutable version of the project's Definition
// of Ready. Items that are ready or done keep the version they were evaluated
// under; every other item follows the new one. The first publication records
// Lictory's defaults as version 1 so kept items have a version to point at.
export function normalizeReadinessRules(
  roster: Directory,
  projectId: string,
  input: ReadinessRules,
): ReadinessRules {
  const disciplines = roster.disciplines.filter(
    (d) => d.projectId === projectId,
  );
  const discipline = (id: string, reviewing: boolean) => {
    const found = disciplines.find((d) => d.id === id);
    if (!found) return fail("A chosen discipline is not part of this project.");
    if (found.archivedAt)
      fail(
        `${found.name} is archived. Restore it or choose another discipline.`,
      );
    if (reviewing && !found.capabilities.review)
      fail(
        `${found.name} cannot be asked to review, so it could never approve. Allow it to review or choose another discipline.`,
      );
    return found.id;
  };
  const unique = (ids: string[]) => [...new Set(ids)];
  const rules: ReadinessRules = {};
  for (const [typeId, checks] of Object.entries(input)) {
    const type = roster.types.find((t) => t.id === typeId);
    if (!type)
      fail("The Definition of Ready names a type that does not exist.");
    const normalized = checks.map((check): ReadinessCheckDefinition => {
      if (check.kind === "discipline_approval")
        return {
          ...check,
          disciplineIds: unique(check.disciplineIds).map((d) =>
            discipline(d, true),
          ),
        };
      if (check.kind === "manual")
        return {
          ...check,
          description: blank(check.description),
          disciplineIds: unique(check.disciplineIds).map((d) =>
            discipline(d, false),
          ),
        };
      return check;
    });
    // A type that requires exactly the defaults keeps following them.
    if (!sameReadinessChecks(normalized, defaultReadinessChecks))
      rules[typeId] = normalized;
  }
  return rules;
}

async function publishReadinessChecks(
  tx: Tx,
  ctx: Context,
  projectId: string,
  c: Extract<ProjectConfigurationCommand, { type: "publishReadinessChecks" }>,
) {
  const { organizationId, roster, userId } = ctx;
  const [latest] = await tx
    .select()
    .from(s.readinessRevision)
    .where(
      and(
        eq(s.readinessRevision.organizationId, organizationId),
        eq(s.readinessRevision.projectId, projectId),
      ),
    )
    .orderBy(desc(s.readinessRevision.number))
    .limit(1);
  if ((latest?.id ?? null) !== c.baseRevisionId)
    fail(
      `The Definition of Ready changed to version ${latest?.number ?? 0} while you were editing. Review the latest version and publish again.`,
      "conflict",
    );
  const rules = normalizeReadinessRules(roster, projectId, c.rules);
  if (sameReadinessRules(rules, latest?.rules ?? {}))
    fail("This is already the current Definition of Ready.");
  const previous =
    latest ??
    (
      await tx
        .insert(s.readinessRevision)
        .values({
          organizationId,
          projectId,
          number: 1,
          rules: {},
          summary: "Lictory defaults",
          authorId: null,
        })
        .returning()
    )[0]!;
  await tx.insert(s.readinessRevision).values({
    organizationId,
    projectId,
    number: previous.number + 1,
    rules,
    summary: blank(c.summary),
    authorId: userId,
  });
  const closedStatuses = roster.statuses
    .filter((x) => x.projectId === projectId && closed.includes(x.category))
    .map((x) => x.id);
  const keeps = or(
    eq(s.workItem.refinementState, "ready"),
    closedStatuses.length
      ? inArray(s.workItem.statusId, closedStatuses)
      : undefined,
  );
  const inProject = and(
    eq(s.workItem.organizationId, organizationId),
    eq(s.workItem.projectId, projectId),
    isNotNull(s.workItem.refinementState),
  );
  await tx
    .update(s.workItem)
    .set({ readinessRevisionId: previous.id })
    .where(and(inProject, isNull(s.workItem.readinessRevisionId), keeps));
  await tx
    .update(s.workItem)
    .set({ readinessRevisionId: null })
    .where(
      and(inProject, isNotNull(s.workItem.readinessRevisionId), not(keeps!)),
    );
}

// The organization type registry belongs to organization administrators.
export async function applyTypeCommand(
  tx: Tx,
  ctx: Pick<Context, "organizationId" | "userId" | "admin" | "roster">,
  c: TypeCommand,
) {
  const { organizationId, roster } = ctx;
  if (!ctx.admin)
    fail(
      "An organization administrator must manage work item types.",
      "forbidden",
    );
  await auditConfiguration(tx, organizationId, ctx.userId, c);
  const now = new Date();
  if (c.type === "createType") {
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
    // New types are available to every project; projects can opt out.
    if (roster.projects.length)
      await tx.insert(s.projectWorkItemType).values(
        roster.projects.map((p) => ({
          organizationId,
          projectId: p.id,
          typeId: c.typeId,
        })),
      );
    return;
  }
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
    roster.types.filter((x) => !x.archivedAt && x.id !== type.id).length === 0
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
    .where(
      and(
        eq(s.workItemType.organizationId, organizationId),
        eq(s.workItemType.id, type.id),
      ),
    );
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
}
