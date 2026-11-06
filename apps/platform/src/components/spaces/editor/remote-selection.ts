import * as Y from "yjs";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import {
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
  type ProsemirrorBinding,
} from "@tiptap/y-tiptap";

// Keeps each person's caret where they left it when someone else edits.
//
// When a remote change arrives, the Yjs binding restores the local
// selection from Yjs relative positions, which follow the text they sit
// in. y-tiptap (through 3.2.0) then second-guesses that answer: whenever
// the caret's paragraph now has different text, it treats the position as
// misresolved and falls back to the caret's old absolute offset in that
// paragraph. So a remote insertion before the caret in the same paragraph
// leaves the caret behind, inside or before the text it was after, and
// the next keystroke (or a work item mention) lands in the middle of
// someone else's words.
//
// The fallback exists for structural changes that delete and re-create the
// Yjs types holding the caret, where a relative position can no longer be
// trusted. When nothing holding the caret was deleted, the relative
// position is exact; this plugin puts the selection back where Yjs
// resolves it and leaves every other case to the binding.

const remoteSelectionKey = new PluginKey("remoteSelection");

// Whether the character a relative position sits before (if any), the text
// or element it points into and every element around it still exist.
function intact(doc: Y.Doc, position: Y.RelativePosition) {
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc);
  if (!absolute) return false;
  if (position.item && Y.getItem(doc.store, position.item).deleted)
    return false;
  let type: Y.AbstractType<unknown> | null = absolute.type;
  while (type?._item) {
    if (type._item.deleted) return false;
    type = type._item.parent as Y.AbstractType<unknown> | null;
  }
  return true;
}

export function remoteSelectionPlugin() {
  return new Plugin({
    key: remoteSelectionKey,
    appendTransaction(transactions, _oldState, state) {
      const remote = transactions.find((tr) => {
        const meta = tr.getMeta(ySyncPluginKey) as
          | { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean }
          | undefined;
        return (
          tr.docChanged && meta?.isChangeOrigin && !meta.isUndoRedoOperation
        );
      });
      if (!remote) return null;
      const binding = (
        ySyncPluginKey.getState(state) as
          { binding?: ProsemirrorBinding | null } | undefined
      )?.binding;
      // The selection from before the Yjs transaction, which the binding
      // keeps until the transaction ends (the remote change is dispatched
      // inside it).
      const before = binding?.beforeTransactionSelection;
      if (!binding || before?.type !== "text") return null;
      if (
        !intact(binding.doc, before.anchor) ||
        !intact(binding.doc, before.head)
      )
        return null;
      const anchor = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        before.anchor,
        binding.mapping,
      );
      const head = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        before.head,
        binding.mapping,
      );
      if (anchor === null || head === null) return null;
      const size = state.doc.content.size;
      if (anchor < 0 || head < 0 || anchor > size || head > size) return null;
      const { selection } = state;
      if (selection.anchor === anchor && selection.head === head) return null;
      return state.tr
        .setSelection(
          TextSelection.between(
            state.doc.resolve(anchor),
            state.doc.resolve(head),
          ),
        )
        .setMeta("addToHistory", false);
    },
  });
}

export const RemoteSelection = Extension.create({
  name: "remoteSelection",
  addProseMirrorPlugins: () => [remoteSelectionPlugin()],
});
