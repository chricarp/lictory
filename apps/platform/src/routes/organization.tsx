import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Outlet } from "@tanstack/react-router";
import { FileQuestion, Search, ShieldCheck } from "lucide-react";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
import { enabledTypes, type Project } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { DocumentSkeleton } from "@lictory/ui/skeleton";
import { MissingState } from "@lictory/ui/status-page";
import { toast } from "@lictory/ui/toast";
import { useMemberships } from "@lictory/platform/data/memberships";
import { hasProjectRows } from "@lictory/platform/data/rows";
import {
  viewStatus,
  type ConnectionName,
} from "@lictory/platform/data/connection";
import {
  useSessionUser,
  useTwoFactorRequiredBy,
} from "@lictory/platform/lib/session";
import {
  Link,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import {
  WorkspaceProvider,
  useOrganizationRows,
  useWorkspace,
  type Organization,
} from "@lictory/platform/components/workspace/provider";
import { Shell } from "@lictory/platform/components/workspace/shell";
import { useLastProjectKey } from "@lictory/platform/lib/last-project";
import { Onboarding } from "@lictory/platform/components/workspace/onboarding";
import {
  ConnectionNotice,
  ConnectionUnavailable,
  useConnectionBlocked,
} from "@lictory/platform/components/workspace/connection-notice";
import { RecoveryWatcher } from "@lictory/platform/components/workspace/recovery";
import { SpacesProvider } from "@lictory/platform/components/spaces/store";
import {
  SyncIssue,
  isSyncBlocked,
} from "@lictory/platform/components/workspace/sync-issue";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { WorkspaceNotFound } from "@lictory/platform/routes/errors";
import { DeletionScheduledNotice } from "@lictory/platform/components/settings/org-deletion";
import { Exports } from "@lictory/platform/components/settings/org-export";
import { PageTitle } from "@lictory/platform/routes/title";
import { useConnectionState } from "@rocicorp/zero/react";

// A just-created or just-joined organization reaches this browser a moment
// after the person navigates to it.
const ARRIVAL_GRACE_MS = 2500;
export const ACCESS_REMOVED = "Organization access has been removed.";

export function OrganizationLayout() {
  const { org } = useParams<{ org: string }>();
  const user = useSessionUser();
  const held = useTwoFactorRequiredBy();
  const router = useRouter();
  const { organizations, complete } = useMemberships();
  const blocked = useConnectionBlocked();
  const organization = organizations.find((o) => o.slug === org);
  // Organizations this route has shown, with the handle they had: if one
  // vanishes from my memberships, access was removed (or the organization
  // deleted).
  const [shown, setShown] = useState<Readonly<Record<string, string>>>({});
  if (organization && shown[organization.id] !== organization.slug)
    setShown({ ...shown, [organization.id]: organization.slug });
  // The organization shown under this handle now has another one: it was
  // renamed, so follow it, keeping the rest of the address. (An address ahead
  // of the synchronized handle, right after renaming here, simply waits.)
  const renamed = organization
    ? undefined
    : organizations.find((o) => shown[o.id] === org && o.slug !== org);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    if (!renamed) return;
    // The address bar may already be ahead of this render's parameters.
    const [, current = "", ...rest] = pathname.split("/");
    if (current !== org) return;
    router.replace(
      [``, renamed.slug, ...rest].join("/") + (search ? `?${search}` : ""),
    );
  }, [renamed, org, pathname, search, router]);
  const lost =
    complete &&
    !organization &&
    !renamed &&
    Object.keys(shown).some((id) => !organizations.some((o) => o.id === id));
  const notified = useRef(false);
  useEffect(() => {
    if (!lost || notified.current) return;
    notified.current = true;
    toast.add({
      title: ACCESS_REMOVED,
      type: "error",
      description:
        "An administrator removed you, or the organization was deleted.",
      timeout: 10000,
    });
    router.replace("/");
  }, [lost, router]);
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), ARRIVAL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [org]);
  if (!organization) {
    if (blocked && !complete) return <ConnectionUnavailable status={blocked} />;
    if (!complete || !graceOver || lost || renamed)
      return (
        <>
          <PageTitle />
          <DocumentSkeleton headerBar />
        </>
      );
    return <WorkspaceNotFound />;
  }
  // The server refuses this organization's data until the person turns on
  // two-factor authentication; say so instead of showing sync errors.
  if (held.some((o) => o.id === organization.id))
    return <TwoFactorRequired organizationName={organization.name} />;
  // Scheduled for deletion: locked for everyone until it is deleted or an
  // owner cancels (the server refuses its data either way).
  if (organization.deletion)
    return (
      <main className="min-h-dvh">
        <PageTitle title={`${organization.name} is scheduled for deletion`} />
        <DeletionScheduledNotice
          organization={{ ...organization, deletion: organization.deletion }}
          exports={<Exports organizationId={organization.id} />}
        />
      </main>
    );
  return (
    <OrganizationWorkspace
      key={organization.id}
      organization={organization}
      organizations={organizations}
      user={{
        name: user.name,
        email: user.email,
        image: user.image ?? null,
        handle: user.handle ?? null,
      }}
      userId={user.id}
    />
  );
}

const OnboardingSetup = lazy(() =>
  import("@lictory/platform/components/workspace/onboarding-setup").then(
    (m) => ({ default: m.OnboardingSetup }),
  ),
);

const SetupContext = createContext<() => void>(() => undefined);
// Setup tells the organization layout it is done; until then the setup flow
// stays in place even after its project exists (invitations come next).
export function useFinishSetup() {
  return useContext(SetupContext);
}

function OrganizationWorkspace({
  organization,
  organizations,
  user,
  userId,
}: {
  organization: Organization;
  organizations: Organization[];
  user: {
    name: string;
    email: string;
    image: string | null;
    handle: string | null;
  };
  userId: string;
}) {
  const { rows, complete, error } = useOrganizationRows(organization.id);
  const connection: ConnectionName = useConnectionState().name;
  const isAdmin = applicationRoleOf(organization.role) === "admin";
  const hasProjects = hasProjectRows(rows);
  const ready = complete || rows.some((r) => r.type === "directory");
  // Archived projects still prove that the organization was configured.
  const needsSetup = complete && !hasProjects;
  const [inSetup, setInSetup] = useState(false);
  if (needsSetup && isAdmin && !inSetup) setInSetup(true);
  const status = viewStatus(connection, complete);
  let content: ReactNode;
  if (!ready)
    content = isSyncBlocked(status) ? (
      <div className="flex min-h-dvh items-center justify-center">
        <SyncIssue status={status} error={error} />
      </div>
    ) : (
      <DocumentSkeleton headerBar />
    );
  else if (needsSetup || inSetup)
    content = (
      <SetupContext.Provider value={() => setInSetup(false)}>
        <Suspense fallback={<DocumentSkeleton headerBar />}>
          <OnboardingSetup canCreate={isAdmin} />
        </Suspense>
      </SetupContext.Provider>
    );
  else
    content = (
      <Shell user={user}>
        <Outlet />
      </Shell>
    );
  return (
    <WorkspaceProvider
      userId={userId}
      organization={organization}
      organizations={organizations}
      rows={rows}
      complete={complete}
      queryError={error}
    >
      <SpacesProvider>
        {content}
        {ready && <ConnectionNotice />}
        <RecoveryWatcher />
      </SpacesProvider>
    </WorkspaceProvider>
  );
}

// Organization root: Litto is the home page. When Litto cannot answer (no AI
// provider on this server, or Lictory Intelligence turned off), home is the
// project the person last worked in instead of a page that only says so. A
// brand-new organization without projects first creates its first project.
export function OrganizationIndex() {
  const { organization, projects, view, isAdmin, directory, userId } =
    useWorkspace();
  const router = useRouter();
  const lastKey = useLastProjectKey(organization.id);
  // The directory carries the Lictory Intelligence settings; until it has
  // arrived its defaults would read as "off".
  const loaded = directory.members.some((m) => m.id === userId);
  const ready = projects.length > 0;
  const littoHome = directory.ai.available && directory.ai.enabled;
  const home =
    !ready || !loaded
      ? undefined
      : littoHome
        ? paths.intelligence(organization.slug)
        : paths.project(
            organization.slug,
            (projects.find((p) => p.key === lastKey) ?? projects[0]!).key,
          );
  useEffect(() => {
    if (!home) return;
    router.replace(home);
    // A redirect issued while the navigation that opened this page is still
    // settling can be superseded, which left people who had just joined on a
    // blank organization page. Retry while this page is still shown; it
    // unmounts as soon as the redirect lands.
    const retry = setInterval(() => router.replace(home), 1500);
    return () => clearInterval(retry);
  }, [home, router]);
  if (ready || view.status === "hydrating") return null;
  if (isSyncBlocked(view.status))
    return <SyncIssue status={view.status} error={view.error} />;
  return <Onboarding canCreate={isAdmin} />;
}

export function NotificationsRedirect() {
  const { organization } = useWorkspace();
  const router = useRouter();
  useEffect(() => {
    router.replace(paths.inbox(organization.slug));
  }, [router, organization.slug]);
  return null;
}

// Refinement is home when the project reviews specifications; projects of
// plain delivery work open where that work happens.
function projectHome(
  org: string,
  project: Project,
  delivery: Parameters<typeof enabledTypes>[0],
) {
  if (enabledTypes(delivery, project.id).some((t) => t.hasSpecification))
    return paths.refinement(org, project.key);
  return project.deliveryMode === "native"
    ? paths.board(org, project.key)
    : paths.items(org, project.key);
}

export function ProjectIndexRedirect() {
  const { organization, delivery } = useWorkspace();
  const project = useProject();
  const router = useRouter();
  const home = projectHome(organization.slug, project, delivery);
  useEffect(() => {
    router.replace(home);
  }, [router, home]);
  return null;
}

export function UnknownProjectRoute() {
  const project = useProject();
  const { organization } = useWorkspace();
  return (
    <MissingState
      illustration="search"
      icon={Search}
      title="This page does not exist"
      action={
        <Link
          href={paths.project(organization.slug, project.key)}
          className="contents"
        >
          <Button variant="secondary">Back to {project.name}</Button>
        </Link>
      }
    >
      {project.name} has no page at this address.
    </MissingState>
  );
}

// Unknown addresses inside an organization keep the shell around them.
export function OrganizationNotFound() {
  const { organization } = useWorkspace();
  return (
    <MissingState
      illustration="search"
      icon={FileQuestion}
      title="This page does not exist"
      action={
        <Link href={paths.inbox(organization.slug)} className="contents">
          <Button variant="secondary">Go to Inbox</Button>
        </Link>
      }
    >
      Check the address, or choose a page from the sidebar.
    </MissingState>
  );
}

function TwoFactorRequired({ organizationName }: { organizationName: string }) {
  const pathname = usePathname();
  return (
    <main className="min-h-dvh">
      <PageTitle title="Two-factor authentication required" />
      <MissingState
        icon={ShieldCheck}
        title="Turn on two-factor authentication"
        action={
          <Link
            href={`/account?returnTo=${encodeURIComponent(pathname)}#two-factor`}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            Set up two-factor authentication
          </Link>
        }
      >
        {organizationName} requires two-factor authentication for its members.
        Set it up in your account settings, then come back here.
      </MissingState>
    </main>
  );
}
