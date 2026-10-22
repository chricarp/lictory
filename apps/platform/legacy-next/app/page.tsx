import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@lictory/core/lib/auth";
import { requestSession } from "../session";
import { db } from "@lictory/core/db";
import { directory } from "@lictory/core/domain/service";
import { paths } from "@lictory/core/lib/paths";
import { OnboardingEntry } from "@lictory/platform/components/workspace/onboarding-entry";

export const metadata: Metadata = { title: "Welcome to Lictory" };

// Entry point: land in the first organization, or create one.
export default async function AppIndex() {
  const session = await requestSession();
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
