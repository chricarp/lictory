import {
  comparisonPath,
  type Comparison,
} from "@lictory/marketing/content/comparisons";
import { product } from "@lictory/marketing/content/products";
import type { Roundup } from "@lictory/marketing/content/roundups";
import { absoluteUrl } from "@lictory/marketing/lib/site";
import {
  applicationNode,
  faqNode,
  publicPageStructuredData,
  webPageId,
} from "@lictory/marketing/lib/structured-data";

// JSON-LD of the comparison and roundup pages: the page, its breadcrumb, Lictory
// as a SoftwareApplication and the FAQ visitors read. Other products appear only
// by name and link, never with claims, ratings or prices.

export function comparisonStructuredData(item: Comparison) {
  const path = comparisonPath(item);
  return publicPageStructuredData(path, {
    nodes: [applicationNode, faqNode(path, item.faqs)],
  });
}

export function roundupStructuredData(item: Roundup) {
  return publicPageStructuredData(item.path, {
    nodes: [
      applicationNode,
      {
        "@type": "ItemList",
        "@id": absoluteUrl(`${item.path}#list`),
        isPartOf: { "@id": webPageId(item.path) },
        name: item.headline,
        itemListElement: item.entries.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: product(entry.product).name,
          url:
            entry.product === "lictory"
              ? absoluteUrl("/")
              : product(entry.product).website,
        })),
      },
      faqNode(item.path, item.faqs),
    ],
  });
}
