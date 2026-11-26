import { useEffect, useId } from "react";
import type { AnyExtension, Editor, Extension } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { pageExtensions } from "@lictory/core/spaces/document/schema";
import { CommentHighlights } from "@lictory/platform/components/spaces/comments/highlights";
import { withNodeViews } from "@lictory/platform/components/editor/node-views";
import "@lictory/platform/components/editor/document.css";
import { withWorkBlockPlugins } from "@lictory/platform/components/spaces/blocks/views";
import {
  commentShortcut,
  keyboardSelect,
  keyboardSelectionHint,
} from "@lictory/platform/lib/keyboard-selection";

// The page schema as the browser renders it: the shared extensions (so a
// commit renders exactly as it was written), live reference views and
// comment highlights. The live editor adds collaboration on top.
// `filterTransaction` (live drafts) leaves block ids of remote changes to
// their author; without it (read-only views) ids are never written.
export function documentExtensions(
  uniqueId:
    | { filterTransaction: (tr: Transaction) => boolean }
    | { updateDocument: false } = { updateDocument: false },
): AnyExtension[] {
  return [
    ...withNodeViews(
      (pageExtensions() as AnyExtension[]).map((extension) =>
        extension.name === "uniqueID"
          ? (extension as Extension).configure(uniqueId)
          : extension,
      ),
    ).map(withWorkBlockPlugins),
    CommentHighlights,
  ];
}

// A commit, read-only, from its canonical JSON. No Yjs and no socket:
// readers get the content as soon as the commit is synchronized.
// The reader is one tab stop whose text is selected with the keyboard
// (lib/keyboard-selection.ts), so a passage can be commented on (Mod+Alt+M),
// turned into work or asked about without a pointer.
export function PageReader({
  content,
  label,
  onEditor,
}: {
  content: Record<string, unknown>;
  label: string;
  onEditor?: (editor: Editor | null) => void;
}) {
  const hintId = useId();
  const editor = useEditor(
    {
      editable: false,
      extensions: documentExtensions(),
      content,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          class: "page-document rounded-sm focus-ring outline-none",
          role: "document",
          "aria-label": label,
          "aria-describedby": hintId,
          tabindex: "0",
        },
        handleDOMEvents: {
          keydown: (view, event) => {
            if (!keyboardSelect(view.dom, event)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    },
    [content],
  );
  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);
  return (
    <div className="group/reader">
      <EditorContent editor={editor} />
      <p
        id={hintId}
        className="mt-3 hidden text-[11px] leading-4 text-muted-foreground group-has-[.page-document:focus-visible]/reader:block"
      >
        {keyboardSelectionHint} {commentShortcut} comments on the selection.
      </p>
    </div>
  );
}
