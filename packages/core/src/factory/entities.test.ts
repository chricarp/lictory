import assert from "node:assert/strict";
import { test } from "node:test";
import { takesSlot, withoutAsking } from "@lictory/core/factory/entities";

void test("a harness's permission mode is said plainly, and unknown when the runner does not report it", () => {
  assert.match(
    withoutAsking("claude-code", "acceptEdits")!,
    /^Edits files in its worktree without asking\. Asks before running commands/,
  );
  assert.match(
    withoutAsking("claude-code", "bypassPermissions")!,
    /^Never asks/,
  );
  assert.match(withoutAsking("codex", "workspace-write")!, /^Never asks/);
  // An older runner reports no mode: unknown, never a guess.
  assert.equal(withoutAsking("claude-code", undefined), null);
  assert.equal(withoutAsking("codex", "something-new"), null);
});

void test("a session waiting on a person takes no runner slot", () => {
  assert.equal(takesSlot("running"), true);
  assert.equal(takesSlot("assigned"), true);
  assert.equal(takesSlot("waiting"), false);
  assert.equal(takesSlot("failed"), false);
});
