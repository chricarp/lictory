import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "~/lib/auth";
import { OnboardingEntry } from "~/components/workspace/onboarding-entry";
export const metadata: Metadata = { title: "Create organization" };
export default async function NewOrganizationPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return <OnboardingEntry userId={session.user.id} createOnly />;
}
