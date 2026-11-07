import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

// After work is created from page text, the page can refer back to it: the
// new items' chips go into the live draft right after the text they came
// from, as an ordinary edit the person sees (and can undo) before they
// publish. The text is found by its block id and the words before the
// selection's end; when the draft no longer has that block, the chips go
// at the end of the page.

export type DraftAnchor = {
  // The textblock (paragraph, heading…) holding the selection's end.
  blockId: string | null;
  // Its text up to the selection's end.
  before: string;
};

const TAIL = 48;

function findBlock(doc: PMNode, blockId: string) {
  let found: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isTextblock && node.attrs.id === blockId) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found as { node: PMNode; pos: number } | null;
}

// The document position after `before`'s last characters inside the
// textblock at `pos`, or its end.
function positionAfter(block: PMNode, pos: number, before: string) {
  const end = pos + block.nodeSize - 1;
  const tail = before.slice(-TAIL);
  if (!tail) return end;
  // Map text offsets to positions (atoms such as chips count as one
  // character that matches nothing).
  let text = "";
  const positions: number[] = [];
  block.descendants((node, offset) => {
    const start = pos + 1 + offset;
    if (node.isText) {
      for (let i = 0; i < node.text!.length; i++) {
        text += node.text![i];
        positions.push(start + i);
      }
    } else if (node.isLeaf) {
      text += "￼";
      positions.push(start);
    }
    return true;
  });
  const at = text.lastIndexOf(tail);
  if (at < 0) return end;
  return positions[at + tail.length - 1]! + 1;
}

export function insertReferencesAfter(
  editor: Editor,
  anchor: DraftAnchor,
  references: readonly { workItemId: string; key: string }[],
): "placed" | "appended" {
  const chips = references.flatMap((r) => [
    { type: "text", text: " " },
    { type: "workItemRef", attrs: { workItemId: r.workItemId, key: r.key } },
  ]);
  const doc = editor.state.doc;
  const block = anchor.blockId ? findBlock(doc, anchor.blockId) : null;
  if (block) {
    const at = positionAfter(block.node, block.pos, anchor.before);
    editor.chain().focus().insertContentAt(at, chips).run();
    return "placed";
  }
  editor
    .chain()
    .focus()
    .insertContentAt(doc.content.size, {
      type: "paragraph",
      content: chips.slice(1),
    })
    .run();
  return "appended";
}
