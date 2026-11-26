import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import {
  BookOpenCheck,
  Bot,
  ChevronRight,
  CircleCheckBig,
  FilePenLine,
  FolderKanban,
  FolderOpen,
  History,
  KanbanSquare,
  Lightbulb,
  ListOrdered,
  MessageSquareMore,
  OctagonAlert,
  Send,
  Settings2,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  projectTeams,
  views,
  type Project,
  type ViewId,
} from "@lictory/core/lib/work-items";
import { Popover, Picker } from "@lictory/ui/popover";
import {
  Link,
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { usePanelCollapsed } from "@lictory/platform/lib/panel-preference";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { itemOrigin } from "@lictory/platform/components/items/queues";
import { TypeIcon, storyGlyph } from "@lictory/platform/components/items/icons";
import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";
import {
  SidebarGroup,
  SidebarLink,
  SidebarNote,
  useCompactSidebar,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type { NavSection } from "@lictory/platform/components/shell/nav-registry";

// Work: the project in context (named by the route, or the last one
// visited) with its queues, delivery, teams and saved views; its spaces are
// listed under Spaces. The project is a clear switcher, with its settings
// one click away.
function ProjectsSection() {
  const { projects, organization } = useWorkspace();
  const { project } = useShell();
  const router = useRouter();
  const compact = useCompactSidebar();
  return (
    <SidebarGroup id="projects" label="Projects">
      <ProjectSwitcher
        project={project}
        projects={projects}
        onSelect={(key) => router.push(paths.project(organization.slug, key))}
      />
      {project ? (
        <div className={cn(!compact && "ml-[15px] border-l pl-1.5")}>
          <ProjectNav project={project} />
        </div>
      ) : (
        <SidebarNote>
          {projects.length ? "Choose a project." : "No projects yet."}
        </SidebarNote>
      )}
    </SidebarGroup>
  );
}

function ProjectSwitcher({
  project,
  projects,
  onSelect,
}: {
  project?: Project;
  projects: Project[];
  onSelect: (key: string) => void;
}) {
  const { organization } = useWorkspace();
  const compact = useCompactSidebar();
  const pathname = usePathname();
  const settings = project
    ? paths.projectSettings(organization.slug, project.key)
    : undefined;
  return (
    <div className="group/project flex items-center gap-0.5">
      <Popover
        width={240}
        side={compact ? "right" : "bottom"}
        trigger={(props) => (
          <button
            {...props}
            aria-label={`Switch project: ${project?.name ?? "none"}`}
            title={compact ? (project?.name ?? "Choose project") : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg text-left text-[13px] focus-ring outline-none hover:bg-sidebar-accent/70",
              compact ? "size-8 justify-center" : "h-[30px] flex-1 px-1.5",
            )}
          >
            {project ? (
              // A visual aid drawn as generated content: the button is named
              // after the project, and the key as text would not match that
              // name (WCAG 2.5.3).
              <span
                aria-hidden
                data-key={project.key.slice(0, compact ? 2 : 4)}
                className="grid h-5 min-w-5 shrink-0 place-items-center rounded-md bg-background px-1 font-mono text-[10px] font-semibold text-muted-foreground shadow-(--shadow-border) before:content-[attr(data-key)]"
              />
            ) : (
              <FolderOpen
                className="size-4 text-muted-foreground"
                aria-hidden
              />
            )}
            {!compact && (
              <>
                {/* The whole row switches projects; the name gets the room. */}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {project?.name ?? "Choose project"}
                </span>
              </>
            )}
          </button>
        )}
      >
        <Picker
          title="Projects"
          options={projects.map((p) => ({
            value: p.key,
            label: p.name,
            hint: p.key,
          }))}
          value={project?.key ?? null}
          onSelect={onSelect}
        />
      </Popover>
      {settings && !compact && (
        <Link
          href={settings}
          aria-label="Project settings"
          title="Project settings"
          aria-current={pathname.startsWith(settings) ? "page" : undefined}
          className={cn(
            "grid size-[30px] shrink-0 place-items-center rounded-lg text-muted-foreground focus-ring outline-none hover:bg-sidebar-accent hover:text-foreground",
            pathname.startsWith(settings) &&
              "bg-sidebar-accent text-foreground shadow-(--shadow-border)",
          )}
        >
          <Settings2 className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

// Inside a project the rows follow the work: refine it, deliver it (by the
// project's mode), browse everything, the teams doing it, and saved views
// one click away without crowding the rest.
function ProjectNav({ project }: { project: Project }) {
  const { delivery, directory, organization, userId } = useWorkspace();
  const active = useNavActive();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const org = organization.slug;
  const key = project.key;
  const external = project.deliveryMode === "external";
  const teamParam = searchParams.get("team");
  // An opened item keeps the queue it came from highlighted.
  const origin = pathname.startsWith(`${paths.items(org, key)}/`)
    ? itemOrigin(searchParams)
    : undefined;
  const [viewsOpen, toggleViews] = usePanelCollapsed(
    organization.id,
    "sidebar-views",
  );
  // Teams I belong to first; membership is not access.
  const teams = projectTeams(delivery, project.id)
    .filter((t) => !t.archivedAt)
    .sort(
      (a, b) =>
        Number(b.memberIds.includes(userId)) -
          Number(a.memberIds.includes(userId)) || a.name.localeCompare(b.name),
    );
  const board = paths.board(org, key);
  const backlog = paths.backlog(org, key);
  const catalog = paths.items(org, key);
  const viewActive = views.some(
    (v) => v.id !== "all" && active(paths.view(org, key, v.id)),
  );
  const tool = external
    ? (projectDeliveryTool(directory, project.id).product ?? "External")
    : null;
  // Two stages, named: agreeing on what to build, then building it (or
  // handing it off). Everything and saved views follow.
  return (
    <div className="space-y-0.5 pt-0.5">
      <SidebarGroup label="Refine" className="pt-1">
        <SidebarLink
          href={paths.proposals(org, key)}
          active={active(paths.proposals(org, key)) || origin === "proposals"}
          icon={<Lightbulb />}
        >
          Proposals
        </SidebarLink>
        <SidebarLink
          href={paths.refinement(org, key)}
          active={
            active(paths.refinement(org, key)) ||
            active(paths.view(org, key, "all")) ||
            origin === "refinement"
          }
          icon={<FilePenLine />}
        >
          Refinement
        </SidebarLink>
        <SidebarLink
          href={paths.reviews(org, key)}
          active={active(paths.reviews(org, key)) || origin === "reviews"}
          icon={<BookOpenCheck />}
        >
          Reviews
        </SidebarLink>
      </SidebarGroup>
      <SidebarGroup label="Deliver" className="pt-2">
        {external ? (
          <SidebarLink
            href={paths.handoff(org, key)}
            active={active(paths.handoff(org, key))}
            icon={<Send />}
            trailing={
              // The link is named Hand-off; the tool is a visual hint.
              <span
                aria-hidden
                className="shrink-0 text-[11px] text-muted-foreground"
              >
                {tool}
              </span>
            }
          >
            Hand-off
          </SidebarLink>
        ) : (
          <>
            <SidebarLink
              href={board}
              active={pathname === board && !teamParam}
              icon={<KanbanSquare />}
            >
              Board
            </SidebarLink>
            <SidebarLink
              href={backlog}
              active={
                (pathname === backlog && !teamParam) ||
                active(`/${org}/${key.toLowerCase()}/iterations`)
              }
              icon={<ListOrdered />}
            >
              {project.iterationMode === "manual"
                ? "Backlog & sprints"
                : project.iterationMode === "automatic"
                  ? "Backlog & cycles"
                  : "Backlog"}
            </SidebarLink>
            {/* The project's claimable work (docs/internals/claims.md). */}
            <SidebarLink
              href={paths.factoryQueue(org, key)}
              active={active(paths.factoryQueue(org, key))}
              icon={<Bot />}
            >
              Factory queue
            </SidebarLink>
          </>
        )}
      </SidebarGroup>
      <div className="pt-2" />
      <SidebarLink
        href={catalog}
        active={active(catalog) && !origin}
        icon={<TypeIcon type={storyGlyph} />}
      >
        All items
      </SidebarLink>
      {teams.length > 0 && (
        <SidebarGroup id="project-teams" label="Teams" className="pt-2">
          {teams.map((t) => {
            const href = paths.team(org, key, t.id);
            return (
              <SidebarLink
                key={t.id}
                href={href}
                active={active(href) || teamParam === t.id}
                icon={
                  <span className="grid size-4 place-items-center rounded bg-background text-[9px] font-semibold text-foreground/70 shadow-(--shadow-border)">
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                }
              >
                {t.name}
              </SidebarLink>
            );
          })}
        </SidebarGroup>
      )}
      <ViewsGroup
        open={viewsOpen || viewActive}
        onToggle={toggleViews}
        project={project}
      />
    </div>
  );
}

// Saved views fold away by default; the compact sidebar lists them.
function ViewsGroup({
  open,
  onToggle,
  project,
}: {
  open: boolean;
  onToggle: () => void;
  project: Project;
}) {
  const { organization } = useWorkspace();
  const compact = useCompactSidebar();
  const active = useNavActive();
  const org = organization.slug;
  const links = views
    .filter(
      (v) =>
        v.id !== "needs-my-review" &&
        v.id !== "all" &&
        v.id !== "drafts" &&
        v.id !== "ready",
    )
    .map((v) => (
      <SidebarLink
        key={v.id}
        href={paths.view(org, project.key, v.id)}
        active={active(paths.view(org, project.key, v.id))}
        icon={<ViewIcon view={v.id} />}
      >
        {v.label}
      </SidebarLink>
    ));
  if (compact) return <SidebarGroup label="Views">{links}</SidebarGroup>;
  return (
    <Collapsible open={open} onOpenChange={onToggle} className="pt-2">
      <CollapsibleTrigger className="group mb-0.5 flex h-6 w-full items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground focus-ring outline-none hover:text-foreground">
        Views
        <ChevronRight
          aria-hidden
          className="size-3 transition-transform duration-150 group-data-open:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="space-y-0.5">{links}</CollapsiblePanel>
    </Collapsible>
  );
}

function ViewIcon({ view }: { view: ViewId }) {
  switch (view) {
    case "needs-review":
      return <MessageSquareMore aria-hidden />;
    case "blocked":
      return <OctagonAlert aria-hidden />;
    case "ready":
      return <CircleCheckBig aria-hidden />;
    case "drafts":
      return <FilePenLine aria-hidden />;
    case "updated":
      return <History aria-hidden />;
    case "all":
    case "needs-my-review":
      return null;
  }
}

export const projectsSection: NavSection = {
  id: "projects",
  label: "Projects",
  icon: FolderKanban,
  // The organization's projects are listed in its settings; the sidebar
  // section itself follows the project in context.
  href: (org) => paths.settings(org, "projects"),
  Section: ProjectsSection,
};
