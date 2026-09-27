"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FolderKanban, Plus } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useWorkspace } from "./provider";
import { CreateProject } from "./onboarding";
import { LabelsAndMilestones } from "./labels-settings";
import { People, Roles } from "./roles-settings";
import {
  TeamsSection,
  TypesSection,
} from "~/components/delivery/team-settings";
import { JiraSection } from "~/components/delivery/delivery-settings";
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
  const { organization, isAdmin, capabilities, directory } = useWorkspace();
  const showLabels = capabilities.changeProperties;
  const nav = [
    { id: "general", label: "General" },
    { id: "projects", label: "Projects" },
    { id: "teams", label: "Teams" },
    { id: "work-item-types", label: "Work item types" },
    { id: "jira", label: "Jira" },
    ...(showLabels ? [{ id: "labels", label: "Labels & milestones" }] : []),
    { id: "people", label: "Members" },
    { id: "roles", label: "Roles" },
  ];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="flex items-center gap-3.5">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-semibold text-primary"
          >
            {organization.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Organization settings
            </h1>
            <p className="truncate text-[13px] text-muted-foreground">
              {organization.name} · {directory.members.length}{" "}
              {directory.members.length === 1 ? "member" : "members"}
              {!isAdmin && " · read-only, ask an administrator to change"}
            </p>
          </div>
        </header>

        <div className="mt-8 gap-10 lg:grid lg:grid-cols-[160px_minmax(0,1fr)]">
          <nav
            aria-label="Settings sections"
            className="hidden lg:sticky lg:top-0 lg:block lg:self-start"
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
              title="People & access"
              description="Who belongs here, who administers it, and what each role may do."
            >
              <People />
              <Roles />
            </SettingsGroup>
          </div>
        </div>
      </div>
    </div>
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
      description="The organization's name, as shown to every member."
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
      </SettingsBody>
    </SettingsSection>
  );
}

function ProjectsSection() {
  const { projects, isAdmin, mutate, delivery } = useWorkspace();
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
            canEdit={isAdmin}
            rename={(name) =>
              mutate({ type: "updateProject", projectId: p.id, name })
            }
            team={
              <Popover
                width={220}
                align="end"
                disabled={!isAdmin}
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
                  options={teams.map((t) => ({ value: t.id, label: t.name }))}
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
