import assert from "node:assert/strict";
import { test } from "node:test";
import { aiScore, applyAiEdit } from "@lictory/core/contracts/ai";

void test("score is explainable: fixed weight per severity, bounded to 0..100", () => {
  assert.equal(aiScore([]), 100);
  assert.equal(
    aiScore([
      { severity: "blocker" },
      { severity: "major" },
      { severity: "minor" },
      { severity: "info" },
    ]),
    62,
  );
  assert.equal(
    aiScore(
      Array.from({ length: 5 }, () => ({ severity: "blocker" as const })),
    ),
    0,
  );
});

void test("edits replace exact quotes and refuse to guess when the quote is gone", () => {
  const content =
    "Retry on timeout.\n\n## Acceptance criteria\n\n- [ ] One charge";
  assert.equal(
    applyAiEdit(content, {
      section: "Intro",
      find: "Retry on timeout.",
      replace: "Retry once on timeout with the same key.",
    }),
    "Retry once on timeout with the same key.\n\n## Acceptance criteria\n\n- [ ] One charge",
  );
  assert.equal(
    applyAiEdit(content, { section: "Intro", find: "Not there", replace: "x" }),
    undefined,
  );
});

void test("appends under an existing section, before the next heading", () => {
  const content =
    "## Acceptance criteria\n\n- [ ] One charge\n\n## Notes\n\nKeep it simple.";
  assert.equal(
    applyAiEdit(content, {
      section: "Acceptance criteria",
      find: "",
      replace: "- [ ] Timeout returns 504",
    }),
    "## Acceptance criteria\n\n- [ ] One charge\n- [ ] Timeout returns 504\n\n## Notes\n\nKeep it simple.",
  );
});

void test("creates a missing section at the end", () => {
  assert.equal(
    applyAiEdit("Intent.", {
      section: "Failure behavior",
      find: "",
      replace: "Return 504 after 30 s.",
    }),
    "Intent.\n\n## Failure behavior\n\nReturn 504 after 30 s.\n",
  );
  assert.equal(
    applyAiEdit("Intent.", { section: "X", find: "", replace: "  " }),
    undefined,
  );
});
