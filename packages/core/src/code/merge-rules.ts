import { codePullRequest } from "@lictory/core/contracts/state-machines";

// Why Lictory would not merge a pull request now, in the words the person
// reads. Shared by the merge command (which refuses with the first reason),
// the autopilot executor and the browser (which explains a disabled merge
// button). The code host's own branch protection applies on top.

export type ReviewDecision =
  "approved" | "changes_requested" | "review_required" | "none";

export type MergeCandidate = {
  state: "open" | "closed" | "merged";
  draft: boolean;
  headSha: string;
  checks: { state: "pending" | "success" | "failure" | "none" };
  // The code host's own review decision.
  reviewDecision: ReviewDecision;
  mergeable: boolean | null;
  // Reviews recorded in Lictory (people's and agents'), the latest of each
  // reviewer; only those of the head count.
  reviews?: readonly {
    decision: "approve" | "request_changes";
    headSha: string;
  }[];
  // A project this pull request delivers work for requires CI to pass in
  // its Definition of Done: no reported check is then no evidence, and the
  // merge waits for CI as Autopilot does.
  ciRequired?: boolean;
};

// One answer to "is it reviewed?": the host's decision and the reviews
// recorded in Lictory for the head commit. Requested changes outweigh an
// approval, as on the hosts.
export function reviewState(
  pr: Pick<MergeCandidate, "reviewDecision" | "reviews" | "headSha">,
): ReviewDecision {
  const head = (pr.reviews ?? []).filter((r) => r.headSha === pr.headSha);
  if (
    pr.reviewDecision === "changes_requested" ||
    head.some((r) => r.decision === "request_changes")
  )
    return "changes_requested";
  if (
    pr.reviewDecision === "approved" ||
    head.some((r) => r.decision === "approve")
  )
    return "approved";
  return pr.reviewDecision;
}

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
  if (pr.checks.state === "none" && pr.ciRequired)
    blockers.push(
      "The Definition of Done requires CI to pass, and the code host has reported no checks for this commit yet.",
    );
  if (reviewState(pr) === "changes_requested")
    blockers.push("A reviewer requested changes.");
  if (pr.mergeable === false)
    blockers.push("It conflicts with its base branch.");
  return blockers;
}
