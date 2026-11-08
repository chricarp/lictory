import { notFound } from "next/navigation";

import { JsonLd } from "@lictory/marketing/components/json-ld";
import {
  CapabilityValue,
  FactsTable,
  FaqSection,
  SectionTitle,
  Sources,
} from "@lictory/marketing/components/marketing/comparison-parts";
import {
  Breadcrumbs,
  LinkCard,
  MarketingPage,
  PageHeading,
  Prose,
  TryLictory,
  Updated,
} from "@lictory/marketing/components/marketing/page";
import {
  capabilityRows,
  comparison as findComparison,
  comparisonPath,
  comparisons,
} from "@lictory/marketing/content/comparisons";
import { guides } from "@lictory/marketing/content/guides";
import { product as findProduct } from "@lictory/marketing/content/products";
import { roundups } from "@lictory/marketing/content/roundups";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { comparisonStructuredData } from "@lictory/marketing/lib/comparison-structured-data";
import { cn } from "@lictory/core/lib/utils";

export const dynamicParams = false;

export function generateStaticParams() {
  return comparisons.map(({ slug }) => ({ product: slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/compare/[product]">) {
  const { product } = await params;
  return publicPageMetadata(`/compare/${product}`, { ownImage: true });
}

export default async function ComparisonPage({
  params,
}: PageProps<"/compare/[product]">) {
  const { product } = await params;
  const item = findComparison(product);
  if (!item) notFound();
  const others = comparisons.filter((other) => other.slug !== item.slug);
  const profiles = item.product
    ? [findProduct("lictory"), findProduct(item.product)]
    : [];
  // Roundups that include this competitor.
  const related = roundups.filter(
    (roundup) =>
      item.product &&
      roundup.entries.some((entry) => entry.product === item.product),
  );
  return (
    <MarketingPage page="comparison">
      <Breadcrumbs
        items={[{ name: "Lictory", href: "/" }, { name: item.headline }]}
      />
      <PageHeading title={item.headline} lead={item.intro}>
        <Updated date={item.updated} reviewed={profiles[1]?.reviewed} />
      </PageHeading>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {(
          [
            ["Lictory", item.verdict.lictory, true],
            [item.competitor, item.verdict.competitor, false],
          ] as const
        ).map(([name, verdict, highlight]) => (
          <div
            key={name}
            className={cn(
              "rounded-xl border border-border p-5",
              highlight ? "bg-primary/5" : "bg-card",
            )}
          >
            <p className="text-[13px] font-medium text-muted-foreground">
              {name}
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground/85">
              {verdict}
            </p>
          </div>
        ))}
      </div>

      <section aria-labelledby="table-title" className="mt-14">
        <SectionTitle id="table-title">Capabilities at a glance</SectionTitle>
        <div className="mt-6 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Lictory compared with {item.competitor}
            </caption>
            <thead>
              <tr className="border-b border-border text-[13px]">
                <th
                  scope="col"
                  className="px-4 py-3.5 text-left font-medium text-muted-foreground sm:px-5"
                >
                  Capability
                </th>
                <th
                  scope="col"
                  className="w-20 bg-primary/5 px-2 py-3.5 font-medium sm:w-28"
                >
                  Lictory
                </th>
                <th
                  scope="col"
                  className="w-20 px-2 py-3.5 font-medium text-muted-foreground sm:w-28"
                >
                  {item.competitor}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {capabilityRows(item).map((row) => (
                <tr key={row.feature}>
                  <th
                    scope="row"
                    className="px-4 py-3 text-left font-normal text-foreground/85 sm:px-5"
                  >
                    {row.feature}
                    {row.note ? (
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        {row.note}
                      </span>
                    ) : null}
                  </th>
                  <td className="bg-primary/5 px-2 py-3">
                    <span className="flex justify-center">
                      <CapabilityValue value={row.lictory} highlight />
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <span className="flex justify-center">
                      <CapabilityValue value={row.competitor} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {item.capabilities
            ? `Built-in capabilities, checked against ${item.competitor}’s public documentation. “Not documented” means we could not find it there, not that it is impossible.`
            : "Built-in capabilities as we understand them. Marketplace add-ons and integrations may change the picture."}
        </p>
      </section>

      {profiles.length ? (
        <section aria-labelledby="facts-title" className="mt-14">
          <SectionTitle id="facts-title">
            Licensing, hosting and pricing
          </SectionTitle>
          <FactsTable
            products={profiles}
            caption={`Licensing, hosting and pricing of Lictory and ${item.competitor}`}
          />
        </section>
      ) : null}

      {item.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24">
          <Prose>{`## ${section.title}\n\n${section.body}`}</Prose>
        </section>
      ))}

      <FaqSection faqs={item.faqs} />

      <TryLictory page="comparison" />

      <Sources products={profiles} />

      <section aria-labelledby="more-title" className="mt-16">
        <h2 id="more-title" className="text-lg font-medium">
          Keep reading
        </h2>
        <ul className="mt-4 grid gap-3">
          {related.map((roundup) => (
            <li key={roundup.path}>
              <LinkCard href={roundup.path} title={roundup.headline}>
                {roundup.description}
              </LinkCard>
            </li>
          ))}
          {others.map((other) => (
            <li key={other.slug}>
              <LinkCard href={comparisonPath(other)} title={other.headline}>
                {other.description}
              </LinkCard>
            </li>
          ))}
          {guides.slice(0, 2).map((guide) => (
            <li key={guide.slug}>
              <LinkCard href={`/guides/${guide.slug}`} title={guide.headline}>
                {guide.description}
              </LinkCard>
            </li>
          ))}
        </ul>
      </section>

      <JsonLd data={comparisonStructuredData(item)} />
    </MarketingPage>
  );
}
