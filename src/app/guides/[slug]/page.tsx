import { notFound } from "next/navigation";

import { JsonLd } from "~/components/json-ld";
import {
  Breadcrumbs,
  LinkCard,
  MarketingPage,
  PageHeading,
  Prose,
  TryLictory,
  Updated,
} from "~/components/marketing/page";
import { guide as findGuide, guides } from "~/content/guides";
import { publicPageMetadata } from "~/lib/public-metadata";
import { absoluteUrl } from "~/lib/site";
import {
  publicPageStructuredData,
  schemaIds,
  webPageId,
} from "~/lib/structured-data";

export const dynamicParams = false;

export function generateStaticParams() {
  return guides.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/guides/[slug]">) {
  const { slug } = await params;
  return publicPageMetadata(`/guides/${slug}`, {
    type: "article",
    ownImage: true,
  });
}

export default async function GuidePage({
  params,
}: PageProps<"/guides/[slug]">) {
  const { slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();
  const path = `/guides/${guide.slug}`;
  const related = guides.filter((other) => other.slug !== guide.slug);
  return (
    <MarketingPage>
      <Breadcrumbs
        items={[
          { name: "Lictory", href: "/" },
          { name: "Guides", href: "/guides" },
          { name: guide.headline },
        ]}
      />
      <article>
        <PageHeading title={guide.headline} lead={guide.description}>
          <Updated date={guide.updated} />
        </PageHeading>
        <Prose className="mt-10">{guide.body}</Prose>
      </article>
      <TryLictory />
      <section aria-labelledby="related-title" className="mt-16">
        <h2 id="related-title" className="text-lg font-medium">
          More guides
        </h2>
        <ul className="mt-4 grid gap-3">
          {related.map((other) => (
            <li key={other.slug}>
              <LinkCard href={`/guides/${other.slug}`} title={other.headline}>
                {other.description}
              </LinkCard>
            </li>
          ))}
        </ul>
      </section>
      <JsonLd
        data={publicPageStructuredData(path, {
          nodes: [
            {
              "@type": "Article",
              "@id": absoluteUrl(`${path}#article`),
              headline: guide.title,
              description: guide.description,
              inLanguage: "en",
              datePublished: guide.published,
              dateModified: guide.updated,
              image: absoluteUrl(`${path}/opengraph-image`),
              mainEntityOfPage: { "@id": webPageId(path) },
              author: { "@id": schemaIds.organization },
              publisher: { "@id": schemaIds.organization },
            },
          ],
        })}
      />
    </MarketingPage>
  );
}
