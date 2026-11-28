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

void test("a commit the code host reported no checks for is no evidence that CI passed", () => {
  const silent = evaluate({
    connected: true,
    pullRequests: [
      pr("merged", { checks: { required: 0, failing: [], pending: [] } }),
    ],
  });
  assert.equal(silent[1]!.passed, false);
  assert.match(
    silent[1]!.detail!,
    /The code host has reported no checks for the head commit of “merged change”/,
  );
  assert.equal(definitionPasses(silent), false);
  // Checks the host reports but marks optional are not required checks.
  const optional = evaluate({
    connected: true,
    pullRequests: [
      pr("merged", {
        checks: { required: 0, failing: [], pending: [], reported: 2 },
      }),
    ],
  });
  assert.equal(optional[1]!.passed, false);
  assert.match(optional[1]!.detail!, /marks none of the checks/);
  // Autopilot waits for CI instead of merging before it reported.
  const approved = pr("open", {
    approvals: [{ agentId: "lens", userId: null }],
    checks: { required: 0, failing: [], pending: [] },
  });
  const code: CodeEvidence = { connected: true, pullRequests: [approved] };
  const waiting = autopilotMergeCandidate(
    evaluate(code),
    code,
    {
      ...defaultAutonomyPolicy,
      level: "autopilot",
      implementerAgentIds: ["forge"],
      reviewerAgentId: "lens",
    },
    { id: "lens", name: "Lens" },
  );
  assert.ok(
    !waiting.ready &&
      waiting.reason.includes("reported no checks") &&
      waiting.reason.includes("Autopilot merges only after CI passes"),
  );
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
