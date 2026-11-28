import {
  doneCheckLabel,
  type AutonomyPolicyInput,
  type DoneCheckDefinition,
  type DoneCheckResult,
} from "@lictory/core/claims/contracts";
import type {
  CodeEvidence,
  CodePullRequestEvidence,
} from "@lictory/core/claims/ports";

// Evaluates a work item against its project's Definition of Done from
// evidence: the Code module's mirror of pull requests and checks, and
// people's sign-offs and overrides for the item's revision. Pure, so the
// rule lives in one place; an agent's report is never an input.

export type DoneSignOffRecord = {
  kind: "sign_off" | "override";
  userId: string;
  createdAt: string;
  reason: string | null;
};

export type DoneEvaluationInput = {
  checks: DoneCheckDefinition[];
  code: CodeEvidence;
  reviewerAgent: { id: string; name: string } | null;
  // Active sign-offs and overrides for the item's revision, by check id.
  signOffs: Map<string, DoneSignOffRecord>;
};

// The pull requests code checks look at: the merged ones once any merged
// (what was delivered), otherwise the open ones (what will be). Closed
// pull requests were abandoned.
export function relevantPullRequests(prs: CodePullRequestEvidence[]) {
  const merged = prs.filter((pr) => pr.state === "merged");
  return merged.length ? merged : prs.filter((pr) => pr.state === "open");
}

const named = (pr: CodePullRequestEvidence) => `“${pr.title}”`;

// Why the CI check is not met when the host reported nothing to pass.
function noChecksDetail(prs: CodePullRequestEvidence[]) {
  const optional = prs.filter((pr) => (pr.checks.reported ?? 0) > 0);
  const first =
    prs.length === 1
      ? optional.length
        ? `The code host marks none of the checks on the head commit of ${named(prs[0]!)} as required.`
        : `The code host has reported no checks for the head commit of ${named(prs[0]!)}.`
      : `The code host has reported no required checks for the head commits of ${prs.map(named).join(", ")}.`;
  return `${first} A project without CI removes this check from its Definition of Done.`;
}

function approvedHead(
  pr: CodePullRequestEvidence,
  reviewer: { id: string } | null,
) {
  // With a reviewer agent named only its approval counts; otherwise any
  // approval of the head does (an agent's, a person's, or one on the host).
  return pr.approvals.some((a) =>
    reviewer
      ? a.agentId === reviewer.id
      : a.agentId !== null || Boolean(a.userId) || Boolean(a.login),
  );
}

function evaluateCode(
  check: DoneCheckDefinition,
  code: CodeEvidence,
  reviewer: { id: string; name: string } | null,
): { passed: boolean; detail: string } {
  if (!code.connected) return { passed: false, detail: code.explanation };
  const prs = code.pullRequests.filter((pr) => pr.state !== "closed");
  if (!prs.length)
    return {
      passed: false,
      detail:
        "No code pull request is linked to this item. Pull requests that name its key are linked automatically.",
    };
  const relevant = relevantPullRequests(prs);
  switch (check.kind) {
    case "pull_request_merged": {
      const open = prs.filter((pr) => pr.state === "open");
      const merged = prs.filter((pr) => pr.state === "merged");
      if (!merged.length)
        return {
          passed: false,
          detail: `Waiting for ${open.map(named).join(", ")} to be merged.`,
        };
      if (open.length)
        return {
          passed: false,
          detail: `${merged.map(named).join(", ")} merged; ${open.map(named).join(", ")} is still open.`,
        };
      return {
        passed: true,
        detail: `${merged.map(named).join(", ")} merged.`,
      };
    }
    case "checks_passed": {
      const failing = relevant.flatMap((pr) =>
        pr.checks.failing.map((name) => `${name} on ${named(pr)}`),
      );
      const pending = relevant.flatMap((pr) =>
        pr.checks.pending.map((name) => `${name} on ${named(pr)}`),
      );
      if (failing.length)
        return { passed: false, detail: `Failing: ${failing.join(", ")}.` };
      if (pending.length)
        return {
          passed: false,
          detail: `Still running: ${pending.join(", ")}.`,
        };
      // No reported check is no evidence that CI passed: the check waits
      // until the code host reports one for the head commit.
      const unreported = relevant.filter((pr) => pr.checks.required === 0);
      if (unreported.length)
        return { passed: false, detail: noChecksDetail(unreported) };
      const required = relevant.reduce((n, pr) => n + pr.checks.required, 0);
      return {
        passed: true,
        detail: `${required} required check${required === 1 ? "" : "s"} passed.`,
      };
    }
    case "code_review_approved": {
      const missing = relevant.filter((pr) => !approvedHead(pr, reviewer));
      if (missing.length)
        return {
          passed: false,
          detail: `${reviewer ? reviewer.name : "Nobody"} has not approved the head commit of ${missing.map(named).join(", ")}.`,
        };
      return {
        passed: true,
        detail: `${reviewer ? reviewer.name : "A reviewer"} approved the head commit.`,
      };
    }
    default:
      return { passed: false, detail: "Unknown check." };
  }
}

export function evaluateDefinitionOfDone(
  input: DoneEvaluationInput,
): DoneCheckResult[] {
  return input.checks.map((check) => {
    const record = input.signOffs.get(check.id);
    const override =
      record?.kind === "override"
        ? {
            by: record.userId,
            at: record.createdAt,
            reason: record.reason ?? "",
          }
        : null;
    const label = doneCheckLabel(check, input.reviewerAgent?.name);
    if (check.kind === "acceptance_verified") {
      const signed = record?.kind === "sign_off" ? record : undefined;
      return {
        key: check.id,
        kind: check.kind,
        label,
        passed: Boolean(signed) || Boolean(override),
        detail: signed
          ? undefined
          : "A person verifies the acceptance criteria and signs off.",
        signOff: {
          disciplineIds: check.disciplineIds,
          signedOffBy: signed?.userId ?? null,
          signedOffAt: signed?.createdAt ?? null,
        },
        override,
      };
    }
    const result = evaluateCode(check, input.code, input.reviewerAgent);
    return {
      key: check.id,
      kind: check.kind,
      label,
      passed: result.passed || Boolean(override),
      detail: result.detail,
      override,
    };
  });
}

export const definitionPasses = (results: DoneCheckResult[]) =>
  results.length > 0 && results.every((check) => check.passed);

// Autopilot: everything but the merge itself passes on exactly one open
// pull request, per the policy's requirements. Returns the pull request to
// merge, or why not.
export function autopilotMergeCandidate(
  results: DoneCheckResult[],
  code: CodeEvidence,
  policy: AutonomyPolicyInput,
  reviewer: { id: string; name: string } | null,
):
  | { ready: true; pullRequest: CodePullRequestEvidence }
  | { ready: false; reason: string } {
  if (policy.level !== "autopilot")
    return { ready: false, reason: "The project is not on Autopilot." };
  if (!code.connected) return { ready: false, reason: code.explanation };
  const open = code.pullRequests.filter((pr) => pr.state === "open");
  if (!open.length)
    return { ready: false, reason: "No open code pull request to merge." };
  if (open.length > 1)
    return {
      ready: false,
      reason:
        "Several code pull requests are open for this item; Autopilot merges only one. Merge them by hand.",
    };
  const pr = open[0]!;
  if (!pr.headSha)
    return { ready: false, reason: "The head commit is not known yet." };
  if (pr.mergeable === false)
    return {
      ready: false,
      reason: `${named(pr)} cannot be merged on the code host (conflicts or branch protection).`,
    };
  for (const requirement of policy.autopilotRequires) {
    if (requirement === "checks_passed") {
      if (pr.checks.failing.length || pr.checks.pending.length)
        return {
          ready: false,
          reason: `Required checks have not passed on ${named(pr)}.`,
        };
      // Autopilot never merges a commit CI has not reported on.
      if (pr.checks.required === 0)
        return {
          ready: false,
          reason: `The code host has reported no checks for the head commit of ${named(pr)}. Autopilot merges only after CI passes.`,
        };
    } else if (requirement === "code_review_approved") {
      if (!reviewer)
        return {
          ready: false,
          reason: "No reviewer agent is set in the autonomy policy.",
        };
      if (!approvedHead(pr, reviewer))
        return {
          ready: false,
          reason: `${reviewer.name} has not approved the head commit of ${named(pr)}.`,
        };
    } else {
      const failing = results.filter(
        (check) => !check.passed && check.kind !== "pull_request_merged",
      );
      if (failing.length)
        return {
          ready: false,
          reason: `Definition of Done checks still failing: ${failing.map((c) => c.label).join("; ")}.`,
        };
    }
  }
  return { ready: true, pullRequest: pr };
}
