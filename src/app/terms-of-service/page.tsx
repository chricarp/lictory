import type { Metadata } from "next";
import { deploymentLegalSections } from "~/lib/legal/deployment";
import { LegalDocument } from "~/components/legal/legal-document";
import { termsSections } from "~/lib/legal/terms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms for using Lictory’s collaborative requirements review and work-management service.",
  alternates: { canonical: "/terms-of-service" },
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      introduction="These terms govern your use of Lictory, a service for refining, reviewing and delivering software requirements. Please read them before creating an account. You can save or print this page for your records."
      sections={deploymentLegalSections(
        termsSections,
        process.env.LICTORY_LEGAL_TEMPLATE,
      )}
    />
  );
}
