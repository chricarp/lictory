import assert from "node:assert/strict";
import { test } from "node:test";
import { describeNotification } from "@lictory/core/notifications/format";

void test("a quoted title that quotes something itself ends in one closing mark", () => {
  const { headline } = describeNotification(
    {
      kind: "suggestion_decided",
      detail: {
        decision: "approved",
        itemKey: "PAY-5",
        suggestionTitle: "Change “until the captured amount is used up”",
      },
    },
    "Ada",
  );
  assert.equal(
    headline,
    "Ada approved “Change ‘until the captured amount is used up’” on PAY-5",
  );
  const straight = describeNotification(
    {
      kind: "suggestion_review_requested",
      detail: { itemKey: "PAY-5", suggestionTitle: 'Say "refund"' },
    },
    "Ada",
  ).headline;
  assert.equal(straight, "Ada asked you to review “Say ‘refund’” on PAY-5");
});
