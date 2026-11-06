import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

// Highlights of open discussions as ProseMirror decorations: they follow
// local typing through the transaction mapping, and the comments
// controller recomputes them from the anchors after remote changes. They
// never change the document.

export type Highlight = {
  threadId: string;
  from: number;
  to: number;
  blocking: boolean;
};

type State = { decorations: DecorationSet };
// The thread that is selected and the one under the pointer (in the
// panel or in the text) read as one: their passage is tinted more strongly.
type Meta = {
  highlights: readonly Highlight[];
  active: string | null;
  hovered: string | null;
};

const key = new PluginKey<State>("pageCommentHighlights");

function build(state: EditorState, meta: Meta) {
  const size = state.doc.content.size;
  const decorations = meta.highlights
    .filter((h) => h.from < h.to && h.to <= size)
    .map((h) =>
      Decoration.inline(
        h.from,
        h.to,
        {
          class: [
            "page-comment",
            h.blocking && "page-comment-blocking",
            (h.threadId === meta.active || h.threadId === meta.hovered) &&
              "page-comment-active",
          ]
            .filter(Boolean)
            .join(" "),
          "data-thread": h.threadId,
        },
        { threadId: h.threadId },
      ),
    );
  return DecorationSet.create(state.doc, decorations);
}

// Clicking a highlight is handled by the comments controller (it listens
// for clicks on `[data-thread]`), which works in read-only views too.
export const CommentHighlights = Extension.create({
  name: "commentHighlights",
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key,
        state: {
          init: () => ({ decorations: DecorationSet.empty }),
          apply(tr, value, _old, next) {
            const meta = tr.getMeta(key) as Meta | undefined;
            if (meta) return { decorations: build(next, meta) };
            if (!tr.docChanged) return value;
            return { decorations: value.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.decorations,
        },
      }),
    ];
  },
});

export function showHighlights(
  view: EditorView,
  highlights: readonly Highlight[],
  active: string | null,
  hovered: string | null,
) {
  if (view.isDestroyed) return;
  view.dispatch(
    view.state.tr
      .setMeta(key, { highlights, active, hovered } satisfies Meta)
      .setMeta("addToHistory", false),
  );
}
