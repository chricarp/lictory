import assert from "node:assert/strict";
import { test } from "node:test";
import { detectKeys, suggestBranchName } from "@lictory/core/code/keys";

const keys = (texts: string[], projects: string[]) =>
  detectKeys(texts, projects).map((k) => `${k.projectKey}-${k.number}`);

void test("keys are found case-insensitively in branch names, titles and messages", () => {
  assert.deepEqual(
    keys(
      ["feature/pay-142-refunds", "Fix PAY-7: retries", "closes Pay-9."],
      ["PAY"],
    ),
    ["PAY-142", "PAY-7", "PAY-9"],
  );
});

void test("a key is a whole word: no prefix letters, no extra digits or letters", () => {
  assert.deepEqual(
    keys(
      ["XPAY-1", "PAY-1423x", "PAY-12a", "PAY_3", "PAY-0", "(PAY-5)"],
      ["PAY"],
    ),
    ["PAY-5"],
  );
  // PAY-1423 names 1423, never 142.
  assert.deepEqual(keys(["PAY-1423"], ["PAY"]), ["PAY-1423"]);
});

void test("only the keys of the repository's projects are looked for", () => {
  assert.deepEqual(keys(["PAY-1 and OPS-2"], ["PAY"]), ["PAY-1"]);
  assert.deepEqual(keys(["PAY-1 and OPS-2"], []), []);
  // Longer keys win over their prefixes.
  assert.deepEqual(keys(["OPS2-4 OPS-5"], ["OPS", "OPS2"]), [
    "OPS2-4",
    "OPS-5",
  ]);
});

void test("each key is reported once", () => {
  assert.deepEqual(keys(["PAY-1", "pay-1: PAY-1"], ["PAY"]), ["PAY-1"]);
});

void test("branch names carry the key and a slug of the title within ref-name rules", () => {
  assert.equal(
    suggestBranchName("PAY-142", "Refunds over the API (v2) — ÜBER fast!"),
    "pay-142-refunds-over-the-api-v2-uber-fast",
  );
  assert.equal(suggestBranchName("PAY-1", "   "), "pay-1");
  assert.equal(suggestBranchName("PAY-1", "x", "feature/"), "feature/pay-1-x");
  assert.ok(suggestBranchName("PAY-1", "a ".repeat(200)).length <= 60);
});
