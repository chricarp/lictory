import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { referencesInDocument } from "@lictory/core/contracts/references";
import { CONTEXT_QUOTE_LIMIT } from "@lictory/core/intelligence/chat/shared";
import { identifier } from "@lictory/core/lib/work-items";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useDock,
  usePublishDockPage,
  type DockPage,
} from "@lictory/platform/components/intelligence/dock/store";

type Selected = {
  quote: string;
  blockId: string | null;
};

// Rendered beside a page of Lictory Spaces: tells the Litto dock which page
// and exact version the person is reading, which work items it mentions,
// and what they select in it; "Ask Litto" joins the selection toolbar
// (SelectionAskAction), as in the specification reader. The dock only names these; the
// server re-checks access before the assistant reads them.
export function DockPageSource({
  spaceId,
  pageId,
  title,
  branchId,
  commitId,
  content,
  editor,
}: {
  spaceId: string;
  pageId: string;
  title: string;
  branchId?: string;
  commitId?: string;
  content: Record<string, unknown> | undefined;
  editor: Editor | null;
}) {
  const { items, projects } = useWorkspace();
  const dock = useDock();

  // Work items the content references that the person can see (the synced
  // workspace holds exactly those), by their current key.
  const referenced = useMemo(() => {
    if (!content) return [];
    const ids = [
      ...new Set(
        referencesInDocument(content)
          .filter((r) => r.kind === "item")
          .map((r) => r.id),
      ),
    ];
    const byId = new Map(items.map((i) => [i.id, i]));
    return ids.flatMap((id) => {
      const item = byId.get(id);
      if (!item || item.archivedAt) return [];
      const project = projects.find((p) => p.id === item.projectId);
      return [{ id, key: identifier(project, item.number) }];
    });
  }, [content, items, projects]);
  // `referenced` is rebuilt whenever the workspace changes; publish only
  // when what it names changes.
  const referencedKey = JSON.stringify(referenced);
  const value = useMemo<DockPage>(
    () => ({
      spaceId,
      pageId,
      title,
      branchId,
      commitId,
      items: JSON.parse(referencedKey) as DockPage["items"],
    }),
    [spaceId, pageId, title, branchId, commitId, referencedKey],
  );
  usePublishDockPage(value);

  const [selected, setSelected] = useState<Selected | null>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (editor.isDestroyed) return;
      const root = editor.view.dom;
      const selection = document.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        !selection.anchorNode ||
        !root.contains(selection.anchorNode) ||
        !selection.focusNode ||
        !root.contains(selection.focusNode)
      )
        return setSelected(null);
      const quote = selection
        .toString()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, CONTEXT_QUOTE_LIMIT);
      if (quote.length < 2) return setSelected(null);
      const range = selection.getRangeAt(0);
      const start =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      const block = start?.closest<HTMLElement>("[data-id]");
      setSelected({
        quote,
        blockId: block && root.contains(block) ? block.dataset.id! : null,
      });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [editor]);

  // The dock follows the selection so it can attach it to the next message.
  useEffect(() => {
    dock?.setSelection(
      selected
        ? {
            pageId,
            blockId: selected.blockId,
            quote: selected.quote,
            section: "",
          }
        : null,
    );
  }, [dock, pageId, selected]);
  useEffect(() => () => dock?.setSelection(null), [dock]);

  // "Ask Litto" itself sits in the selection toolbar beside Comment
  // (SelectionAskAction).
  return null;
}

// Whether "Ask Litto" applies to text selected in this reader.
export function useSelectionAskAvailable(editor: Editor | null) {
  const { directory } = useWorkspace();
  const dock = useDock();
  return Boolean(
    dock &&
    directory.ai.available &&
    directory.ai.enabled &&
    editor &&
    !editor.isEditable,
  );
}

// "Ask Litto" in the page's selection toolbar: opens the dock, which has
// already been given the selection by DockPageSource.
export function SelectionAskAction({
  editor,
  className,
}: {
  editor: Editor;
  className: string;
}) {
  const dock = useDock();
  const available = useSelectionAskAvailable(editor);
  if (!available || !dock) return null;
  return (
    <button
      type="button"
      // Keeps the selection: the dock attaches what is selected.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => dock.open()}
      className={className}
    >
      <IntelligenceMark className="size-3.5 text-primary" /> Ask Litto
    </button>
  );
}
