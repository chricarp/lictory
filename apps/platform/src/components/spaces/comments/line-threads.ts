import type { PageBranch } from "@lictory/platform/data/spaces";
import type { PageThread } from "@lictory/platform/components/spaces/comments/store";

// Which discussions belong to the line on screen, and how many are open on
// the page's other lines. Threads belong to the line they were written on
// (`branchId`; main also keeps threads written before lines were recorded,
// without one); pull request threads belong to their pull request. The
// header's count and the comments panel both come from here, so they always
// describe the same discussions.

export type LineRef = { branchId: string | undefined; isMain: boolean };

export function onLine(thread: PageThread, line: LineRef) {
  return (
    !thread.pullRequestId &&
    ((line.branchId !== undefined && thread.branchId === line.branchId) ||
      (line.isMain && thread.branchId === null))
  );
}

// The line's threads, open and resolved.
export function lineThreads(threads: readonly PageThread[], line: LineRef) {
  return threads.filter((t) => onLine(t, line));
}

export type OpenCount = { open: number; blocking: number };

function openCount(threads: readonly PageThread[]): OpenCount {
  let open = 0;
  let blocking = 0;
  for (const t of threads)
    if (t.status === "open") {
      open += 1;
      if (t.blocking) blocking += 1;
    }
  return { open, blocking };
}

export type OtherLine = OpenCount & { branch: PageBranch };

export type LineDiscussionCounts = OpenCount & {
  // Live lines of the page other than the one on screen that have open
  // discussions, main first, then by name. Deleted branches are not lines
  // anyone can switch to, so their threads are counted nowhere.
  others: OtherLine[];
};

export function lineDiscussionCounts(
  threads: readonly PageThread[],
  branches: readonly PageBranch[],
  line: LineRef,
): LineDiscussionCounts {
  const others: OtherLine[] = [];
  for (const branch of branches) {
    if (branch.id === line.branchId) continue;
    const counts = openCount(
      lineThreads(threads, { branchId: branch.id, isMain: branch.isMain }),
    );
    if (counts.open) others.push({ branch, ...counts });
  }
  others.sort(
    (a, b) =>
      Number(b.branch.isMain) - Number(a.branch.isMain) ||
      a.branch.name.localeCompare(b.branch.name),
  );
  return { ...openCount(lineThreads(threads, line)), others };
}

export const discussionsLabel = (n: number) =>
  n === 1 ? "1 discussion" : `${n} discussions`;
export const openDiscussionsLabel = (n: number) =>
  n === 1 ? "1 open discussion" : `${n} open discussions`;
