import type { SpacePublishing } from "@lictory/core/contracts/protocol";

// How history names the reviewers recorded on a merge commit. "Approved" is
// a claim about the space's policy: only Reviewed spaces require approvals
// to publish, so only they say it. In Direct spaces the same people are
// shown neutrally as reviewers (a pull request may still have been
// reviewed there, but nobody's approval was needed).
export type CommitReview = {
  // The short badge on the version.
  badge: string;
  // The sentence that names the people.
  line: string;
  // Reviewed spaces only: the published version carries the approval.
  approved: boolean;
};

export function commitReview(
  publishing: SpacePublishing,
  approverNames: readonly string[],
): CommitReview | null {
  if (!approverNames.length) return null;
  const names = approverNames.join(", ");
  return publishing === "reviewed"
    ? { badge: "Approved", line: `Approved by ${names}`, approved: true }
    : { badge: "Reviewed", line: `Reviewed by ${names}`, approved: false };
}
