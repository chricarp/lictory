import type { Node } from "fumadocs-core/page-tree";

import type { DocsPage } from "@lictory/docs/lib/markdown";
import { site } from "@lictory/docs/lib/site";
import { source } from "@lictory/docs/lib/source";

// The sidebar's sections (its separators) with their pages in sidebar order,
// shared by llms.txt and page titles.

function pages(node: Node): DocsPage[] {
  if (node.type === "separator") return [];
  if (node.type === "page") {
    const page = source.getNodePage(node);
    return page ? [page] : [];
  }
  return [
    ...(node.index ? pages(node.index) : []),
    ...node.children.flatMap(pages),
  ];
}

let cached: Array<{ title: string; pages: DocsPage[] }> | undefined;

/** Computed once per build: every page's metadata asks for it. */
export function sections() {
  cached ??= readSections();
  return cached;
}

function readSections() {
  const result: Array<{ title: string; pages: DocsPage[] }> = [
    { title: "Start here", pages: [] },
  ];
  for (const node of source.getPageTree().children) {
    if (node.type === "separator")
      result.push({
        title: typeof node.name === "string" ? node.name : "",
        pages: [],
      });
    else result.at(-1)!.pages.push(...pages(node));
  }
  return result.filter((section) => section.pages.length);
}

/**
 * The page's document title. Pages in a section name it, so pages with the
 * same heading in different sections ("Branches and pull requests" for
 * specifications and for Spaces) stay distinct in search results.
 */
export function documentTitle(page: DocsPage) {
  if (page.url === "/") return site.name;
  const section = sections().find((candidate) =>
    candidate.pages.some((member) => member.url === page.url),
  )?.title;
  const named =
    section && section !== "Start here" && !page.data.title.includes(section);
  return [page.data.title, ...(named ? [section] : []), site.name].join(" · ");
}
