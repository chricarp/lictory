import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import {
  absoluteTime,
  formatDate,
  isReviewAskedOf,
  needsMyReview,
  relativeTime,
} from "@lictory/core/lib/work-items";

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

void test("dates read one way everywhere: relative, a short-month date, or a short-month date and time", () => {
  const at = "2026-11-27T04:50:49Z";
  const exact = absoluteTime(at);
  const day = formatDate(at);
  // Never the runtime's numeric default ("11/27/2026, 4:50:49 AM").
  for (const text of [exact, day]) {
    assert.doesNotMatch(text, /\d+\/\d+\/\d{4}/);
    assert.match(text, /2026/);
  }
  // Minutes, no seconds: the exact moment a person can read.
  assert.doesNotMatch(exact, /:\d{2}:\d{2}/);
  assert.ok(exact.startsWith(day.slice(0, 3)), `${exact} vs ${day}`);
  assert.equal(relativeTime(at, Date.parse(at) + 9 * 60_000), "9m ago");
  assert.equal(absoluteTime("not a date"), "");
});
