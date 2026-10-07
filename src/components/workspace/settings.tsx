"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FolderKanban, Plus, Sparkles } from "lucide-react";
import { cn } from "~/lib/utils";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useWorkspace } from "./provider";
import { CreateProject } from "./onboarding";
import { OrganizationMark } from "./organization-logo";
import { ACCEPT_LOGO, MAX_LOGO_SIZE, type LogoKind } from "~/branding/logo";
import { LabelsAndMilestones } from "./labels-settings";
import {
  ConfigurationRoles,
  ConfigurationAccess,
} from "./configuration-access";
import { canConfigure } from "~/sync/shared/configuration-access";
import { People, Roles } from "./roles-settings";
import {
  TeamsSection,
  TypesSection,
} from "~/components/delivery/team-settings";
import { JiraSection } from "~/components/delivery/delivery-settings";
import { IntelligenceContextSection } from "~/components/intelligence/context-settings";
import { Popover, Picker } from "~/components/ui/popover";
import {
  InlineError,
  SettingsBody,
  SettingsGroup,
  SettingsList,
  SettingsSection,
} from "./settings-section";

// Organization-level settings. Membership and invitations remain Better Auth
// operations; projects are organization-wide in this baseline.
//
// The page is divided into two contexts: what the workspace contains
// (organization, projects, labels and milestones) and who can do what in it
// (members and roles).
export function Settings() {
  const { organization, isAdmin, capabilities, directory, userId, projects } =
    useWorkspace();
  const showLabels =
    capabilities.changeProperties ||
    projects.some((p) =>
      canConfigure(
        directory,
        userId,
        isAdmin,
        { scope: "project", scopeId: p.id },
        "projectTaxonomy",
      ),
    );
  const nav = [
    { id: "general", label: "General" },
    { id: "projects", label: "Projects" },
    { id: "teams", label: "Teams" },
    { id: "work-item-types", label: "Work item types" },
    { id: "jira", label: "Jira" },
    { id: "ai", label: "Lictory AI" },
    { id: "intelligence-context", label: "AI context" },
    ...(showLabels ? [{ id: "labels", label: "Labels & milestones" }] : []),
    { id: "people", label: "Members" },
    { id: "roles", label: "Roles" },
    { id: "configuration-roles", label: "Configuration roles" },
    { id: "configuration-access", label: "Local access" },
  ];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="flex items-center gap-3.5">
          {organization.logos.mark ? (
            <OrganizationMark
              organization={organization}
              className="size-10 rounded-xl"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-semibold text-primary"
            >
              {organization.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Organization settings
            </h1>
            <p className="truncate text-[13px] text-muted-foreground">
              {organization.name} · {directory.members.length}{" "}
              {directory.members.length === 1 ? "member" : "members"}
              {!isAdmin && " · available controls depend on your roles"}
            </p>
          </div>
        </header>

        <div className="mt-8 gap-10 lg:grid lg:grid-cols-[160px_minmax(0,1fr)]">
          <nav
            aria-label="Settings sections"
            className="hidden pt-14 lg:sticky lg:top-0 lg:block lg:self-start"
          >
            <ul className="space-y-0.5">
              {nav.map((n) => (
                <li key={n.id}>
                  <a
                    href={`#${n.id}`}
                    className="block rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
                  >
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-10">
            <SettingsGroup
              title="Workspace"
              description="What this organization contains and how it is named."
            >
              <GeneralSection />
              <ProjectsSection />
              {showLabels && <LabelsAndMilestones />}
            </SettingsGroup>

            <SettingsGroup
              title="Delivery"
              description="Teams, their workflows, and the kinds of work items the organization uses."
            >
              <TeamsSection />
              <TypesSection />
              <JiraSection />
            </SettingsGroup>

            <SettingsGroup
              title="Lictory Intelligence"
              description="Whether Lictory AI may run, and what it knows about how you work."
            >
              <AiSection />
              <IntelligenceContextSection />
            </SettingsGroup>

            <SettingsGroup
              title="People & access"
              description="Who belongs here, who administers it, and what each role may do."
            >
              <People />
              <Roles />
              <ConfigurationRoles />
              <ConfigurationAccess />
            </SettingsGroup>
          </div>
        </div>
      </div>
    </div>
  );
}

// Organization content is sent to the AI provider only after an administrator
// opts in. Turning it off stops queued runs before anything is sent.
function AiSection() {
  const { isAdmin, directory, mutate } = useWorkspace();
  const { enabled, available } = directory.ai;
  const [error, setError] = useState("");
  return (
    <SettingsSection
      id="ai"
      icon={<Sparkles />}
      title="Lictory AI"
      description="AI reviews of work items and Lictory Action on pull requests. AI proposes findings and changes; people decide what becomes part of a specification."
      action={
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Allow Lictory AI"
          disabled={!isAdmin || (!available && !enabled)}
          onClick={async () => {
            setError("");
            try {
              await mutate({ type: "setAiPolicy", enabled: !enabled });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Not saved.");
            }
          }}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
            enabled ? "bg-primary" : "bg-muted-foreground/25",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
              enabled ? "translate-x-4.5" : "translate-x-0.5",
            )}
          />
        </button>
      }
      footer={
        available
          ? "When enabled, the content of reviewed items (specifications, open discussions, pull request changes) and the Lictory Intelligence Context that applies to them is sent to OpenAI without being retained for training. Each team chooses how Lictory Action treats its pull requests in team settings."
          : "This server has no AI provider configured. Set OPENAI_API_KEY to make Lictory AI available."
      }
    >
      <SettingsBody className="space-y-1 text-[13px]">
        <p>
          {enabled
            ? "Enabled. Members who can request reviews can ask for AI reviews."
            : "Off. No content is sent to an AI provider."}
          {!isAdmin && " Only administrators can change this."}
        </p>
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}

function GeneralSection() {
  const { organization, isAdmin } = useWorkspace();
  const router = useRouter();
  return (
    <SettingsSection
      id="general"
      icon={<Building2 />}
      title="General"
      description="The organization's name and logos, as shown to every member."
    >
      <SettingsBody>
        {isAdmin ? (
          <RenameOrganization
            name={organization.name}
            onRename={async (name) => {
              const result = await authClient.organization.update({
                organizationId: organization.id,
                data: { name },
              });
              if (result.error) throw new Error(result.error.message);
              router.refresh();
            }}
          />
        ) : (
          <dl className="grid gap-1 text-[13px]">
            <dt className="text-xs text-muted-foreground">Organization name</dt>
            <dd className="font-medium">{organization.name}</dd>
          </dl>
        )}
        <Branding />
      </SettingsBody>
    </SettingsSection>
  );
}

const logoFields: {
  kind: LogoKind;
  label: string;
  hint: string;
  preview: string;
}[] = [
  {
    kind: "mark",
    label: "Logomark",
    hint: "Square symbol, at least 64×64. Shown when the sidebar is collapsed and in the organization list.",
    preview: "size-12",
  },
  {
    kind: "full",
    label: "Full logo",
    hint: "Wide logo including the name, about 6:1. Replaces the name in the sidebar.",
    preview: "h-12 w-48",
  },
];

// Branding is optional; without a logomark the organization's initial is
// used, and without a full logo the name is shown as text.
function Branding() {
  const { organization, isAdmin, engine } = useWorkspace();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<LogoKind | null>(null);
  const change = async (kind: LogoKind, file: File | null) => {
    setError("");
    setPending(kind);
    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organization.id)}/logo/${kind}`,
        file
          ? {
              method: "PUT",
              body: file,
              headers: {
                "Content-Type": file.type || "application/octet-stream",
              },
            }
          : { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "The logo was not saved.");
      }
      await engine.sync();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The logo was not saved.");
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="mt-5 space-y-4 border-t border-border pt-5">
      {logoFields.map((field) => {
        const src = organization.logos[field.kind];
        const inputId = `organization-logo-${field.kind}`;
        return (
          <div key={field.kind} className="flex items-center gap-4">
            <div
              className={cn(
                "grid shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 p-1.5",
                field.preview,
              )}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, authenticated image
                <img
                  src={src}
                  alt={`${organization.name} ${field.label.toLowerCase()}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[11px] text-muted-foreground">None</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{field.label}</p>
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
            {isAdmin && (
              <div className="flex shrink-0 gap-1.5">
                <input
                  id={inputId}
                  type="file"
                  accept={ACCEPT_LOGO}
                  className="sr-only"
                  aria-label={`Upload ${field.label.toLowerCase()}`}
                  disabled={pending !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (file) void change(field.kind, file);
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending !== null}
                  onClick={() => document.getElementById(inputId)?.click()}
                >
                  {pending === field.kind
                    ? "Saving…"
                    : src
                      ? "Replace"
                      : "Upload"}
                </Button>
                {src && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null}
                    aria-label={`Remove ${field.label.toLowerCase()}`}
                    onClick={() => void change(field.kind, null)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        PNG, JPEG or WebP up to {MAX_LOGO_SIZE / 1024} KB. Transparent
        backgrounds work best in both light and dark themes.
      </p>
      <InlineError>{error}</InlineError>
    </div>
  );
}

function ProjectsSection() {
  const { projects, isAdmin, mutate, delivery, directory, userId } =
    useWorkspace();
  const teams = [...delivery.teams.values()].filter((t) => !t.archivedAt);
  const [showCreate, setShowCreate] = useState(false);
  return (
    <SettingsSection
      id="projects"
      icon={<FolderKanban />}
      title="Projects"
      description="Each project groups work items; its key prefixes every identifier. New items land in the project's default team."
      action={
        isAdmin && !showCreate ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="size-3.5" /> Add project
          </Button>
        ) : undefined
      }
    >
      <SettingsList isEmpty={projects.length === 0} empty="No projects yet.">
        {projects.map((p) => (
          <ProjectRow
            key={p.id}
            id={p.id}
            name={p.name}
            keyName={p.key}
            canEdit={canConfigure(
              directory,
              userId,
              isAdmin,
              { scope: "project", scopeId: p.id },
              "projectSettings",
            )}
            rename={(name) =>
              mutate({ type: "updateProject", projectId: p.id, name })
            }
            team={
              <Popover
                width={220}
                align="end"
                disabled={
                  !canConfigure(
                    directory,
                    userId,
                    isAdmin,
                    { scope: "project", scopeId: p.id },
                    "projectSettings",
                  )
                }
                trigger={(props) => (
                  <button
                    {...props}
                    className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted disabled:pointer-events-none"
                    title="Team new items land in"
                  >
                    {delivery.teams.get(p.defaultTeamId ?? "")?.name ??
                      "No default team"}
                  </button>
                )}
              >
                <Picker
                  title="Default team"
                  options={teams
                    .filter((t) => !t.projectIds || t.projectIds.includes(p.id))
                    .map((t) => ({ value: t.id, label: t.name }))}
                  value={p.defaultTeamId}
                  onSelect={(defaultTeamId) =>
                    void mutate({
                      type: "updateProject",
                      projectId: p.id,
                      name: p.name,
                      defaultTeamId,
                    })
                  }
                />
              </Popover>
            }
          />
        ))}
      </SettingsList>
      {isAdmin && showCreate && (
        <div className="border-t border-border bg-muted/40 px-5 pb-5">
          <div className="flex items-center justify-between pt-4">
            <p className="text-[13px] font-medium">New project</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
          </div>
          <div className="[&>form]:mt-3 [&>form]:max-w-sm">
            <CreateProject onDone={() => setShowCreate(false)} />
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

function ProjectRow({
  name,
  keyName,
  canEdit,
  rename,
  team,
}: {
  id: string;
  name: string;
  keyName: string;
  canEdit: boolean;
  rename: (name: string) => Promise<unknown>;
  team: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <div className="group flex items-center gap-3 px-5 py-2.5 text-[13px]">
      <span className="inline-flex h-5 min-w-12 items-center justify-center rounded bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground">
        {keyName}
      </span>
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (value.trim() && value.trim() !== name)
              await rename(value.trim());
            setEditing(false);
          }}
        >
          <Input
            className="h-8 rounded-md text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            aria-label="Project name"
          />
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue(name);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="flex-1 truncate font-medium">{name}</span>
          {team}
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => setEditing(true)}
            >
              Rename
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function RenameOrganization({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        setPending(true);
        try {
          await onRename(value.trim());
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not rename.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-[13px] font-medium">
        Organization name
        <div className="mt-1.5 flex gap-2">
          <Input
            className="h-8 max-w-sm rounded-md text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={pending || !value.trim() || value.trim() === name}
          >
            {pending ? "Saving…" : "Rename"}
          </Button>
        </div>
      </label>
      <InlineError>{error}</InlineError>
    </form>
  );
}
