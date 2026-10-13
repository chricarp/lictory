import type { Metadata } from "next";
import { deploymentLegalSections } from "~/lib/legal/deployment";
import { LegalDocument } from "~/components/legal/legal-document";
import { privacySections } from "~/lib/legal/privacy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description:
    "How Lictory processes account, collaboration and technical data, and how to exercise your privacy rights.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Notice"
      introduction="This notice explains how personal data is handled when you visit Lictory, create an account or collaborate in an organization. It covers the public website and the work-management service. Acknowledging this notice is not consent to optional analytics."
      sections={deploymentLegalSections(
        privacySections,
        process.env.LICTORY_LEGAL_TEMPLATE,
      )}
    />
  );
}
