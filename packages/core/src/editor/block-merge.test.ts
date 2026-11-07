import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasConflicts,
  mergeBlocks,
  resolveMerge,
} from "@lictory/core/editor/block-merge";

// Markdown edited as text beside a live draft changes only what its author
// changed; overlapping changes are never chosen silently.

const merge = (base: string, mine: string, theirs: string) =>
  mergeBlocks([...base], [...mine], [...theirs], (block) => block);
const merged = (base: string, mine: string, theirs: string) => {
  const chunks = merge(base, mine, theirs);
  assert.equal(hasConflicts(chunks), false);
  return resolveMerge(chunks, "mine").join("");
};

void test("disjoint changes on both sides are all kept", () => {
  // I change B; meanwhile someone changes D and adds F.
  assert.equal(merged("ABCDE", "AXCDE", "ABCYEF"), "AXCYEF");
  // I delete C; they insert G after A.
  assert.equal(merged("ABCDE", "ABDE", "AGBCDE"), "AGBDE");
  // Nothing of mine changed: theirs as it is.
  assert.equal(merged("ABC", "ABC", "AQC"), "AQC");
  // Both added at the end: theirs first, then mine.
  assert.equal(merged("AB", "ABM", "ABT"), "ABTM");
  // The same change on both sides counts once.
  assert.equal(merged("ABC", "AZC", "AZC"), "AZC");
  assert.equal(merged("", "M", ""), "M");
  assert.equal(merged("A", "", "A"), "");
});

void test("changes to the same blocks are a conflict, resolved only by choice", () => {
  const chunks = merge("ABC", "AMC", "ATC");
  assert.equal(hasConflicts(chunks), true);
  assert.deepEqual(
    chunks.find((c) => c.kind === "conflict"),
    { kind: "conflict", base: ["B"], mine: ["M"], theirs: ["T"] },
  );
  assert.equal(resolveMerge(chunks, "mine").join(""), "AMC");
  assert.equal(resolveMerge(chunks, "theirs").join(""), "ATC");
  // I edited what they deleted.
  assert.equal(hasConflicts(merge("ABC", "AMC", "AC")), true);
});
