import { JsonLd } from "@lictory/marketing/components/json-ld";
import Link from "next/link";

import {
  FaqSection,
  SectionTitle,
  Sources,
} from "@lictory/marketing/components/marketing/comparison-parts";
import {
  Breadcrumbs,
  headingId,
  LinkCard,
  MarketingPage,
  PageHeading,
  Prose,
  TryLictory,
  Updated,
} from "@lictory/marketing/components/marketing/page";
import {
  comparisonPath,
  comparisons,
} from "@lictory/marketing/content/comparisons";
import { product } from "@lictory/marketing/content/products";
import {
  glanceColumns,
  glanceValue,
  roundupProducts,
  roundupReviewed,
  roundups,
  type Roundup,
} from "@lictory/marketing/content/roundups";
import { roundupStructuredData } from "@lictory/marketing/lib/comparison-structured-data";
import { cn } from "@lictory/core/lib/utils";

// An alternatives or "best tools" page: several products, each with who it
// suits, its licensing, hosting and pricing, and what to weigh before choosing.

function comparisonFor(id: string) {
  return comparisons.find((item) => item.product === id);
}

export function RoundupPage({ roundup }: { roundup: Roundup }) {
  const profiles = roundupProducts(roundup);
  const related = comparisons.filter((item) =>
    roundup.entries.some((entry) => entry.product === item.product),
  );
  const otherRoundups = roundups.filter((other) => other.path !== roundup.path);
  return (
    <MarketingPage page={roundup.page}>
      <Breadcrumbs
        items={[{ name: "Lictory", href: "/" }, { name: roundup.headline }]}
      />
      <PageHeading title={roundup.headline} lead={roundup.intro}>
        <Updated date={roundup.updated} reviewed={roundupReviewed(roundup)} />
      </PageHeading>

      <section aria-labelledby="glance-title" className="mt-14">
        <SectionTitle id="glance-title">At a glance</SectionTitle>
        <div className="mt-6 hidden overflow-hidden rounded-xl border border-border sm:block">
          <table className="w-full text-sm">
            <caption className="sr-only">{roundup.headline}</caption>
            <thead>
              <tr className="border-b border-border text-left text-[13px] text-muted-foreground">
                <th scope="col" className="px-4 py-3.5 font-medium sm:px-5">
                  Tool
                </th>
                {roundup.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="px-3 py-3.5 font-medium"
                  >
                    {glanceColumns[column]}
                  </th>
                ))}
                <th scope="col" className="px-3 py-3.5 font-medium">
                  Best for
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roundup.entries.map((entry) => {
                const profile = product(entry.product);
                return (
                  <tr
                    key={entry.product}
                    className={cn(
                      entry.product === "lictory" && "bg-primary/5",
                    )}
                  >
                    <th
                      scope="row"
                      className="px-4 py-3 text-left align-top font-medium sm:px-5"
                    >
                      <a
                        href={`#${headingId(profile.name)}`}
                        className="hover:underline"
                      >
                        {profile.name}
                      </a>
                    </th>
                    {roundup.columns.map((column) => (
                      <td
                        key={column}
                        className="px-3 py-3 align-top text-foreground/85"
                      >
                        {glanceValue(profile, column)}
                      </td>
                    ))}
                    <td className="px-3 py-3 align-top leading-6 text-muted-foreground">
                      {entry.bestFor}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="mt-6 grid gap-3 sm:hidden">
          {roundup.entries.map((entry) => {
            const profile = product(entry.product);
            return (
              <li
                key={entry.product}
                className={cn(
                  "rounded-xl border border-border p-4 text-sm",
                  entry.product === "lictory" ? "bg-primary/5" : "bg-card",
                )}
              >
                <a
                  href={`#${headingId(profile.name)}`}
                  className="font-medium hover:underline"
                >
                  {profile.name}
                </a>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {roundup.columns.map((column) => (
                    <div key={column} className="contents">
                      <dt className="text-muted-foreground">
                        {glanceColumns[column]}
                      </dt>
                      <dd className="text-foreground/85">
                        {glanceValue(profile, column)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 leading-6 text-muted-foreground">
                  {entry.bestFor}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="method" className="scroll-mt-24">
        <Prose>{`## How we chose\n\n${roundup.method}`}</Prose>
      </section>

      {roundup.entries.map((entry, index) => {
        const profile = product(entry.product);
        const compare = comparisonFor(entry.product);
        return (
          <section
            key={entry.product}
            id={headingId(profile.name)}
            aria-labelledby={`${headingId(profile.name)}-title`}
            className="mt-14 scroll-mt-24"
          >
            <h2
              id={`${headingId(profile.name)}-title`}
              className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl"
            >
              {index + 1}. {profile.name}
            </h2>
            <Prose>{entry.summary}</Prose>
            <dl className="mt-6 grid gap-4 rounded-xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
              {(
                [
                  ["Best for", entry.bestFor],
                  ["Weigh before choosing", entry.considerations],
                  ["License", profile.license],
                  ["Hosting", profile.hosting],
                  ["Pricing model", profile.pricing],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[13px] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 leading-6 text-foreground/85">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {compare ? (
                <Link
                  href={comparisonPath(compare)}
                  className="text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground"
                >
                  {compare.headline}
                </Link>
              ) : null}
              {entry.product === "lictory" ? null : (
                <a
                  href={profile.website}
                  rel="noopener nofollow"
                  className="text-muted-foreground underline decoration-foreground/25 underline-offset-4 hover:text-foreground"
                >
                  {profile.name} website
                </a>
              )}
            </p>
          </section>
        );
      })}

      {roundup.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24">
          <Prose>{`## ${section.title}\n\n${section.body}`}</Prose>
        </section>
      ))}

      <FaqSection faqs={roundup.faqs} />

      <TryLictory page={roundup.page} />

      <Sources products={profiles} />

      <section aria-labelledby="more-title" className="mt-16">
        <h2 id="more-title" className="text-lg font-medium">
          Keep reading
        </h2>
        <ul className="mt-4 grid gap-3">
          {[
            ...otherRoundups.map((other) => ({
              href: other.path,
              title: other.headline,
              description: other.description,
            })),
            ...related.map((item) => ({
              href: comparisonPath(item),
              title: item.headline,
              description: item.description,
            })),
          ].map((link) => (
            <li key={link.href}>
              <LinkCard href={link.href} title={link.title}>
                {link.description}
              </LinkCard>
            </li>
          ))}
        </ul>
      </section>

      <JsonLd data={roundupStructuredData(roundup)} />
    </MarketingPage>
  );
}
