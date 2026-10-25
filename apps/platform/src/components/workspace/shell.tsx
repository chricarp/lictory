import { Link, useLinkStatus } from "@lictory/platform/lib/navigation";
import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";
import { APP_VERSION } from "@lictory/core/lib/app-version";
import { toast as toastManager } from "@lictory/ui/toast";
import { track } from "@lictory/core/lib/analytics/client";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpenCheck,
  CircleCheckBig,
  Check,
  ChevronRight,
  ChevronsUpDown,
  FilePenLine,
  FolderOpen,
  History,
  Inbox,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquareMore,
  OctagonAlert,
  Plus,
  Search,
  Send,
  Settings,
  Settings2,
  ShieldCheck,
  UserRound,
  KanbanSquare,
  ListOrdered,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { signOut } from "@lictory/platform/lib/account";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { workspaceTitle } from "@lictory/platform/lib/document-title";
import {
  rememberProject,
  useLastProjectKey,
} from "@lictory/platform/lib/last-project";
import { usePanelCollapsed } from "@lictory/platform/lib/panel-preference";
import {
  needsMyReview,
  projectTeams,
  views,
  type Project,
  type ViewId,
} from "@lictory/core/lib/work-items";
import type { Directory, WorkItem } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Popover, Picker } from "@lictory/ui/popover";
import { Avatar, Kbd } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useUnreadNotifications } from "@lictory/platform/components/notifications/client";
import type { QuickCreateOptions } from "@lictory/platform/components/workspace/quick-create";
import { SyncStatus } from "@lictory/platform/components/workspace/sync-status";
import { DockProvider } from "@lictory/platform/components/intelligence/dock/store";
import { OrganizationMark } from "@lictory/platform/components/workspace/organization-logo";
import {
  TypeIcon,
  epicGlyph,
  storyGlyph,
} from "@lictory/platform/components/items/icons";

// Overlays open on demand. They carry the Markdown editor and search, so they
// load after the workspace is interactive instead of with every page.
const loadCommandPalette = () =>
  import("@lictory/platform/components/workspace/command-palette").then(
    (m) => m.CommandPalette,
  );
const loadQuickCreate = () =>
  import("@lictory/platform/components/workspace/quick-create").then(
    (m) => m.QuickCreate,
  );
const loadIntelligenceDock = () =>
  import("@lictory/platform/components/intelligence/dock/dock").then(
    (m) => m.IntelligenceDock,
  );
const CommandPalette = lazy(() =>
  loadCommandPalette().then((m) => ({ default: m })),
);
const QuickCreate = lazy(() => loadQuickCreate().then((m) => ({ default: m })));
// Always present, but never needed for the first paint.
const IntelligenceDock = lazy(() =>
  loadIntelligenceDock().then((m) => ({ default: m })),
);

type Organization = Directory["organizations"][number];

type Toast = {
  action?: { label: string; href: string };
};
type ShellContextValue = {
  toast: (text: string, action?: Toast["action"]) => void;
  openPalette: (query?: string) => void;
  openCreate: (options?: QuickCreateOptions) => void;
  setCurrentItem: (item: WorkItem | undefined) => void;
  currentItem: WorkItem | undefined;
  // The project in context: named by the route, or the last one visited.
  project: Project | undefined;
};
const ShellContext = createContext<ShellContextValue | null>(null);
const CollapsedSidebarContext = createContext(false);
export function useShell() {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell requires Shell.");
  return value;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export function Shell({
  user,
  children,
}: {
  user: {
    name: string;
    email: string;
    handle: string | null;
    image?: string | null;
  };
  children: ReactNode;
}) {
  const {
    organization,
    projects,
    items,
    userId,
    disciplineIds,
    directory,
    capabilitiesIn,
  } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });
  const [create, setCreate] = useState<QuickCreateOptions | null>(null);
  const [currentItem, setCurrentItem] = useState<WorkItem>();
  const [drawer, setDrawer] = useState(false);
  const [sidebarCollapsed, toggleSidebarPreference] = usePanelCollapsed(
    organization.id,
    "sidebar",
  );
  const sidebarId = useId();
  const sidebarRef = useRef<HTMLElement>(null);
  const [dockReady, setDockReady] = useState(false);
  const restoreSidebarFocus = useRef(false);
  // Warm the on-demand overlays once the workspace is idle, so the first
  // shortcut opens them without a visible load.
  useEffect(() => {
    const preload = () => {
      void loadCommandPalette();
      void loadQuickCreate();
      setDockReady(true);
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(preload, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 1500);
    return () => clearTimeout(timer);
  }, []);
  const toggleSidebar = () => {
    restoreSidebarFocus.current = true;
    toggleSidebarPreference();
  };
  useEffect(() => {
    if (!restoreSidebarFocus.current) return;
    restoreSidebarFocus.current = false;
    sidebarRef.current
      ?.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")
      ?.focus();
  }, [sidebarCollapsed]);
  const toast = useCallback(
    (text: string, action?: Toast["action"]) => {
      const id = toastManager.add({
        title: text,
        timeout: 6000,
        actionProps: action
          ? {
              children: action.label,
              onClick: () => {
                router.push(action.href);
                toastManager.close(id);
              },
            }
          : undefined,
      });
    },
    [router],
  );
  // The route names the project while browsing it. Organization-level surfaces
  // (Inbox, settings, account) keep the last project in context instead of
  // dropping the person out of it.
  const params = useParams<{ project?: string }>();
  const routeKey = params.project?.toUpperCase();
  const lastKey = useLastProjectKey(organization.id);
  const routeProject = projects.find((p) => p.key === routeKey);
  const project =
    routeProject ?? projects.find((p) => p.key === lastKey) ?? projects[0];
  useEffect(() => {
    if (routeProject) rememberProject(organization.id, routeProject.key);
  }, [routeProject, organization.id]);
  const canCreateIn = useCallback(
    (projectId: string | undefined) => {
      const capabilities = capabilitiesIn(projectId);
      return capabilities.editSpecifications || capabilities.changeProperties;
    },
    [capabilitiesIn],
  );
  const canCreate = canCreateIn(project?.id);
  // The shell owns the document title: it stays mounted across in-workspace
  // navigations, so React updates the hoisted <title> in place instead of the
  // route metadata swapping the node on every page change.
  const title = workspaceTitle(pathname, {
    organization,
    project: routeProject,
    item: currentItem,
  });
  // Creation is authoring: every entry point (button, shortcut, palette)
  // funnels here so a person without the capability gets one clear message.
  const openCreate = useCallback(
    (options?: QuickCreateOptions) => {
      const projectId = options?.projectId ?? project?.id;
      if (!canCreateIn(projectId))
        return toast(
          "Your disciplines in this project cannot create work items. Ask a project administrator for a discipline that edits specifications or changes properties.",
        );
      track("work_item_create_opened", {
        organization_id: organization.id,
        project_id: projectId ?? null,
      });
      // A board or backlog narrowed to a team creates work for that team.
      const team =
        options?.teamId === undefined &&
        projectId === routeProject?.id &&
        /\/(board|backlog)$/.test(window.location.pathname)
          ? new URLSearchParams(window.location.search).get("team")
          : null;
      setCreate({
        kind: "story",
        ...options,
        projectId,
        teamId: options?.teamId ?? (team && team !== "none" ? team : null),
      });
    },
    [project?.id, routeProject?.id, canCreateIn, toast, organization.id],
  );
  const openPalette = useCallback(
    (query = "") => {
      track("command_palette_opened", { organization_id: organization.id });
      setPalette({ open: true, query });
    },
    [organization.id],
  );
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawer(false);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!palette.open) openPalette();
        else setPalette({ open: false, query: "" });
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (event.key === "c" && project) {
        event.preventDefault();
        openCreate({ kind: pathname.includes("/epics") ? "epic" : "story" });
      } else if (event.key === "/") {
        event.preventDefault();
        openPalette("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, pathname, openCreate, openPalette, palette.open]);
  const inboxCount = useMemo(
    () => items.filter((i) => needsMyReview(i, userId, disciplineIds)).length,
    [items, userId, disciplineIds],
  );
  const shell = useMemo<ShellContextValue>(
    () => ({
      toast,
      openPalette,
      openCreate,
      setCurrentItem,
      currentItem,
      project,
    }),
    [toast, openPalette, openCreate, currentItem, project],
  );
  const sidebar = (collapsed = false) => (
    <Sidebar
      collapsed={collapsed}
      organization={organization}
      organizations={directory.organizations}
      projects={projects}
      project={project}
      pathname={pathname}
      inboxCount={inboxCount}
      user={{
        ...user,
        image: directory.members.find((m) => m.id === userId)
          ? directory.members.find((m) => m.id === userId)!.image
          : user.image,
      }}
      onCreate={canCreate ? () => openCreate() : undefined}
      onSearch={() => openPalette()}
      onCollapse={toggleSidebar}
      sidebarId={sidebarId}
      onSignOut={async () => {
        await signOut();
      }}
    />
  );
  return (
    <ShellContext.Provider value={shell}>
      <DockProvider>
        <title>{title}</title>
        <div className="flex h-dvh overflow-hidden bg-sidebar text-foreground">
          <aside
            id={sidebarId}
            ref={sidebarRef}
            className={cn(
              "hidden shrink-0 flex-col border-r bg-sidebar lg:flex",
              sidebarCollapsed ? "w-12" : "w-[232px]",
            )}
          >
            {sidebar(sidebarCollapsed)}
          </aside>
          {drawer && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                aria-label="Close navigation"
                className="absolute inset-0 bg-black/30"
                onClick={() => setDrawer(false)}
              />
              <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r bg-sidebar shadow-xl">
                {sidebar()}
              </aside>
            </div>
          )}
          <div className="relative flex min-w-0 flex-1 flex-col bg-background lg:my-0">
            <div className="flex h-11 items-center gap-2 border-b px-3 lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                onClick={() => setDrawer(true)}
              >
                <Menu className="size-4" />
              </Button>
              <span className="text-sm font-medium">
                {project?.name ?? organization.name}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Search"
                  onClick={() => openPalette()}
                >
                  <Search className="size-4" />
                </Button>
                {project && canCreate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Create"
                    onClick={() => openCreate()}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <main
              id="main"
              tabIndex={-1}
              className="min-h-0 flex-1 overflow-hidden outline-none"
            >
              {children}
            </main>
            {dockReady && (
              <Suspense fallback={null}>
                <IntelligenceDock />
              </Suspense>
            )}
          </div>
        </div>
        <Suspense fallback={null}>
          {palette.open && (
            <CommandPalette
              initialQuery={palette.query}
              onClose={() => setPalette({ open: false, query: "" })}
            />
          )}
          {create && (
            <QuickCreate options={create} onClose={() => setCreate(null)} />
          )}
        </Suspense>
      </DockProvider>
    </ShellContext.Provider>
  );
}

function Sidebar({
  collapsed = false,
  organization,
  organizations,
  projects,
  project,
  pathname,
  inboxCount,
  user,
  onCreate,
  onSearch,
  onSignOut,
  onCollapse,
  sidebarId,
}: {
  collapsed?: boolean;
  organization: Organization;
  organizations: Organization[];
  projects: Project[];
  project?: Project;
  pathname: string;
  inboxCount: number;
  user: {
    name: string;
    email: string;
    handle: string | null;
    image?: string | null;
  };
  onCreate?: () => void;
  onSearch: () => void;
  onSignOut: () => void;
  onCollapse: () => void;
  sidebarId: string;
}) {
  const router = useRouter();
  const org = organization.slug;
  const active = (href: string, exact = false) =>
    exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <CollapsedSidebarContext.Provider value={collapsed}>
      <div
        className={cn(
          "flex items-center gap-1 px-2",
          collapsed ? "flex-col py-2" : "h-11",
        )}
      >
        <Popover
          width={240}
          side={collapsed ? "right" : "bottom"}
          trigger={(props) => (
            <button
              {...props}
              aria-label={
                collapsed
                  ? `Switch organization: ${organization.name}`
                  : undefined
              }
              title={collapsed ? organization.name : undefined}
              className={cn(
                "flex h-8 min-w-0 items-center gap-2 rounded-md text-left text-[13px] font-semibold hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                collapsed ? "size-8 justify-center" : "flex-1 px-2",
              )}
            >
              {collapsed || !organization.logos.full ? (
                <OrganizationMark organization={organization} />
              ) : (
                // The full logo already contains the name; keep it for
                // assistive technology.
                <>
                  {}
                  <img
                    src={organization.logos.full}
                    alt=""
                    aria-hidden
                    className="h-5 max-w-[150px] min-w-0 shrink object-contain object-left"
                  />
                  <span className="sr-only">{organization.name}</span>
                </>
              )}
              {!collapsed && (
                <>
                  {!organization.logos.full && (
                    <span className="truncate">{organization.name}</span>
                  )}
                  <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          )}
        >
          {(close) => (
            <div className="p-1">
              <p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground uppercase">
                Organizations
              </p>
              {organizations.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    close();
                    router.push(paths.org(o.slug));
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                >
                  <OrganizationMark organization={o} className="size-4" />
                  <span className="truncate">{o.name}</span>
                  {o.id === organization.id && (
                    <Check className="ml-auto size-3.5 text-primary" />
                  )}
                </button>
              ))}
              <div className="my-1 border-t" />
              <Link
                href={paths.settings(organization.slug)}
                onClick={close}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                <Settings className="size-3.5" aria-hidden />
                Organization settings
              </Link>
              <Link
                href={paths.newOrganization}
                onClick={close}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                <Plus className="size-3.5" aria-hidden />
                Create organization
              </Link>
            </div>
          )}
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          className={cn("hidden lg:inline-flex", collapsed && "size-8")}
          data-sidebar-toggle
          aria-label={collapsed ? "Expand app sidebar" : "Collapse app sidebar"}
          title={collapsed ? "Expand app sidebar" : "Collapse app sidebar"}
          aria-expanded={!collapsed}
          aria-controls={sidebarId}
          onClick={onCollapse}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={collapsed ? "size-8" : undefined}
          aria-label="Search (/)"
          title="Search  /"
          onClick={onSearch}
        >
          <Search className="size-4" />
        </Button>
      </div>
      {onCreate && (
        <div className="px-2 pb-2">
          <Button
            variant="secondary"
            className={cn(
              "gap-2 text-muted-foreground",
              collapsed ? "size-8 p-0" : "w-full justify-start",
            )}
            aria-label={collapsed ? "Create work item" : undefined}
            title={collapsed ? "Create work item  C" : undefined}
            onClick={onCreate}
            disabled={!project}
          >
            <Plus className="size-3.5" />
            {!collapsed && (
              <>
                New item <Kbd>C</Kbd>
              </>
            )}
          </Button>
        </div>
      )}
      <nav
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2",
          collapsed ? "gap-2" : "gap-4",
        )}
        aria-label="Workspace"
      >
        <div className="space-y-px">
          <InboxLink
            organizationId={organization.id}
            href={paths.inbox(org)}
            active={active(paths.inbox(org))}
            todo={inboxCount}
          />
          <NavLink
            href={paths.intelligence(org)}
            active={active(paths.intelligence(org))}
            icon={<IntelligenceMark className="size-4" />}
          >
            Litto
          </NavLink>
        </div>
        <div>
          <ProjectSwitcher
            project={project}
            projects={projects}
            onSelect={(key) => router.push(paths.list(org, key, "epics"))}
          />
          {project ? (
            <ProjectNav project={project} active={active} />
          ) : (
            <p className="px-2 pt-1 text-xs text-muted-foreground">
              {projects.length ? "Choose a project." : "No projects yet."}
            </p>
          )}
        </div>
        <div className="mt-auto space-y-px">
          <NavLink
            href={paths.settings(org)}
            active={active(paths.settings(org))}
            icon={<Settings className="size-4" />}
          >
            Organization settings
          </NavLink>
        </div>
      </nav>
      <div
        className={cn(
          "group/footer flex items-center gap-1 border-t py-2",
          collapsed ? "flex-col px-2" : "px-3",
        )}
      >
        <Popover
          width={240}
          side="top"
          trigger={(props) => (
            <button
              {...props}
              aria-label="Account menu"
              title={
                collapsed ? `Account: ${user.name || user.email}` : undefined
              }
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md p-1 text-left hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                collapsed ? "size-8 justify-center" : "-ml-1 flex-1",
              )}
            >
              <Avatar
                image={user.image}
                name={user.name || user.email}
                size="sm"
              />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {user.name}
                  </span>
                  <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          )}
        >
          {(close) => (
            <div className="p-1">
              <div className="px-2 py-1.5">
                <p className="truncate text-[13px] font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.handle ? `@${user.handle} · ${user.email}` : user.email}
                </p>
              </div>
              <div className="my-1 border-t" />
              <Link
                href={paths.account(pathname)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted"
              >
                <UserRound className="size-3.5 text-muted-foreground" /> Account
                settings
              </Link>
              <PrivacyPreferencesButton
                onClick={close}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                <ShieldCheck className="size-3.5 text-muted-foreground" />{" "}
                Privacy preferences
              </PrivacyPreferencesButton>
              <button
                onClick={onSignOut}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                <LogOut className="size-3.5 text-muted-foreground" /> Sign out
              </button>
              <div className="mt-1 border-t px-2 pt-2 pb-1">
                <p
                  className="text-xs text-muted-foreground"
                  title="Major version · feature release · fixes"
                >
                  Lictory <span className="tabular-nums">v{APP_VERSION}</span>
                </p>
              </div>
            </div>
          )}
        </Popover>
        <SyncStatus />
      </div>
    </CollapsedSidebarContext.Provider>
  );
}

// Unread notifications take the badge; otherwise the count of open to-dos.
function InboxLink({
  organizationId,
  href,
  active,
  todo,
}: {
  organizationId: string;
  href: string;
  active: boolean;
  todo: number;
}) {
  const unread = useUnreadNotifications(organizationId)[organizationId] ?? 0;
  const collapsed = useContext(CollapsedSidebarContext);
  const count = unread || todo;
  return (
    <NavLink
      href={href}
      active={active}
      icon={<Inbox className="size-4" />}
      badge={
        count > 0 ? (
          <span
            className={cn(
              "rounded-full text-[10px] font-semibold tabular-nums",
              collapsed
                ? "absolute -top-0.5 -right-1 bg-primary px-1 text-primary-foreground"
                : "ml-auto px-1.5",
              !collapsed &&
                (unread
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground"),
            )}
            aria-label={`${count} ${unread ? "unread" : "to do"}`}
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : undefined
      }
    >
      Inbox
    </NavLink>
  );
}

// The project is the main context: a clear switcher naming it, with its
// settings one click away.
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
  const collapsed = useContext(CollapsedSidebarContext);
  const pathname = usePathname();
  const settings = project
    ? paths.projectSettings(organization.slug, project.key)
    : undefined;
  return (
    <div
      className={cn("mb-2 flex items-center gap-1", collapsed && "flex-col")}
    >
      <Popover
        width={240}
        side={collapsed ? "right" : "bottom"}
        trigger={(props) => (
          <button
            {...props}
            aria-label={`Switch project: ${project?.name ?? "none"}`}
            title={collapsed ? (project?.name ?? "Choose project") : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-md text-left text-[13px] hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              collapsed ? "size-8 justify-center" : "h-9 flex-1 px-2",
            )}
          >
            {project ? (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded bg-muted px-1 font-mono text-[10px] font-semibold text-muted-foreground">
                {collapsed ? project.key.slice(0, 2) : project.key}
              </span>
            ) : (
              <FolderOpen
                className="size-4 text-muted-foreground"
                aria-hidden
              />
            )}
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {project?.name ?? "Choose project"}
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
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
      {settings && !collapsed && (
        <Link
          href={settings}
          aria-label="Project settings"
          title="Project settings"
          aria-current={pathname.startsWith(settings) ? "page" : undefined}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            pathname.startsWith(settings) &&
              "bg-sidebar-accent text-foreground",
          )}
        >
          <Settings2 className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function NavGroup({
  label,
  children,
  toggle,
}: {
  label: string;
  children?: ReactNode;
  // Collapsible groups render their caption as a disclosure button.
  toggle?: { open: boolean; onToggle: () => void };
}) {
  const collapsed = useContext(CollapsedSidebarContext);
  return (
    <div className={collapsed ? "mt-2" : "mt-4"}>
      {collapsed ? (
        <div className="mx-1 mb-2 border-t" />
      ) : toggle ? (
        <button
          type="button"
          aria-expanded={toggle.open}
          onClick={toggle.onToggle}
          className="mb-1 flex h-6 w-full items-center gap-1 rounded-md px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          {label}
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3 transition-transform duration-150",
              toggle.open && "rotate-90",
            )}
          />
        </button>
      ) : (
        <p className="mb-1 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
      )}
      {(!toggle || toggle.open || collapsed) && (
        <div className="space-y-px">{children}</div>
      )}
    </div>
  );
}

// Inside a project the sidebar follows the work: refine it (Work), deliver
// it (Delivery, by the project's mode), and the teams doing it. Saved views
// stay one click away without crowding the rest.
function ProjectNav({
  project,
  active,
}: {
  project: Project;
  active: (href: string, exact?: boolean) => boolean;
}) {
  const { delivery, organization, userId } = useWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const org = organization.slug;
  const key = project.key;
  const external = project.deliveryMode === "external";
  const teamParam = searchParams.get("team");
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
  const stories = paths.list(org, key, "stories");
  const viewActive = views.some((v) => active(paths.view(org, key, v.id)));
  return (
    <>
      <NavGroup label="Work">
        <NavLink
          href={paths.list(org, key, "epics")}
          active={active(paths.list(org, key, "epics"))}
          icon={<TypeIcon type={epicGlyph} />}
        >
          Epics
        </NavLink>
        <NavLink
          href={stories}
          active={active(stories) && !teamParam}
          icon={<TypeIcon type={storyGlyph} />}
        >
          Work items
        </NavLink>
        <NavLink
          href={paths.reviews(org, key)}
          active={active(paths.reviews(org, key))}
          icon={<BookOpenCheck className="size-4" />}
        >
          Reviews
        </NavLink>
      </NavGroup>
      <NavGroup label={external ? "Delivery · Jira" : "Delivery"}>
        {external ? (
          <NavLink
            href={paths.handoff(org, key)}
            active={active(paths.handoff(org, key))}
            icon={<Send className="size-4" />}
          >
            Hand-off
          </NavLink>
        ) : (
          <>
            <NavLink
              href={board}
              active={pathname === board && !teamParam}
              icon={<KanbanSquare className="size-4" />}
            >
              Board
            </NavLink>
            <NavLink
              href={backlog}
              active={
                (pathname === backlog && !teamParam) ||
                active(`/${org}/${key.toLowerCase()}/iterations`)
              }
              icon={<ListOrdered className="size-4" />}
            >
              {project.iterationMode === "manual"
                ? "Backlog & sprints"
                : project.iterationMode === "automatic"
                  ? "Backlog & cycles"
                  : "Backlog"}
            </NavLink>
          </>
        )}
      </NavGroup>
      {teams.length > 0 && (
        <NavGroup label="Teams">
          {teams.map((t) => {
            const href = paths.team(org, key, t.id);
            return (
              <NavLink
                key={t.id}
                href={href}
                active={active(href) || teamParam === t.id}
                icon={
                  <span className="grid size-4 place-items-center rounded bg-muted text-[9px] font-semibold text-foreground/70">
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                }
              >
                {t.name}
              </NavLink>
            );
          })}
        </NavGroup>
      )}
      <NavGroup
        label="Views"
        toggle={{
          open: viewsOpen || viewActive,
          onToggle: toggleViews,
        }}
      >
        {views
          .filter((v) => v.id !== "needs-my-review")
          .map((v) => (
            <NavLink
              key={v.id}
              href={paths.view(org, key, v.id)}
              active={active(paths.view(org, key, v.id))}
              icon={<ViewIcon view={v.id} />}
            >
              {v.label}
            </NavLink>
          ))}
      </NavGroup>
    </>
  );
}

function ViewIcon({ view }: { view: ViewId }) {
  switch (view) {
    case "needs-review":
      return <MessageSquareMore aria-hidden className="size-4" />;
    case "blocked":
      return <OctagonAlert aria-hidden className="size-4" />;
    case "ready":
      return <CircleCheckBig aria-hidden className="size-4" />;
    case "drafts":
      return <FilePenLine aria-hidden className="size-4" />;
    case "updated":
      return <History aria-hidden className="size-4" />;
    case "all":
    case "needs-my-review":
      return null;
  }
}

function NavLink({
  href,
  active,
  icon,
  children,
  badge,
}: {
  href: string;
  active: boolean;
  icon?: ReactNode;
  children: string;
  badge?: ReactNode;
}) {
  const collapsed = useContext(CollapsedSidebarContext);
  return (
    <Link
      href={href}
      aria-label={children}
      title={collapsed ? children : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center rounded-md text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        collapsed ? "size-8 justify-center" : "h-7 gap-2 px-2",
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {icon ? (
        <span className="grid size-4 place-items-center text-muted-foreground">
          {icon}
        </span>
      ) : (
        <span className="size-4" />
      )}
      <span className={collapsed ? "sr-only" : undefined}>{children}</span>
      {badge}
      <PendingHint />
    </Link>
  );
}

// Immediate acknowledgement for a pressed link whose route is still loading
// (cold prefetch, slow network). Must render inside the <Link>.
function PendingHint() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="link-pending absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
    />
  );
}
