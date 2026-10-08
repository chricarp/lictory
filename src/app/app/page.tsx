import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "~/lib/auth";
import { db } from "~/db";
import { directory } from "~/sync/server/service";
import { paths } from "~/lib/paths";
import { OnboardingEntry } from "~/components/workspace/onboarding-entry";

export const metadata: Metadata = { title: "Welcome to Lictory" };

// Entry point: land in the first organization, or create one.
export default async function AppIndex() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const initial = await directory(db, session.user.id);
  const organization = initial.organizations[0];
  if (organization) redirect(paths.org(organization.slug));
  const invitations = await auth.api.listUserInvitations({
    headers: await headers(),
  });
  // This authenticated server page evaluates invitation expiry per request.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return (
    <OnboardingEntry
      userId={session.user.id}
      userName={session.user.name}
      email={session.user.email}
      invitations={invitations.filter(
        (i) => i.status === "pending" && i.expiresAt.getTime() > now,
      )}
    />
  );
}
