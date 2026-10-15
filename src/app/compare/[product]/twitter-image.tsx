import { comparisons } from "~/content/comparisons";
import { comparisonCard } from "~/lib/marketing-cards";
import { ogCardSize } from "~/lib/og-card";

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
