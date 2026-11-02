import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entity, EntityOf } from "@lictory/core/contracts/protocol";
import {
  becameMergeable,
  mergeBlockers,
} from "@lictory/core/contracts/merge-readiness";

const at = "2026-11-02T10:00:00.000Z";
const hash = (s: { title: string; content: string }) =>
  `${s.title}|${s.content}`;
const commit = (
  id: string,
  content: string,
  parentIds: string[],
  authorId = "author",
): EntityOf<"specCommit"> => ({
  type: "specCommit",
  id,
  workItemId: "item",
  title: "Retries",
  content,
  proposedChildren: [],
  parentIds,
  message: id,
  authorId,
  revisionId: null,
  createdAt: at,
});
const branch = (id: string, name: string, headId: string) =>
  ({
    type: "specBranch",
    id,
    workItemId: "item",
    name,
    headId,
    authorId: "author",
    collaboratorIds: ["author"],
    createdAt: at,
  }) satisfies EntityOf<"specBranch">;
const pullRequest = (status: "draft" | "open" | "merged" = "open") =>
  ({
    type: "pullRequest",
    id: "pr",
    workItemId: "item",
    sourceId: "feature",
    targetId: "main",
    title: "Define retries",
    description: "",
    status,
    authorId: "author",
    mergedCommitId: null,
    createdAt: at,
  }) satisfies EntityOf<"pullRequest">;
const review = (
  decision: "approved" | "changes_requested" | null,
  resultHash: string | null,
  reviewerId: string | null = "engineer",
) =>
  ({
    type: "prReview",
    id: "review",
    workItemId: "item",
    pullRequestId: "pr",
    disciplineId: "engineering",
    userId: null,
    required: true,
    decision,
    reviewerId,
    resultHash,
    createdAt: at,
  }) satisfies EntityOf<"prReview">;
const thread = (blocking: boolean, status: "open" | "resolved") =>
  ({
    type: "thread",
    id: "thread",
    workItemId: "item",
    revisionId: "revision",
    suggestionId: null,
    pullRequestId: "pr",
    commitId: null,
    authorId: "engineer",
    status,
    blocking,
    createdAt: at,
    anchor: null,
  }) satisfies EntityOf<"thread">;
const run = (
  status: EntityOf<"aiRun">["status"],
  headCommitId: string,
  createdAt = at,
): EntityOf<"aiRun"> => ({
  type: "aiRun",
  id: crypto.randomUUID(),
  workItemId: "item",
  kind: "pr_action",
  status,
  pullRequestId: "pr",
  headCommitId,
  requestedById: "author",
  contextRevisions: {},
  score: null,
  summary: null,
  strengths: [],
  findings: [],
  correctivePullRequests: {},
  appliedFindingIds: [],
  intelligenceContext: [],
  model: null,
  error: null,
  createdAt,
  startedAt: null,
  completedAt: null,
  staleAt: null,
  staleReason: null,
});

const commits = [
  commit("base", "Retry.", []),
  commit("change", "Retry with the same key.", ["base"]),
];
const branches = [
  branch("main", "main", "base"),
  branch("feature", "f", "change"),
];
const approvedHash = hash({
  title: "Retries",
  content: "Retry with the same key.",
});
const context = {
  disciplines: [
    {
      id: "engineering",
      archivedAt: null,
      capabilities: { review: true },
      userIds: ["engineer", "author"],
    },
  ],
  memberIds: ["author", "engineer"],
  actionRequired: false,
  hash,
};
const state = (extra: Entity[] = [], pr = pullRequest()): Entity[] => [
  pr,
  ...branches,
  ...commits,
  ...extra,
];
const blockers = (entities: Entity[], actionRequired = false) =>
  mergeBlockers({
    ...context,
    actionRequired,
    pullRequest: entities.find(
      (e): e is EntityOf<"pullRequest"> => e.type === "pullRequest",
    )!,
    branches: entities.filter(
      (e): e is EntityOf<"specBranch"> => e.type === "specBranch",
    ),
    commits: entities.filter(
      (e): e is EntityOf<"specCommit"> => e.type === "specCommit",
    ),
    reviews: entities.filter(
      (e): e is EntityOf<"prReview"> => e.type === "prReview",
    ),
    threads: entities.filter(
      (e): e is EntityOf<"thread"> => e.type === "thread",
    ),
    runs: entities.filter((e): e is EntityOf<"aiRun"> => e.type === "aiRun"),
  });

void test("an approved exact result without blockers can be merged", () => {
  assert.deepEqual(blockers(state([review("approved", approvedHash)])), []);
  assert.equal(
    blockers(state([review("approved", approvedHash)], pullRequest("merged"))),
    undefined,
  );
});

void test("each merge requirement is reported until it is met", () => {
  assert.deepEqual(
    blockers(state([], pullRequest("draft"))).map((b) => b.kind),
    ["draft", "no_required_review"],
  );
  assert.deepEqual(blockers(state([review(null, null)])), [
    { kind: "review_pending", disciplineId: "engineering" },
  ]);
  // An approval of an earlier result is stale.
  assert.deepEqual(
    blockers(state([review("approved", "older")])).map((b) => b.kind),
    ["review_pending"],
  );
  assert.deepEqual(
    blockers(state([review("changes_requested", approvedHash)])).map(
      (b) => b.kind,
    ),
    ["review_pending", "changes_requested"],
  );
  assert.deepEqual(
    blockers(state([review("approved", approvedHash), thread(true, "open")])),
    [{ kind: "blocking_discussions", count: 1 }],
  );
  assert.deepEqual(
    blockers(
      state([review("approved", approvedHash), thread(true, "resolved")]),
    ),
    [],
  );
});

void test("contributors cannot satisfy their own required review", () => {
  assert.deepEqual(
    blockers(state([review("approved", approvedHash, "author")])).map(
      (b) => b.kind,
    ),
    ["review_pending"],
  );
});

void test("a required review action must have passed on the current head", () => {
  const approved = review("approved", approvedHash);
  assert.deepEqual(blockers(state([approved]), true), [
    { kind: "action", status: "missing" },
  ]);
  assert.deepEqual(
    blockers(state([approved, run("running", "change")]), true),
    [{ kind: "action", status: "running" }],
  );
  assert.deepEqual(
    blockers(state([approved, run("completed", "base")]), true),
    [{ kind: "action", status: "outdated" }],
  );
  assert.deepEqual(
    blockers(
      state([
        approved,
        run("completed", "change"),
        run("failed", "change", "2026-11-02T11:00:00.000Z"),
      ]),
      true,
    ),
    [{ kind: "action", status: "failed" }],
  );
  assert.deepEqual(
    blockers(state([approved, run("completed", "change")]), true),
    [],
  );
});

void test("only the change that clears the last blocker reports a pull request", () => {
  const pending = state([review(null, null)]);
  const approved = state([review("approved", approvedHash)]);
  assert.deepEqual(
    becameMergeable(pending, approved, context).map((p) => p.id),
    ["pr"],
  );
  // Already mergeable before: nothing new to say.
  assert.deepEqual(becameMergeable(approved, approved, context), []);
  // Becoming blocked again and then clear again reports again.
  const blocked = state([
    review("approved", approvedHash),
    thread(true, "open"),
  ]);
  assert.deepEqual(becameMergeable(approved, blocked, context), []);
  assert.deepEqual(
    becameMergeable(blocked, approved, context).map((p) => p.id),
    ["pr"],
  );
});
