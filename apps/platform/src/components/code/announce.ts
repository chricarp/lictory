import { useEffect, useRef } from "react";
import type {
  CodeChecks,
  CodePullRequestEntity,
} from "@lictory/core/code/entities";
import { useAnnounce } from "@lictory/platform/components/shell/announcer";

// What a surface knows about a pull request: the full page knows each
// check run and who merged; an item's Code panel knows the summary.
export type PullRequestSnapshot = {
  id: string;
  // "pull request #12", "merge request !4".
  name: string;
  state: CodePullRequestEntity["state"];
  checks: CodeChecks["state"];
  failing: readonly string[];
  head: string;
  // "by Autopilot · policy set by Ada", or null when unknown.
  mergedBy: string | null;
  // The person on the page asked for the merge themselves.
  mergedByMe: boolean;
};

// What a pull request's checks and merge did since the surface showing it
// opened: "Checks failed on pull request #12: ci", "Pull request #12 merged
// by Autopilot". A merge the person asked for is confirmed where they asked.
export function pullRequestAnnouncements(
  previous: PullRequestSnapshot,
  next: PullRequestSnapshot,
): { key: string; text: string }[] {
  const said: { key: string; text: string }[] = [];
  if (previous.checks !== next.checks || previous.head !== next.head) {
    const key = `pr:${next.id}:${next.head}:checks:${next.checks}`;
    if (next.checks === "success")
      said.push({ key, text: `Checks passed on ${next.name}` });
    else if (next.checks === "failure")
      said.push({
        key,
        text: `Checks failed on ${next.name}${next.failing.length ? `: ${next.failing.join(", ")}` : ""}`,
      });
  }
  if (previous.state !== next.state) {
    const key = `pr:${next.id}:${next.state}`;
    const name = capital(next.name);
    if (next.state === "merged" && !next.mergedByMe)
      said.push({
        key,
        text: `${name} merged${next.mergedBy ? ` ${next.mergedBy}` : ""}`,
      });
    else if (next.state === "closed")
      said.push({ key, text: `${name} closed without merging` });
  }
  return said;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A full pull request as the announcement sees it.
export function pullRequestSnapshot(
  pr: CodePullRequestEntity,
  noun: string,
  userId: string,
): PullRequestSnapshot {
  const byPolicy = pr.mergedVia?.startsWith("Autopilot") ?? false;
  return {
    id: pr.id,
    name: `${noun} #${pr.number}`,
    state: pr.state,
    checks: pr.checks.state,
    failing: pr.checks.runs
      .filter((run) => run.state === "failure")
      .map((run) => run.name),
    head: pr.headSha,
    mergedBy: byPolicy
      ? `by ${pr.mergedVia}`
      : pr.mergedByLogin
        ? `by ${pr.mergedByLogin}`
        : null,
    mergedByMe: !byPolicy && pr.mergeRequestedById === userId,
  };
}

// Announces check results and merges of the pull requests a surface shows.
// Pass snapshots memoized on what they depend on.
export function useAnnouncePullRequests(
  pullRequests: readonly PullRequestSnapshot[],
) {
  const announce = useAnnounce();
  const seen = useRef(new Map<string, PullRequestSnapshot>());
  useEffect(() => {
    const known = seen.current;
    for (const pr of pullRequests) {
      const previous = known.get(pr.id);
      known.set(pr.id, pr);
      if (!previous) continue;
      for (const { key, text } of pullRequestAnnouncements(previous, pr))
        announce(text, { key });
    }
  }, [pullRequests, announce]);
}
