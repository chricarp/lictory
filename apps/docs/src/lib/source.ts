import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

// Compiled at build time from content/docs (MDX pages and meta.json order).
// Each page also keeps a Markdown copy (getText("processed")) for /<page>.md
// and llms-full.txt, where lib/markdown.ts writes each component below as
// plain Markdown.
const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: {
        headingIds: false,
        mdxAsPlaceholder: [
          "Steps",
          "Step",
          "Tabs",
          "Tab",
          "Cards",
          "Card",
          "Callout",
          "Cli",
          "CliNotice",
          "CliReference",
          "Lifecycle",
          "DirectPublishing",
          "ReviewedChange",
          "SpaceAccess",
        ],
      },
    },
  },
});

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});
