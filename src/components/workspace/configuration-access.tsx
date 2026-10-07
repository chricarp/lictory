"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "~/components/ui/dropdown-select";
import { Badge } from "~/components/ui/primitives";
import {
  canDelegateConfigurationRole,
  canConfigure,
  configurationPermissionsOf,
  configurationRolesHeldAt,
  effectiveConfigurationRolePermissions,
  configurationPermissions,
  type ConfigurationPermission,
  type ConfigurationRole,
  type ConfigurationScope,
} from "~/sync/shared/configuration-access";
import { useWorkspace } from "./provider";
import { InlineError, SettingsBody, SettingsSection } from "./settings-section";

const labels: Record<ConfigurationPermission, string> = {
  projectSettings: "Project name and default team",
  projectTaxonomy: "Project labels and milestones",
  teamSettings: "Team details, estimates and iteration schedule",
  teamWorkflow: "Team workflow statuses",
  teamTypes: "Enabled organization work item types",
  teamMembers: "Team membership",
  teamIterations: "Plan, start and complete team iterations",
  deliveryMode: "Choose native or external delivery",
  integrations: "Manage team delivery credentials and export mapping",
  manageAccess: "Manage local role assignments",
};

function PermissionChoices({
  scope,
  permissions,
  disabled,
  onChange,
}: {
  scope: ConfigurationScope["scope"];
  permissions: ConfigurationPermission[];
  disabled?: boolean;
  onChange: (permissions: ConfigurationPermission[]) => void;
}) {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2 text-[13px]">
      <legend className="mb-2 font-medium">Configuration permissions</legend>
      {configurationPermissions
        .filter(
          (p) =>
            p === "manageAccess" ||
            p === "deliveryMode" ||
            p === "integrations" ||
            scope === "project" ||
            p.startsWith(scope),
        )
        .map((p) => (
          <label key={p} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={permissions.includes(p)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...permissions, p]
                    : permissions.filter((v) => v !== p),
                )
              }
            />
            {labels[p]}
          </label>
        ))}
    </fieldset>
  );
}

export function ConfigurationRoles() {
  const { directory, isAdmin, mutate, userId, projects } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ConfigurationScope["scope"]>("project");
  const [permissions, setPermissions] = useState<ConfigurationPermission[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const targets = [
    ...projects
      .filter((p) => !p.archivedAt)
      .map((p) => ({ scope: "project" as const, scopeId: p.id, name: p.name })),
    ...directory.teams
      .filter((t) => !t.archivedAt)
      .map((t) => ({ scope: "team" as const, scopeId: t.id, name: t.name })),
  ].filter((t) => canConfigure(directory, userId, isAdmin, t, "manageAccess"));
  const [targetKey, setTargetKey] = useState("");
  const [parentRoleId, setParentRoleId] = useState("");
  const target =
    targets.find((t) => `${t.scope}:${t.scopeId}` === targetKey) ??
    (!isAdmin ? targets[0] : undefined);
  const selectedScope = target?.scope ?? scope;
  const parentProjectIds =
    target?.scope === "project"
      ? [target.scopeId]
      : (directory.teams.find((t) => t.id === target?.scopeId)?.projectIds ??
        []);
  const parents = (directory.configurationRoles ?? []).filter(
    (r) =>
      !r.archivedAt &&
      (isAdmin ||
        (!!target &&
          configurationRolesHeldAt(directory, userId, target).some(
            (held) => held.id === r.id,
          ))) &&
      (!r.projectId || parentProjectIds.includes(r.projectId)) &&
      (!r.teamId ||
        (target?.scope === "team" && r.teamId === target.scopeId)) &&
      (target?.scope !== "project" || r.scope === "project"),
  );
  return (
    <SettingsSection
      id="configuration-roles"
      icon={<ShieldCheck />}
      title="Configuration roles"
      description="Roles inherit permission limits from above and apply to projects and their teams. These roles do not grant specification editing, approval rights or organization administration."
      action={
        (isAdmin || targets.length > 0) && !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreating(true)}
          >
            Add configuration role
          </Button>
        ) : undefined
      }
    >
      <SettingsBody className="flex flex-col gap-4">
        {(directory.configurationRoles ?? []).map((role) => (
          <ConfigurationRoleCard key={role.id} role={role} />
        ))}
        {!directory.configurationRoles?.length && (
          <p className="text-[13px] text-muted-foreground">
            No local configuration roles yet. Organization administrators can
            define permissions, then assign them below.
          </p>
        )}
        {creating && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(undefined);
              try {
                await mutate({
                  type: "createConfigurationRole",
                  roleId: crypto.randomUUID(),
                  name,
                  scope: selectedScope,
                  ...(target ? { scopeId: target.scopeId, parentRoleId } : {}),
                  permissions,
                });
                setCreating(false);
                setName("");
                setPermissions([]);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Could not create configuration role.",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="flex flex-col gap-1 text-[13px]">
              Configuration role name
              <Input
                aria-label="Configuration role name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
              />
            </label>

            <DropdownSelect
              aria-label="Role definition scope"
              value={
                target ? `${target.scope}:${target.scopeId}` : "organization"
              }
              onValueChange={(v) => {
                setTargetKey(v);
                setParentRoleId("");
                setPermissions([]);
              }}
            >
              {isAdmin && (
                <DropdownSelectOption value="organization">
                  Organization template
                </DropdownSelectOption>
              )}
              {targets.map((t) => (
                <DropdownSelectOption
                  key={`${t.scope}:${t.scopeId}`}
                  value={`${t.scope}:${t.scopeId}`}
                >
                  {t.name} · {t.scope}
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
            {!target && (
              <DropdownSelect
                aria-label="Configuration role scope"
                value={scope}
                onValueChange={(v) => {
                  setScope(v as typeof scope);
                  setPermissions([]);
                }}
              >
                <DropdownSelectOption value="project">
                  Project
                </DropdownSelectOption>
                <DropdownSelectOption value="team">Team</DropdownSelectOption>
              </DropdownSelect>
            )}
            {target && (
              <DropdownSelect
                aria-label="Parent configuration role"
                placeholder="Choose parent role"
                value={parentRoleId}
                onValueChange={(v) => {
                  setParentRoleId(v);
                  setPermissions([]);
                }}
              >
                {parents.map((r) => (
                  <DropdownSelectOption key={r.id} value={r.id}>
                    {r.name}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
            )}
            <PermissionChoices
              scope={selectedScope}
              permissions={permissions}
              onChange={(next) => {
                const parent = parents.find((r) => r.id === parentRoleId);
                const ceiling = parent
                  ? effectiveConfigurationRolePermissions(directory, parent)
                  : [];
                const mine =
                  target && !isAdmin
                    ? configurationPermissionsOf(directory, userId, target)
                    : undefined;
                setPermissions(
                  target
                    ? next.filter(
                        (p) => ceiling.includes(p) && (!mine || mine.has(p)),
                      )
                    : next,
                );
              }}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              Local roles are bounded by their parent role. Managers may
              customize and delegate only permissions they already hold.
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  pending || !name.trim() || (!!target && !parentRoleId)
                }
              >
                Create configuration role
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
            <InlineError>{error}</InlineError>
          </form>
        )}
      </SettingsBody>
    </SettingsSection>
  );
}

function ConfigurationRoleCard({ role }: { role: ConfigurationRole }) {
  const { isAdmin, mutate, directory, userId } = useWorkspace();
  const roleTarget = role.projectId
    ? { scope: "project" as const, scopeId: role.projectId }
    : role.teamId
      ? { scope: "team" as const, scopeId: role.teamId }
      : undefined;
  const editable =
    isAdmin ||
    (!!roleTarget &&
      canConfigure(directory, userId, false, roleTarget, "manageAccess"));
  const [draftPermissions, setDraftPermissions] =
    useState<ConfigurationPermission[]>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const update = async (patch: {
    permissions?: ConfigurationPermission[];
    archived?: boolean;
    name?: string;
  }) => {
    if (patch.permissions) setDraftPermissions(patch.permissions);
    setPending(true);
    setError(undefined);
    try {
      await mutate({
        type: "updateConfigurationRole",
        roleId: role.id,
        ...patch,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not update configuration role.",
      );
    } finally {
      setDraftPermissions(undefined);
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        {editable && !role.archivedAt ? (
          <Input
            key={role.name}
            aria-label={`Configuration role name ${role.name}`}
            defaultValue={role.name}
            disabled={pending}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              if (name && name !== role.name) void update({ name });
            }}
          />
        ) : (
          <span className="flex-1 text-sm font-medium">{role.name}</span>
        )}
        <Badge>
          {role.projectId
            ? directory.projects.find((p) => p.id === role.projectId)?.name
            : role.teamId
              ? directory.teams.find((t) => t.id === role.teamId)?.name
              : "Organization template"}{" "}
          · {role.scope}
        </Badge>
        {role.archivedAt && <Badge>Archived</Badge>}
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => void update({ archived: !role.archivedAt })}
          >
            {role.archivedAt ? "Restore" : "Archive"}
          </Button>
        )}
      </div>
      <PermissionChoices
        scope={role.scope}
        permissions={draftPermissions ?? role.permissions}
        disabled={!editable || pending || !!role.archivedAt}
        onChange={(permissions) => void update({ permissions })}
      />
      {role.parentRoleId && (
        <p className="text-xs text-muted-foreground">
          Bounded by{" "}
          {directory.configurationRoles?.find((r) => r.id === role.parentRoleId)
            ?.name ?? "unavailable parent"}
          . {effectiveConfigurationRolePermissions(directory, role).length} of{" "}
          {role.permissions.length} configured permissions currently apply.
        </p>
      )}
      <InlineError>{error}</InlineError>
    </div>
  );
}

export function ConfigurationAccess({
  target,
}: {
  target?: ConfigurationScope;
}) {
  const { directory, projects, userId, isAdmin, mutate, memberName } =
    useWorkspace();
  const scopes = [
    ...projects
      .filter((p) => !p.archivedAt)
      .map((p) => ({ scope: "project" as const, scopeId: p.id, name: p.name })),
    ...directory.teams
      .filter((t) => !t.archivedAt)
      .map((t) => ({ scope: "team" as const, scopeId: t.id, name: t.name })),
  ];
  const [selected, setSelected] = useState("");
  const current =
    target ??
    scopes.find((s) => `${s.scope}:${s.scopeId}` === selected) ??
    scopes[0];
  const [roleId, setRoleId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (!current) return null;
  const roles = directory.configurationRoles ?? [];
  const available = roles.filter((r) =>
    canDelegateConfigurationRole(directory, userId, isAdmin, current, r),
  );
  const assignments = (directory.configurationAssignments ?? []).filter(
    (a) => a.scope === current.scope && a.scopeId === current.scopeId,
  );
  const assign = async (roleId: string, userId: string, assigned: boolean) => {
    setPending(true);
    setError(undefined);
    try {
      await mutate({
        type: "setConfigurationAssignment",
        scope: current.scope,
        scopeId: current.scopeId,
        roleId,
        userId,
        assigned,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not change configuration access.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <SettingsSection
      id="configuration-access"
      title="Local configuration access"
      icon={<ShieldCheck />}
      description="Assignments apply only to the selected project or team. Organization policy and role definitions remain authoritative."
    >
      <SettingsBody className="flex flex-col gap-3">
        {!target && (
          <DropdownSelect
            aria-label="Configuration target"
            value={`${current.scope}:${current.scopeId}`}
            onValueChange={(v) => {
              setSelected(v);
              setRoleId("");
            }}
          >
            {scopes.map((s) => (
              <DropdownSelectOption
                key={`${s.scope}:${s.scopeId}`}
                value={`${s.scope}:${s.scopeId}`}
              >
                {s.name} · {s.scope}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        )}
        {assignments.map((a) => {
          const role = roles.find((r) => r.id === a.roleId);
          return (
            <div
              key={`${a.roleId}:${a.userId}`}
              className="flex flex-wrap items-center gap-2 text-[13px]"
            >
              <span className="flex-1">
                {memberName(a.userId)} · {role?.name ?? "Unavailable role"}
                {role?.archivedAt && " (archived, no permissions)"}
              </span>
              {role &&
                (isAdmin ||
                  canDelegateConfigurationRole(
                    directory,
                    userId,
                    false,
                    current,
                    role,
                  )) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void assign(a.roleId, a.userId, false)}
                  >
                    Revoke
                  </Button>
                )}
            </div>
          );
        })}
        {!assignments.length && (
          <p className="text-[13px] text-muted-foreground">
            No configuration roles assigned here.
          </p>
        )}
        {!!available.length && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void assign(roleId, memberId, true);
            }}
          >
            <DropdownSelect
              aria-label="Local configuration role"
              placeholder="Choose role"
              value={available.some((r) => r.id === roleId) ? roleId : ""}
              onValueChange={setRoleId}
              disabled={pending}
            >
              {available.map((r) => (
                <DropdownSelectOption key={r.id} value={r.id}>
                  {r.name}
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
            <DropdownSelect
              aria-label="Configuration member"
              placeholder="Choose member"
              value={memberId}
              onValueChange={setMemberId}
              disabled={pending}
            >
              {directory.members.map((m) => (
                <DropdownSelectOption key={m.id} value={m.id}>
                  {m.name}
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
            <Button
              type="submit"
              disabled={
                pending || !available.some((r) => r.id === roleId) || !memberId
              }
            >
              Assign role
            </Button>
          </form>
        )}
        {!available.length && (
          <p className="text-xs text-muted-foreground">
            An organization administrator or a local access manager with the
            required permissions can change assignments.
          </p>
        )}
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}
