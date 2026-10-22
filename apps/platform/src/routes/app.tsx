import type { ReactNode } from "react";
import { Outlet, useLoaderData } from "@tanstack/react-router";
import { parseAppearance, parseTheme } from "@lictory/core/lib/appearance";
import { paths } from "@lictory/core/lib/paths";
import { DocumentSkeleton } from "@lictory/ui/skeleton";
import { AppearanceProvider } from "@lictory/platform/components/app/appearance-provider";
import { PostHogIdentity } from "@lictory/platform/components/app/posthog-identity";
import { Invitation } from "@lictory/platform/components/app/invitation";
import { OnboardingEntry } from "@lictory/platform/components/workspace/onboarding-entry";
import { authClient } from "@lictory/platform/lib/auth-client";
import { Redirect, useSearchParams } from "@lictory/platform/lib/navigation";
import { useSessionState, useSessionUser } from "@lictory/platform/lib/session";
import { WorkspaceDataProvider } from "@lictory/platform/data/zero";
import { useMemberships } from "@lictory/platform/data/memberships";
import { PageTitle } from "@lictory/platform/routes/title";

// Everything behind sign-in. The route guard has already required a session
// and a handle; this keeps the person's appearance and their own Zero client.
export function AppLayout() {
  const state = useSessionState();
  const user = state.session?.user;
  if (!user) {
    const here = `${window.location.pathname}${window.location.search}`;
    return (
      <Redirect href={`/sign-in?callbackUrl=${encodeURIComponent(here)}`} />
    );
  }
  return (
    <AppearanceProvider
      initial={parseAppearance(user.appearance)}
      initialTheme={parseTheme(user.theme)}
    >
      <PostHogIdentity userId={user.id} />
      <WorkspaceDataProvider key={user.id} userId={user.id}>
        <div className="min-h-dvh bg-background">
          <Outlet />
        </div>
      </WorkspaceDataProvider>
    </AppearanceProvider>
  );
}

type Invite = {
  id: string;
  organizationName: string;
  organizationId: string;
  status: string;
  expiresAt: Date | string;
};

// Pending invitations for the entry page; an unavailable list only hides the
// shortcut, joining still works from the invitation email.
export async function loadInvitations(): Promise<Invite[]> {
  try {
    const result = await authClient.organization.listUserInvitations();
    const now = Date.now();
    return (result.data ?? []).filter(
      (i) => i.status === "pending" && new Date(i.expiresAt).getTime() > now,
    );
  } catch {
    return [];
  }
}

// Entry point: land in the first organization, or create or join one.
export function AppIndex() {
  const user = useSessionUser();
  const invitations = useLoaderData({ strict: false }) as Invite[] | undefined;
  const { organizations, complete } = useMemberships();
  const first = organizations[0];
  if (first) return <Redirect href={paths.org(first.slug)} />;
  if (!complete) return <DocumentSkeleton headerBar />;
  return (
    <>
      <PageTitle title="Welcome to Lictory" />
      <OnboardingEntry
        userId={user.id}
        userName={user.name}
        email={user.email}
        invitations={invitations ?? []}
      />
    </>
  );
}

export function NewOrganizationPage() {
  const user = useSessionUser();
  return (
    <>
      <PageTitle title="Create organization" />
      <OnboardingEntry userId={user.id} createOnly />
    </>
  );
}

export function InvitationPage() {
  const id = useSearchParams().get("id") ?? undefined;
  return (
    <>
      <PageTitle title="Invitation" />
      <Invitation id={id} />
    </>
  );
}

// Old organization-scoped account links.
export function RedirectTo({ href }: { href: string }): ReactNode {
  return <Redirect href={href} />;
}
