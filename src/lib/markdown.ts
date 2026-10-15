import {
  comparisonCellText,
  comparisonRows,
} from "~/components/landing/content";
import { comparisons, type Comparison } from "~/content/comparisons";
import { guides, type Guide } from "~/content/guides";
import { absoluteUrl, publicPage } from "~/lib/site";

// Markdown versions of the public guides and comparisons, served at the page
// URL with `.md` appended (the llms.txt convention). AI assistants and agents
// read them without navigation, styling or scripts. They carry the same copy as
// the HTML pages, which stay canonical.

const comparisonNote =
  "Built-in capabilities as we understand them. Marketplace add-ons and integrations may change the picture.";

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

function comparisonPath(item: Comparison) {
  return `/compare/${item.slug}`;
}

/** The guide as one Markdown document, headings starting at level 1. */
export function guideMarkdown(guide: Guide) {
  return `${header(guidePath(guide), guide.headline, guide.description)}
Published: ${guide.published}. Updated: ${guide.updated}.

${guide.body.trim()}`;
}

/** The comparison as one Markdown document, headings starting at level 1. */
export function comparisonMarkdown(item: Comparison) {
  const table = [
    `| Capability | Lictory | ${item.competitor} |`,
    "| --- | --- | --- |",
    ...comparisonRows.map(
      (row) =>
        `| ${row.feature} | ${comparisonCellText[row.lictory]} | ${comparisonCellText[row[item.slug]]} |`,
    ),
  ].join("\n");
  return `${header(comparisonPath(item), item.headline, item.description)}
Updated: ${item.updated}.

${item.intro}

## Verdict

- **Lictory:** ${item.verdict.lictory}
- **${item.competitor}:** ${item.verdict.competitor}

## Capabilities at a glance

${table}

${comparisonNote}

${item.sections.map((section) => `## ${section.title}\n\n${section.body.trim()}`).join("\n\n")}

## Frequently asked questions

${item.faqs.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}`;
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
