import type { Metadata } from "next";
import { OnboardingEntry } from "~/components/workspace/onboarding-entry";
export const metadata: Metadata = { title: "Create organization" };
export default function NewOrganizationPage() {
  return <OnboardingEntry createOnly />;
}
