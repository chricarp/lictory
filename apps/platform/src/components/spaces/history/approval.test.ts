import assert from "node:assert/strict";
import { test } from "node:test";
import { commitReview } from "@lictory/platform/components/spaces/history/approval";

void test("only Reviewed spaces call recorded reviewers approvals", () => {
  assert.deepEqual(commitReview("reviewed", ["Ada", "Ben"]), {
    badge: "Approved",
    line: "Approved by Ada, Ben",
    approved: true,
  });
  const direct = commitReview("direct", ["Ada"]);
  assert.deepEqual(direct, {
    badge: "Reviewed",
    line: "Reviewed by Ada",
    approved: false,
  });
  assert.doesNotMatch(JSON.stringify(direct), /Approved/);
  assert.equal(commitReview("reviewed", []), null);
  assert.equal(commitReview("direct", []), null);
});
