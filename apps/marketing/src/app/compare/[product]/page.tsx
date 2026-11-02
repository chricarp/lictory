import { Check, Minus } from "lucide-react";
import { notFound } from "next/navigation";

import { JsonLd } from "@lictory/marketing/components/json-ld";
import {
  comparisonCellText,
  comparisonRows,
  type ComparisonCell,
} from "@lictory/marketing/components/landing/content";
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
  comparison as findComparison,
  comparisons,
} from "@lictory/marketing/content/comparisons";
import { guides } from "@lictory/marketing/content/guides";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import {
  faqNode,
  publicPageStructuredData,
} from "@lictory/marketing/lib/structured-data";
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

function Cell({
  value,
  highlight,
}: {
  value: ComparisonCell;
  highlight?: boolean;
}) {
  if (value === "yes")
    return (
      <Check
        role="img"
        aria-label={comparisonCellText.yes}
        className={cn(
          "size-4",
          highlight ? "text-primary" : "text-foreground/70",
        )}
      />
    );
  if (value === "no")
    return (
      <Minus
        role="img"
        aria-label={comparisonCellText.no}
        className="size-4 text-muted-foreground"
      />
    );
  return (
    <span className="text-xs text-muted-foreground">
      {comparisonCellText[value]}
    </span>
  );
}

export default async function ComparisonPage({
  params,
}: PageProps<"/compare/[product]">) {
  const { product } = await params;
  const item = findComparison(product);
  if (!item) notFound();
  const path = `/compare/${item.slug}`;
  const others = comparisons.filter((other) => other.slug !== item.slug);
  return (
    <MarketingPage>
      <Breadcrumbs
        items={[{ name: "Lictory", href: "/" }, { name: item.headline }]}
      />
      <PageHeading title={item.headline} lead={item.intro}>
        <Updated date={item.updated} />
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
        <h2
          id="table-title"
          className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl"
        >
          Capabilities at a glance
        </h2>
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
              {comparisonRows.map((row) => (
                <tr key={row.feature}>
                  <th
                    scope="row"
                    className="px-4 py-3 text-left font-normal text-foreground/85 sm:px-5"
                  >
                    {row.feature}
                  </th>
                  <td className="bg-primary/5 px-2 py-3">
                    <span className="flex justify-center">
                      <Cell value={row.lictory} highlight />
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <span className="flex justify-center">
                      <Cell value={row[item.slug]} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Built-in capabilities as we understand them. Marketplace add-ons and
          integrations may change the picture.
        </p>
      </section>

      {item.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24">
          <Prose>{`## ${section.title}\n\n${section.body}`}</Prose>
        </section>
      ))}

      <section
        id="faq"
        aria-labelledby="faq-title"
        className="mt-14 scroll-mt-24"
      >
        <h2
          id="faq-title"
          className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl"
        >
          Frequently asked questions
        </h2>
        <div className="mt-6 divide-y divide-border border-y border-border">
          {item.faqs.map(({ question, answer }) => (
            <div key={question} className="py-5">
              <h3 className="text-[15px] font-medium">{question}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      <TryLictory />

      <section aria-labelledby="more-title" className="mt-16">
        <h2 id="more-title" className="text-lg font-medium">
          Keep reading
        </h2>
        <ul className="mt-4 grid gap-3">
          {others.map((other) => (
            <li key={other.slug}>
              <LinkCard href={`/compare/${other.slug}`} title={other.headline}>
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

      <JsonLd
        data={publicPageStructuredData(path, {
          nodes: [faqNode(path, item.faqs)],
        })}
      />
    </MarketingPage>
  );
}
