// What still stands between an open pull request and its merge, computed from
// the pull request's synchronized state. The server's merge command enforces
// the same rules; this evaluation lets automatic actions notice the moment the
// last requirement is met without anyone having to look.
import type { Entity, EntityOf } from "@lictory/core/contracts/protocol";
import { sameProposedChildren } from "@lictory/core/contracts/decomposition";
import {
  mergeBase,
  mergeSnapshot,
  type Snapshot,
} from "@lictory/core/contracts/merge";

export type MergeBlocker =
  | { kind: "draft" }
  | { kind: "conflicted" }
  | { kind: "no_changes" }
  | { kind: "no_required_review" }
  | { kind: "review_pending"; disciplineId: string }
  | { kind: "changes_requested" }
  | { kind: "blocking_discussions"; count: number }
  | { kind: "action"; status: "missing" | "running" | "failed" | "outdated" };

type Discipline = {
  id: string;
  archivedAt: string | null;
  capabilities: { review: boolean };
  userIds: string[];
};

export type MergeReadinessInput = {
  pullRequest: EntityOf<"pullRequest">;
  branches: EntityOf<"specBranch">[];
  commits: EntityOf<"specCommit">[];
  reviews: EntityOf<"prReview">[];
  threads: EntityOf<"thread">[];
  runs: EntityOf<"aiRun">[];
  disciplines: Discipline[];
  memberIds: string[];
  // The project requires a Lictory Intelligence review run on the current
  // head, and Lictory Intelligence is enabled and configured.
  actionRequired: boolean;
  hash: (snapshot: Snapshot) => string;
};

// Returns undefined when the pull request is not open for merging at all
// (merged, deleted or missing a branch); otherwise the remaining blockers, an
// empty list when it can be merged.
export function mergeBlockers(
  input: MergeReadinessInput,
): MergeBlocker[] | undefined {
  const p = input.pullRequest;
  if (p.status === "merged") return undefined;
  const source = input.branches.find((b) => b.id === p.sourceId);
  const target = input.branches.find((b) => b.id === p.targetId);
  if (!source || !target) return undefined;
  const commit = (id: string) => input.commits.find((c) => c.id === id);
  const ours = commit(source.headId),
    theirs = commit(target.headId);
  const base = mergeBase(input.commits, source.headId, target.headId);
  const blockers: MergeBlocker[] = [];
  if (p.status === "draft") blockers.push({ kind: "draft" });
  const result =
    base && ours && theirs ? mergeSnapshot(base, ours, theirs) : undefined;
  const hash = result && !result.conflicted ? input.hash(result) : undefined;
  if (!result || result.conflicted) blockers.push({ kind: "conflicted" });
  else if (
    result.title === theirs?.title &&
    result.content === theirs.content &&
    sameProposedChildren(result.proposedChildren, theirs.proposedChildren)
  )
    blockers.push({ kind: "no_changes" });

  // Commits on the source branch that the target does not have yet.
  const behind = new Set(ancestry(input.commits, target.headId));
  const contributors = new Set(
    ancestry(input.commits, source.headId)
      .filter((id) => !behind.has(id))
      .map((id) => commit(id)?.authorId),
  );
  const soleMember = input.memberIds.length === 1;
  const reviews = input.reviews.filter((r) => r.pullRequestId === p.id);
  const valid = (r: EntityOf<"prReview">) =>
    !!hash &&
    r.decision === "approved" &&
    r.resultHash === hash &&
    !!r.reviewerId &&
    input.memberIds.includes(r.reviewerId) &&
    (soleMember || !contributors.has(r.reviewerId)) &&
    input.disciplines.some(
      (d) =>
        d.id === r.disciplineId &&
        !d.archivedAt &&
        d.capabilities.review &&
        d.userIds.includes(r.reviewerId!),
    );
  const required = reviews.filter((r) => r.required);
  if (!required.length) blockers.push({ kind: "no_required_review" });
  for (const r of required)
    if (!valid(r))
      blockers.push({ kind: "review_pending", disciplineId: r.disciplineId });
  if (
    hash &&
    reviews.some(
      (r) => r.decision === "changes_requested" && r.resultHash === hash,
    )
  )
    blockers.push({ kind: "changes_requested" });
  const blocking = input.threads.filter(
    (t) => t.pullRequestId === p.id && t.status === "open" && t.blocking,
  ).length;
  if (blocking)
    blockers.push({ kind: "blocking_discussions", count: blocking });

  if (input.actionRequired) {
    const [latest] = input.runs
      .filter(
        (r) =>
          r.kind === "pr_action" &&
          r.pullRequestId === p.id &&
          r.status !== "superseded",
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const status = !latest
      ? "missing"
      : latest.status === "queued" || latest.status === "running"
        ? "running"
        : latest.status === "failed"
          ? "failed"
          : latest.headCommitId !== source.headId
            ? "outdated"
            : undefined;
    if (status) blockers.push({ kind: "action", status });
  }
  return blockers;
}

function ancestry(
  commits: { id: string; parentIds: string[] }[],
  head: string,
) {
  const map = new Map(commits.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const queue = [head];
  for (const id of queue) {
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(map.get(id)?.parentIds ?? []));
  }
  return [...seen];
}

// Pull requests that a change made mergeable: blocked before, clear after.
// Evaluating the transition, not the state, makes the follow-up happen once
// per transition however often the state is read.
export function becameMergeable(
  before: Entity[],
  after: Entity[],
  context: Pick<
    MergeReadinessInput,
    "disciplines" | "memberIds" | "actionRequired" | "hash"
  >,
) {
  const blockers = (entities: Entity[], pullRequest: EntityOf<"pullRequest">) =>
    mergeBlockers({
      ...context,
      pullRequest,
      branches: of(entities, "specBranch"),
      commits: of(entities, "specCommit"),
      reviews: of(entities, "prReview"),
      threads: of(entities, "thread"),
      runs: of(entities, "aiRun"),
    });
  return of(after, "pullRequest").filter((p) => {
    if (blockers(after, p)?.length !== 0) return false;
    const previous = of(before, "pullRequest").find((x) => x.id === p.id);
    return !previous || blockers(before, previous)?.length !== 0;
  });
}

function of<T extends Entity["type"]>(entities: Entity[], type: T) {
  return entities.filter((e): e is EntityOf<T> => e.type === type);
}
