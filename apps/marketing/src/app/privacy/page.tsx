import { JsonLd } from "@lictory/marketing/components/json-ld";
import { LegalDocument } from "@lictory/marketing/components/legal/legal-document";
import { privacySections } from "@lictory/marketing/lib/legal/privacy";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { publicPageStructuredData } from "@lictory/marketing/lib/structured-data";

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
