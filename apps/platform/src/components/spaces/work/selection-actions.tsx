import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { ListPlus } from "lucide-react";
import { usePageWorkActions } from "@lictory/platform/components/spaces/work/page-work-actions";
import type { CreateFromPageRequest } from "@lictory/platform/components/spaces/work/create-from-page";

// "Create work item" beside "Comment" on text selected in the published
// page (the read-only reader), for people who can create work somewhere.

const LEAF = "￼";

// The nearest heading before a position, for a title when the selection is
// long.
function headingBefore(state: EditorState, pos: number) {
  let found = "";
  state.doc.nodesBetween(0, pos, (node) => {
    if (node.type.name === "heading") found = node.textContent.trim();
    return node.isBlock && node.type.name !== "heading";
  });
  return found;
}

export function selectionRequest(
  state: EditorState,
  from: number,
  to: number,
): Omit<CreateFromPageRequest, "mode"> | null {
  const quote = state.doc.textBetween(from, to, "\n").trim();
  if (!quote) return null;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const top = $from.depth >= 1 ? $from.node(1) : null;
  const block = $to.parent;
  const firstLine = quote.split("\n")[0]!.trim();
  const title =
    firstLine.length <= 120
      ? firstLine.replace(/[.:;,]+$/, "")
      : headingBefore(state, from) || `${firstLine.slice(0, 117)}…`;
  return {
    origin: "selection",
    quote,
    title,
    topBlockId: (top?.attrs.id as string | null) ?? null,
    anchor: {
      blockId: block.isTextblock
        ? ((block.attrs.id as string | null) ?? null)
        : null,
      before: block.isTextblock
        ? state.doc.textBetween($to.start(), to, undefined, LEAF)
        : "",
    },
  };
}

export function SelectionWorkAction({
  editor,
  range,
}: {
  editor: Editor;
  range: { from: number; to: number };
}) {
  const actions = usePageWorkActions();
  if (!actions || editor.isEditable) return null;
  return (
    <button
      type="button"
      // Keeps the selection: the action reads what is selected.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const request = selectionRequest(editor.state, range.from, range.to);
        if (request) actions.start({ ...request, mode: "write" });
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-popover px-3 text-xs font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ListPlus className="size-3.5" aria-hidden /> Create work item
    </button>
  );
}

// Whether the selection toolbar has this action (so it shows for people
// who can create work but not comment).
export function useSelectionWorkAvailable(editor: Editor | null) {
  const actions = usePageWorkActions();
  return Boolean(actions && editor && !editor.isEditable);
}
