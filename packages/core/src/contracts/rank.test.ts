import assert from "node:assert/strict";
import { test } from "node:test";
import { rankBetween } from "@lictory/core/contracts/rank";

void test("ranks sort strictly between neighbours, even when repeatedly bisected", () => {
  let low: string | null = null;
  let high: string | null = null;
  const first = rankBetween(low, high);
  low = first;
  high = rankBetween(first, null);
  for (let i = 0; i < 200; i++) {
    const mid = rankBetween(low, high);
    assert.ok(low !== null && high !== null && mid > low && mid < high);
    if (i % 2) low = mid;
    else high = mid;
  }
});

void test("ranks can always be placed first and last", () => {
  let first = rankBetween(null, null);
  let last = first;
  for (let i = 0; i < 100; i++) {
    const before = rankBetween(null, first);
    assert.ok(before < first);
    first = before;
    const after = rankBetween(last, null);
    assert.ok(after > last);
    last = after;
  }
});
