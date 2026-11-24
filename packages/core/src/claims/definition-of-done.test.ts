import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autopilotMergeCandidate,
  definitionPasses,
  evaluateDefinitionOfDone,
} from "@lictory/core/claims/definition-of-done";
import {
  autonomyPolicyInputSchema,
  defaultAutonomyPolicy,
  defaultDoneChecks,
  doneChecksSchema,
  type DoneCheckDefinition,
} from "@lictory/core/claims/contracts";
import type {
  CodeEvidence,
  CodePullRequestEvidence,
} from "@lictory/core/claims/ports";

const pr = (
  state: CodePullRequestEvidence["state"],
  overrides: Partial<CodePullRequestEvidence> = {},
): CodePullRequestEvidence => ({
  id: `pr-${state}`,
  title: `${state} change`,
  url: null,
  state,
  headSha: "abc",
  checks: { required: 1, failing: [], pending: [] },
  approvals: [],
  mergeable: true,
  ...overrides,
});
const evaluate = (
  code: CodeEvidence,
  checks: DoneCheckDefinition[] = defaultDoneChecks,
  reviewer: { id: string; name: string } | null = null,
) =>
  evaluateDefinitionOfDone({
    checks,
    code,
    reviewerAgent: reviewer,
    signOffs: new Map(),
  });

void test("without a code host, code checks explain why they cannot pass", () => {
  const results = evaluate({ connected: false, explanation: "Connect one." });
  assert.equal(definitionPasses(results), false);
  assert.deepEqual(
    results.map((r) => r.detail),
    ["Connect one.", "Connect one."],
  );
});

void test("merged and green passes; an abandoned pull request does not count", () => {
  assert.equal(
    definitionPasses(
      evaluate({ connected: true, pullRequests: [pr("merged"), pr("closed")] }),
    ),
    true,
  );
  const open = evaluate({
    connected: true,
    pullRequests: [pr("merged"), pr("open")],
  });
  assert.equal(open[0]!.passed, false);
  assert.match(open[0]!.detail!, /still open/);
  const failing = evaluate({
    connected: true,
    pullRequests: [
      pr("merged", { checks: { required: 2, failing: ["ci"], pending: [] } }),
    ],
  });
  assert.equal(failing[1]!.passed, false);
  assert.match(failing[1]!.detail!, /Failing: ci/);
});

void test("code review names the reviewer agent and needs its approval of the head", () => {
  const checks: DoneCheckDefinition[] = [
    { id: "review", kind: "code_review_approved" },
  ];
  const reviewer = { id: "lens", name: "Lens" };
  const byPerson = evaluate(
    {
      connected: true,
      pullRequests: [
        pr("open", { approvals: [{ agentId: null, userId: "u" }] }),
      ],
    },
    checks,
    reviewer,
  );
  assert.equal(byPerson[0]!.label, "Lens approved the head commit");
  assert.equal(byPerson[0]!.passed, false);
  // Without a reviewer agent any approval counts.
  assert.equal(
    evaluate(
      {
        connected: true,
        pullRequests: [
          pr("open", { approvals: [{ agentId: null, userId: "u" }] }),
        ],
      },
      checks,
    )[0]!.passed,
    true,
  );
});

void test("overrides pass a check by hand and are reported as such", () => {
  const results = evaluateDefinitionOfDone({
    checks: defaultDoneChecks,
    code: { connected: false, explanation: "None." },
    reviewerAgent: null,
    signOffs: new Map([
      [
        "pull_request_merged",
        {
          kind: "override",
          userId: "ada",
          createdAt: "2026-11-20T10:00:00.000Z",
          reason: "Documentation only.",
        },
      ],
    ]),
  });
  assert.equal(results[0]!.passed, true);
  assert.equal(results[0]!.override?.reason, "Documentation only.");
  assert.equal(results[1]!.passed, false);
});

void test("Autopilot merges one open pull request only when its requirements pass", () => {
  const policy = {
    ...defaultAutonomyPolicy,
    level: "autopilot" as const,
    implementerAgentIds: ["forge"],
    reviewerAgentId: "lens",
  };
  const reviewer = { id: "lens", name: "Lens" };
  const approved = pr("open", {
    approvals: [{ agentId: "lens", userId: null }],
  });
  const code: CodeEvidence = { connected: true, pullRequests: [approved] };
  const results = evaluate(code);
  const ready = autopilotMergeCandidate(results, code, policy, reviewer);
  assert.equal(ready.ready, true);
  assert.equal(
    autopilotMergeCandidate(
      results,
      { connected: true, pullRequests: [approved, pr("open")] },
      policy,
      reviewer,
    ).ready,
    false,
  );
  assert.equal(
    autopilotMergeCandidate(
      results,
      code,
      { ...policy, level: "build" },
      reviewer,
    ).ready,
    false,
  );
  const unapproved: CodeEvidence = {
    connected: true,
    pullRequests: [pr("open")],
  };
  const refused = autopilotMergeCandidate(
    evaluate(unapproved),
    unapproved,
    policy,
    reviewer,
  );
  assert.ok(!refused.ready && refused.reason.includes("Lens has not approved"));
});

void test("policies and definitions validate what people can choose", () => {
  assert.equal(
    autonomyPolicyInputSchema.safeParse({
      ...defaultAutonomyPolicy,
      level: "build",
    }).success,
    false,
  );
  assert.equal(
    autonomyPolicyInputSchema.safeParse({
      ...defaultAutonomyPolicy,
      level: "autopilot",
      implementerAgentIds: ["forge"],
      autopilotRequires: ["code_review_approved"],
    }).success,
    false,
  );
  assert.equal(
    doneChecksSchema.safeParse([
      { id: "a", kind: "checks_passed" },
      { id: "b", kind: "checks_passed" },
    ]).success,
    false,
  );
  assert.equal(doneChecksSchema.safeParse([]).success, true);
});
