import { guides } from "~/content/guides";
import { guideCard } from "~/lib/marketing-cards";
import { ogCardSize } from "~/lib/og-card";

export const size = ogCardSize;
export const contentType = "image/png";
export const alt = "A Lictory guide";

export function generateStaticParams() {
  return guides.map(({ slug }) => ({ slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return guideCard((await params).slug);
}
