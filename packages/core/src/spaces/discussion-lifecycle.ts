// Which page discussions end with the line they were written on
// (docs/internals/spaces.md#when-a-line-ends). A deleted branch takes every
// discussion written on it with it, open or resolved, blocking or not; a
// merged pull request takes the discussions of its source and its own. The
// server removes exactly what these functions select, and projects the
// counts so people are told before they confirm. Pure: the merge command,
// the projections and the repair of older data share it.

export type LineThread = {
  id: string;
  status: "open" | "resolved";
  blocking: boolean;
  // The line the thread was written on, if any.
  branchId: string | null;
  // The pull request it was opened on, and that pull request's source.
  pullRequestId: string | null;
  pullRequestSourceBranchId: string | null;
};

export type DiscussionCounts = {
  open: number;
  openBlocking: number;
  resolved: number;
  resolvedBlocking: number;
};

// A thread's line: its branch, or (written on a pull request without a
// branch) the pull request's source.
const lineOf = (t: LineThread) => t.branchId ?? t.pullRequestSourceBranchId;

// The discussions that go when `branchId` is deleted: written on it, or on a
// pull request from it without naming another line.
export function discussionsOfDeletedBranch<T extends LineThread>(
  threads: readonly T[],
  branchId: string,
) {
  return threads.filter((t) => lineOf(t) === branchId);
}

// The discussions that go when `pullRequest` merges: those of its source
// line and its own, unless they belong to another line (an explicit branch
// that is not the source) or, while the source stays, to another pull
// request that still uses it. When the merge retires the source, everything
// on it goes, as for a deleted branch.
export function discussionsOfMerge<T extends LineThread>(
  threads: readonly T[],
  pullRequest: { id: string; sourceBranchId: string },
  sourceRetired: boolean,
) {
  const source = pullRequest.sourceBranchId;
  return threads.filter((t) => {
    if (t.branchId !== null && t.branchId !== source) return false;
    if (t.pullRequestId === pullRequest.id) return true;
    if (lineOf(t) !== source) return false;
    return sourceRetired || t.pullRequestId === null;
  });
}

// Threads written on a line that no longer exists: what a deleted branch
// should have taken with it. They block nothing and are removed by the repair
// of older data (`removeOrphanedPageDiscussions`).
export function onDeletedLine(
  t: LineThread,
  liveBranchIds: ReadonlySet<string>,
) {
  const line = lineOf(t);
  return line !== null && !liveBranchIds.has(line);
}

export function discussionCounts(
  threads: readonly LineThread[],
): DiscussionCounts {
  const counts = { open: 0, openBlocking: 0, resolved: 0, resolvedBlocking: 0 };
  for (const t of threads)
    if (t.status === "open") {
      counts.open++;
      if (t.blocking) counts.openBlocking++;
    } else {
      counts.resolved++;
      if (t.blocking) counts.resolvedBlocking++;
    }
  return counts;
}

export const discussionTotal = (c: DiscussionCounts) => c.open + c.resolved;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// "3 discussions (2 open, 1 of them blocking; 1 resolved)": the English
// summary shown before a branch is deleted or a pull request merged.
export function describeDiscussions(c: DiscussionCounts) {
  const total = discussionTotal(c);
  if (!total) return "no discussions";
  const part = (n: number, state: string, blocking: number) =>
    n
      ? `${n} ${state}${blocking ? `, ${blocking === n ? (n === 1 ? "blocking" : "all blocking") : `${blocking} of them blocking`}` : ""}`
      : null;
  const parts = [
    part(c.open, "open", c.openBlocking),
    part(c.resolved, "resolved", c.resolvedBlocking),
  ].filter(Boolean);
  return `${plural(total, "discussion", "discussions")} (${parts.join("; ")})`;
}
