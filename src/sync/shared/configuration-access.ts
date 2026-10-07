import { z } from "zod";

export const configurationPermissions = [
  "projectSettings",
  "projectTaxonomy",
  "teamSettings",
  "teamWorkflow",
  "teamTypes",
  "teamMembers",
  "teamIterations",
  "deliveryMode",
  "integrations",
  "manageAccess",
] as const;
export type ConfigurationPermission = (typeof configurationPermissions)[number];
export const configurationScopeSchema = z.enum(["project", "team"]);
export const configurationRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: configurationScopeSchema,
  permissions: z.array(z.enum(configurationPermissions)),
  archivedAt: z.string().nullable(),
  projectId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  parentRoleId: z.string().nullable().optional(),
});
export type ConfigurationRole = z.infer<typeof configurationRoleSchema>;
export const configurationAssignmentSchema = z.object({
  roleId: z.string(),
  userId: z.string(),
  scope: configurationScopeSchema,
  scopeId: z.string(),
});
export type ConfigurationAssignment = z.infer<
  typeof configurationAssignmentSchema
>;
export type ConfigurationScope = { scope: "project" | "team"; scopeId: string };
type AccessDirectory = {
  teams?: { id: string; projectIds?: string[]; archivedAt?: string | null }[];
  projects?: { id: string; archivedAt?: string | null }[];
  configurationRoles?: ConfigurationRole[];
  configurationAssignments?: ConfigurationAssignment[];
};

export function validConfigurationPermissions(
  scope: ConfigurationScope["scope"],
  permissions: readonly ConfigurationPermission[],
) {
  return permissions.every(
    (p) =>
      p === "manageAccess" ||
      p === "integrations" ||
      p === "deliveryMode" ||
      scope === "project" ||
      p.startsWith("team"),
  );
}

export function configurationPermissionsOf(
  directory: AccessDirectory,
  userId: string,
  target: ConfigurationScope,
): Set<ConfigurationPermission> {
  return new Set(
    configurationRolesHeldAt(directory, userId, target).flatMap((r) =>
      effectiveConfigurationRolePermissions(directory, r),
    ),
  );
}

export function configurationRolesHeldAt(
  directory: AccessDirectory,
  userId: string,
  target: ConfigurationScope,
): ConfigurationRole[] {
  if (
    target.scope === "team" &&
    directory.teams?.find((t) => t.id === target.scopeId)?.archivedAt
  )
    return [];
  if (
    target.scope === "project" &&
    directory.projects?.find((p) => p.id === target.scopeId)?.archivedAt
  )
    return [];
  const projectIds =
    target.scope === "team"
      ? (directory.teams?.find((t) => t.id === target.scopeId)?.projectIds ??
        [])
      : [];
  const roleIds = new Set(
    directory.configurationAssignments
      ?.filter(
        (a) =>
          a.userId === userId &&
          ((a.scope === target.scope && a.scopeId === target.scopeId) ||
            (a.scope === "project" &&
              projectIds.includes(a.scopeId) &&
              !directory.projects?.find((p) => p.id === a.scopeId)
                ?.archivedAt)),
      )
      .map((a) => a.roleId),
  );
  return (
    directory.configurationRoles?.filter(
      (r) => !r.archivedAt && roleIds.has(r.id),
    ) ?? []
  );
}

// Each local role is bounded by its parent, including later reductions and archive.
export function effectiveConfigurationRolePermissions(
  directory: AccessDirectory,
  role: ConfigurationRole,
  seen = new Set<string>(),
): ConfigurationPermission[] {
  if (role.archivedAt || seen.has(role.id)) return [];
  if (
    (role.projectId &&
      directory.projects?.find((p) => p.id === role.projectId)?.archivedAt) ||
    (role.teamId &&
      directory.teams?.find((t) => t.id === role.teamId)?.archivedAt)
  )
    return [];
  if (!role.parentRoleId) return role.permissions;
  const parent = directory.configurationRoles?.find(
    (r) => r.id === role.parentRoleId,
  );
  if (!parent) return [];
  if (
    role.teamId &&
    parent.projectId &&
    !directory.teams
      ?.find((t) => t.id === role.teamId)
      ?.projectIds?.includes(parent.projectId)
  )
    return [];
  seen.add(role.id);
  const ceiling = effectiveConfigurationRolePermissions(
    directory,
    parent,
    seen,
  );
  return role.permissions.filter((p) => ceiling.includes(p));
}

export function canConfigure(
  directory: AccessDirectory,
  userId: string,
  admin: boolean,
  target: ConfigurationScope,
  permission: ConfigurationPermission,
) {
  return (
    admin ||
    configurationPermissionsOf(directory, userId, target).has(permission)
  );
}

export function canDelegateConfigurationRole(
  directory: AccessDirectory,
  userId: string,
  admin: boolean,
  target: ConfigurationScope,
  role: ConfigurationRole,
) {
  if (
    role.archivedAt ||
    role.scope !== target.scope ||
    (role.projectId && role.projectId !== target.scopeId) ||
    (role.teamId && role.teamId !== target.scopeId)
  )
    return false;
  if (admin) return true;
  const mine = configurationPermissionsOf(directory, userId, target);
  return (
    mine.has("manageAccess") &&
    effectiveConfigurationRolePermissions(directory, role).every((p) =>
      mine.has(p),
    )
  );
}
