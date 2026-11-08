import {
  capabilityCellText,
  capabilityRows,
  comparisonPath,
  comparisons,
  type Comparison,
} from "@lictory/marketing/content/comparisons";
import { guides, type Guide } from "@lictory/marketing/content/guides";
import {
  product,
  type ProductProfile,
} from "@lictory/marketing/content/products";
import {
  glanceColumns,
  glanceValue,
  roundupProducts,
  roundupReviewed,
  roundups,
  type Roundup,
} from "@lictory/marketing/content/roundups";
import { absoluteUrl, publicPage } from "@lictory/marketing/lib/site";

// Markdown versions of the public guides, comparisons and roundups, served at the page
// URL with `.md` appended (the llms.txt convention). AI assistants and agents
// read them without navigation, styling or scripts. They carry the same copy as
// the HTML pages, which stay canonical.

const comparisonNote =
  "Built-in capabilities as we understand them. Marketplace add-ons and integrations may change the picture.";

const checkedNote = (competitor: string) =>
  `Built-in capabilities, checked against ${competitor}’s public documentation. “Not documented” means we could not find it there, not that it is impossible.`;

/** The `.md` URL path of a public page that has a Markdown version. */
export function markdownPath(path: string) {
  return `${path}.md`;
}

function header(path: string, title: string, description: string) {
  return `# ${title}\n\n> ${description}\n\nCanonical URL: ${absoluteUrl(path)}`;
}

function linkList(items: ReadonlyArray<{ path: string }>) {
  return items
    .map(({ path }) => {
      const page = publicPage(path);
      return `- [${page.title}](${absoluteUrl(markdownPath(path))}): ${page.description}`;
    })
    .join("\n");
}

function guidePath(guide: Guide) {
  return `/guides/${guide.slug}`;
}

function factsTable(profiles: readonly ProductProfile[]) {
  return [
    `| | ${profiles.map((profile) => profile.name).join(" | ")} |`,
    `| --- | ${profiles.map(() => "---").join(" | ")} |`,
    `| License | ${profiles.map((profile) => profile.license).join(" | ")} |`,
    `| Hosting | ${profiles.map((profile) => profile.hosting).join(" | ")} |`,
    `| Pricing model | ${profiles.map((profile) => profile.pricing).join(" | ")} |`,
  ].join("\n");
}

function sourcesList(profiles: readonly ProductProfile[]) {
  return profiles
    .filter((profile) => profile.id !== "lictory")
    .map(
      (profile) =>
        `- ${profile.name} (checked ${profile.reviewed}): ${profile.sources
          .map((source) => `[${source.label}](${source.url})`)
          .join(", ")}`,
    )
    .join("\n");
}

/** The guide as one Markdown document, headings starting at level 1. */
export function guideMarkdown(guide: Guide) {
  return `${header(guidePath(guide), guide.headline, guide.description)}
Published: ${guide.published}. Updated: ${guide.updated}.

${guide.body.trim()}`;
}

/** The comparison as one Markdown document, headings starting at level 1. */
export function comparisonMarkdown(item: Comparison) {
  const profiles = item.product
    ? [product("lictory"), product(item.product)]
    : [];
  const table = [
    `| Capability | Lictory | ${item.competitor} |`,
    "| --- | --- | --- |",
    ...capabilityRows(item).map(
      (row) =>
        `| ${row.feature}${row.note ? ` (${row.note})` : ""} | ${capabilityCellText[row.lictory]} | ${capabilityCellText[row.competitor]} |`,
    ),
  ].join("\n");
  const reviewed = profiles[1]
    ? ` Last reviewed: ${profiles[1].reviewed}.`
    : "";
  return `${header(comparisonPath(item), item.headline, item.description)}
Updated: ${item.updated}.${reviewed}

${item.intro}

## Verdict

- **Lictory:** ${item.verdict.lictory}
- **${item.competitor}:** ${item.verdict.competitor}

## Capabilities at a glance

${table}

${item.capabilities ? checkedNote(item.competitor) : comparisonNote}
${profiles.length ? `\n## Licensing, hosting and pricing\n\n${factsTable(profiles)}\n` : ""}
${item.sections.map((section) => `## ${section.title}\n\n${section.body.trim()}`).join("\n\n")}

## Frequently asked questions

${item.faqs.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}${profiles.length ? `\n\n## Sources\n\n${sourcesList(profiles)}` : ""}`;
}

/** The roundup as one Markdown document, headings starting at level 1. */
export function roundupMarkdown(item: Roundup) {
  const profiles = roundupProducts(item);
  const glance = [
    `| Tool | ${item.columns.map((column) => glanceColumns[column]).join(" | ")} | Best for |`,
    `| --- | ${item.columns.map(() => "---").join(" | ")} | --- |`,
    ...item.entries.map((entry) => {
      const profile = product(entry.product);
      return `| ${profile.name} | ${item.columns.map((column) => glanceValue(profile, column)).join(" | ")} | ${entry.bestFor} |`;
    }),
  ].join("\n");
  const entries = item.entries.map((entry, index) => {
    const profile = product(entry.product);
    const compare = comparisons.find(
      (other) => other.product === entry.product,
    );
    return `## ${index + 1}. ${profile.name}

${entry.summary.trim()}

- **Best for:** ${entry.bestFor}
- **Weigh before choosing:** ${entry.considerations}
- **License:** ${profile.license}
- **Hosting:** ${profile.hosting}
- **Pricing model:** ${profile.pricing}
- **Website:** ${entry.product === "lictory" ? absoluteUrl("/") : profile.website}${compare ? `\n- **Comparison:** [${compare.headline}](${absoluteUrl(markdownPath(comparisonPath(compare)))})` : ""}`;
  });
  return `${header(item.path, item.headline, item.description)}
Updated: ${item.updated}. Last reviewed: ${roundupReviewed(item)}.

${item.intro}

## At a glance

${glance}

## How we chose

${item.method.trim()}

${entries.join("\n\n")}

${item.sections.map((section) => `## ${section.title}\n\n${section.body.trim()}`).join("\n\n")}

## Frequently asked questions

${item.faqs.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}

## Sources

${sourcesList(profiles)}`;
}

function guidesIndexMarkdown() {
  const { title, description } = publicPage("/guides");
  return `${header("/guides", title, description)}

${linkList(guides.map((guide) => ({ path: guidePath(guide) })))}`;
}

const documents = new Map<string, () => string>([
  ["/guides", guidesIndexMarkdown],
  ...guides.map(
    (guide) =>
      [
        guidePath(guide),
        () =>
          `${guideMarkdown(guide)}\n\n## More guides\n\n${linkList(
            guides
              .filter((other) => other.slug !== guide.slug)
              .map((other) => ({ path: guidePath(other) })),
          )}`,
      ] as const,
  ),
  ...comparisons.map(
    (item) => [comparisonPath(item), () => comparisonMarkdown(item)] as const,
  ),
  ...roundups.map((item) => [item.path, () => roundupMarkdown(item)] as const),
]);

/** Public pages that have a Markdown version. */
export const markdownPages: readonly string[] = [...documents.keys()];

export function hasMarkdown(path: string) {
  return documents.has(path);
}

export function markdownDocument(path: string) {
  const document = documents.get(path);
  return document ? `${document()}\n` : undefined;
}

/** Nests a document under a parent heading by demoting every heading. */
export function demoteHeadings(markdown: string, levels: number) {
  return markdown.replace(
    /^(#{1,6}) /gm,
    (_, hashes: string) =>
      `${"#".repeat(Math.min(hashes.length + levels, 6))} `,
  );
}
