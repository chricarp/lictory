import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  wordingHintsInDocument,
  type PlacedWordingHint,
} from "@lictory/core/editor/wording-hints";
import { Button } from "@lictory/ui/button";

// Wording hints in the Acceptance criteria section of a specification
// being edited (core/editor/wording-hints.ts): a dotted underline under
// phrases a tester cannot check, and one line about the phrase under the
// caret with "Dismiss". They are decorations, never document content, and
// dismissals stay on this device: hints create no discussions, revisions or
// readiness results, and need no AI.

// Dismissed hints, keyed by the phrase and its criterion's text, so editing
// the criterion shows its hints again. Browser storage only.
const STORAGE_KEY = "lictory:wording-hints:dismissed";
const LIMIT = 500;
let dismissed: string[] | null = null;

function load() {
  if (dismissed) return dismissed;
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    dismissed = Array.isArray(stored)
      ? stored.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    dismissed = [];
  }
  return dismissed;
}

function save(keys: string[]) {
  dismissed = keys.slice(-LIMIT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissed));
  } catch {
    // Dismissals then last until the page reloads.
  }
}

// FNV-1a: stores a short key instead of the criterion's text.
function hintKey(hint: PlacedWordingHint) {
  const text = `${hint.kind}\u0000${hint.phrase.toLowerCase()}\u0000${hint.criterion}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

type State = { hints: PlacedWordingHint[]; decorations: DecorationSet };
const key = new PluginKey<State>("wordingHints");

function build(state: EditorState): State {
  const hidden = new Set(load());
  const hints = wordingHintsInDocument(state.doc).filter(
    (hint) => !hidden.has(hintKey(hint)),
  );
  return {
    hints,
    decorations: DecorationSet.create(
      state.doc,
      hints.map((hint) =>
        Decoration.inline(hint.pos, hint.end, {
          class: "wording-hint",
          title: hint.message,
        }),
      ),
    ),
  };
}

export const WordingHints = Extension.create({
  name: "wordingHints",
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key,
        state: {
          init: (_config, state) => build(state),
          apply: (tr, value, _old, next) =>
            tr.docChanged || tr.getMeta(key) ? build(next) : value,
        },
        props: {
          // Only while editing: readers and closed drafts show none.
          decorations: (state) =>
            this.editor.isEditable
              ? key.getState(state)?.decorations
              : undefined,
        },
      }),
    ];
  },
});

function hintAtCaret(editor: Editor) {
  if (editor.isDestroyed || !editor.isEditable) return null;
  const { from, to } = editor.state.selection;
  return (
    key
      .getState(editor.state)
      ?.hints.find((hint) => hint.pos <= from && to <= hint.end) ?? null
  );
}

// The line about the hint under the caret, shown at the bottom of the
// editor while the caret is in a hinted phrase.
export function WordingHintLine({ editor }: { editor: Editor | null }) {
  const [hint, setHint] = useState<PlacedWordingHint | null>(null);
  const [undo, setUndo] = useState<{ key: string; phrase: string } | null>(
    null,
  );
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next = hintAtCaret(editor);
      setHint((current) =>
        current?.pos === next?.pos &&
        current?.end === next?.end &&
        current?.message === next?.message
          ? current
          : next,
      );
    };
    const moved = () => {
      setUndo(null);
      update();
    };
    update();
    editor.on("transaction", update);
    editor.on("selectionUpdate", moved);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", moved);
    };
  }, [editor]);
  if (!editor || (!hint && !undo)) return null;
  const refresh = () => {
    if (!editor.isDestroyed)
      editor.view.dispatch(
        editor.state.tr.setMeta(key, true).setMeta("addToHistory", false),
      );
  };
  return (
    <div
      role="status"
      data-testid="wording-hint"
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-b-[inherit] border-t bg-card/95 px-3 py-1.5 text-[13px] backdrop-blur"
    >
      <Lightbulb
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <p className="min-w-0 flex-1 basis-60 text-muted-foreground">
        {hint
          ? hint.message
          : `Hint about “${undo!.phrase}” dismissed on this device.`}
      </p>
      {hint ? (
        <Button
          size="sm"
          variant="ghost"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const k = hintKey(hint);
            save([...load().filter((x) => x !== k), k]);
            setUndo({ key: k, phrase: hint.phrase });
            refresh();
          }}
        >
          Dismiss
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            save(load().filter((x) => x !== undo!.key));
            setUndo(null);
            refresh();
          }}
        >
          Undo
        </Button>
      )}
    </div>
  );
}
