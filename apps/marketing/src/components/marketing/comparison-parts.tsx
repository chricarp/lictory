import { Check, Minus } from "lucide-react";

import {
  capabilityCellText,
  type CapabilityCell,
} from "@lictory/marketing/content/comparisons";
import type { ProductProfile } from "@lictory/marketing/content/products";
import { cn } from "@lictory/core/lib/utils";

// Building blocks shared by the comparison, alternatives and roundup pages, so
// every page that states a fact about a product renders it the same way.

export function CapabilityValue({
  value,
  highlight,
}: {
  value: CapabilityCell;
  highlight?: boolean;
}) {
  if (value === "yes")
    return (
      <Check
        role="img"
        aria-label={capabilityCellText.yes}
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
        aria-label={capabilityCellText.no}
        className="size-4 text-muted-foreground"
      />
    );
  return (
    <span className="text-center text-xs text-muted-foreground">
      {capabilityCellText[value]}
    </span>
  );
}

export function SectionTitle({
  id,
  children,
}: {
  id: string;
  children: string;
}) {
  return (
    <h2
      id={id}
      className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl"
    >
      {children}
    </h2>
  );
}

const factLabels = {
  license: "License",
  hosting: "Hosting",
  pricing: "Pricing model",
} as const;

/**
 * Licensing, hosting and pricing of two or more products side by side. On a
 * phone each product becomes its own card instead of a wide table.
 */
export function FactsTable({
  products,
  caption,
}: {
  products: readonly ProductProfile[];
  caption: string;
}) {
  const keys = Object.keys(factLabels) as (keyof typeof factLabels)[];
  return (
    <>
      <div className="mt-6 hidden overflow-hidden rounded-xl border border-border sm:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-[13px]">
              <th
                scope="col"
                className="w-32 px-5 py-3.5 text-left font-medium text-muted-foreground"
              >
                <span className="sr-only">Fact</span>
              </th>
              {products.map((product) => (
                <th
                  key={product.id}
                  scope="col"
                  className={cn(
                    "px-4 py-3.5 text-left font-medium",
                    product.id === "lictory" && "bg-primary/5",
                  )}
                >
                  {product.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {keys.map((key) => (
              <tr key={key}>
                <th
                  scope="row"
                  className="px-5 py-3 text-left align-top font-normal text-muted-foreground"
                >
                  {factLabels[key]}
                </th>
                {products.map((product) => (
                  <td
                    key={product.id}
                    className={cn(
                      "px-4 py-3 align-top leading-6 text-foreground/85",
                      product.id === "lictory" && "bg-primary/5",
                    )}
                  >
                    {product[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 grid gap-3 sm:hidden">
        {products.map((product) => (
          <dl
            key={product.id}
            className={cn(
              "rounded-xl border border-border p-4 text-sm",
              product.id === "lictory" ? "bg-primary/5" : "bg-card",
            )}
          >
            <p className="font-medium">{product.name}</p>
            {keys.map((key) => (
              <div key={key} className="mt-3">
                <dt className="text-[13px] text-muted-foreground">
                  {factLabels[key]}
                </dt>
                <dd className="mt-0.5 leading-6 text-foreground/85">
                  {product[key]}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </>
  );
}

/** Where the facts about other products come from, and when they were checked. */
export function Sources({ products }: { products: readonly ProductProfile[] }) {
  const others = products.filter((product) => product.id !== "lictory");
  if (!others.length) return null;
  return (
    <section aria-labelledby="sources-title" className="mt-14">
      <h2 id="sources-title" className="text-lg font-medium">
        Sources
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Facts about other products come from their own public websites and
        documentation, checked on the date shown. Products change: check the
        vendor’s current pages before you decide, and tell us if something here
        is out of date.
      </p>
      <ul className="mt-4 space-y-3 text-sm leading-6">
        {others.map((product) => (
          <li key={product.id}>
            <span className="font-medium text-foreground/85">
              {product.name}
            </span>
            <span className="text-muted-foreground">
              {" "}
              (checked{" "}
              <time dateTime={product.reviewed}>
                {formatDate(product.reviewed)}
              </time>
              ):{" "}
            </span>
            {product.sources.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? ", " : null}
                <a
                  href={source.url}
                  rel="noopener nofollow"
                  className="text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground"
                >
                  {source.label}
                </a>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FaqSection({
  faqs,
}: {
  faqs: ReadonlyArray<{ question: string; answer: string }>;
}) {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="mt-14 scroll-mt-24"
    >
      <SectionTitle id="faq-title">Frequently asked questions</SectionTitle>
      <div className="mt-6 divide-y divide-border border-y border-border">
        {faqs.map(({ question, answer }) => (
          <div key={question} className="py-5">
            <h3 className="text-[15px] font-medium">{question}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {answer}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
