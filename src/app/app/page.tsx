import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "~/lib/auth";
import { db } from "~/db";
import { directory } from "~/sync/server/service";
import { paths } from "~/lib/paths";
import { Onboarding } from "~/components/workspace/onboarding";

// Entry point: land in the first organization, or create one.
export default async function AppIndex() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const initial = await directory(db, session.user.id);
  const organization = initial.organizations[0];
  if (organization) redirect(paths.org(organization.slug));
  return <Onboarding step="organization" userName={session.user.name} />;
}
