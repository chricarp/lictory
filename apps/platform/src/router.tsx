import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { safeCallbackPath } from "@lictory/core/lib/paths";
import {
  DocumentSkeleton,
  ItemSkeleton,
  ListSkeleton,
  SettingsSectionSkeleton,
} from "@lictory/ui/skeleton";
import { AuthLayout } from "@lictory/platform/components/auth/auth-layout";
import { ProjectGate } from "@lictory/platform/components/workspace/project-gate";
import { SplitView } from "@lictory/platform/components/items/split-view";
import { loadSession } from "@lictory/platform/lib/session";
import { RootLayout } from "@lictory/platform/routes/root";
import {
  AppIndex,
  AppLayout,
  InvitationPage,
  NewOrganizationPage,
  RedirectTo,
  loadInvitations,
} from "@lictory/platform/routes/app";
import {
  NotificationsRedirect,
  OrganizationIndex,
  OrganizationLayout,
  OrganizationNotFound,
  ProjectIndexRedirect,
  UnknownProjectRoute,
} from "@lictory/platform/routes/organization";
import {
  RootError,
  WorkspaceError,
  WorkspaceNotFound,
} from "@lictory/platform/routes/errors";

// URL map (app host): /{org}/... workspace, /account, /new-organization,
// /invitation, /admin (instance administration), account flows at the top
// level. Workspace data comes from Zero,
// so routes load code, never data: pending skeletons cover chunk loading.

const here = (location: { pathname: string; searchStr: string }) =>
  `${location.pathname}${location.searchStr}`;

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: WorkspaceNotFound,
});

// Links from before the app moved to its own host.
const legacyAppRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app/$",
  beforeLoad: ({ location }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- router redirects are thrown
    throw redirect({ href: safeCallbackPath(here(location)), replace: true });
  },
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  beforeLoad: async () => {
    // Social sign-in buttons need the configured providers.
    await loadSession().catch(() => undefined);
  },
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
});
// Pages only for people who are signed out: a signed-in person continues to
// the destination they asked for, or the home page. The cached session is
// confirmed with the server first, so an ended session still reaches them.
async function redirectSignedIn({
  location,
}: {
  location: { searchStr: string };
}) {
  const cached = await loadSession().catch(() => undefined);
  if (!cached?.user) return;
  const session = await loadSession(true).catch(() => undefined);
  if (!session?.user) return;
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- router redirects are thrown
  throw redirect({
    href: safeCallbackPath(
      new URLSearchParams(location.searchStr).get("callbackUrl"),
    ),
    replace: true,
  });
}

const authPage = (path: string, name: string, signedOutOnly = false) =>
  createRoute({
    getParentRoute: () => authRoute,
    path,
    beforeLoad: signedOutOnly ? redirectSignedIn : undefined,
    component: lazyRouteComponent(
      () => import("@lictory/platform/routes/auth"),
      name as "SignInPage",
    ),
  });
const signInRoute = authPage("/sign-in", "SignInPage", true);
const signUpRoute = authPage("/sign-up", "SignUpPage", true);
const forgotPasswordRoute = authPage(
  "/forgot-password",
  "ForgotPasswordPage",
  true,
);
const resetPasswordRoute = authPage("/reset-password", "ResetPasswordPage");
const verifyEmailRoute = authPage("/verify-email", "VerifyEmailPage");
const authErrorRoute = authPage("/auth-error", "AuthErrorPage");
const welcomeRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/welcome",
  beforeLoad: async ({ location }) => {
    const session = await loadSession();
    const next = safeCallbackPath(
      new URLSearchParams(location.searchStr).get("next"),
    );
    if (!session.user)
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- router redirects are thrown
      throw redirect({
        href: `/sign-in?callbackUrl=${encodeURIComponent(next)}`,
        replace: true,
      });
    if (session.user.handle)
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- router redirects are thrown
      throw redirect({ href: next, replace: true });
  },
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/auth"),
    "WelcomePage",
  ),
});

// Signed in, with a handle.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ location }) => {
    let session = await loadSession();
    // A session read while signed out may be stale after signing in.
    if (!session.user) session = await loadSession(true);
    const target = here(location);
    if (!session.user)
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- router redirects are thrown
      throw redirect({
        href: `/sign-in?callbackUrl=${encodeURIComponent(target)}`,
        replace: true,
      });
    // Every account, however it signed up, chooses a handle before entering.
    if (!session.user.handle)
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- router redirects are thrown
      throw redirect({
        href: `/welcome?next=${encodeURIComponent(safeCallbackPath(target))}`,
        replace: true,
      });
  },
  component: AppLayout,
  errorComponent: WorkspaceError,
  pendingComponent: () => <DocumentSkeleton headerBar />,
});
const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  loader: loadInvitations,
  staleTime: 0,
  component: AppIndex,
});
const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/account",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/account"),
    "AccountRoute",
  ),
  pendingComponent: () => <SettingsSectionSkeleton />,
});
const newOrganizationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/new-organization",
  component: NewOrganizationPage,
});
const invitationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/invitation",
  component: InvitationPage,
});
// Instance administration (instance administrators; the API authorizes).
const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/admin"),
    "AdminRoute",
  ),
  pendingComponent: () => <SettingsSectionSkeleton />,
});
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/admin"),
    "AdminPage",
  ),
});
const adminSectionRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/$section",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/admin"),
    "AdminPage",
  ),
});

const orgRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/$org",
  component: OrganizationLayout,
  notFoundComponent: OrganizationNotFound,
  pendingComponent: () => <DocumentSkeleton headerBar />,
});
const orgIndexRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/",
  component: OrganizationIndex,
});
const orgAccountRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/account",
  // Personal settings live outside organization routing.
  component: () => <RedirectTo href="/account" />,
});
const notificationsRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/notifications",
  // Notifications live in the Inbox ("Updates").
  component: NotificationsRedirect,
});
const inboxRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/inbox",
  component: lazyRouteComponent(
    () => import("@lictory/platform/components/workspace/inbox"),
    "Inbox",
  ),
  pendingComponent: ListSkeleton,
});
const inboxSettingsRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/inbox/settings",
  component: lazyRouteComponent(
    () => import("@lictory/platform/components/notifications/settings"),
    "NotificationSettings",
  ),
  pendingComponent: () => <DocumentSkeleton headerBar />,
});
// The conversation lives in the layout so a streaming answer and the composer
// survive moving from a new chat to its own URL.
const intelligenceRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/intelligence",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/intelligence"),
    "IntelligenceLayout",
  ),
  pendingComponent: () => <DocumentSkeleton headerBar />,
});
const intelligenceIndexRoute = createRoute({
  getParentRoute: () => intelligenceRoute,
  path: "/",
  component: () => null,
});
const intelligenceChatRoute = createRoute({
  getParentRoute: () => intelligenceRoute,
  path: "/$chat",
  component: () => null,
});
const itemRedirectRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/items/$id",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/items"),
    "ItemRedirectRoute",
  ),
});
const orgSettingsRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/settings",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/settings"),
    "OrganizationSettingsRoute",
  ),
  pendingComponent: SettingsSectionSkeleton,
});
const orgSettingsIndexRoute = createRoute({
  getParentRoute: () => orgSettingsRoute,
  path: "/",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/settings"),
    "OrganizationSettingsPage",
  ),
});
const orgSettingsSectionRoute = createRoute({
  getParentRoute: () => orgSettingsRoute,
  path: "/$section",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/settings"),
    "OrganizationSettingsPage",
  ),
  pendingComponent: SettingsSectionSkeleton,
});

// Lictory Spaces. Static segments rank above `$project`, so these addresses
// never resolve as a project key.
const spacesRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/spaces",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/spaces"),
    "SpacesRoute",
  ),
  pendingComponent: ListSkeleton,
});
const spaceRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/spaces/$space",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/spaces"),
    "SpaceRoute",
  ),
  pendingComponent: () => <DocumentSkeleton />,
});
const spaceHomeRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/spaces"),
    "SpaceHomeRoute",
  ),
});
const spacePageRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/pages/$page",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/spaces"),
    "SpacePageRoute",
  ),
  pendingComponent: () => <DocumentSkeleton />,
});
const spaceSettingsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/settings",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/spaces"),
    "SpaceSettingsRoute",
  ),
  pendingComponent: SettingsSectionSkeleton,
});

const projectRoute = createRoute({
  getParentRoute: () => orgRoute,
  path: "/$project",
  component: () => (
    <ProjectGate>
      <Outlet />
    </ProjectGate>
  ),
  pendingComponent: ListSkeleton,
});
const projectIndexRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: ProjectIndexRedirect,
});
// Every item type shares one address. The list lives in the layout; the
// index shows the catalog, `$id` the item beside its originating queue.
const itemsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/items",
  component: () => (
    <SplitView>
      <Outlet />
    </SplitView>
  ),
  pendingComponent: ListSkeleton,
});
const itemsIndexRoute = createRoute({
  getParentRoute: () => itemsRoute,
  path: "/",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/items"),
    "AllItemsRoute",
  ),
  pendingComponent: ListSkeleton,
});
const itemRoute = createRoute({
  getParentRoute: () => itemsRoute,
  path: "/$id",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/items"),
    "ItemRoute",
  ),
  pendingComponent: ItemSkeleton,
});
// Earlier addresses (/epics, /stories) stay valid for existing links,
// including those published to delivery tools.
const legacyItemRoutes = (["epics", "stories"] as const).map((kind) => {
  const list = createRoute({
    getParentRoute: () => projectRoute,
    path: `/${kind}`,
    component: Outlet,
  });
  const index = createRoute({
    getParentRoute: () => list,
    path: "/",
    component: lazyRouteComponent(
      () => import("@lictory/platform/routes/items"),
      "LegacyItemsRoute",
    ),
  });
  const item = createRoute({
    getParentRoute: () => list,
    path: "/$id",
    component: lazyRouteComponent(
      () => import("@lictory/platform/routes/items"),
      "LegacyItemsRoute",
    ),
  });
  return list.addChildren([index, item]);
});
const projectPage = (
  path: string,
  load: () => Promise<Record<string, unknown>>,
  name: string,
  pending = () => <DocumentSkeleton />,
) =>
  createRoute({
    getParentRoute: () => projectRoute,
    path,
    component: lazyRouteComponent(
      load as () => Promise<Record<string, () => null>>,
      name,
    ),
    pendingComponent: pending,
  });
const boardRoute = projectPage(
  "/board",
  () => import("@lictory/platform/components/delivery/board"),
  "Board",
);
const backlogRoute = projectPage(
  "/backlog",
  () => import("@lictory/platform/components/delivery/backlog"),
  "Backlog",
);
const handoffRoute = projectPage(
  "/handoff",
  () => import("@lictory/platform/components/delivery/handoff"),
  "Handoff",
);
const proposalsRoute = projectPage(
  "/proposals",
  () => import("@lictory/platform/routes/items"),
  "ProposalsRoute",
  ListSkeleton,
);
const refinementRoute = projectPage(
  "/refinement",
  () => import("@lictory/platform/routes/items"),
  "RefinementRoute",
  ListSkeleton,
);
const reviewsRoute = projectPage(
  "/reviews",
  () => import("@lictory/platform/routes/items"),
  "ReviewsRoute",
  ListSkeleton,
);
const iterationRoute = projectPage(
  "/iterations/$iteration",
  () => import("@lictory/platform/components/delivery/iteration-report"),
  "IterationReportPage",
);
const teamRoute = projectPage(
  "/teams/$team",
  () => import("@lictory/platform/components/delivery/team-backlog"),
  "TeamBacklog",
);
const viewRoute = projectPage(
  "/views/$view",
  () => import("@lictory/platform/routes/items"),
  "SavedViewRoute",
  ListSkeleton,
);
const projectSettingsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/settings",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/settings"),
    "ProjectSettingsRoute",
  ),
  pendingComponent: SettingsSectionSkeleton,
});
const projectSettingsIndexRoute = createRoute({
  getParentRoute: () => projectSettingsRoute,
  path: "/",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/settings"),
    "ProjectSettingsPage",
  ),
});
const projectSettingsSectionRoute = createRoute({
  getParentRoute: () => projectSettingsRoute,
  path: "/$section",
  component: lazyRouteComponent(
    () => import("@lictory/platform/routes/settings"),
    "ProjectSettingsPage",
  ),
  pendingComponent: SettingsSectionSkeleton,
});
const unknownProjectRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/$",
  component: UnknownProjectRoute,
});

const routeTree = rootRoute.addChildren([
  legacyAppRoute,
  authRoute.addChildren([
    signInRoute,
    signUpRoute,
    forgotPasswordRoute,
    resetPasswordRoute,
    verifyEmailRoute,
    authErrorRoute,
    welcomeRoute,
  ]),
  appRoute.addChildren([
    appIndexRoute,
    accountRoute,
    newOrganizationRoute,
    invitationRoute,
    adminRoute.addChildren([adminIndexRoute, adminSectionRoute]),
    orgRoute.addChildren([
      orgIndexRoute,
      orgAccountRoute,
      notificationsRoute,
      inboxRoute,
      inboxSettingsRoute,
      intelligenceRoute.addChildren([
        intelligenceIndexRoute,
        intelligenceChatRoute,
      ]),
      itemRedirectRoute,
      orgSettingsRoute.addChildren([
        orgSettingsIndexRoute,
        orgSettingsSectionRoute,
      ]),
      spacesRoute,
      spaceRoute.addChildren([
        spaceHomeRoute,
        spacePageRoute,
        spaceSettingsRoute,
      ]),
      projectRoute.addChildren([
        projectIndexRoute,
        itemsRoute.addChildren([itemsIndexRoute, itemRoute]),
        ...legacyItemRoutes,
        boardRoute,
        backlogRoute,
        handoffRoute,
        proposalsRoute,
        refinementRoute,
        reviewsRoute,
        iterationRoute,
        teamRoute,
        viewRoute,
        projectSettingsRoute.addChildren([
          projectSettingsIndexRoute,
          projectSettingsSectionRoute,
        ]),
        unknownProjectRoute,
      ]),
    ]),
  ]),
]);

// Query strings stay exactly as written (filters, sort, ?item, ?team): every
// value is a plain string, as in the address bar.
function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}
function stringifySearch(search: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (value !== undefined && value !== null)
      params.set(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const router = createRouter({
  routeTree,
  parseSearch,
  stringifySearch,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  // Like the previous loading states: skeletons appear quickly but never
  // flash for an instant chunk load.
  defaultPendingMs: 150,
  defaultPendingMinMs: 300,
  defaultErrorComponent: WorkspaceError,
  defaultNotFoundComponent: WorkspaceNotFound,
  scrollRestoration: true,
  scrollToTopSelectors: ["#main"],
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
