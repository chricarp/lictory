import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { pageExtensions } from "@lictory/core/spaces/document/schema";
import {
  blockAnchor,
  findBlock,
  insertionRange,
} from "@lictory/platform/components/spaces/blocks/anchor";

const schema = getSchema(pageExtensions());
type Json = Record<string, unknown>;
const paragraph = (id: string, text?: string): Json => ({
  type: "paragraph",
  attrs: { id },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const workList = (id: string): Json => ({
  type: "workList",
  attrs: { id, filter: "referenced" },
});
const doc = (...content: Json[]) =>
  schema.nodeFromJSON({ type: "doc", content });
// The id of the block at a position.
const blockAt = (d: PMNode, pos: number) =>
  d.nodeAt(pos)?.attrs.id as string | undefined;
const blockBefore = (d: PMNode, pos: number) =>
  d.resolve(pos).nodeBefore?.attrs.id as string | undefined;

void test("a block dialog applies where it was opened, after others edited the draft meanwhile", () => {
  const opened = doc(paragraph("a", "Intro"), paragraph("b", "Goal"));
  // "/" typed at the end of "Goal".
  const after = blockAnchor(opened, opened.content.size - 1);
  // A collaborator adds two paragraphs above while the dialog is open; the
  // document arrives rebuilt, so old positions point elsewhere.
  const edited = doc(
    paragraph("x", "New first"),
    paragraph("y", "New second"),
    paragraph("a", "Intro"),
    paragraph("b", "Goal"),
  );
  const range = insertionRange(edited, after);
  assert.equal(range.from, range.to);
  assert.equal(blockBefore(edited, range.from), "b");

  // "/" in an empty paragraph replaces that paragraph, wherever it is now.
  const empty = doc(paragraph("a", "Intro"), paragraph("e"));
  const inEmpty = blockAnchor(empty, empty.content.size - 1);
  const moved = doc(paragraph("e"), paragraph("a", "Intro"));
  const replaced = insertionRange(moved, inEmpty);
  assert.equal(blockAt(moved, replaced.from), "e");
  assert.equal(replaced.to, moved.child(0).nodeSize);
  // Someone typed into it meanwhile: it is kept and the list follows it.
  const typed = doc(paragraph("a", "Intro"), paragraph("e", "Now text"));
  const kept = insertionRange(typed, inEmpty);
  assert.equal(kept.from, kept.to);
  assert.equal(blockBefore(typed, kept.from), "e");

  // The blocks are gone: the position, kept within the document.
  const gone = insertionRange(doc(paragraph("z", "Other")), after);
  assert.equal(gone.from, gone.to);
  assert.equal(gone.from, doc(paragraph("z", "Other")).content.size);
});

void test("an existing work list is found by its id, not its old position", () => {
  const opened = doc(paragraph("a", "Intro"), workList("list"));
  const was = findBlock(opened, "list", "workList");
  assert.equal(blockAt(opened, was!), "list");
  const edited = doc(
    paragraph("x", "Added above"),
    paragraph("a", "Intro"),
    workList("list"),
  );
  const now = findBlock(edited, "list", "workList");
  assert.notEqual(now, was);
  assert.equal(edited.nodeAt(now!)?.type.name, "workList");
  assert.equal(findBlock(edited, "a", "workList"), undefined);
  assert.equal(findBlock(doc(paragraph("a", "Intro")), "list"), undefined);
});
