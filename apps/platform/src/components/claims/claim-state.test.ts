import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimBadgeLabel,
  claimFor,
  claimShownState,
  claimState,
  claimWaitsOnPeople,
} from "@lictory/platform/components/claims/claim-state";

const claim = (
  state: "starting" | "active" | "waiting",
  extra: { waitingThreadIds?: string[]; sessionWaitingSince?: string } = {},
) => ({
  agentName: "Forge",
  ownerId: "ada",
  state,
  waitingThreadIds: extra.waitingThreadIds ?? [],
  sessionWaitingSince: extra.sessionWaitingSince ?? null,
});

void test("a working claim runs in the info tone", () => {
  const state = claimState(claim("active"), "Ada Lovelace");
  assert.equal(state.label, "Running");
  assert.equal(state.tone, "info");
  assert.equal(state.needsPerson, false);
  assert.equal(
    claimBadgeLabel(claim("active"), "Ada Lovelace"),
    "Forge · running",
  );
});

void test("a claim whose session waits on an approval waits on its owner, never 'Working'", () => {
  const waiting = claim("active", {
    sessionWaitingSince: "2026-11-24T10:00:00Z",
  });
  const state = claimState(waiting, "Ada Lovelace");
  assert.equal(state.label, "Waiting on Ada");
  assert.equal(state.tone, "attention");
  assert.equal(state.needsPerson, true);
  assert.equal(claimShownState(waiting), "session_waiting");
  assert.equal(claimWaitsOnPeople(waiting), true);
  assert.equal(
    claimBadgeLabel(waiting, "Ada Lovelace"),
    "Forge · waiting on Ada",
  );
});

void test("questions on the specification wait on whoever resolves them", () => {
  const asked = claim("waiting", { waitingThreadIds: ["t1"] });
  const state = claimState(asked, "Ada Lovelace");
  assert.equal(state.label, "Waiting on people");
  assert.equal(state.tone, "attention");
  assert.equal(claimShownState(asked), "waiting");
});

void test("a starting claim is in motion, not waiting", () => {
  const state = claimState(claim("starting"));
  assert.equal(state.label, "Starting");
  assert.equal(state.glyph, "starting");
  assert.equal(claimWaitsOnPeople(claim("starting")), false);
});

void test("an item assigned to someone other than the agent's owner is worked for them", () => {
  const name = (id: string) =>
    ({ ben: "Ben Ortiz", ada: "Ada Lovelace" })[id] ?? id;
  assert.equal(claimFor({ ownerId: "ada" }, "ben", name), "for Ben");
  assert.equal(claimFor({ ownerId: "ada" }, "ada", name), null);
  assert.equal(claimFor({ ownerId: "ada" }, null, name), null);
});
