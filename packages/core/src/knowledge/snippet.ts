// Short, highlighted excerpts of search results. Pure: the search reads the
// text, these functions decide what a person sees of it.

export type Highlight = { start: number; end: number };
export type Snippet = { text: string; highlights: Highlight[] };

const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 180;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every case-insensitive occurrence of `query` in `text`.
export function highlightsIn(text: string, query: string): Highlight[] {
  const needle = query.trim();
  if (!needle) return [];
  const out: Highlight[] = [];
  for (const match of text.matchAll(new RegExp(escapeRegExp(needle), "giu")))
    out.push({ start: match.index, end: match.index + match[0].length });
  return out;
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

// A window of `text` around the first occurrence of `query`, cut at word
// boundaries, with ellipses where text was left out and every occurrence
// inside the window highlighted. Without an occurrence: the beginning.
export function snippetOf(source: string, query: string): Snippet {
  const text = flat(source);
  const first = highlightsIn(text, query)[0];
  if (!first) {
    const cut = cutAt(text, 0, SNIPPET_LENGTH);
    return { text: cut.text, highlights: [] };
  }
  let start = Math.max(0, first.start - SNIPPET_BEFORE);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space !== -1 && space < first.start ? space + 1 : start;
  }
  const length = Math.max(SNIPPET_LENGTH, first.end - start);
  const cut = cutAt(text, start, length);
  return {
    text: cut.text,
    highlights: highlightsIn(cut.text, query),
  };
}

function cutAt(text: string, start: number, length: number) {
  let end = Math.min(text.length, start + length);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  const body = text.slice(start, end);
  return {
    text: `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`,
  };
}

// Markdown as plain text for excerpts: references and links read as their
// labels, mentions as @name, and formatting marks are dropped.
export function markdownText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?|~~~[^\n]*\n?/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/@\[([^\]]*)\]\(mention:[^)]*\)/g, "@$1")
    .replace(/\[\[page:[^\]]+\]\]/g, "page")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[\s(])[*_]([^\s*_][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()<>#+\-.!|])/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, " ")
    .replace(/\|/g, " ");
}

type DocNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
};

// The text a reader sees of a page node: references by their label.
function nodeText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  const a = node.attrs ?? {};
  const attr = (key: string, fallback: string) =>
    typeof a[key] === "string" ? a[key] : fallback;
  if (node.type === "workItemRef") return attr("key", "");
  if (node.type === "decisionRef") return attr("label", "decision");
  if (node.type === "pageRef") return attr("label", "page");
  const parts = (node.content ?? []).map(nodeText);
  return node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "codeBlock"
    ? parts.join("")
    : parts.join(" ");
}

const textblocks = new Set(["paragraph", "heading", "codeBlock"]);

// The block of a canonical page document where `query` occurs (the first
// text block with an id that contains it, so a reader can scroll to it) and
// an excerpt of it. Falls back to a top-level block containing the query
// across its text blocks, then to the beginning of the page.
export function pageSnippet(
  doc: unknown,
  query: string,
): { blockId: string | null; snippet: Snippet; found: boolean } {
  const root = (doc ?? {}) as DocNode;
  const needle = query.trim();
  let hit: { blockId: string | null; text: string } | undefined;
  const visit = (node: DocNode) => {
    if (hit) return;
    const id = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    if (node.type && textblocks.has(node.type)) {
      const text = nodeText(node);
      if (id && highlightsIn(flat(text), needle).length)
        hit = { blockId: id, text };
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (needle) visit(root);
  if (!hit && needle)
    for (const block of root.content ?? []) {
      const text = nodeText(block);
      if (highlightsIn(flat(text), needle).length) {
        hit = {
          blockId: typeof block.attrs?.id === "string" ? block.attrs.id : null,
          text,
        };
        break;
      }
    }
  if (hit)
    return {
      blockId: hit.blockId,
      snippet: snippetOf(hit.text, needle),
      found: true,
    };
  const opening = (root.content ?? [])
    .map(nodeText)
    .filter((t) => t.trim())
    .slice(0, 3)
    .join(" ");
  return { blockId: null, snippet: snippetOf(opening, ""), found: false };
}
