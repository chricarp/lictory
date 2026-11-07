import type { InlineCode, Nodes, Parent, Root, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// The readable text of a Markdown document, as a reader sees it rendered:
// what discussions quote and what word diffs compare. Specifications store
// Markdown, and anchors are quotes, so the reader, the discussion panel and
// the diff view must agree on one text and one way to find a quote in it.
//
// The text is the document's text nodes and inline code in order, with one
// line break between blocks (paragraphs, headings, list items, table cells,
// code blocks) and for hard breaks. Code block text is counted but cannot be
// marked; raw HTML and image descriptions are not text (the reader does not
// show them). Positions are offsets into this text.

export function parseMarkdownTree(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

// A text node or inline code, where it is in the tree and in the text.
type Segment = {
  node: Text | InlineCode;
  parent: Parent;
  start: number;
  end: number;
};

export type Heading = { start: number; text: string };

export type TextModel = {
  text: string;
  segments: Segment[];
  // Every heading in document order, with where its text starts.
  headings: Heading[];
};

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "tableCell",
  "code",
  "blockquote",
  "thematicBreak",
]);

export function textModel(tree: Root): TextModel {
  let text = "";
  const segments: Segment[] = [];
  const headings: Heading[] = [];
  const separate = () => {
    if (text && !text.endsWith("\n")) text += "\n";
  };
  const visit = (node: Nodes, parent: Parent | null) => {
    if (BLOCKS.has(node.type)) separate();
    if (node.type === "text" || node.type === "inlineCode") {
      if (!parent) return;
      segments.push({
        node,
        parent,
        start: text.length,
        end: text.length + node.value.length,
      });
      text += node.value;
      return;
    }
    if (node.type === "code") {
      text += node.value;
      return;
    }
    if (node.type === "break") {
      text += "\n";
      return;
    }
    if (node.type === "html" || node.type === "image") return;
    if (!("children" in node)) return;
    const start = text.length;
    for (const child of node.children as Nodes[]) visit(child, node);
    if (node.type === "heading")
      headings.push({ start, text: text.slice(start) });
    if (BLOCKS.has(node.type)) separate();
  };
  visit(tree, null);
  headings.sort((a, b) => a.start - b.start);
  return { text, segments, headings };
}

// Headings compare like readiness sections do (contracts/readiness.ts).
export const sameHeading = (a: string, b: string) => {
  const normal = (value: string) =>
    value
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[:\s]+$/, "")
      .trim()
      .toLowerCase();
  return normal(a) === normal(b);
};

// The text with every run of whitespace read as one space, and where each
// of its characters is in the original.
function collapsed(text: string) {
  let value = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const space = /\s/.test(text[i]!);
    if (space && value.endsWith(" ")) continue;
    value += space ? " " : text[i];
    at.push(i);
  }
  return { value, at };
}

export const normalizeQuote = (quote: string) =>
  quote.replace(/\s+/g, " ").trim();

// The heading a position is under ("" before the first heading).
function sectionAt(model: TextModel, position: number) {
  let section = "";
  for (const heading of model.headings) {
    if (heading.start > position) break;
    section = heading.text;
  }
  return section;
}

export type QuoteAnchor = {
  quote: string;
  section: string;
  // Which occurrence of the quote under its heading was selected (0 = the
  // first). Discussions written before it was recorded have none.
  occurrence?: number;
};

export type QuotePlacement =
  | { kind: "found"; from: number; to: number }
  // The quote is not in this text; its section still is (or it had none).
  | { kind: "changed" }
  // Neither the quote nor its section is in this text.
  | { kind: "removed" };

// Where an anchored quote is in this text. The quote is looked for under
// its heading and the recorded occurrence is taken there. A quote that left
// its heading is still found when it occurs exactly once in the text;
// several copies elsewhere are ambiguous, and a discussion is never
// attached to an arbitrary one of them.
export function placeQuote(
  model: TextModel,
  anchor: QuoteAnchor,
): QuotePlacement {
  const quote = normalizeQuote(anchor.quote);
  const sectionExists =
    !anchor.section ||
    model.headings.some((h) => sameHeading(h.text, anchor.section));
  if (!quote) return { kind: sectionExists ? "changed" : "removed" };
  const { value, at } = collapsed(model.text);
  const found: { from: number; to: number }[] = [];
  for (
    let index = value.indexOf(quote);
    index !== -1;
    index = value.indexOf(quote, index + quote.length)
  )
    found.push({ from: at[index]!, to: at[index + quote.length - 1]! + 1 });
  const inSection = found.filter((range) =>
    sameHeading(sectionAt(model, range.from), anchor.section),
  );
  const candidates = inSection.length
    ? inSection
    : found.length === 1
      ? found
      : [];
  if (!candidates.length)
    return { kind: sectionExists ? "changed" : "removed" };
  const pick =
    candidates[Math.min(anchor.occurrence ?? 0, candidates.length - 1)]!;
  return { kind: "found", ...pick };
}

// Which occurrence of `quote` ends at the end of `prefix`: the selection's
// text with what precedes it under its heading. Counted the way placeQuote
// counts, on collapsed whitespace.
export function occurrenceIn(prefix: string, quote: string) {
  const value = normalizeQuote(prefix);
  const wanted = normalizeQuote(quote);
  if (!wanted) return 0;
  let count = 0;
  for (
    let index = value.indexOf(wanted);
    index !== -1;
    index = value.indexOf(wanted, index + wanted.length)
  )
    count++;
  return Math.max(0, count - 1);
}

export type Mark<T> = { from: number; to: number; data: T };

// Wraps the text of each range in a node made by `wrap` (a span of one text
// node at a time, so a range across blocks becomes several wrappers). Text
// covered by several ranges gets one wrapper with all of their data. Inline
// code is wrapped whole when a range touches it; code blocks are not marked.
// Changes the tree in place; `model` must be the tree's own model.
export function markText<T>(
  model: TextModel,
  ranges: readonly Mark<T>[],
  wrap: (children: (Text | InlineCode)[], data: T[]) => Nodes,
) {
  if (!ranges.length) return;
  // Last first, so the positions of earlier siblings stay valid.
  for (const segment of [...model.segments].reverse()) {
    const covering = ranges.filter(
      (r) => r.from < segment.end && r.to > segment.start && r.from < r.to,
    );
    if (!covering.length) continue;
    const index = (segment.parent.children as Nodes[]).indexOf(segment.node);
    if (index === -1) continue;
    if (segment.node.type === "inlineCode") {
      segment.parent.children.splice(
        index,
        1,
        wrap(
          [segment.node],
          covering.map((r) => r.data),
        ) as never,
      );
      continue;
    }
    // Cut the text at every range boundary inside it.
    const cuts = new Set([segment.start, segment.end]);
    for (const r of covering) {
      if (r.from > segment.start && r.from < segment.end) cuts.add(r.from);
      if (r.to > segment.start && r.to < segment.end) cuts.add(r.to);
    }
    const points = [...cuts].sort((a, b) => a - b);
    const value = segment.node.value;
    const pieces: Nodes[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i]!,
        to = points[i + 1]!;
      const text: Text = {
        type: "text",
        value: value.slice(from - segment.start, to - segment.start),
      };
      const data = covering
        .filter((r) => r.from <= from && r.to >= to)
        .map((r) => r.data);
      pieces.push(data.length ? wrap([text], data) : text);
    }
    segment.parent.children.splice(index, 1, ...(pieces as never[]));
  }
}
