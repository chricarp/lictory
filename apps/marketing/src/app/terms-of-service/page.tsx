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
        title="Terms of Service"
        introduction="These terms govern your use of Lictory, a service for refining, reviewing and delivering software requirements. Please read them before creating an account. You can save or print this page for your records."
        sections={termsSections}
      />
      <JsonLd data={publicPageStructuredData("/terms-of-service")} />
    </>
  );
}
