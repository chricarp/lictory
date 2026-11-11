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
        introduction="This notice explains which personal data is processed when you visit lictory.com or docs.lictory.com, why, for how long, and what rights you have. The websites have no accounts or forms. They serve pages and count visits without cookies; an analytics cookie is set only if you accept it."
        sections={privacySections}
      />
      <JsonLd data={publicPageStructuredData("/privacy")} />
    </>
  );
}
