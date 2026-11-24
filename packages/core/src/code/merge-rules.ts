import { codePullRequest } from "@lictory/core/contracts/state-machines";

// Why Lictory would not merge a pull request now, in the words the person
// reads. Shared by the merge command (which refuses with the first reason),
// the autopilot executor and the browser (which explains a disabled merge
// button). The code host's own branch protection applies on top.

export type MergeCandidate = {
  state: "open" | "closed" | "merged";
  draft: boolean;
  checks: { state: "pending" | "success" | "failure" | "none" };
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
  mergeable: boolean | null;
};

export function mergeBlockers(pr: MergeCandidate): string[] {
  const refusal = codePullRequest.refusal(pr.state, "merge");
  if (refusal) return [refusal];
  if (pr.state !== "open") return [];
  const blockers: string[] = [];
  if (pr.draft)
    blockers.push(
      "It is a draft. Mark it ready for review on the code host first.",
    );
  if (pr.checks.state === "failure") blockers.push("Checks are failing.");
  if (pr.checks.state === "pending") blockers.push("Checks are still running.");
  if (pr.reviewDecision === "changes_requested")
    blockers.push("A reviewer requested changes.");
  if (pr.mergeable === false)
    blockers.push("It conflicts with its base branch.");
  return blockers;
}
