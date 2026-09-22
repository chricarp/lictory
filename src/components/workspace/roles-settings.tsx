"use client";
import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Link2,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { authClient } from "~/lib/auth-client";
import {
  capabilityKeys,
  noCapabilities,
  type Capabilities,
  type Role,
} from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover } from "~/components/ui/popover";
import { PeoplePicker } from "~/components/ui/people-picker";
import { Avatar, Badge } from "~/components/ui/primitives";
import { useWorkspace } from "./provider";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "./settings-section";

export const capabilityMeta: Record<
  keyof Capabilities,
  { label: string; description: string }
> = {
  editSpecifications: {
    label: "Edit Epics and Stories directly",
    description:
      "Create items and save specification revisions without going through a suggestion.",
  },
  changeProperties: {
    label: "Change properties",
    description:
      "Status, priority, owner, epic, labels and milestones, and the label and milestone lists.",
  },
  requestReviews: {
    label: "Request reviews",
    description: "Ask other roles to review a revision, or cancel a request.",
  },
  review: {
    label: "Can be asked to review",
    description:
      "This role, or one of its members, can be assigned a review and approve it.",
  },
};

// People: fixed application roles (Admin / Member) plus the organization roles
// each person holds. Only administrators change either.
export function People() {
  const { organization, directory, isAdmin, userId, engine } = useWorkspace();
  const [error, setError] = useState<string>();
  const activeRoles = directory.roles.filter((r) => !r.archivedAt);
  const admins = directory.members.filter((m) => m.role === "admin").length;
  const setApplicationRole = async (
    memberId: string,
    role: "admin" | "member",
  ) => {
    setError(undefined);
    const result = await authClient.organization.updateMemberRole({
      organizationId: organization.id,
      memberId,
      role,
    });
    if (result.error) return setError(result.error.message);
    // Membership is a Better Auth write: refresh the directory explicitly.
    await engine.sync();
  };
  return (
    <SettingsSection
      id="people"
      icon={<Users />}
      title="Members"
      description="Administrators manage the organization, projects and roles. What a person can do with Epics and Stories comes from the roles they hold."
      action={
        <span className="text-xs text-muted-foreground tabular-nums">
          {directory.members.length}{" "}
          {directory.members.length === 1 ? "member" : "members"}
        </span>
      }
    >
      <SettingsList
        isEmpty={directory.members.length === 0}
        empty="No members."
      >
        {directory.members.map((m) => {
          const held = activeRoles.filter((r) => r.userIds.includes(m.id));
          const lastAdmin = m.role === "admin" && admins === 1;
          return (
            <div
              key={m.id}
              className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]"
            >
              <Avatar name={m.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {m.name}
                    {m.id === userId && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (you)
                      </span>
                    )}
                  </span>
                  {m.role === "admin" && (
                    <Badge tone="info">
                      {m.owner ? "Admin · owner" : "Admin"}
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {m.email}
                  <span className="mx-1.5 text-muted-foreground/50">·</span>
                  {held.length > 0
                    ? held.map((r) => r.name).join(", ")
                    : "No role"}
                </div>
              </div>
              {isAdmin && !m.owner && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={lastAdmin}
                  className="opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100 disabled:group-hover:opacity-50"
                  title={
                    lastAdmin
                      ? "An organization needs at least one administrator."
                      : m.role === "admin"
                        ? "Remove organization management rights"
                        : "Allow managing settings, projects and roles"
                  }
                  onClick={() =>
                    void setApplicationRole(
                      m.memberId,
                      m.role === "admin" ? "member" : "admin",
                    )
                  }
                >
                  <ShieldCheck className="size-3.5" />
                  {m.role === "admin" ? "Make member" : "Make admin"}
                </Button>
              )}
            </div>
          );
        })}
      </SettingsList>
      {error && (
        <SettingsBody className="py-2">
          <InlineError>{error}</InlineError>
        </SettingsBody>
      )}
      {isAdmin && (
        <div className="border-t border-border bg-muted/40 px-5 py-4">
          <Invite organizationId={organization.id} />
        </div>
      )}
    </SettingsSection>
  );
}

// Invitation form. Lives inside Members so "who is here" and "who should be
// here" share one context. Invitations are Better Auth operations.
function Invite({ organizationId }: { organizationId: string }) {
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        setPending(true);
        const result = await authClient.organization.inviteMember({
          organizationId,
          email: email.trim(),
          role: "member",
        });
        setPending(false);
        if (result.error) return setError(result.error.message);
        setUrl(`${window.location.origin}/app/invitation?id=${result.data.id}`);
      }}
    >
      <label className="block text-[13px] font-medium">
        <span className="inline-flex items-center gap-1.5">
          <Link2 className="size-3.5 text-muted-foreground" />
          Invite a teammate
        </span>
        <div className="mt-1.5 flex gap-2">
          <Input
            className="h-8 max-w-sm rounded-md text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            required
            aria-label="Teammate email"
          />
          <Button
            type="submit"
            size="md"
            variant="secondary"
            disabled={pending}
          >
            {pending ? "Creating…" : "Create link"}
          </Button>
        </div>
      </label>
      <InlineError>{error}</InlineError>
      {url && (
        <label className="block text-xs text-muted-foreground">
          Invitation link — share it; they must sign in with this email.
          <input
            className="mt-1.5 w-full rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs"
            readOnly
            value={url}
            aria-label="Invitation link"
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
    </form>
  );
}

// Organization roles: name, capabilities and members. Archiving is reversible
// and keeps every historical review assignment.
export function Roles() {
  const { directory, isAdmin } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const active = directory.roles.filter((r) => !r.archivedAt);
  const archived = directory.roles.filter((r) => r.archivedAt);
  return (
    <SettingsSection
      id="roles"
      icon={<ShieldCheck />}
      title="Roles"
      description="A role bundles capabilities and the people who hold them. Archiving is reversible and keeps every historical review assignment."
      action={
        isAdmin && !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" /> Add role
          </Button>
        ) : undefined
      }
    >
      <SettingsBody className="space-y-3">
        {active.map((role) => (
          <RoleCard key={role.id} role={role} canEdit={isAdmin} />
        ))}
        {active.length === 0 && !creating && (
          <p className="py-4 text-center text-[13px] text-muted-foreground">
            No roles. Nobody can edit, change properties or request reviews
            until an administrator adds one.
          </p>
        )}
        {isAdmin && creating && <NewRole onDone={() => setCreating(false)} />}
      </SettingsBody>
      {archived.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <button
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors duration-100 hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-transform duration-150",
                showArchived && "rotate-180",
              )}
            />
            {archived.length} archived role{archived.length > 1 ? "s" : ""}
          </button>
          {showArchived && (
            <div className="mt-3 space-y-3">
              {archived.map((role) => (
                <RoleCard key={role.id} role={role} canEdit={isAdmin} />
              ))}
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function RoleCard({ role, canEdit }: { role: Role; canEdit: boolean }) {
  const { mutate, directory, memberName } = useWorkspace();
  const [name, setName] = useState(role.name);
  const [error, setError] = useState<string>();
  const update = async (
    patch: Partial<{
      name: string;
      capabilities: Capabilities;
      archived: boolean;
    }>,
  ) => {
    setError(undefined);
    try {
      await mutate({ type: "updateRole", roleId: role.id, ...patch });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role.");
    }
  };
  const editable = canEdit && !role.archivedAt;
  const members = role.userIds
    .map((id) => directory.members.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background p-3",
        role.archivedAt && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        {editable ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (!trimmed) return setName(role.name);
              if (trimmed !== role.name) void update({ name: trimmed });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label={`Role name ${role.name}`}
            className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13px] font-medium outline-none hover:bg-muted focus:bg-muted"
          />
        ) : (
          <span className="flex-1 px-1 text-[13px] font-medium">
            {role.name}
          </span>
        )}
        {role.archivedAt && <Badge>Archived</Badge>}
        {canEdit && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={
              role.archivedAt
                ? `Restore role ${role.name}`
                : `Archive role ${role.name}`
            }
            title={role.archivedAt ? "Restore" : "Archive"}
            onClick={() => void update({ archived: !role.archivedAt })}
          >
            {role.archivedAt ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
          </Button>
        )}
      </div>
      <CapabilityList
        value={role.capabilities}
        disabled={!editable}
        onChange={(capabilities) => void update({ capabilities })}
        idPrefix={role.id}
      />
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {members.map((m) => (
          <span
            key={m.id}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-muted pr-1 pl-0.5 text-xs"
          >
            <Avatar name={m.name} size="xs" />
            {m.name}
            {editable && (
              <button
                aria-label={`Remove ${m.name} from ${role.name}`}
                className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() =>
                  void mutate({
                    type: "setRoleMembership",
                    roleId: role.id,
                    userId: m.id,
                    member: false,
                  })
                }
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {members.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Nobody holds this role yet.
          </span>
        )}
        {editable && (
          <Popover
            width={280}
            trigger={(props) => (
              <button
                {...props}
                aria-label={`Add person to ${role.name}`}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <UserPlus className="size-3.5" /> Add person
              </button>
            )}
          >
            {(close) => (
              <PeoplePicker
                title={`Add to ${role.name}`}
                excludeIds={role.userIds}
                onSelect={(userId) => {
                  void mutate({
                    type: "setRoleMembership",
                    roleId: role.id,
                    userId,
                    member: true,
                  });
                  close();
                }}
              />
            )}
          </Popover>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {/* memberName keeps former members legible if the directory lags. */}
      {role.userIds.length !== members.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {role.userIds
            .filter((id) => !members.some((m) => m.id === id))
            .map(memberName)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

function CapabilityList({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: Capabilities;
  onChange: (next: Capabilities) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
      {capabilityKeys.map((key) => (
        <li key={key}>
          <label
            className={cn(
              "flex items-start gap-2 rounded-md px-1 py-1 text-[13px]",
              !disabled && "cursor-pointer hover:bg-muted",
            )}
          >
            <input
              id={`${idPrefix}-${key}`}
              type="checkbox"
              className="mt-0.5"
              checked={value[key]}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            />
            <span>
              <span className={cn(!value[key] && "text-muted-foreground")}>
                {capabilityMeta[key].label}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {capabilityMeta[key].description}
              </span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function NewRole({ onDone }: { onDone: () => void }) {
  const { mutate } = useWorkspace();
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities>({
    ...noCapabilities,
    review: true,
  });
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-3 rounded-lg border border-dashed border-border bg-muted/40 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setPending(true);
        setError(undefined);
        try {
          await mutate({
            type: "createRole",
            roleId: crypto.randomUUID(),
            name: name.trim(),
            capabilities,
          });
          onDone();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not create role.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-[13px] font-medium">
        Role name
        <Input
          className="mt-1.5 h-8 rounded-md text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Security"
          required
          autoFocus
          aria-label="New role name"
        />
      </label>
      <CapabilityList
        value={capabilities}
        onChange={setCapabilities}
        idPrefix="new-role"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          Create role
        </Button>
      </div>
    </form>
  );
}
