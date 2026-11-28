import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activitySubject,
  foldActivity,
} from "@lictory/platform/components/review/activity-subject";

void test("an agent's act is shown as the agent acting for its person", () => {
  const review = activitySubject(
    "code_review_approved",
    { performedVia: "Hawk", agentId: "hawk" },
    "Bo Engineer",
  );
  assert.equal(review.kind, "agent");
  assert.equal(review.name, "Hawk via Bo Engineer");
  const moved = activitySubject(
    "status_changed",
    { performedVia: "runner", agentName: "Forge", automation: "dispatcher" },
    "Ada Owner",
  );
  assert.equal(moved.name, "Forge via Ada Owner");
  // Litto and MCP keep the person as the subject, named after it.
  assert.equal(
    activitySubject("revised", { performedVia: "mcp" }, "Ada").kind,
    "person",
  );
});

void test("automation is the subject of what it did, with the person it acted for", () => {
  const done = activitySubject(
    "status_changed",
    { automation: "definition_of_done" },
    "Ada Owner",
  );
  assert.deepEqual(
    [done.kind, done.name, done.after],
    ["system", "Definition of Done", "for Ada Owner"],
  );
  const merged = activitySubject(
    "code_pull_request_merged",
    { automation: "autopilot" },
    "Ada Owner",
  );
  assert.deepEqual(
    [merged.name, merged.after],
    ["Autopilot", "policy set by Ada Owner"],
  );
  const ready = activitySubject(
    "refinement_changed",
    { automatic: true },
    "Ben QA",
  );
  assert.deepEqual(
    [ready.kind, ready.name, ready.after],
    ["system", "Lictory", "after a change by Ben QA"],
  );
});

void test("the factory loop's entries read in the same shape: the agent for its person, or the automation", () => {
  const claimed = activitySubject(
    "claimed",
    { performedVia: "runner", agentName: "Forge", automation: "dispatcher" },
    "Ada Owner",
  );
  assert.deepEqual(
    [claimed.kind, claimed.name],
    ["agent", "Forge via Ada Owner"],
  );
  const completed = activitySubject(
    "claim_completed",
    { agentName: "Forge", reason: "definition_of_done" },
    "Ada Owner",
  );
  assert.deepEqual(
    [completed.kind, completed.name, completed.after],
    ["system", "Definition of Done", "for Ada Owner"],
  );
  const merge = activitySubject(
    "autopilot_merge_requested",
    { agentName: "Forge" },
    "Ada Owner",
  );
  assert.deepEqual(
    [merge.kind, merge.name, merge.after],
    ["system", "Autopilot", "policy set by Ada Owner"],
  );
  // A person releasing an agent's claim is the person's act.
  assert.equal(
    activitySubject(
      "claim_released",
      { agentName: "Forge", reason: "person" },
      "Bo",
    ).kind,
    "person",
  );
});

void test("a suggestion its reviewer approved and accepted reads as one act", () => {
  const entry = (action: string, actorId: string, suggestionId = "s1") => ({
    action,
    actorId,
    detail: { suggestionId },
  });
  const folded = foldActivity([
    entry("suggestion_merged", "ilse"),
    entry("suggestion_approved", "ilse"),
    // Another reviewer's approval stays, and so does one never accepted.
    entry("suggestion_approved", "tomas"),
    entry("suggestion_approved", "ilse", "s2"),
  ]);
  assert.deepEqual(
    folded.map((e) => `${e.action}:${e.actorId}:${e.detail.suggestionId}`),
    [
      "suggestion_merged:ilse:s1",
      "suggestion_approved:tomas:s1",
      "suggestion_approved:ilse:s2",
    ],
  );
});
