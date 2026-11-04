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
        introduction="This notice explains how personal data is handled when you visit lictory.com and docs.lictory.com. Lictory itself is self-hosted software: the project does not receive the data in any Lictory installation, whose operator is responsible for it."
        sections={privacySections}
      />
      <JsonLd data={publicPageStructuredData("/privacy")} />
    </>
  );
}
