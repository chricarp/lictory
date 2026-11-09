import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useEffect, useState } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { Mail, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { authClient } from "@lictory/platform/lib/auth-client";
import { paths } from "@lictory/core/lib/paths";
import type { Capabilities } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Avatar, Badge } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

export const capabilityMeta: Record<
  keyof Capabilities,
  { label: string; description: string }
> = {
  editSpecifications: {
    label: "Edit specifications",
    description:
      "Create spec-backed items, revise the specification and merge suggestions without going through review of each change.",
  },
  changeProperties: {
    label: "Change properties",
    description:
      "Status, priority, owner, parent, labels, milestones, iterations and ordering.",
  },
  requestReviews: {
    label: "Request reviews",
    description: "Ask a discipline to review a revision, or cancel a request.",
  },
  review: {
    label: "Can be asked to review",
    description:
      "This discipline, or one of its members, can be assigned a review and approve it.",
  },
  publishDelivery: {
    label: "Hand off",
    description:
      "Export ready work to the project's delivery tool and link existing issues.",
  },
};

// Organization members: the application role (Admin / Member) and a summary
// of the projects each person works in. Only administrators change roles.
export function People() {
  const { organization, directory, isAdmin, userId } = useWorkspace();
  const [error, setError] = useState<string>();
  const [invitesVersion, setInvitesVersion] = useState(0);
  const admins = directory.members.filter((m) => m.role === "admin").length;
  const projects = new Map(
    directory.projects.filter((p) => !p.archivedAt).map((p) => [p.id, p]),
  );
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
  };
  return (
    <>
      <SettingsSection
        id="members"
        icon={<Users />}
        title="Members"
        description="Admins manage the organization and every project. What people can do inside a project comes from their project role and disciplines."
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
            const lastAdmin = m.role === "admin" && admins === 1;
            const memberships = directory.projectMembers
              .filter((pm) => pm.userId === m.id && projects.has(pm.projectId))
              .map((pm) => ({ ...pm, project: projects.get(pm.projectId)! }))
              .sort((a, b) => a.project.name.localeCompare(b.project.name));
            return (
              <div
                key={m.id}
                className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]"
              >
                <Avatar image={m.image} name={m.name} size="md" />
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
                    {m.handle && (
                      <>
                        @{m.handle}
                        <span className="mx-1.5 text-muted-foreground/50">
                          ·
                        </span>
                      </>
                    )}
                    {m.email}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {memberships.map((pm) => (
                      <Link
                        key={pm.projectId}
                        href={paths.projectSettings(
                          organization.slug,
                          pm.project.key,
                          "members",
                        )}
                        title={`${pm.project.name}: project ${pm.role}`}
                        className="inline-flex h-5 items-center gap-1 rounded bg-muted px-1.5 text-[11px] text-muted-foreground transition-colors duration-100 hover:text-foreground"
                      >
                        <span className="font-mono font-medium">
                          {pm.project.key}
                        </span>
                        {pm.role === "admin" && <span>· Admin</span>}
                      </Link>
                    ))}
                    {memberships.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {m.role === "admin"
                          ? "Manages every project"
                          : "Not in a project yet"}
                      </span>
                    )}
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
                          ? "Remove organization administration rights"
                          : "Allow managing the organization and every project"
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
            <Invite
              organizationId={organization.id}
              onSent={() => setInvitesVersion((v) => v + 1)}
            />
          </div>
        )}
      </SettingsSection>
      {isAdmin && (
        <PendingInvitations
          organizationId={organization.id}
          version={invitesVersion}
        />
      )}
    </>
  );
}

type PendingInvitation = {
  id: string;
  email: string;
  expiresAt: Date | string;
  placement?: { projectId: string; disciplineIds: string[] } | null;
};

// Pending Better Auth invitations, so a mistaken invitation can be withdrawn.
function PendingInvitations({
  organizationId,
  version,
}: {
  organizationId: string;
  version: number;
}) {
  const { directory } = useWorkspace();
  const [invitations, setInvitations] = useState<PendingInvitation[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    void fetch(
      `/api/invitations?organizationId=${encodeURIComponent(organizationId)}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load invitations.");
        const result = (await response.json()) as PendingInvitation[];
        if (current) {
          setInvitations(result);
          setError(undefined);
        }
      })
      .catch((error) => {
        if (current)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load invitations.",
          );
      });
    return () => {
      current = false;
    };
  }, [organizationId, version]);
  if (!invitations?.length && !error) return null;
  return (
    <SettingsSection
      id="invitations"
      icon={<Mail />}
      title="Pending invitations"
      description="People invited who have not joined yet. Withdrawing an invitation makes its link stop working."
    >
      <SettingsList isEmpty={!invitations?.length} empty="No invitations.">
        {invitations?.map((i) => (
          <div
            key={i.id}
            className="flex items-center gap-3 px-5 py-2.5 text-[13px]"
          >
            <div className="min-w-0 flex-1 truncate">
              <span>{i.email}</span>
              {i.placement && (
                <p className="text-xs text-muted-foreground">
                  Joins{" "}
                  {directory.projects.find(
                    (p) => p.id === i.placement?.projectId,
                  )?.name ?? "unavailable project"}
                  {i.placement.disciplineIds
                    .map(
                      (id) =>
                        directory.disciplines.find(
                          (d) => d.id === id && !d.archivedAt,
                        )?.name,
                    )
                    .filter(Boolean)
                    .map((name) => ` · ${name}`)
                    .join("")}
                </p>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              Expires {new Date(i.expiresAt).toLocaleDateString()}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Withdraw invitation for ${i.email}`}
              onClick={async () => {
                setError(undefined);
                const result = await authClient.organization.cancelInvitation({
                  invitationId: i.id,
                });
                if (result.error) return setError(result.error.message);
                setInvitations((list) => list?.filter((x) => x.id !== i.id));
              }}
            >
              <X className="size-3.5" /> Withdraw
            </Button>
          </div>
        ))}
      </SettingsList>
      {error && (
        <SettingsBody className="py-2">
          <InlineError>{error}</InlineError>
        </SettingsBody>
      )}
    </SettingsSection>
  );
}

// Invitation form. Lives inside Members so "who is here" and "who should be
// here" share one context. Invitations are Better Auth operations.
function Invite({
  organizationId,
  onSent,
}: {
  organizationId: string;
  onSent: () => void;
}) {
  const { directory, isAdmin, userId } = useWorkspace();
  const projects = directory.projects.filter((p) => !p.archivedAt);
  const eligible = projects.filter(
    (p) =>
      isAdmin ||
      directory.projectMembers.some(
        (m) =>
          m.projectId === p.id && m.userId === userId && m.role === "admin",
      ),
  );
  const [projectId, setProjectId] = useState(
    projects.length === 1 && eligible.length === 1 ? eligible[0]!.id : "",
  );
  const [disciplineIds, setDisciplineIds] = useState<string[]>([]);
  const [recipient, setRecipient] = useState("");
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
        setUrl(undefined);
        try {
          const response = await fetch("/api/invitations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId,
              recipient,
              ...(projectId ? { placement: { projectId, disciplineIds } } : {}),
            }),
          });
          const result = (await response.json()) as {
            id?: string;
            error?: { message?: string };
          };
          if (!response.ok || !result.id)
            throw new Error(
              result.error?.message ?? "Could not send the invitation.",
            );
          setUrl(`${window.location.origin}/app/invitation?id=${result.id}`);
          onSent();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not send the invitation. Try again.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-[13px] font-medium">
        <span className="inline-flex items-center gap-1.5">
          <UserPlus className="size-3.5 text-muted-foreground" />
          Invite to the organization
        </span>
        <div className="mt-1.5 flex gap-2">
          <Input
            className="h-8 max-w-sm rounded-md text-sm"
            type="text"
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setUrl(undefined);
            }}
            placeholder="Email or @username"
            required
            aria-label="Teammate email or username"
          />
          <Button
            type="submit"
            size="md"
            variant="secondary"
            disabled={pending}
          >
            {pending ? "Sending…" : "Send invitation"}
          </Button>
        </div>
      </label>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          Project
          <DropdownSelect
            className="w-full"
            aria-label="Invitation project"
            value={projectId}
            onValueChange={(value) => {
              setProjectId(value);
              setDisciplineIds([]);
              setUrl(undefined);
            }}
          >
            <DropdownSelectOption value="">
              Organization only
            </DropdownSelectOption>
            {eligible.map((p) => (
              <DropdownSelectOption key={p.id} value={p.id}>
                {p.name}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        </label>
        {projectId &&
          directory.disciplines
            .filter((d) => d.projectId === projectId && !d.archivedAt)
            .map((d) => (
              <label key={d.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={disciplineIds.includes(d.id)}
                  onChange={(e) => {
                    setDisciplineIds((ids) =>
                      e.target.checked
                        ? [...ids, d.id]
                        : ids.filter((id) => id !== d.id),
                    );
                    setUrl(undefined);
                  }}
                />
                {d.name}
              </label>
            ))}
      </div>
      <p className="text-xs text-muted-foreground">
        People join as members. Project and disciplines are optional and apply
        when they accept.
      </p>
      <InlineError>{error}</InlineError>
      {url && (
        <label className="block text-xs text-muted-foreground">
          Invitation email sent. You can also share this link.
          <input
            className="mt-1.5 w-full rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs touch:text-base"
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
