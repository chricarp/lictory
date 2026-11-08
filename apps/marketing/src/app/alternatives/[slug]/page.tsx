import { notFound } from "next/navigation";

import { RoundupPage } from "@lictory/marketing/components/marketing/roundup-page";
import {
  alternativesSlug,
  roundup,
  roundups,
} from "@lictory/marketing/content/roundups";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";

export const dynamicParams = false;

export function generateStaticParams() {
  return roundups.flatMap((item) => {
    const slug = alternativesSlug(item);
    return slug ? [{ slug }] : [];
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/alternatives/[slug]">) {
  const { slug } = await params;
  return publicPageMetadata(`/alternatives/${slug}`, { ownImage: true });
}

export default async function AlternativesPage({
  params,
}: PageProps<"/alternatives/[slug]">) {
  const { slug } = await params;
  const item = roundup(`/alternatives/${slug}`);
  if (!item) notFound();
  return <RoundupPage roundup={item} />;
}
