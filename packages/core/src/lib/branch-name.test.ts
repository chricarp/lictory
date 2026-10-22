import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchNameProblem,
  finalizeBranchName,
  sanitizeBranchNameInput,
} from "@lictory/core/lib/branch-name";

void test("spaces become single dashes while typing", () => {
  assert.equal(
    sanitizeBranchNameInput("clarify  the timeout "),
    "clarify-the-timeout-",
  );
  assert.equal(sanitizeBranchNameInput("a - - b"), "a-b");
});

void test("characters Git rejects are dropped", () => {
  assert.equal(sanitizeBranchNameInput("fix~^:?*[\\]@{x}"), "fixx");
  assert.equal(sanitizeBranchNameInput("ä-é-name"), "name");
  assert.equal(sanitizeBranchNameInput("a..b//c/.d/-e"), "a.b/c/d/e");
  assert.equal(sanitizeBranchNameInput("--start"), "start");
});

void test("finalizing trims trailing separators and .lock", () => {
  assert.equal(finalizeBranchName("feature/"), "feature");
  assert.equal(finalizeBranchName("name.lock-"), "name");
});

void test("validation follows Git ref rules", () => {
  assert.equal(branchNameProblem("feature/clarify-timeout"), null);
  for (const bad of [
    "",
    "has space",
    "a..b",
    "a//b",
    "a/.b",
    "a.lock",
    "a/",
    "-a",
    "Main",
    "x".repeat(81),
  ])
    assert.notEqual(branchNameProblem(bad), null, bad);
});
