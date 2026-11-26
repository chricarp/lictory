import assert from "node:assert/strict";
import { test } from "node:test";
import {
  setupSteps,
  type SetupFacts,
} from "@lictory/platform/components/shell/home/setup";

const empty: SetupFacts = {
  codeConnections: [],
  runners: [],
  agents: [],
  channels: [],
  members: 1,
  invited: 0,
};

const done = (facts: SetupFacts, admin = true) =>
  Object.fromEntries(
    setupSteps(facts, "acme", admin).steps.map((s) => [s.id, s.done]),
  );

void test("a new organization has every step to do, in order", () => {
  const result = setupSteps(empty, "acme", true);
  assert.deepEqual(
    result.steps.map((s) => s.id),
    ["code", "runner", "agent", "channel", "team"],
  );
  assert.equal(result.done, 0);
  assert.equal(result.complete, false);
});

void test("each step is done by the data it sets up", () => {
  assert.equal(
    done({ ...empty, codeConnections: [{ status: "active" }] }).code,
    true,
  );
  // A connection whose credentials stopped working is not set up.
  assert.equal(
    done({ ...empty, codeConnections: [{ status: "invalid" }] }).code,
    false,
  );
  assert.equal(
    done({
      ...empty,
      runners: [{ lastSeenAt: "2026-11-24T10:00:00Z", revokedAt: null }],
    }).runner,
    true,
  );
  // Registered but never connected, or revoked, is not.
  assert.equal(
    done({
      ...empty,
      runners: [
        { lastSeenAt: null, revokedAt: null },
        {
          lastSeenAt: "2026-11-24T10:00:00Z",
          revokedAt: "2026-11-24T11:00:00Z",
        },
      ],
    }).runner,
    false,
  );
  assert.equal(
    done({ ...empty, agents: [{ archivedAt: "2026-11-24" }] }).agent,
    false,
  );
  assert.equal(done({ ...empty, agents: [{ archivedAt: null }] }).agent, true);
  // A direct conversation is not a channel.
  assert.equal(
    done({ ...empty, channels: [{ kind: "direct", archivedAt: null }] })
      .channel,
    false,
  );
  assert.equal(
    done({ ...empty, channels: [{ kind: "public", archivedAt: null }] })
      .channel,
    true,
  );
  assert.equal(done({ ...empty, members: 2 }).team, true);
});

void test("the checklist is complete when everything exists", () => {
  const result = setupSteps(
    {
      codeConnections: [{ status: "active" }],
      runners: [{ lastSeenAt: "2026-11-24T10:00:00Z", revokedAt: null }],
      agents: [{ archivedAt: null }],
      channels: [{ kind: "private", archivedAt: null }],
      members: 4,
      invited: 0,
    },
    "acme",
    false,
  );
  assert.equal(result.complete, true);
  assert.equal(result.done, 5);
});

void test("steps only administrators can take offer no action to others", () => {
  const steps = setupSteps(empty, "acme", false).steps;
  const action = Object.fromEntries(steps.map((s) => [s.id, s.action]));
  assert.equal(action.code, null);
  assert.equal(action.team, null);
  assert.equal(action.agent?.href, "/acme/factory/agents");
  assert.equal(action.channel?.href, "/acme/channels");
});

void test("inviting someone completes the team step before they join", () => {
  const result = setupSteps({ ...empty, invited: 2 }, "acme", true);
  const team = result.steps.find((s) => s.id === "team")!;
  assert.equal(team.done, true);
  assert.equal(team.note, "2 invited, not joined yet");
  const joined = setupSteps({ ...empty, members: 3, invited: 1 }, "acme", true);
  assert.equal(joined.steps.find((s) => s.id === "team")!.note, undefined);
});
