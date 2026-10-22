import { comparisons } from "@lictory/marketing/content/comparisons";
import { comparisonCard } from "@lictory/marketing/lib/marketing-cards";
import { ogCardSize } from "@lictory/marketing/lib/og-card";

export const size = ogCardSize;
export const contentType = "image/png";
export const alt = "Lictory comparison";

export function generateStaticParams() {
  return comparisons.map(({ slug }) => ({ product: slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  return comparisonCard((await params).product);
}
