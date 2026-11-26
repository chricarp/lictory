import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimBadgeLabel,
  claimFor,
  claimShownState,
  claimState,
  claimWaitsOnPeople,
  deliveredEvidence,
  pullRequestStripPart,
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

const evaluated = (
  ...pulls: {
    state: "open" | "merged" | "closed";
    checks?: "passing" | "pending" | "failing" | "none";
  }[]
) => ({
  code: {
    connected: true,
    explanation: null,
    pullRequests: pulls.map((p, i) => ({
      id: `pr${i}`,
      title: `acme/pay#${i + 1} Refund endpoint`,
      url: null,
      headSha: "abc",
      ...p,
    })),
  },
});

void test("the strip says checks are running, never failing, while CI is pending", () => {
  const part = pullRequestStripPart(
    evaluated({ state: "open", checks: "pending" }),
  );
  assert.equal(part?.label, "PR open · checks running");
  assert.equal(part?.tone, "info");
});

void test("only a check the code host reported as failed reads failing", () => {
  const part = pullRequestStripPart(
    evaluated({ state: "open", checks: "failing" }),
  );
  assert.equal(part?.label, "PR open · checks failing");
  assert.equal(part?.tone, "danger");
});

void test("an evaluation without check states claims nothing about the checks", () => {
  const part = pullRequestStripPart(evaluated({ state: "open" }));
  assert.equal(part?.label, "PR open");
  assert.equal(part?.tone, "info");
});

void test("the open pull request speaks before a merged one; closed ones are not shown", () => {
  assert.equal(
    pullRequestStripPart(
      evaluated({ state: "merged" }, { state: "open", checks: "passing" }),
    )?.label,
    "PR open · checks pass",
  );
  assert.equal(
    pullRequestStripPart(evaluated({ state: "merged" }))?.label,
    "PR merged",
  );
  assert.equal(pullRequestStripPart(evaluated({ state: "closed" })), null);
  assert.equal(pullRequestStripPart(undefined), null);
});

void test("a Done item keeps the evidence its Definition of Done moved it on", () => {
  const passed = {
    action: "definition_of_done_passed",
    createdAt: "2026-11-20T10:00:00.000Z",
    detail: {
      checks: [
        {
          key: "merged",
          label: "Merged",
          overridden: false,
          detail: "#1 merged.",
        },
        { key: "ci", label: "CI passed", overridden: true },
      ],
      pullRequests: [
        {
          title: "acme/api#1 Retries",
          url: null,
          state: "merged",
          headSha: "abc",
        },
      ],
    },
  };
  const toDone = {
    action: "status_changed",
    createdAt: "2026-11-20T10:00:00.000Z",
    detail: { category: "done" },
  };
  // Same instant, listed in either order: the record precedes its move.
  for (const activity of [
    [passed, toDone],
    [toDone, passed],
  ]) {
    const evidence = deliveredEvidence(activity);
    assert.equal(evidence?.checks.length, 2);
    assert.equal(evidence?.checks[0]?.detail, "#1 merged.");
    assert.equal(evidence?.checks[1]?.overridden, true);
    assert.equal(evidence?.pullRequests[0]?.state, "merged");
  }
  // Reopened and then moved to Done by a person: the old record no longer
  // explains why it is Done.
  assert.equal(
    deliveredEvidence([
      passed,
      toDone,
      {
        action: "status_changed",
        createdAt: "2026-11-21T10:00:00.000Z",
        detail: { category: "started" },
      },
      {
        action: "status_changed",
        createdAt: "2026-11-22T10:00:00.000Z",
        detail: { category: "done" },
      },
    ]),
    undefined,
  );
  assert.equal(deliveredEvidence([]), undefined);
});
