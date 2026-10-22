import { comparison as findComparison } from "@lictory/marketing/content/comparisons";
import { guide as findGuide } from "@lictory/marketing/content/guides";
import { ogCard } from "@lictory/marketing/lib/og-card";
import { siteUrl } from "@lictory/marketing/lib/site";

// Social cards for public guides and comparisons, built from their public copy.

const host = new URL(siteUrl).host;

export function guideCard(slug: string) {
  const guide = findGuide(slug)!;
  return ogCard({
    eyebrow: "LICTORY GUIDE",
    title: guide.headline,
    titleSize: guide.headline.length > 48 ? 60 : 68,
    subtitle:
      "Practical advice for turning product intent into work your team can commit to.",
    footer: ["Requirements, reviewed like code.", `${host}/guides`],
  });
}

export function comparisonCard(slug: string) {
  const item = findComparison(slug)!;
  return ogCard({
    eyebrow: "COMPARISON",
    title: item.headline,
    titleSize: 84,
    subtitle: item.verdict.lictory,
    footer: ["Requirements, reviewed like code.", `${host}/compare/${slug}`],
  });
}
