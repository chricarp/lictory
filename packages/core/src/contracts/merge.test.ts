import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeText,
  mergeSnapshot,
  mergeBase,
} from "@lictory/core/contracts/merge";
import { reviewResultValue } from "@lictory/core/contracts/decomposition";
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

void test("independent breakdown additions combine and competing child edits conflict", () => {
  const child = {
    workItemId: "a",
    typeId: "task",
    title: "Retries",
    description: "Stable IDs",
  };
  const other = { ...child, workItemId: "b", title: "Timeouts" };
  const base = {
    title: "Behavior",
    content: "Retries are safe",
    proposedChildren: [],
  };
  const result = mergeSnapshot(
    base,
    { ...base, proposedChildren: [child] },
    { ...base, proposedChildren: [other] },
  );
  assert.equal(result.conflicted, false);
  assert.deepEqual(result.proposedChildren, [child, other]);
  const original = { ...base, proposedChildren: [child] };
  assert.equal(
    mergeSnapshot(
      original,
      { ...original, proposedChildren: [{ ...child, description: "Ours" }] },
      { ...original, proposedChildren: [{ ...child, description: "Theirs" }] },
    ).decompositionConflict,
    true,
  );
  // jsonb reorders keys; equal scope remains equal after persistence.
  assert.equal(
    mergeSnapshot(
      base,
      { ...base, proposedChildren: [child] },
      {
        ...base,
        proposedChildren: [
          {
            description: child.description,
            title: child.title,
            typeId: child.typeId,
            workItemId: child.workItemId,
          },
        ],
      },
    ).conflicted,
    false,
  );
});

void test("changes to existing children merge by change identity", () => {
  const change = {
    changeId: "c1",
    workItemId: "child",
    base: { revisionId: "r1", title: "Retries" },
    parentId: null,
  };
  const other = { ...change, changeId: "c2", workItemId: "sibling" };
  const base = { title: "Behavior", content: "Retries", proposedChildren: [] };
  const combined = mergeSnapshot(
    base,
    { ...base, proposedChildren: [change] },
    { ...base, proposedChildren: [other] },
  );
  assert.equal(combined.conflicted, false);
  assert.deepEqual(combined.proposedChildren, [change, other]);
  const original = { ...base, proposedChildren: [change] };
  assert.equal(
    mergeSnapshot(
      original,
      { ...original, proposedChildren: [{ ...change, parentId: "epic" }] },
      {
        ...original,
        proposedChildren: [{ ...change, archive: true as const }],
      },
    ).decompositionConflict,
    true,
  );
  // Detaching and keeping the parent fingerprint differently.
  assert.notEqual(
    reviewResultValue({ ...base, proposedChildren: [change] }),
    reviewResultValue({
      ...base,
      proposedChildren: [
        { ...change, parentId: undefined, archive: true as const },
      ],
    }),
  );
});
