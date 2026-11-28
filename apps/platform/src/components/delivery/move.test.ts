import assert from "node:assert/strict";
import { test } from "node:test";
import { rankNeighbours } from "@lictory/platform/components/delivery/move";

const ids = ["a", "b", "c", "d"];

void test("a rank move places the item between the neighbours it ends up with", () => {
  assert.deepEqual(rankNeighbours(ids, "c", "top"), {
    afterId: null,
    beforeId: "a",
  });
  assert.deepEqual(rankNeighbours(ids, "c", "up"), {
    afterId: "a",
    beforeId: "b",
  });
  assert.deepEqual(rankNeighbours(ids, "b", "down"), {
    afterId: "c",
    beforeId: "d",
  });
  assert.deepEqual(rankNeighbours(ids, "b", "bottom"), {
    afterId: "d",
    beforeId: null,
  });
});

void test("a move that would not change the order sends nothing", () => {
  assert.equal(rankNeighbours(ids, "a", "top"), null);
  assert.equal(rankNeighbours(ids, "a", "up"), null);
  assert.equal(rankNeighbours(ids, "d", "down"), null);
  assert.equal(rankNeighbours(ids, "d", "bottom"), null);
  assert.equal(rankNeighbours(["a"], "a", "bottom"), null);
  assert.equal(rankNeighbours(ids, "missing", "top"), null);
});
