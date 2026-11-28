import assert from "node:assert/strict";
import { test } from "node:test";
import { numberPatch } from "@lictory/platform/lib/patch";

void test("diff lines carry their numbers in the old and the new file", () => {
  const lines = numberPatch(
    [
      "@@ -10,4 +10,5 @@ export function refund(",
      " const amount = charge.amount;",
      "-if (amount > 0) {",
      "+if (amount > 0 && !charge.refunded) {",
      "+  audit(charge);",
      " return issue(amount);",
      "@@ -40 +41 @@",
      "-}",
      "+};",
      "\\ No newline at end of file",
    ].join("\n"),
  );
  assert.deepEqual(
    lines.map((l) => [l.kind, l.old, l.new]),
    [
      ["hunk", undefined, undefined],
      ["context", 10, 10],
      ["delete", 11, undefined],
      ["add", undefined, 11],
      ["add", undefined, 12],
      ["context", 12, 13],
      ["hunk", undefined, undefined],
      ["delete", 40, undefined],
      ["add", undefined, 41],
      ["note", undefined, undefined],
    ],
  );
});
