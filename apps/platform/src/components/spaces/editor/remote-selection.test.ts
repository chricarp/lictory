import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import {
  EditorState,
  TextSelection,
  type Plugin,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ySyncPlugin } from "@tiptap/y-tiptap";
import { pageExtensions } from "@lictory/core/spaces/document/schema";
import { remoteSelectionPlugin } from "@lictory/platform/components/spaces/editor/remote-selection";

const schema = getSchema(pageExtensions());

// One person's editor without a DOM: the sync binding only needs the state,
// dispatch and focus of its view.
function editor(doc: Y.Doc, withFix: boolean) {
  const plugins: Plugin[] = [ySyncPlugin(doc.getXmlFragment("default"))];
  if (withFix) plugins.push(remoteSelectionPlugin());
  let state = EditorState.create({ schema, plugins });
  const views: {
    update?: (view: EditorView, previous: EditorState) => void;
  }[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      const previous = state;
      state = state.apply(tr);
      for (const pluginView of views) pluginView.update?.(view, previous);
    },
    hasFocus: () => false,
  } as unknown as EditorView;
  for (const plugin of state.plugins)
    if (plugin.spec.view) views.push(plugin.spec.view(view));
  return {
    get state() {
      return state;
    },
    type(text: string) {
      view.dispatch(state.tr.insertText(text));
    },
    select(from: number, to = from) {
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, from, to)),
      );
    },
    // Splits the paragraph; the new one gets its own block id, as the
    // editor's unique id extension does.
    enter() {
      const { $from } = state.selection;
      view.dispatch(
        state.tr.split($from.pos, 1, [
          { type: $from.parent.type, attrs: { id: crypto.randomUUID() } },
        ]),
      );
    },
    // Gives the first block an id, as the editor's unique id extension
    // does for every block (the ids are what the binding's fallback keys on).
    identifyFirstBlock() {
      view.dispatch(state.tr.setNodeAttribute(0, "id", crypto.randomUUID()));
    },
    text() {
      return state.doc.content.content.map((block) => block.textContent);
    },
  };
}

// Two people on one live draft, connected directly.
function room(withFix = true) {
  const docs = [new Y.Doc(), new Y.Doc()] as const;
  for (const [from, to] of [docs, [...docs].reverse()] as const)
    from.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") Y.applyUpdate(to, update, "remote");
    });
  const ada = editor(docs[0], withFix);
  const ben = editor(docs[1], withFix);
  return { ada, ben };
}

function startedDraft(withFix = true) {
  const { ada, ben } = room(withFix);
  ada.select(1);
  ada.type("Refunds are processed within five days.");
  ada.identifyFirstBlock();
  ben.select(1);
  return { ada, ben };
}

void test("a caret stays after its text when someone types before it in the same paragraph", () => {
  const { ada, ben } = startedDraft();
  assert.equal(ada.state.selection.from, 40);
  ben.type("Escalate disputes to finance. ");
  assert.deepEqual(ada.text(), [
    "Escalate disputes to finance. Refunds are processed within five days.",
  ]);
  assert.equal(ada.state.selection.from, 70);
  // What Ada types next continues her sentence.
  ada.type(" Weekends count.");
  assert.deepEqual(ben.text(), [
    "Escalate disputes to finance. Refunds are processed within five days. Weekends count.",
  ]);
});

// When this fails, y-tiptap resolves remote changes correctly by itself and
// the remote selection plugin can go.
void test("y-tiptap alone still leaves the caret at its old offset", () => {
  const { ada, ben } = startedDraft(false);
  ben.type("Escalate disputes to finance. ");
  assert.notEqual(ada.state.selection.from, 70);
});

void test("a caret stays put when someone types after it", () => {
  const { ada, ben } = startedDraft();
  ada.select(9);
  ben.select(40);
  ben.type(" Weekends count.");
  assert.equal(ada.state.selection.from, 9);
});

void test("a selection keeps covering its words when text is inserted around it", () => {
  const { ada, ben } = startedDraft();
  ada.select(13, 22);
  ben.type("Note: ");
  ben.select(46);
  ben.type(" (business days)");
  const { from, to } = ada.state.selection;
  assert.equal(ada.state.doc.textBetween(from, to), "processed");
});

void test("a caret in its own paragraph follows a new paragraph written above it", () => {
  const { ada, ben } = startedDraft();
  ben.type("Escalate disputes to finance.");
  ben.enter();
  assert.deepEqual(ada.text(), [
    "Escalate disputes to finance.",
    "Refunds are processed within five days.",
  ]);
  // Before "Refunds", Ada was at the end of the paragraph's text.
  assert.equal(
    ada.state.doc.resolve(ada.state.selection.from).parent.textContent,
    "Refunds are processed within five days.",
  );
  assert.equal(ada.state.selection.$from.parentOffset, 39);
});
