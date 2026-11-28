import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionState } from "@lictory/platform/lib/session-state";

const claim = (
  state: "starting" | "active" | "waiting",
  waitingThreadIds: string[] = [],
) => ({ state, waitingThreadIds });

void test("each session status has one label and one tone", () => {
  const cases = [
    ["queued", "Queued", "neutral"],
    ["assigned", "Starting", "info"],
    ["running", "Running", "info"],
    ["waiting", "Waiting on a person", "attention"],
    ["completed", "Completed", "success"],
    ["failed", "Failed", "danger"],
    ["canceled", "Canceled", "neutral"],
  ] as const;
  for (const [status, label, tone] of cases) {
    const state = sessionState({ status });
    assert.equal(state.label, label, status);
    assert.equal(state.tone, tone, status);
  }
});

void test("a session waiting on a known person names them by first name", () => {
  const state = sessionState(
    { status: "waiting" },
    { decider: "Ada Lovelace" },
  );
  assert.equal(state.label, "Waiting on Ada");
  assert.equal(state.tone, "attention");
  assert.equal(state.needsPerson, true);
});

void test("a claim whose session waits on a person waits on that person, never 'Working'", () => {
  const state = sessionState(
    { status: "waiting" },
    { claim: claim("active"), decider: "Ada Lovelace" },
  );
  assert.equal(state.label, "Waiting on Ada");
  assert.equal(state.tone, "attention");
  assert.equal(state.active, true);
});

void test("the session's state wins over the claim's own", () => {
  assert.equal(
    sessionState({ status: "running" }, { claim: claim("starting") }).label,
    "Running",
  );
  assert.equal(
    sessionState({ status: "failed" }, { claim: claim("active") }).tone,
    "danger",
  );
});

void test("a claim with unresolved questions needs a person even while its session runs", () => {
  const state = sessionState(
    { status: "running" },
    { claim: claim("active", ["thread-1"]) },
  );
  assert.equal(state.tone, "info");
  assert.equal(state.needsPerson, true);
});

void test("a claim without a visible session reads from the claim", () => {
  assert.equal(
    sessionState(null, { claim: claim("starting") }).label,
    "Starting",
  );
  const waiting = sessionState(null, { claim: claim("active", ["t"]) });
  assert.equal(waiting.label, "Waiting on people");
  assert.equal(waiting.tone, "attention");
});

void test("finished sessions are not active", () => {
  for (const status of ["completed", "failed", "canceled"] as const)
    assert.equal(sessionState({ status }).active, false);
  assert.equal(sessionState(null).active, false);
});

void test("a completed session whose changes were discarded reads as work not kept, never success", () => {
  const unkept = sessionState({ status: "completed", discardedFiles: 1 });
  assert.equal(unkept.label, "Work not kept");
  assert.equal(unkept.tone, "attention");
  assert.equal(unkept.active, false);
  assert.match(unkept.meaning, /the file it changed was discarded/);
  // A session that changed nothing, or kept its work, completed.
  for (const discardedFiles of [null, 0, undefined])
    assert.equal(
      sessionState({ status: "completed", discardedFiles }).label,
      "Completed",
    );
  // A failure stays a failure.
  assert.equal(
    sessionState({ status: "failed", discardedFiles: 2 }).label,
    "Failed",
  );
});
