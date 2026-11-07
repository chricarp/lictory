import { useEffect } from "react";
import type { AnyExtension, Editor, Extension } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { pageExtensions } from "@lictory/core/spaces/document/schema";
import { CommentHighlights } from "@lictory/platform/components/spaces/comments/highlights";
import { withNodeViews } from "@lictory/platform/components/editor/node-views";
import "@lictory/platform/components/editor/document.css";

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
    ),
    CommentHighlights,
  ];
}

// A commit, read-only, from its canonical JSON. No Yjs and no socket:
// readers get the content as soon as the commit is synchronized.
export function PageReader({
  content,
  label,
  onEditor,
}: {
  content: Record<string, unknown>;
  label: string;
  onEditor?: (editor: Editor | null) => void;
}) {
  const editor = useEditor(
    {
      editable: false,
      extensions: documentExtensions(),
      content,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          class: "page-document",
          role: "document",
          "aria-label": label,
        },
      },
    },
    [content],
  );
  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);
  return <EditorContent editor={editor} />;
}
