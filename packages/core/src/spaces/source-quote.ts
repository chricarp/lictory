import type { PageNode } from "@lictory/core/spaces/document/canonical";

// Whether a quote attributed to a page version is really its text
// (docs/internals/knowledge-links.md#authorization). A work item created
// from a page stores the quote as evidence of what the page said, so the
// server checks it against the exact commit instead of trusting the client.
//
// Text is compared normalized: Unicode NFC, every run of whitespace (block
// boundaries, line breaks, indentation) as one space, trimmed. Inline
// references count as what readers' selections copy: a work item as its key,
// a decision as its stored label, and, because browsers copy a chip's text
// differently, also as nothing, with line breaks as nothing too (both
// readings are tried). A page reference and an image have no text.
//
// With a block, the quote must begin in that top-level block and may
// continue across the consecutive blocks after it: a selection spanning
// several blocks names the block of its first character. Without one, it
// may begin anywhere in the commit.

export const normalizeQuote = (text: string) =>
  text.normalize("NFC").replace(/\s+/g, " ").trim();

type Leaves = "labels" | "empty";

function textOf(node: PageNode, leaves: Leaves): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return leaves === "labels" ? "\n" : "";
  if (leaves === "labels") {
    const attr = node.attrs?.[node.type === "workItemRef" ? "key" : "label"];
    if (node.type === "workItemRef" || node.type === "decisionRef")
      return typeof attr === "string" ? attr : "";
  }
  const children = node.content ?? [];
  // Inline content joins as it is; blocks are separated like lines.
  const inline = children.every(
    (c) =>
      c.type === "text" ||
      c.type === "hardBreak" ||
      c.type.endsWith("Ref") ||
      c.type === "image",
  );
  return children.map((c) => textOf(c, leaves)).join(inline ? "" : "\n");
}

/**
 * Whether `quote` is text of `doc` (a canonical page document), beginning in
 * the top-level block `blockId` when one is given (see the rules above).
 */
export function quoteOccursIn(
  doc: PageNode,
  quote: string,
  blockId: string | null,
): boolean {
  const wanted = normalizeQuote(quote);
  if (!wanted) return false;
  const blocks = doc.content ?? [];
  const start = blockId ? blocks.findIndex((b) => b.attrs?.id === blockId) : 0;
  if (start < 0) return false;
  return (["labels", "empty"] as const).some((leaves) => {
    const first = normalizeQuote(
      textOf(blocks[start] ?? { type: "doc" }, leaves),
    );
    const all = normalizeQuote(
      blocks
        .slice(start)
        .map((b) => textOf(b, leaves))
        .join("\n"),
    );
    const at = all.indexOf(wanted);
    if (at < 0) return false;
    // Without a block the quote may begin anywhere; with one, in it.
    return !blockId || at < first.length;
  });
}
