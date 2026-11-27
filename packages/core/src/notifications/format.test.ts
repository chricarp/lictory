import assert from "node:assert/strict";
import { test } from "node:test";
import { describeNotification } from "@lictory/core/notifications/format";

void test("a quoted title that quotes text nests its quotation marks instead of doubling them", () => {
  assert.equal(
    describeNotification(
      {
        kind: "suggestion_merged",
        detail: {
          itemKey: "PAY-5",
          merged: true,
          suggestionTitle: "Change “until the captured amount is used up”",
        },
      },
      "Ada",
    ).headline,
    "Ada accepted “Change ‘until the captured amount is used up’” on PAY-5",
  );
});
