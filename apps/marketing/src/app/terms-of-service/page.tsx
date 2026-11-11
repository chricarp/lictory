import { JsonLd } from "@lictory/marketing/components/json-ld";
import { LegalDocument } from "@lictory/marketing/components/legal/legal-document";
import { termsSections } from "@lictory/marketing/lib/legal/terms";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { publicPageStructuredData } from "@lictory/marketing/lib/structured-data";

export const metadata = publicPageMetadata("/terms-of-service");

export default function TermsPage() {
  return (
    <>
      <LegalDocument
        title="Terms of Use"
        introduction="These terms apply to the Lictory project websites, lictory.com and docs.lictory.com. The Lictory software is covered by its open-source license, and an installation of it by the terms of whoever runs it."
        sections={termsSections}
      />
      <JsonLd data={publicPageStructuredData("/terms-of-service")} />
    </>
  );
}
