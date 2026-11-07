import type { Node as PMNode } from "@tiptap/pm/model";
import {
  PAGE_THREAD_QUOTE_MAX,
  type PageThreadAnchor,
} from "@lictory/core/contracts/protocol";

// Commit anchors: a range of one textblock of an immutable commit, as the
// block's stable id and ProseMirror offsets into its content (a character,
// an inline reference and a line break each count 1), with the quoted
// text. Live documents keep block ids, so an anchor written on an earlier
// version still finds its text while the block and the words survive.

export type CommitAnchor = Extract<PageThreadAnchor, { kind: "commit" }>;
export type Range = { from: number; to: number };

// How inline atoms read in quotes: a work item by its key, a decision by its
// stored label (never a page's current title, which a reader may not see).
export function leafText(node: PMNode) {
  if (node.type.name === "workItemRef") return String(node.attrs.key ?? "");
  if (node.type.name === "decisionRef") return String(node.attrs.label ?? "");
  if (node.type.name === "hardBreak") return "\n";
  return "";
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function quoteOf(doc: PMNode, from: number, to: number) {
  return normalize(doc.textBetween(from, to, "\n", leafText)).slice(
    0,
    PAGE_THREAD_QUOTE_MAX,
  );
}

// The commit anchor for a selection, cut at the end of its first block, or
// null when the selection does not start in a textblock with an id.
export function commitAnchorFor(
  doc: PMNode,
  from: number,
  to: number,
  commitId: string,
): CommitAnchor | null {
  if (from >= to) return null;
  const $from = doc.resolve(from);
  const block = $from.parent;
  const blockId: unknown = block.attrs.id;
  if (!block.isTextblock || typeof blockId !== "string" || !blockId)
    return null;
  const start = $from.start();
  const end = Math.min(to, start + block.content.size);
  const offsetFrom = from - start;
  const offsetTo = end - start;
  if (offsetFrom >= offsetTo) return null;
  const quote = quoteOf(doc, from, end);
  if (!quote) return null;
  return {
    v: 1,
    kind: "commit",
    commitId,
    blockId,
    from: offsetFrom,
    to: offsetTo,
    quote,
  };
}

// Where each block with an id starts (the position before the node).
export function blockIndex(doc: PMNode) {
  const index = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const id: unknown = node.attrs.id;
      if (typeof id === "string" && id) index.set(id, pos);
      return false;
    }
    return true;
  });
  return index;
}

// The anchor's range in this document: the stored offsets when they still
// cover the quote, otherwise the quote found elsewhere in the same block,
// otherwise null (the text changed; the thread shows its quote only).
export function resolveCommitAnchor(
  doc: PMNode,
  index: ReadonlyMap<string, number>,
  anchor: Pick<CommitAnchor, "blockId" | "from" | "to" | "quote">,
): Range | null {
  const pos = index.get(anchor.blockId);
  if (pos === undefined) return null;
  const block = doc.nodeAt(pos);
  if (!block?.isTextblock) return null;
  const start = pos + 1;
  const size = block.content.size;
  const wanted = normalize(anchor.quote);
  if (anchor.to <= size && anchor.from < anchor.to) {
    const plain = normalize(
      block.textBetween(anchor.from, anchor.to, "\n", ""),
    );
    const keyed = normalize(
      block.textBetween(anchor.from, anchor.to, "\n", leafText),
    );
    if (plain === wanted || keyed === wanted)
      return { from: start + anchor.from, to: start + anchor.to };
  }
  // Every inline leaf counts as one character, like ProseMirror offsets.
  const text = block.textBetween(0, size, "\n", "￼");
  const at = anchor.quote ? text.indexOf(anchor.quote) : -1;
  if (at >= 0)
    return { from: start + at, to: start + at + anchor.quote.length };
  return null;
}
