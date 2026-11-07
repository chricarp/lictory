import type { Editor } from "@tiptap/core";
import { ListTodo } from "lucide-react";
import type { WorkListAttrs } from "@lictory/core/spaces/document/blocks";
import type { MenuItem } from "@lictory/platform/components/editor/suggestions";
import {
  blockAnchor,
  insertionRange,
  type BlockAnchor,
} from "@lictory/platform/components/spaces/blocks/anchor";

// What "/" → Work list asks for: a small dialog (rendered by
// `BlockInsertHost`) that configures a work list, then inserts it into the
// editor that asked, as an ordinary edit. Editing a list's configuration
// goes through the same dialog. ("/" → Decision is the shared editor's.)

export type BlockRequest = {
  kind: "workList";
  editor: Editor;
  // Where a new block goes, resolved when the dialog applies it.
  anchor: BlockAnchor;
  // Editing an existing list: its block id (found again when the dialog
  // applies, wherever others' edits moved it), the position it had for a
  // list without one, and its attributes.
  existing?: { id: string | null; pos: number; attrs: WorkListAttrs };
};

let current: BlockRequest | null = null;
const listeners = new Set<() => void>();

export const blockRequests = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => current,
  open: (request: BlockRequest) => {
    current = request;
    for (const l of listeners) l();
  },
  close: () => {
    current = null;
    for (const l of listeners) l();
  },
};

const matches = (query: string, ...values: string[]) => {
  const q = query.trim().toLowerCase();
  return !q || values.some((v) => v.toLowerCase().includes(q));
};

// The "/" menu entry for work lists (page drafts only).
export function workBlockSlashItems(query: string): MenuItem[] {
  const items: MenuItem[] = [];
  if (matches(query, "work list items epic iteration sprint cycle label"))
    items.push({
      id: "workList",
      label: "Work list",
      icon: <ListTodo className="size-4" />,
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        blockRequests.open({
          kind: "workList",
          editor,
          anchor: blockAnchor(editor.state.doc, range.from),
        });
      },
    });
  return items;
}

// Inserts a block where "/" was typed: replacing the paragraph when it is
// still empty, otherwise after the block holding the position, as the
// document is now.
export function insertBlockAt(
  editor: Editor,
  anchor: BlockAnchor,
  node: Record<string, unknown>,
) {
  if (editor.isDestroyed) return;
  const range = insertionRange(editor.state.doc, anchor);
  editor
    .chain()
    .focus()
    .insertContentAt(range.from === range.to ? range.from : range, node)
    .run();
}
