import { JsonLd } from "~/components/json-ld";
import { LegalDocument } from "~/components/legal/legal-document";
import { privacySections } from "~/lib/legal/privacy";
import { publicPageMetadata } from "~/lib/public-metadata";
import { publicPageStructuredData } from "~/lib/structured-data";

export const metadata = publicPageMetadata("/privacy");

export default function PrivacyPage() {
  return (
    <>
      <LegalDocument
        title="Privacy Notice"
        introduction="This notice explains how personal data is handled when you visit Lictory, create an account or collaborate in an organization. It covers the public website and the work-management service. Acknowledging this notice is not consent to optional analytics."
        sections={privacySections}
      />
      <JsonLd data={publicPageStructuredData("/privacy")} />
    </>
  );
}
