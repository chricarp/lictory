"use client";
import Link from "next/link";
import { toast as toastManager } from "~/components/ui/toast";
import { resetAnalytics, track } from "~/lib/analytics/client";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
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
  Settings,
  UserRound,
  KanbanSquare,
  ListOrdered,
  Users,
} from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { workspaceTitle } from "~/lib/document-title";
import { rememberProject, useLastProjectKey } from "~/lib/last-project";
import { usePanelCollapsed } from "~/lib/panel-preference";
import {
  needsMyReview,
  views,
  type Project,
  type ViewId,
} from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Popover, Picker } from "~/components/ui/popover";
import { Avatar, Kbd } from "~/components/ui/primitives";
import { useWorkspace } from "./provider";
import { useUnreadNotifications } from "~/components/notifications/client";
import { CommandPalette } from "./command-palette";
import { QuickCreate, type QuickCreateOptions } from "./quick-create";
import { SyncStatus } from "./sync-status";
import { TypeIcon, epicGlyph, storyGlyph } from "~/components/items/icons";

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
  user: { name: string; email: string; handle: string | null };
  children: ReactNode;
}) {
  const {
    organization,
    projects,
    items,
    userId,
    roleIds,
    directory,
    capabilities,
  } = useWorkspace();
  const canCreate = capabilities.editSpecifications;
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
  const restoreSidebarFocus = useRef(false);
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
  // The shell owns the document title: it stays mounted across in-workspace
  // navigations, so React updates the hoisted <title> in place instead of the
  // route metadata swapping the node on every page change.
  const title = workspaceTitle(pathname, {
    organization,
    project: routeProject,
    item: currentItem,
  });
  // Creation is authoring: every entry point (button, shortcut, palette)
  // funnels here so a role without the capability gets one clear message.
  const openCreate = useCallback(
    (options?: QuickCreateOptions) => {
      if (!canCreate)
        return toast(
          "Your roles cannot create Epics or Stories. Ask an administrator for a role that can edit specifications.",
        );
      track("work_item_create_opened", {
        organization_id: organization.id,
        project_id: options?.projectId ?? project?.id ?? null,
      });
      setCreate({
        kind: "story",
        ...options,
        projectId: options?.projectId ?? project?.id,
      });
    },
    [project?.id, canCreate, toast, organization.id],
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
    () => items.filter((i) => needsMyReview(i, userId, roleIds)).length,
    [items, userId, roleIds],
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
      user={user}
      onCreate={canCreate ? () => openCreate() : undefined}
      onSearch={() => openPalette()}
      onCollapse={toggleSidebar}
      sidebarId={sidebarId}
      onSignOut={async () => {
        const result = await authClient.signOut();
        if (result.error) return;
        track("signed_out");
        resetAnalytics();
        router.push("/sign-in");
        router.refresh();
      }}
    />
  );
  return (
    <ShellContext.Provider value={shell}>
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
        <div className="flex min-w-0 flex-1 flex-col bg-background lg:my-0">
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
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
      {palette.open && (
        <CommandPalette
          initialQuery={palette.query}
          onClose={() => setPalette({ open: false, query: "" })}
        />
      )}
      {create && (
        <QuickCreate options={create} onClose={() => setCreate(null)} />
      )}
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
  organization: { id: string; name: string; slug: string };
  organizations: { id: string; name: string; slug: string }[];
  projects: Project[];
  project?: Project;
  pathname: string;
  inboxCount: number;
  user: { name: string; email: string; handle: string | null };
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
              <span className="grid size-5 shrink-0 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
                {organization.name.slice(0, 1).toUpperCase()}
              </span>
              {!collapsed && (
                <>
                  <span className="truncate">{organization.name}</span>
                  <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
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
                  <span className="truncate">{o.name}</span>
                  {o.id === organization.id && (
                    <Check className="ml-auto size-3.5 text-primary" />
                  )}
                </button>
              ))}
              <div className="my-1 border-t" />
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
        </div>
        <div>
          <div className={cn("mb-1 flex items-center", !collapsed && "px-2")}>
            <Popover
              width={220}
              side={collapsed ? "right" : "bottom"}
              trigger={(props) => (
                <button
                  {...props}
                  aria-label={
                    collapsed
                      ? `Switch project: ${project?.name ?? "Project"}`
                      : undefined
                  }
                  title={
                    collapsed
                      ? `Project: ${project?.name ?? "Choose project"}`
                      : undefined
                  }
                  className={cn(
                    "flex min-w-0 items-center gap-1 rounded-md text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                    collapsed ? "size-8 justify-center" : "h-6 px-1",
                  )}
                >
                  {collapsed ? (
                    <FolderOpen className="size-4" aria-hidden />
                  ) : (
                    <>
                      <span className="truncate">
                        {project?.name ?? "Project"}
                      </span>
                      <ChevronsUpDown className="size-3" />
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
                onSelect={(key) => router.push(paths.list(org, key, "epics"))}
              />
            </Popover>
          </div>
          {project ? (
            <div className="space-y-px">
              <NavLink
                href={paths.list(org, project.key, "epics")}
                active={active(paths.list(org, project.key, "epics"))}
                icon={<TypeIcon type={epicGlyph} />}
              >
                Epics
              </NavLink>
              <NavLink
                href={paths.list(org, project.key, "stories")}
                active={active(paths.list(org, project.key, "stories"))}
                icon={<TypeIcon type={storyGlyph} />}
              >
                Work items
              </NavLink>
              <NavLink
                href={paths.reviews(org, project.key)}
                active={active(paths.reviews(org, project.key))}
                icon={<BookOpenCheck className="size-4" />}
              >
                Reviews
              </NavLink>
            </div>
          ) : (
            <p className="px-2 text-xs text-muted-foreground">
              {projects.length ? "Choose a project." : "No projects yet."}
            </p>
          )}
        </div>
        <TeamsNav active={active} pathname={pathname} />
        {project && (
          <div>
            {collapsed ? (
              <div className="mx-1 mb-2 border-t" />
            ) : (
              <p className="mb-1 px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Views
              </p>
            )}
            <div className="space-y-px">
              {views
                .filter((v) => v.id !== "needs-my-review")
                .map((v) => (
                  <NavLink
                    key={v.id}
                    href={paths.view(org, project.key, v.id)}
                    active={active(paths.view(org, project.key, v.id))}
                    icon={<ViewIcon view={v.id} />}
                  >
                    {v.label}
                  </NavLink>
                ))}
            </div>
          </div>
        )}
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
              <Avatar name={user.name || user.email} size="sm" />
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
            <button
              onClick={onSignOut}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            >
              <LogOut className="size-3.5 text-muted-foreground" /> Sign out
            </button>
          </div>
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

// Teams I belong to first; everyone sees all teams (membership is not access).
function TeamsNav({
  active,
  pathname,
}: {
  active: (href: string) => boolean;
  pathname: string;
}) {
  const { delivery, organization, userId } = useWorkspace();
  const collapsed = useContext(CollapsedSidebarContext);
  const router = useRouter();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const org = organization.slug;
  const teams = [...delivery.teams.values()]
    .filter((t) => !t.archivedAt && t.deliveryMode === "native")
    .sort(
      (a, b) =>
        Number(b.memberIds.includes(userId)) -
          Number(a.memberIds.includes(userId)) || a.name.localeCompare(b.name),
    );
  if (!teams.length) return null;
  // The team in the URL wins; otherwise the last one picked, then my first team.
  const routeTeamId = /\/teams\/([^/]+)/.exec(pathname)?.[1];
  const t =
    teams.find((x) => x.id === routeTeamId) ??
    teams.find((x) => x.id === chosenId) ??
    teams[0]!;
  return (
    <div>
      <div className={cn("mb-1 flex items-center", !collapsed && "px-2")}>
        <Popover
          width={220}
          side={collapsed ? "right" : "bottom"}
          trigger={(props) => (
            <button
              {...props}
              aria-label={collapsed ? `Switch team: ${t.name}` : undefined}
              title={collapsed ? `Team: ${t.name}` : undefined}
              className={cn(
                "flex min-w-0 items-center gap-1 rounded-md text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                collapsed ? "size-8 justify-center" : "h-6 px-1",
              )}
            >
              <Users className={collapsed ? "size-4" : "size-3"} aria-hidden />
              {!collapsed && (
                <>
                  <span className="truncate">{t.name}</span>
                  <ChevronsUpDown className="size-3" />
                </>
              )}
            </button>
          )}
        >
          <Picker
            title="Teams"
            options={teams.map((x) => ({ value: x.id, label: x.name }))}
            value={t.id}
            onSelect={(id) => {
              setChosenId(id);
              router.push(paths.board(org, id));
            }}
          />
        </Popover>
      </div>
      <div className="space-y-px">
        <NavLink
          href={paths.board(org, t.id)}
          active={active(paths.board(org, t.id))}
          icon={<KanbanSquare className="size-4" />}
        >
          Board
        </NavLink>
        <NavLink
          href={paths.backlog(org, t.id)}
          active={active(paths.backlog(org, t.id))}
          icon={<ListOrdered className="size-4" />}
        >
          {t.iterationMode === "manual"
            ? "Backlog & sprints"
            : t.iterationMode === "automatic"
              ? "Backlog & cycles"
              : "Backlog"}
        </NavLink>
      </div>
    </div>
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
    </Link>
  );
}
