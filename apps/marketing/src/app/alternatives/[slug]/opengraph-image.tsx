import {
  alternativesSlug,
  roundups,
} from "@lictory/marketing/content/roundups";
import { roundupCard } from "@lictory/marketing/lib/marketing-cards";
import { ogCardSize } from "@lictory/marketing/lib/og-card";

export const size = ogCardSize;
export const contentType = "image/png";
export const alt = "Lictory alternatives";

export function generateStaticParams() {
  return roundups.flatMap((item) => {
    const slug = alternativesSlug(item);
    return slug ? [{ slug }] : [];
  });
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return roundupCard(`/alternatives/${(await params).slug}`);
}
