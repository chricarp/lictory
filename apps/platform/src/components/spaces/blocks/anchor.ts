import type { Node as PMNode } from "@tiptap/pm/model";

// Where a block dialog (such as "/" → Work list) applies its result. The
// dialog stays open while others edit the live draft, and a remote edit
// rebuilds the whole document, so positions taken when it opened mean
// nothing by then. Blocks carry stable ids (the schema's unique id
// extension): the anchor names the blocks and is resolved in the document
// as it is when the person confirms.

export type BlockAnchor = {
  // Where "/" was typed, used only when the blocks below are gone.
  at: number;
  // The text block holding the position, replaced when it is still empty.
  blockId: string | null;
  // Its top-level block, which the new block follows otherwise.
  topId: string | null;
};

const idOf = (node: PMNode) =>
  typeof node.attrs.id === "string" && node.attrs.id ? node.attrs.id : null;

export function blockAnchor(doc: PMNode, at: number): BlockAnchor {
  const $at = doc.resolve(Math.min(at, doc.content.size));
  return {
    at,
    blockId: $at.parent.isTextblock && $at.depth >= 1 ? idOf($at.parent) : null,
    topId: $at.depth >= 1 ? idOf($at.node(1)) : null,
  };
}

// The position of the block with this id (and type, when given).
export function findBlock(doc: PMNode, id: string, type?: string) {
  let found: number | undefined;
  doc.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (idOf(node) === id && (!type || node.type.name === type)) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

// The range the new block replaces (an empty one: it is inserted there).
export function insertionRange(
  doc: PMNode,
  anchor: BlockAnchor,
): { from: number; to: number } {
  if (anchor.blockId) {
    const pos = findBlock(doc, anchor.blockId);
    const node = pos === undefined ? null : doc.nodeAt(pos);
    if (pos !== undefined && node?.isTextblock && node.content.size === 0)
      return { from: pos, to: pos + node.nodeSize };
  }
  if (anchor.topId) {
    const pos = findBlock(doc, anchor.topId);
    const node = pos === undefined ? null : doc.nodeAt(pos);
    // A top-level block found by id: the new block follows it.
    if (pos !== undefined && node && doc.resolve(pos).depth === 0)
      return { from: pos + node.nodeSize, to: pos + node.nodeSize };
  }
  // The blocks are gone (deleted meanwhile) or carry no ids: the position,
  // as close as the document allows.
  const $at = doc.resolve(Math.min(anchor.at, doc.content.size));
  if ($at.depth >= 1 && $at.parent.isTextblock && !$at.parent.content.size)
    return { from: $at.before(), to: $at.after() };
  const pos = $at.depth >= 1 ? $at.after(1) : $at.pos;
  return { from: pos, to: pos };
}
