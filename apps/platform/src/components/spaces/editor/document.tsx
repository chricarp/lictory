import { useEffect } from "react";
import type { AnyExtension, Editor, Extension, Node } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import { pageExtensions } from "@lictory/core/spaces/document/schema";
import { CommentHighlights } from "@lictory/platform/components/spaces/comments/highlights";
import {
  PageReference,
  WorkItemReference,
} from "@lictory/platform/components/spaces/editor/references";
import { withWorkBlockView } from "@lictory/platform/components/spaces/blocks/views";
import "@lictory/platform/components/spaces/editor/page-document.css";

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
    ...(pageExtensions() as AnyExtension[]).map((extension) => {
      if (extension.name === "uniqueID")
        return (extension as Extension).configure(uniqueId);
      if (extension.name === "workItemRef")
        return (extension as Node).extend({
          addNodeView: () =>
            ReactNodeViewRenderer(WorkItemReference, { as: "span" }),
        });
      if (extension.name === "pageRef")
        return (extension as Node).extend({
          addNodeView: () =>
            ReactNodeViewRenderer(PageReference, { as: "span" }),
        });
      return withWorkBlockView(extension);
    }),
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
