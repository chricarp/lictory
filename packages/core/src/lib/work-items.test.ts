import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { isReviewAskedOf, needsMyReview } from "@lictory/core/lib/work-items";

const engineering = "discipline-engineering";
const qa = "discipline-qa";
const review = (
  responsibility: string,
  assigneeIds: string[],
  status = "requested",
): WorkItem["reviews"][number] => ({
  id: `review-${responsibility}`,
  responsibility,
  status,
  required: true,
  assigneeIds,
  approved: false,
});

void test("a review is asked of a person by name or through one of their disciplines", () => {
  assert.equal(
    isReviewAskedOf(review("Engineering", [engineering]), "marco", [
      engineering,
    ]),
    true,
  );
  assert.equal(
    isReviewAskedOf(review("Security", ["marco"]), "marco", []),
    true,
  );
  // Another discipline's review is not this engineer's to give.
  assert.equal(
    isReviewAskedOf(review("QA", [qa]), "marco", [engineering]),
    false,
  );
});

void test("finished reviews are no longer asked of anyone", () => {
  for (const status of ["completed", "cancelled"])
    assert.equal(
      isReviewAskedOf(review("Engineering", [engineering], status), "marco", [
        engineering,
      ]),
      false,
    );
});

void test("an item waiting only on another discipline is not in my review queue", () => {
  const item = {
    archivedAt: null,
    suggestionReviewerIds: [],
    reviews: [review("QA", [qa])],
  } as unknown as WorkItem;
  assert.equal(needsMyReview(item, "marco", [engineering]), false);
  assert.equal(needsMyReview(item, "lena", [qa]), true);
});
