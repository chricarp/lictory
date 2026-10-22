import { JsonLd } from "@lictory/marketing/components/json-ld";
import {
  Breadcrumbs,
  LinkCard,
  MarketingPage,
  PageHeading,
  TryLictory,
} from "@lictory/marketing/components/marketing/page";
import { guides } from "@lictory/marketing/content/guides";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { absoluteUrl, publicPage } from "@lictory/marketing/lib/site";
import { publicPageStructuredData, webPageId } from "@lictory/marketing/lib/structured-data";

export const metadata = publicPageMetadata("/guides");

export default function GuidesPage() {
  const { title, description } = publicPage("/guides");
  return (
    <MarketingPage>
      <Breadcrumbs
        items={[{ name: "Lictory", href: "/" }, { name: "Guides" }]}
      />
      <PageHeading title={title} lead={description} />
      <ul className="mt-12 grid gap-3">
        {guides.map((guide) => (
          <li key={guide.slug}>
            <LinkCard href={`/guides/${guide.slug}`} title={guide.headline}>
              {guide.description}
            </LinkCard>
          </li>
        ))}
      </ul>
      <TryLictory />
      <JsonLd
        data={publicPageStructuredData("/guides", {
          pageType: "CollectionPage",
          nodes: [
            {
              "@type": "ItemList",
              "@id": absoluteUrl("/guides#list"),
              isPartOf: { "@id": webPageId("/guides") },
              itemListElement: guides.map((guide, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url: absoluteUrl(`/guides/${guide.slug}`),
                name: guide.title,
              })),
            },
          ],
        })}
      />
    </MarketingPage>
  );
}
