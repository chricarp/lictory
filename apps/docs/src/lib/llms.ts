import { pageMarkdown } from "@lictory/docs/lib/markdown";
import { sections } from "@lictory/docs/lib/sections";
import { absoluteUrl, markdownPath, site } from "@lictory/docs/lib/site";

// llms.txt (https://llmstxt.org): the documentation's sections in sidebar
// order, each page linked to its Markdown version. llms-full.txt carries every
// page's Markdown in the same order.

export function llmsIndex() {
  const index = sections()
    .map(
      (section) =>
        `## ${section.title}\n\n${section.pages
          .map(
            (page) =>
              `- [${page.data.title}](${absoluteUrl(markdownPath(page.url))}): ${page.data.description}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");
  return `# ${site.name}

> ${site.description}

Lictory is open-source, self-hosted work management for software teams: requirements are refined and reviewed like code (branches, pull requests, revision-bound approvals and readiness checks), then delivered natively or published to Jira. Every page below is also available as Markdown at its URL with \`.md\` appended; all of them together are in [llms-full.txt](${absoluteUrl("/llms-full.txt")}).

${index}

## Optional

- [Lictory website](${site.website}/llms.txt): what Lictory is, comparisons and guides.
- [Source code](${site.repository}): the Lictory repository on GitHub.
`;
}

export async function llmsFull() {
  const documents = await Promise.all(
    sections()
      .flatMap((section) => section.pages)
      .map(pageMarkdown),
  );
  return `# ${site.name}\n\n> ${site.description}\n\n${documents.join("\n---\n\n")}`;
}
