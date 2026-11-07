import type { AnyExtension, Editor, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  DecisionReference,
  decisionCardPlugin,
} from "@lictory/platform/components/spaces/blocks/decision-view";
import { WorkListView } from "@lictory/platform/components/spaces/blocks/work-list-view";
import "@lictory/platform/components/spaces/blocks/blocks.css";

// How the page schema's Work blocks render in the browser: decision
// references (chips, or cards alone in a paragraph), work lists, and on the
// read-only reader a "Create work item" action on open task items. The
// shared document extensions pass every extension through here.
export function withWorkBlockView(extension: AnyExtension): AnyExtension {
  if (extension.name === "decisionRef")
    return (extension as Node).extend({
      addNodeView: () =>
        ReactNodeViewRenderer(DecisionReference, { as: "span" }),
      addProseMirrorPlugins: () => [decisionCardPlugin()],
    });
  if (extension.name === "workList")
    return (extension as Node).extend({
      addNodeView: () => ReactNodeViewRenderer(WorkListView),
    });
  if (extension.name === "taskItem")
    return (extension as Node).extend({
      addProseMirrorPlugins() {
        const inherited = this.parent?.() ?? [];
        return [...inherited, taskToWorkPlugin(this.editor)];
      },
    });
  return extension;
}

// Asked on the page element; the page listens (components/spaces/work).
export const TASK_TO_WORK_EVENT = "lictory:task-to-work";
export type TaskToWorkDetail = {
  // The task's text, its paragraph and the top-level block holding it.
  text: string;
  blockId: string | null;
  topBlockId: string | null;
};

const taskKey = new PluginKey("taskToWork");

function taskDecorations(doc: PMNode) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "taskItem") return true;
    const paragraph = node.firstChild;
    const text = paragraph?.textContent.trim() ?? "";
    let linked = false;
    paragraph?.descendants((child) => {
      if (child.type.name === "workItemRef") linked = true;
      return !linked;
    });
    if (!node.attrs.checked && paragraph && text && !linked) {
      const end = pos + 1 + paragraph.nodeSize - 1;
      const top = doc.resolve(pos).node(1);
      const detail: TaskToWorkDetail = {
        text,
        blockId: (paragraph.attrs.id as string | null) ?? null,
        topBlockId: (top?.attrs.id as string | null) ?? null,
      };
      decorations.push(
        Decoration.widget(end, () => taskButton(detail), {
          side: 1,
          key: `task-${detail.blockId ?? pos}-${text}`,
          ignoreSelection: true,
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

function taskButton(detail: TaskToWorkDetail) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-to-work";
  button.contentEditable = "false";
  button.setAttribute(
    "aria-label",
    `Create a work item from the task “${detail.text.slice(0, 80)}”`,
  );
  button.title = "Create a work item from this task";
  button.textContent = "Create work item";
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    button.dispatchEvent(
      new CustomEvent<TaskToWorkDetail>(TASK_TO_WORK_EVENT, {
        detail,
        bubbles: true,
      }),
    );
  });
  return button;
}

// Only on the read-only reader of a commit: converting needs committed text
// to cite. Nothing is changed in the page.
function taskToWorkPlugin(editor: Editor) {
  return new Plugin({
    key: taskKey,
    state: {
      init: (_, state) => taskDecorations(state.doc),
      apply: (tr, old) => (tr.docChanged ? taskDecorations(tr.doc) : old),
    },
    props: {
      decorations: (state) =>
        editor.isEditable
          ? DecorationSet.empty
          : (taskKey.getState(state) as DecorationSet),
    },
  });
}
