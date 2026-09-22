"use client";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  History,
  Inbox,
  LogOut,
  Menu,
  MessageSquareMore,
  OctagonAlert,
  Plus,
  Search,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { rememberProject, useLastProjectKey } from "~/lib/last-project";
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
import { CommandPalette } from "./command-palette";
import { QuickCreate, type QuickCreateOptions } from "./quick-create";
import { SyncStatus } from "./sync-status";
import { KindIcon } from "~/components/items/icons";

type Toast = {
  id: number;
  text: string;
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
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const { organization, projects, items, userId, groupIds, directory } =
    useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });
  const [create, setCreate] = useState<QuickCreateOptions | null>(null);
  const [currentItem, setCurrentItem] = useState<WorkItem>();
  const [drawer, setDrawer] = useState(false);
  const toastId = useRef(0);
  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  // The route names the project while browsing it. Organization-level surfaces
  // (Inbox, settings, account) keep the last project in context instead of
  // dropping the person out of it.
  const params = useParams<{ project?: string }>();
  const routeKey = params.project?.toUpperCase();
  const lastKey = useLastProjectKey(organization.id);
  const project =
    projects.find((p) => p.key === routeKey) ??
    projects.find((p) => p.key === lastKey) ??
    projects[0];
  useEffect(() => {
    if (routeKey && projects.some((p) => p.key === routeKey))
      rememberProject(organization.id, routeKey);
  }, [routeKey, projects, organization.id]);
  const openCreate = useCallback(
    (options?: QuickCreateOptions) =>
      setCreate({
        kind: "story",
        ...options,
        projectId: options?.projectId ?? project?.id,
      }),
    [project?.id],
  );
  const openPalette = useCallback(
    (query = "") => setPalette({ open: true, query }),
    [],
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
        setPalette((p) => ({ open: !p.open, query: "" }));
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
  }, [project, pathname, openCreate, openPalette]);
  const inboxCount = useMemo(
    () => items.filter((i) => needsMyReview(i, userId, groupIds)).length,
    [items, userId, groupIds],
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
  const sidebar = (
    <Sidebar
      organization={organization}
      organizations={directory.organizations}
      projects={projects}
      project={project}
      pathname={pathname}
      inboxCount={inboxCount}
      user={user}
      onCreate={() => openCreate()}
      onSearch={() => openPalette()}
      onSignOut={async () => {
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    />
  );
  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-dvh overflow-hidden bg-sidebar text-foreground">
        <aside className="hidden w-[232px] shrink-0 flex-col border-r bg-sidebar lg:flex">
          {sidebar}
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/30"
              onClick={() => setDrawer(false)}
            />
            <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r bg-sidebar shadow-xl">
              {sidebar}
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
              {project && (
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
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-popover px-3 py-2 text-[13px] shadow-[var(--shadow-panel)]"
          >
            <Check className="size-3.5 text-emerald-600" />
            <span>{t.text}</span>
            {t.action && (
              <Link
                href={t.action.href}
                className="font-medium text-primary hover:underline"
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              >
                {t.action.label}
              </Link>
            )}
            <button
              aria-label="Dismiss"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ShellContext.Provider>
  );
}

function Sidebar({
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
}: {
  organization: { id: string; name: string; slug: string };
  organizations: { id: string; name: string; slug: string }[];
  projects: Project[];
  project?: Project;
  pathname: string;
  inboxCount: number;
  user: { name: string; email: string };
  onCreate: () => void;
  onSearch: () => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const org = organization.slug;
  const active = (href: string, exact = false) =>
    exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <>
      <div className="flex h-11 items-center gap-1 px-2">
        <Popover
          width={240}
          trigger={(props) => (
            <button
              {...props}

              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] font-semibold hover:bg-sidebar-accent"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
                {organization.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{organization.name}</span>
              <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
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
            </div>
          )}
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Search (/)"
          title="Search  /"
          onClick={onSearch}
        >
          <Search className="size-4" />
        </Button>
      </div>
      <div className="px-2 pb-2">
        <Button
          variant="secondary"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={onCreate}
          disabled={!project}
        >
          <Plus className="size-3.5" /> New item
          <Kbd>C</Kbd>
        </Button>
      </div>
      <nav
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2"
        aria-label="Workspace"
      >
        <div className="space-y-px">
          <NavLink
            href={paths.inbox(org)}
            active={active(paths.inbox(org))}
            icon={<Inbox className="size-4" />}
          >
            Inbox
            {inboxCount > 0 && (
              <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                {inboxCount}
              </span>
            )}
          </NavLink>
        </div>
        <div>
          <div className="mb-1 flex items-center px-2">
            <Popover
              width={220}
              trigger={(props) => (
                <button
                  {...props}

                  className="flex h-6 min-w-0 items-center gap-1 rounded px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:bg-sidebar-accent hover:text-foreground"
                >
                  <span className="truncate">{project?.name ?? "Project"}</span>
                  <ChevronsUpDown className="size-3" />
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
                icon={<KindIcon kind="epic" />}
              >
                Epics
              </NavLink>
              <NavLink
                href={paths.list(org, project.key, "stories")}
                active={active(paths.list(org, project.key, "stories"))}
                icon={<KindIcon kind="story" />}
              >
                Stories
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
        {project && (
          <div>
            <p className="mb-1 px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Views
            </p>
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
      <div className="group/footer flex items-center gap-1 border-t px-3 py-2">
        <Popover
          width={240}
          side="top"
          trigger={(props) => (
            <button
              {...props}
              aria-label="Account menu"
              className="-ml-1 flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left hover:bg-sidebar-accent"
            >
              <Avatar name={user.name || user.email} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {user.name}
              </span>
              <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          )}
        >
          {(close) => (
            <div className="p-1">
              <div className="px-2 py-1.5">
                <p className="truncate text-[13px] font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <div className="my-1 border-t" />
              <Link
                href={paths.account(org)}
                onClick={close}
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
          )}
        </Popover>
        <SyncStatus />
      </div>
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
}: {
  href: string;
  active: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
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
      {children}
    </Link>
  );
}
