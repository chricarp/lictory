import { serializeJsonLd } from "@lictory/marketing/lib/structured-data";

/** schema.org data for search engines and AI assistants. */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
