import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";
import { useState } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  FolderKanban,
  Plus,
  Settings2,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { byType, type Project } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Tooltip } from "@lictory/ui/tooltip";
import { Badge } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { CreateProject } from "@lictory/platform/components/workspace/onboarding";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

// Active and archived projects. Live entities win over the directory so an
// archive or rename shows up without waiting for the next directory refresh.
function useAllProjects() {
  const { view, directory } = useWorkspace();
  const byId = new Map<string, Project>(
    directory.projects.map((p) => [p.id, p]),
  );
  for (const p of byType(Object.values(view.entities), "project"))
    byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function OrganizationProjects() {
  const { isAdmin, organization } = useWorkspace();
  const all = useAllProjects();
  const active = all.filter((p) => !p.archivedAt);
  const archived = all.filter((p) => p.archivedAt);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      <SettingsSection
        id="projects"
        icon={<FolderKanban />}
        title="Projects"
        description="A project is a product area with its own key, workflow, delivery and people. Configure each one in its settings. Archiving hides a project and keeps its work; restore it at any time."
        action={
          isAdmin && !creating ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5" /> New project
            </Button>
          ) : undefined
        }
      >
        <SettingsList isEmpty={active.length === 0} empty="No active projects.">
          {active.map((p) => (
            <ProjectRow key={p.id} project={p} onError={setError} />
          ))}
        </SettingsList>
        {archived.length > 0 && (
          <div className="border-t border-border">
            <button
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="inline-flex items-center gap-1 px-5 py-3 text-xs text-muted-foreground transition-colors duration-100 hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform duration-150",
                  showArchived && "rotate-180",
                )}
              />
              {archived.length} archived project
              {archived.length === 1 ? "" : "s"}
            </button>
            {showArchived && (
              <div className="divide-y divide-border border-t border-border">
                {archived.map((p) => (
                  <ProjectRow key={p.id} project={p} onError={setError} />
                ))}
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="border-t border-border px-5 py-3">
            <InlineError>{error}</InlineError>
          </div>
        )}
        {isAdmin && creating && (
          <div className="border-t border-border bg-muted/40 px-5 pb-5">
            <div className="flex items-center justify-between pt-4">
              <div>
                <p className="text-[13px] font-medium">New project</p>
                <p className="text-xs text-muted-foreground">
                  It starts with the default workflow, every work item type and
                  the Product, Engineering and QA disciplines. You become its
                  admin.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
            <div className="[&>form]:mt-4 [&>form]:max-w-md">
              <CreateProject
                withDescription
                onDone={() => setCreating(false)}
                destination={(key) =>
                  paths.projectSettings(organization.slug, key)
                }
              />
            </div>
          </div>
        )}
      </SettingsSection>
      {!isAdmin && (
        <ReadOnlyNotice>
          Only organization administrators create and archive projects.
        </ReadOnlyNotice>
      )}
    </>
  );
}

function ProjectRow({
  project,
  onError,
}: {
  project: Project;
  onError: (error: string | undefined) => void;
}) {
  const { organization, directory, isAdmin, canManage, mutate, memberName } =
    useWorkspace();
  const [pending, setPending] = useState(false);
  const members = directory.projectMembers.filter(
    (m) => m.projectId === project.id,
  );
  const admins = members.filter((m) => m.role === "admin");
  const archived = Boolean(project.archivedAt);
  const toggleArchive = async () => {
    onError(undefined);
    setPending(true);
    try {
      await mutate({
        type: "archiveProject",
        projectId: project.id,
        archived: !archived,
      });
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : `${project.name} was not ${archived ? "restored" : "archived"}.`,
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 py-2.5 text-[13px]",
        archived && "opacity-70",
      )}
    >
      <span className="inline-flex h-5 min-w-12 items-center justify-center rounded bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground">
        {project.key}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{project.name}</span>
          <Badge
            tone={project.deliveryMode === "external" ? "info" : "neutral"}
          >
            {project.deliveryMode === "external"
              ? (projectDeliveryTool(directory, project.id).product ??
                "External")
              : "Lictory"}
          </Badge>
          {project.sample && <Badge>Sample</Badge>}
          {archived && <Badge>Archived</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {members.length} {members.length === 1 ? "member" : "members"}
          <span className="mx-1.5 text-muted-foreground/50">·</span>
          {admins.length
            ? `Admins: ${admins.map((a) => memberName(a.userId)).join(", ")}`
            : "No project admins; organization admins manage it"}
        </p>
      </div>
      {!archived && (
        <Tooltip
          label={canManage(project.id) ? "Project settings" : "View settings"}
        >
          <Link
            href={paths.projectSettings(organization.slug, project.key)}
            aria-label={`${project.name} settings`}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
          </Link>
        </Tooltip>
      )}
      {isAdmin && (
        <Tooltip label={archived ? "Restore" : "Archive"}>
          <Button
            size="icon"
            variant="ghost"
            disabled={pending}
            aria-label={
              archived
                ? `Restore project ${project.name}`
                : `Archive project ${project.name}`
            }
            onClick={() => void toggleArchive()}
          >
            {archived ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
