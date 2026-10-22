import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@lictory/core/lib/auth";
import { OnboardingEntry } from "@lictory/platform/components/workspace/onboarding-entry";
export const metadata: Metadata = { title: "Create organization" };
export default async function NewOrganizationPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return <OnboardingEntry userId={session.user.id} createOnly />;
}
