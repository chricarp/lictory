import { and, eq } from "drizzle-orm";
import * as s from "../../db/schema";
import type { Command, Directory } from "../shared/protocol";
import {
  canDelegateConfigurationRole,
  configurationRoleSchema,
  validConfigurationPermissions,
  configurationPermissionsOf,
  configurationRolesHeldAt,
  effectiveConfigurationRolePermissions,
  canConfigure,
} from "../shared/configuration-access";
import type { Tx } from "./service";
import { DomainError } from "./errors";

type ConfigurationCommand = Extract<
  Command,
  {
    type:
      | "createConfigurationRole"
      | "updateConfigurationRole"
      | "setConfigurationAssignment";
  }
>;
export function isConfigurationCommand(c: Command): c is ConfigurationCommand {
  return (
    c.type === "createConfigurationRole" ||
    c.type === "updateConfigurationRole" ||
    c.type === "setConfigurationAssignment"
  );
}

export async function configurationDirectory(
  tx: Pick<Tx, "select">,
  organizationId: string,
  memberIds: Set<string>,
) {
  const roles = await tx
    .select()
    .from(s.configurationRole)
    .where(eq(s.configurationRole.organizationId, organizationId));
  const assignments = await tx
    .select()
    .from(s.configurationAssignment)
    .where(eq(s.configurationAssignment.organizationId, organizationId));
  return {
    configurationRoles: roles.map((r) =>
      configurationRoleSchema.parse({
        ...r,
        archivedAt: r.archivedAt?.toISOString() ?? null,
      }),
    ),
    configurationAssignments: assignments
      .filter((a) => memberIds.has(a.userId))
      .map((a) => ({
        roleId: a.roleId,
        userId: a.userId,
        scope: a.projectId ? ("project" as const) : ("team" as const),
        scopeId: a.projectId ?? a.teamId!,
      })),
  };
}

export async function auditConfiguration(
  tx: Tx,
  organizationId: string,
  actorId: string,
  command: Command,
  previous?: unknown,
) {
  await tx.insert(s.configurationAudit).values({
    organizationId,
    actorId,
    action: command.type,
    detail: { command, ...(previous === undefined ? {} : { previous }) },
  });
}

export async function applyConfigurationCommand(
  tx: Tx,
  organizationId: string,
  userId: string,
  admin: boolean,
  roster: Directory,
  c: ConfigurationCommand,
) {
  const reject = (
    message: string,
    category: "forbidden" | "validation" | "unavailable" = "forbidden",
  ): never => {
    throw new DomainError(category, message);
  };
  const roles = roster.configurationRoles ?? [];
  const role = roles.find((r) => r.id === c.roleId);
  if (c.type === "setConfigurationAssignment") {
    if (!role) reject("This configuration role is unavailable.", "unavailable");
    const target =
      c.scope === "project"
        ? roster.projects.find((p) => p.id === c.scopeId && !p.archivedAt)
        : roster.teams.find((t) => t.id === c.scopeId && !t.archivedAt);
    if (!target)
      reject("This configuration scope is unavailable.", "unavailable");
    if (!roster.members.some((m) => m.id === c.userId))
      reject(
        "That person is not a member of this organization.",
        "unavailable",
      );
    // Administrators may also remove assignments from an archived template.
    if (
      !(admin && !c.assigned) &&
      !canDelegateConfigurationRole(roster, userId, admin, c, role!)
    )
      reject(
        "You may only assign roles within your own configuration permissions. An access manager must hold every permission being delegated.",
      );
    const match = and(
      eq(s.configurationAssignment.organizationId, organizationId),
      eq(s.configurationAssignment.roleId, c.roleId),
      eq(s.configurationAssignment.userId, c.userId),
      c.scope === "project"
        ? eq(s.configurationAssignment.projectId, c.scopeId)
        : eq(s.configurationAssignment.teamId, c.scopeId),
    );
    const previous = roster.configurationAssignments?.filter(
      (a) =>
        a.roleId === c.roleId &&
        a.userId === c.userId &&
        a.scope === c.scope &&
        a.scopeId === c.scopeId,
    );
    if (c.assigned)
      await tx
        .insert(s.configurationAssignment)
        .values({
          organizationId,
          roleId: c.roleId,
          userId: c.userId,
          projectId: c.scope === "project" ? c.scopeId : null,
          teamId: c.scope === "team" ? c.scopeId : null,
        })
        .onConflictDoNothing();
    else await tx.delete(s.configurationAssignment).where(match);
    await auditConfiguration(tx, organizationId, userId, c, previous);
    return;
  }
  if (c.type === "updateConfigurationRole" && !role)
    reject("This configuration role is unavailable.", "unavailable");
  const scope = c.type === "createConfigurationRole" ? c.scope : role!.scope;
  const scopeId =
    c.type === "createConfigurationRole"
      ? c.scopeId
      : (role!.projectId ?? role!.teamId ?? undefined);
  const parentRoleId =
    c.type === "createConfigurationRole" ? c.parentRoleId : role!.parentRoleId;
  const permissions = c.permissions ?? role!.permissions;
  if (!validConfigurationPermissions(scope, permissions))
    reject("Choose permissions belonging to the role's scope.", "validation");
  if (scopeId) {
    const target =
      scope === "project"
        ? roster.projects.find((p) => p.id === scopeId && !p.archivedAt)
        : roster.teams.find((t) => t.id === scopeId && !t.archivedAt);
    if (!target)
      reject("This configuration scope is unavailable.", "unavailable");
    const definingPermissions =
      c.type === "createConfigurationRole" || c.permissions !== undefined;
    const parent = roles.find((r) => r.id === parentRoleId);
    if (!parent || (definingPermissions && parent.archivedAt))
      return reject(
        "Choose an active parent role to bound this local role.",
        "validation",
      );
    const projectIds =
      scope === "project"
        ? [scopeId]
        : (roster.teams.find((t) => t.id === scopeId)?.projectIds ?? []);
    if (
      definingPermissions &&
      ((parent.projectId && !projectIds.includes(parent.projectId)) ||
        (parent.teamId && (scope !== "team" || parent.teamId !== scopeId)) ||
        (scope === "project" && parent.scope !== "project"))
    )
      reject("The parent role belongs to another scope.", "validation");
    if (
      !admin &&
      c.type === "createConfigurationRole" &&
      !configurationRolesHeldAt(roster, userId, { scope, scopeId }).some(
        (r) => r.id === parent.id,
      )
    )
      reject(
        "Choose a parent role you hold in this scope; local roles cannot bypass an intermediate permission ceiling.",
      );
    const ceiling = effectiveConfigurationRolePermissions(roster, parent);
    if (
      (c.type === "createConfigurationRole" || c.permissions !== undefined) &&
      !permissions.every((p) => ceiling.includes(p))
    )
      reject(
        "A local role cannot exceed its parent role's permissions.",
        "forbidden",
      );
    if (!admin) {
      const targetScope = { scope, scopeId };
      const mine = configurationPermissionsOf(roster, userId, targetScope);
      if (
        !canConfigure(roster, userId, false, targetScope, "manageAccess") ||
        !(
          c.type === "createConfigurationRole" || c.permissions !== undefined
            ? permissions
            : effectiveConfigurationRolePermissions(roster, {
                ...role!,
                ...(c.archived === false ? { archivedAt: null } : {}),
              })
        ).every((p) => mine.has(p))
      )
        reject(
          "You may customize local roles only within your delegated configuration permissions.",
        );
    }
  } else if (!admin || parentRoleId)
    reject(
      "Only organization administrators may define organization role templates.",
    );
  const name = c.name ?? role!.name;
  if (
    (c.type === "createConfigurationRole" ||
      c.archived === false ||
      (!role?.archivedAt && c.name)) &&
    roles.some(
      (r) =>
        r.id !== c.roleId &&
        r.scope === scope &&
        (r.projectId ?? r.teamId ?? undefined) === scopeId &&
        !r.archivedAt &&
        r.name.toLowerCase() === name.toLowerCase(),
    )
  )
    reject("An active configuration role already has this name.", "validation");
  if (c.type === "createConfigurationRole")
    await tx.insert(s.configurationRole).values({
      id: c.roleId,
      organizationId,
      name,
      scope,
      projectId: scope === "project" ? (scopeId ?? null) : null,
      teamId: scope === "team" ? (scopeId ?? null) : null,
      parentRoleId: parentRoleId ?? null,
      permissions: [...new Set(permissions)],
    });
  else
    await tx
      .update(s.configurationRole)
      .set({
        name,
        permissions: [...new Set(permissions)],
        ...(c.archived === undefined
          ? {}
          : { archivedAt: c.archived ? new Date() : null }),
      })
      .where(
        and(
          eq(s.configurationRole.organizationId, organizationId),
          eq(s.configurationRole.id, c.roleId),
        ),
      );
  await auditConfiguration(tx, organizationId, userId, c, role);
}
