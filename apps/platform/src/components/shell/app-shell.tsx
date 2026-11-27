import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerTitle,
} from "@ui-sdk/react/drawer";
import { Menu as MenuIcon, Plus, Search } from "lucide-react";
import { toast as toastManager } from "@lictory/ui/toast";
import { popupContainer } from "@lictory/ui/popup";
import { Button } from "@lictory/ui/button";
import { track } from "@lictory/core/lib/analytics/client";
import { cn } from "@lictory/core/lib/utils";
import { scrimClass } from "@lictory/ui/dialog";
import { paths } from "@lictory/core/lib/paths";
import { enabledTypes } from "@lictory/core/lib/work-items";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import {
  useParams,
  usePathname,
  useRouter,
} from "@lictory/platform/lib/navigation";
import { signOut } from "@lictory/platform/lib/account";
import { workspaceTitle } from "@lictory/platform/lib/document-title";
import {
  rememberProject,
  useLastProjectKey,
} from "@lictory/platform/lib/last-project";
import { usePanelCollapsed } from "@lictory/platform/lib/panel-preference";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  ShellContext,
  type ShellContextValue,
} from "@lictory/platform/components/workspace/shell";
import type { QuickCreateOptions } from "@lictory/platform/components/workspace/quick-create";
import {
  PaneResizer,
  usePaneResize,
} from "@lictory/platform/components/workspace/pane-resizer";
import { DockProvider } from "@lictory/platform/components/intelligence/dock/store";
import { LittoLauncher } from "@lictory/platform/components/intelligence/dock/launcher";
import { OrganizationBrand } from "@lictory/platform/components/workspace/organization-brand";
import { PhoneSyncNotice } from "@lictory/platform/components/workspace/sync-status";
import {
  SkipLinkSlot,
  skipLinkClass,
} from "@lictory/platform/components/shell/skip-links";
import {
  useSpaceBySlug,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";
import { OrganizationRail } from "@lictory/platform/components/shell/org-rail";
import {
  Sidebar,
  type SidebarUser,
} from "@lictory/platform/components/shell/sidebar";
import { UnreadProvider } from "@lictory/platform/components/shell/unread";
import { AnnouncerProvider } from "@lictory/platform/components/shell/announcer";
import {
  NavBadgesProvider,
  useNavBadges,
} from "@lictory/platform/components/shell/nav-badges";
import {
  PhoneChromeContext,
  type PhoneChrome,
} from "@lictory/platform/components/shell/page-header";

// Overlays open on demand. They carry the Markdown editor and search, so they
// load after the workspace is interactive instead of with every page.
const loadCommandPalette = () =>
  import("@lictory/platform/components/shell/command-palette").then(
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

const SIDEBAR_DEFAULT = 232;

// `G` then one of these letters.
const goTargets: Record<string, (org: string) => string> = {
  h: paths.org,
  i: paths.inbox,
  c: paths.channels,
  f: paths.factory,
  d: paths.code,
  s: paths.spaces,
};

// The workspace around every organization page: the organization rail, the
// sidebar (full, compact, or a drawer on phones), the framed page, Litto's
// sheet beside it, and the overlays (command palette, quick create).
export function Shell({
  user,
  children,
}: {
  user: SidebarUser;
  children: ReactNode;
}) {
  const { organization } = useWorkspace();
  return (
    <AnnouncerProvider>
      <UnreadProvider organizationId={organization.id}>
        <NavBadgesProvider>
          <ShellFrame user={user}>{children}</ShellFrame>
        </NavBadgesProvider>
      </UnreadProvider>
    </AnnouncerProvider>
  );
}

function ShellFrame({
  user,
  children,
}: {
  user: SidebarUser;
  children: ReactNode;
}) {
  const {
    organization,
    projects,
    userId,
    delivery,
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
  // The overlays unmount to close, before their dialog can hand focus back.
  const overlayOpener = useRef<Element | null>(null);
  const overlayOpen = palette.open || create !== null;
  useEffect(() => {
    if (overlayOpen) return;
    const opener = overlayOpener.current;
    overlayOpener.current = null;
    if (
      opener instanceof HTMLElement &&
      opener.isConnected &&
      // Whatever closing moved on to (the next overlay, Litto) keeps focus.
      (!document.activeElement || document.activeElement === document.body)
    )
      opener.focus({ preventScroll: true });
  }, [overlayOpen]);
  const [currentItem, setCurrentItem] = useState<WorkItem>();
  const [drawer, setDrawer] = useState(false);
  // Page headers mounted now. While one is, it carries the phone's top bar.
  const [headers, setHeaders] = useState(0);
  const [sidebarCollapsed, toggleSidebarPreference, setSidebarCollapsed] =
    usePanelCollapsed(organization.id, "sidebar");
  const sidebarRef = useRef<HTMLElement | null>(null);
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
  // The sidebar's width follows the person's drag; dragging well past its
  // narrowest folds it into the compact sidebar.
  const resize = usePaneResize<HTMLElement>(
    {
      pane: "sidebar",
      label: "sidebar",
      edge: "end",
      min: 200,
      max: 360,
      share: { fraction: 0.28, floor: SIDEBAR_DEFAULT, of: "viewport" },
      preferred: () => SIDEBAR_DEFAULT,
      neighbour: () => document.querySelector<HTMLElement>("[data-app-frame]"),
      keep: 560,
    },
    {
      collapse: {
        collapsed: sidebarCollapsed,
        setCollapsed: setSidebarCollapsed,
      },
    },
  );
  // The resizer and the collapse toggle both control the sidebar by its id.
  const sidebarId = resize.pane.id;
  const attachSidebar = resize.pane.attach;
  const sidebarElement = useCallback(
    (element: HTMLElement | null) => {
      sidebarRef.current = element;
      attachSidebar(element);
    },
    [attachSidebar],
  );
  const toast = useCallback(
    (text: string, action?: { label: string; href: string }) => {
      toastManager({
        title: text,
        duration: 6000,
        action: action && {
          label: action.label,
          onAction: () => router.push(action.href),
        },
      });
    },
    [router],
  );
  // The route names the project while browsing it. Organization-level surfaces
  // (Home, Inbox, settings) keep the last project in context instead of
  // dropping the person out of it.
  const params = useParams<{
    project?: string;
    space?: string;
    page?: string;
  }>();
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
  const routeSpace = useSpaceBySlug(params.space);
  const { index: spaceIndex } = useSpaces();
  const title = workspaceTitle(pathname, {
    organization,
    project: routeProject,
    item: currentItem,
    space: routeSpace,
    page: params.page ? spaceIndex.pageById.get(params.page) : undefined,
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
      overlayOpener.current ??= document.activeElement;
      setCreate({
        kind: "story",
        intent:
          capabilitiesIn(projectId).editSpecifications &&
          enabledTypes(delivery, projectId).some(
            (type) => type.hasSpecification,
          ) &&
          /\/(proposals|refinement)$/.test(window.location.pathname)
            ? "proposal"
            : /\/(board|backlog|handoff)$/.test(window.location.pathname)
              ? "work"
              : undefined,
        ...options,
        projectId,
        teamId: options?.teamId ?? (team && team !== "none" ? team : null),
      });
    },
    [
      project?.id,
      routeProject?.id,
      canCreateIn,
      capabilitiesIn,
      delivery,
      toast,
      organization.id,
    ],
  );
  const openPalette = useCallback(
    (query = "") => {
      track("command_palette_opened", { organization_id: organization.id });
      overlayOpener.current ??= document.activeElement;
      setPalette({ open: true, query });
    },
    [organization.id],
  );
  const goPrefix = useRef(0);
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
      // `G` then a module's letter goes there (G H Home, G I Inbox).
      const goTo = goPrefix.current && Date.now() - goPrefix.current < 1200;
      goPrefix.current = 0;
      const target = goTo ? goTargets[event.key.toLowerCase()] : undefined;
      if (target) {
        event.preventDefault();
        router.push(target(organization.slug));
        return;
      }
      if (event.key === "g" && !event.shiftKey) {
        goPrefix.current = Date.now();
        return;
      }
      if (
        event.key === "[" &&
        window.matchMedia("(min-width: 64rem)").matches
      ) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (event.key === "c" && project) {
        event.preventDefault();
        openCreate();
      } else if (event.key === "/") {
        event.preventDefault();
        openPalette("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
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
  const createHere = !!project && canCreate;
  const onCreatePhone = createHere ? () => openCreate() : undefined;
  const phoneChrome = useMemo<PhoneChrome>(
    () => ({
      claim: () => {
        setHeaders((n) => n + 1);
        return () => setHeaders((n) => n - 1);
      },
      leading: <PhoneMenuButton onMenu={() => setDrawer(true)} />,
      search: <PhoneSearch onSearch={() => openPalette()} />,
      trailing: createHere ? (
        <PhoneCreate onCreate={() => openCreate()} />
      ) : null,
    }),
    [openPalette, openCreate, createHere],
  );
  const me = directory.members.find((m) => m.id === userId);
  const sidebarUser = { ...user, image: me ? me.image : user.image };
  const sidebar = (compact: boolean, inDrawer = false) => (
    <Sidebar
      compact={compact}
      user={sidebarUser}
      onCreate={canCreate ? () => openCreate() : undefined}
      onSearch={() => openPalette()}
      onCollapse={inDrawer ? undefined : toggleSidebar}
      sidebarId={sidebarId}
      onSignOut={async () => {
        await signOut();
      }}
    />
  );
  return (
    <ShellContext value={shell}>
      <DockProvider>
        <title>{title}</title>
        <OrganizationBrand organization={organization} />
        <div className="flex h-dvh overflow-clip bg-sidebar text-foreground">
          {/* The first Tab stop skips the rail and sidebar (dozens of
              links) to the page. Hidden until focused. */}
          <a
            href="#main"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("main")?.focus();
            }}
            className={skipLinkClass}
          >
            Skip to content
          </a>
          <SkipLinkSlot />
          {/* The left column: the organization rail and the sidebar. */}
          <div className="relative hidden shrink-0 lg:flex">
            {/* Wide windows only: on laptops the room goes to the work,
                and the organization menu switches. */}
            {!sidebarCollapsed && (
              <div className="hidden min-[96rem]:flex">
                <OrganizationRail />
              </div>
            )}
            {/* Named, so it stays apart from a page's own complementary
                parts (an item's details). Its resizer sits inside it, on
                its edge, so every control belongs to a landmark. */}
            <aside
              id={sidebarId}
              ref={sidebarElement}
              aria-label="Sidebar"
              style={sidebarCollapsed ? undefined : resize.pane.style}
              data-sidebar={sidebarCollapsed ? "compact" : "full"}
              className={cn(
                "relative flex shrink-0 flex-col bg-sidebar",
                sidebarCollapsed
                  ? "w-12"
                  : resize.pane.sized
                    ? "w-(--pane-w)"
                    : "w-[232px]",
              )}
            >
              {sidebar(sidebarCollapsed)}
              {!sidebarCollapsed && (
                <PaneResizer
                  resize={resize.handle}
                  className="absolute inset-y-0 right-0"
                />
              )}
            </aside>
          </div>
          <Drawer
            open={drawer}
            onOpenChange={setDrawer}
            side="left"
            container={popupContainer()}
          >
            <DrawerBackdrop
              className={cn("fixed inset-0 z-40 lg:hidden", scrimClass)}
            />
            <DrawerContent
              aria-label="Navigation"
              className="z-50 flex h-dvh max-h-none w-[300px] max-w-[88vw] flex-row gap-0 overflow-hidden border-0 border-r bg-sidebar p-0 text-foreground shadow-xl lg:hidden"
            >
              <DrawerTitle className="sr-only">Navigation</DrawerTitle>
              <OrganizationRail />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {sidebar(false, true)}
              </div>
            </DrawerContent>
          </Drawer>
          {/* The work sits in one framed surface on the shell; Litto's side
              sheet, when open, is a second surface beside it. Panes inside
              the frame size to the frame (a named container), not to the
              window, so opening Litto only folds what no longer fits. */}
          <div className="flex min-w-0 flex-1 min-[1440px]:gap-3 min-[1440px]:py-3 min-[1440px]:pr-3 lg:gap-2 lg:py-2 lg:pr-2">
            <div
              data-app-frame
              className="@container/frame relative flex min-w-0 flex-1 flex-col overflow-clip bg-background min-[1440px]:rounded-[20px] lg:rounded-2xl lg:shadow-(--shadow-border)"
            >
              {headers === 0 && (
                <PhoneBar
                  onMenu={() => setDrawer(true)}
                  onSearch={() => openPalette()}
                  onCreate={onCreatePhone}
                  place={
                    // Name where the person is: a space's pages belong to the
                    // space, not to the project the sidebar remembers.
                    routeSpace ? (
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <SpaceIcon space={routeSpace} />
                        <span className="truncate">{routeSpace.name}</span>
                      </span>
                    ) : (
                      <span className="truncate text-sm font-medium">
                        {phonePlace(pathname, routeProject?.name) ??
                          project?.name ??
                          organization.name}
                      </span>
                    )
                  }
                />
              )}
              <PhoneSyncNotice />
              {/* Pinned: `overflow-clip`, unlike `hidden`, is not a scroll
                  container, so focusing or scrolling to a field deep in a
                  page never shifts the frame and cuts its top bar. Pages
                  scroll inside themselves. */}
              <main
                id="main"
                tabIndex={-1}
                className="min-h-0 flex-1 overflow-clip outline-none"
              >
                <PhoneChromeContext value={phoneChrome}>
                  {children}
                </PhoneChromeContext>
              </main>
            </div>
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
    </ShellContext>
  );
}

// Organization-wide pages are named by their module on phones, not by the
// project the sidebar remembers.
function phonePlace(pathname: string, routeProject: string | undefined) {
  if (routeProject) return routeProject;
  const segment = pathname.split("/")[2];
  switch (segment) {
    case undefined:
    case "":
      return "Home";
    case "inbox":
      return "Inbox";
    case "spaces":
      return "Spaces";
    case "channels":
      return "Channels";
    case "factory":
      return "Factory";
    case "code":
      return "Code";
    case "intelligence":
      return "Litto";
    case "search":
      return "Search";
    case "settings":
      return "Settings";
    default:
      return undefined;
  }
}

// The phone's top bar on pages without a `PageHeader`: navigation, where I
// am, search, create and Litto. Pages with a header carry these themselves.
function PhoneBar({
  onMenu,
  onSearch,
  onCreate,
  place,
}: {
  onMenu: () => void;
  onSearch: () => void;
  onCreate?: () => void;
  place: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
      <PhoneMenuButton onMenu={onMenu} />
      {place}
      <div className="ml-auto flex items-center gap-1">
        <PhoneSearch onSearch={onSearch} />
        {onCreate && <PhoneCreate onCreate={onCreate} />}
        <LittoLauncher compact />
      </div>
    </div>
  );
}

// Opens the navigation drawer; a dot says something addressed to me waits
// behind it.
function PhoneMenuButton({ onMenu }: { onMenu: () => void }) {
  const badges = useNavBadges();
  const waitingId = useId();
  const waiting = [...badges.values()].some((b) => b.tone === "strong");
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Open navigation"
      aria-describedby={waiting ? waitingId : undefined}
      // The dot's meaning in words, for a pointer that hovers.
      title={waiting ? "Something waits on you" : undefined}
      className="relative size-8 shrink-0"
      onClick={onMenu}
    >
      <MenuIcon className="size-4" />
      {waiting && (
        // Hidden from the button's name, referenced as its description.
        <span
          id={waitingId}
          aria-hidden
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-background"
        >
          <span className="sr-only">Something waits on you</span>
        </span>
      )}
    </Button>
  );
}

function PhoneSearch({ onSearch }: { onSearch: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Search"
      className="size-8"
      onClick={onSearch}
    >
      <Search className="size-4" />
    </Button>
  );
}

function PhoneCreate({ onCreate }: { onCreate: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Create"
      className="size-8"
      onClick={onCreate}
    >
      <Plus className="size-4" />
    </Button>
  );
}
