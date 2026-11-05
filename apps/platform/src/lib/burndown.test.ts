import assert from "node:assert/strict";
import { test } from "node:test";
import {
  burndownFrame,
  burndownUsesPoints,
} from "@lictory/platform/lib/burndown";

const tally = (count: number, points: number) => ({ count, points });
const report = (points: number) => ({
  series: [
    {
      at: "2026-11-05T00:00:00.000Z",
      scope: points,
      remaining: points,
      scopeCount: 3,
      remainingCount: 3,
    },
    {
      at: "2026-11-06T00:00:00.000Z",
      scope: points,
      remaining: points,
      scopeCount: 3,
      remainingCount: 2,
    },
  ],
  totals: {
    atStart: tally(3, points),
    final: tally(3, points),
    completed: tally(1, 0),
    addedAfterStart: tally(0, 0),
    removedAfterStart: tally(0, 0),
  },
});

void test("an iteration with no estimates burns down in items", () => {
  assert.equal(burndownUsesPoints(report(0), "fibonacci"), false);
  assert.equal(burndownUsesPoints(report(8), "fibonacci"), true);
  // Projects without estimates never use points.
  assert.equal(burndownUsesPoints(report(8), "none"), false);
});

void test("the burndown spans the whole iteration, not just the samples so far", () => {
  const samples = [
    { at: new Date("2026-11-05T09:00:00Z"), scope: 3, remaining: 3 },
    { at: new Date("2026-11-06T09:00:00Z"), scope: 3, remaining: 2 },
  ];
  const frame = burndownFrame(samples, {
    startsAt: "2026-11-05T00:00:00.000Z",
    endsAt: "2026-11-19T00:00:00.000Z",
  });
  assert.equal(frame.start, Date.parse("2026-11-05T00:00:00.000Z"));
  // The ideal pace reaches zero at the iteration's end, not today.
  assert.equal(frame.end, Date.parse("2026-11-19T00:00:00.000Z"));
  // Without the iteration, the samples are the frame.
  assert.equal(burndownFrame(samples).end, Date.parse("2026-11-06T09:00:00Z"));
});

void test("burndown ticks never repeat on a small scale", () => {
  const frame = burndownFrame([
    { at: new Date("2026-11-05T09:00:00Z"), scope: 1, remaining: 1 },
    { at: new Date("2026-11-05T10:00:00Z"), scope: 1, remaining: 0 },
  ]);
  assert.deepEqual(frame.ticks, [0, 1]);
});
