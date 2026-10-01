import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeText, mergeSnapshot, mergeBase } from "./merge";
const merged = (base: string, ours: string, theirs: string) =>
  mergeText(base, ours, theirs)
    .flatMap((c) => ("lines" in c ? c.lines : c.ours))
    .join("\n");
void test("independent changes combine and preserve trailing newlines and removals", () => {
  assert.equal(
    merged("one\ntwo\nthree\n", "ONE\ntwo\nthree\n", "one\ntwo\nTHREE\n"),
    "ONE\ntwo\nTHREE\n",
  );
  assert.equal(
    merged("one\ntwo\nthree", "one\nthree", "one\ntwo\nTHREE"),
    "one\nTHREE",
  );
  assert.equal(
    merged("one\ntwo", "zero\none\ntwo", "one\ntwo\nthree"),
    "zero\none\ntwo\nthree",
  );
  assert.equal(
    merged("one\ntwo\nthree", "ONE\ntwo\nthree", "one\nTWO\nthree"),
    "ONE\nTWO\nthree",
  );
});
void test("overlapping edits and competing insertions require explicit resolution", () => {
  assert.ok(
    mergeText("one\ntwo", "one\nours", "one\ntheirs").some(
      (c) => !("lines" in c),
    ),
  );
  assert.ok(
    mergeText("one\ntwo", "one\nours\ntwo", "one\ntheirs\ntwo").some(
      (c) => !("lines" in c),
    ),
  );
  assert.equal(merged("one\ntwo", "ONE\ntwo", "ONE\ntwo"), "ONE\ntwo");
  assert.ok(
    mergeSnapshot(
      { title: "base", content: "" },
      { title: "ours", content: "" },
      { title: "theirs", content: "" },
    ).titleConflict,
  );
});
void test("merge bases follow merge parents, not current main or timestamps", () => {
  const commits = [
    { id: "root", parentIds: [] },
    { id: "a", parentIds: ["root"] },
    { id: "b", parentIds: ["root"] },
    { id: "merge", parentIds: ["a", "b"] },
    { id: "next", parentIds: ["b"] },
  ];
  assert.equal(mergeBase(commits, "merge", "next")?.id, "b");
  assert.equal(mergeBase(commits, "a", "b")?.id, "root");
  assert.equal(
    mergeBase([...commits, { id: "x", parentIds: [] }], "a", "x"),
    undefined,
  );
});
void test("large ambiguous rewrites become conflicts without an unbounded diff matrix", () => {
  const base = Array.from({ length: 1100 }, (_, i) => `${i}`).join("\n");
  assert.ok(
    mergeText(base, base + "\nours", base + "\ntheirs").some(
      (c) => !("lines" in c),
    ),
  );
});
