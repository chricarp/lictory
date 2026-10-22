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
import { FileQuestion, Search } from "lucide-react";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
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
import { useSessionUser } from "@lictory/platform/lib/session";
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
import { Onboarding } from "@lictory/platform/components/workspace/onboarding";
import {
  ConnectionNotice,
  ConnectionUnavailable,
  useConnectionBlocked,
} from "@lictory/platform/components/workspace/connection-notice";
import { RecoveryWatcher } from "@lictory/platform/components/workspace/recovery";
import {
  SyncIssue,
  isSyncBlocked,
} from "@lictory/platform/components/workspace/sync-issue";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { WorkspaceNotFound } from "@lictory/platform/routes/errors";
import { PageTitle } from "@lictory/platform/routes/title";
import { useConnectionState } from "@rocicorp/zero/react";

// A just-created or just-joined organization reaches this browser a moment
// after the person navigates to it.
const ARRIVAL_GRACE_MS = 2500;
export const ACCESS_REMOVED = "Organization access has been removed.";

export function OrganizationLayout() {
  const { org } = useParams<{ org: string }>();
  const user = useSessionUser();
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
      {content}
      {ready && <ConnectionNotice />}
      <RecoveryWatcher />
    </WorkspaceProvider>
  );
}

// Organization root: Lictory Intelligence is the home page. A brand-new
// organization without projects first creates its first project.
export function OrganizationIndex() {
  const { organization, projects, view, isAdmin } = useWorkspace();
  const router = useRouter();
  const ready = projects.length > 0;
  useEffect(() => {
    if (ready) router.replace(paths.intelligence(organization.slug));
  }, [ready, organization.slug, router]);
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

export function ProjectIndexRedirect() {
  const { organization } = useWorkspace();
  const project = useProject();
  const router = useRouter();
  useEffect(() => {
    router.replace(paths.list(organization.slug, project.key, "epics"));
  }, [router, organization.slug, project.key]);
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
          href={paths.list(organization.slug, project.key, "epics")}
          className="contents"
        >
          <Button variant="secondary">Back to Epics</Button>
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
