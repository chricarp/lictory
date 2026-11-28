import type {
  CodeCheckRun,
  CodeChecksSummary,
} from "@lictory/core/code/provider";

// One state for a commit: any failure fails it, then anything pending, then
// success; no checks at all is `none`.
export function summarize(runs: CodeCheckRun[]): CodeChecksSummary {
  const state = runs.some((r) => r.state === "failure")
    ? "failure"
    : runs.some((r) => r.state === "pending")
      ? "pending"
      : runs.length
        ? "success"
        : "none";
  return { state, runs: runs.slice(0, 100) };
}
