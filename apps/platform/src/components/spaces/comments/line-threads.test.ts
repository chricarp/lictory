import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageBranch } from "@lictory/platform/data/spaces";
import type { PageThread } from "@lictory/platform/components/spaces/comments/store";
import {
  lineDiscussionCounts,
  lineThreads,
} from "@lictory/platform/components/spaces/comments/line-threads";

const branch = (id: string, name: string, isMain = false): PageBranch => ({
  type: "pageBranch",
  id,
  organizationId: "org",
  spaceId: "space",
  pageId: "page",
  name,
  isMain,
  headCommitId: `${id}-head`,
  baseCommitId: null,
  authorId: "me",
  collaboratorIds: [],
  draft: null,
  createdAt: "2026-11-01T00:00:00.000Z",
});

const thread = (
  id: string,
  branchId: string | null,
  {
    status = "open",
    blocking = false,
    pullRequestId = null,
  }: Partial<Pick<PageThread, "status" | "blocking" | "pullRequestId">> = {},
): PageThread => ({
  type: "pageThread",
  id,
  organizationId: "org",
  spaceId: "space",
  pageId: "page",
  authorId: "me",
  status,
  blocking,
  anchor: { v: 1, kind: "page" },
  commitId: null,
  branchId,
  pullRequestId,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  resolvedById: status === "resolved" ? "me" : null,
  resolvedAt: status === "resolved" ? "2026-11-02T00:00:00.000Z" : null,
});

const main = branch("main", "main", true);
const intro = branch("intro", "ada/intro");
const zeta = branch("zeta", "zeta-notes");
const branches = [zeta, intro, main];
const onMain = { branchId: main.id, isMain: true };
const onIntro = { branchId: intro.id, isMain: false };

// Discussions written on main (with and without a recorded line), on two
// branches, on a pull request and on a branch that was deleted after its
// pull request merged.
const threads = [
  thread("main-recorded", main.id),
  thread("main-legacy", null, { blocking: true }),
  thread("main-resolved", main.id, { status: "resolved" }),
  thread("intro-1", intro.id),
  thread("intro-2", intro.id, { blocking: true }),
  thread("intro-resolved", intro.id, { status: "resolved", blocking: true }),
  thread("zeta-1", zeta.id),
  thread("review", intro.id, { pullRequestId: "pr", blocking: true }),
  thread("deleted-branch", "retired"),
];

const ids = (list: readonly PageThread[]) => list.map((t) => t.id);

void test("main counts exactly the open discussions its panel lists", () => {
  const listed = lineThreads(threads, onMain);
  assert.deepEqual(ids(listed), [
    "main-recorded",
    "main-legacy",
    "main-resolved",
  ]);
  const counts = lineDiscussionCounts(threads, branches, onMain);
  const openListed = listed.filter((t) => t.status === "open");
  assert.equal(counts.open, openListed.length);
  assert.equal(counts.open, 2);
  assert.equal(counts.blocking, openListed.filter((t) => t.blocking).length);
  assert.equal(counts.blocking, 1);
});

void test("discussions of other branches are named, not counted, main first", () => {
  const counts = lineDiscussionCounts(threads, branches, onMain);
  assert.deepEqual(
    counts.others.map((o) => [o.branch.name, o.open, o.blocking]),
    [
      ["ada/intro", 2, 1],
      ["zeta-notes", 1, 0],
    ],
  );
});

void test("switching to a branch moves the count and the list together", () => {
  const listed = lineThreads(threads, onIntro);
  // Main's discussions without a recorded line stay on main.
  assert.deepEqual(ids(listed), ["intro-1", "intro-2", "intro-resolved"]);
  const counts = lineDiscussionCounts(threads, branches, onIntro);
  assert.deepEqual([counts.open, counts.blocking], [2, 1]);
  assert.deepEqual(
    counts.others.map((o) => [o.branch.name, o.open, o.blocking]),
    [
      ["main", 2, 1],
      ["zeta-notes", 1, 0],
    ],
  );
});

void test("pull request threads and threads of deleted branches are counted nowhere", () => {
  for (const line of [onMain, onIntro]) {
    const counts = lineDiscussionCounts(threads, branches, line);
    const everywhere =
      counts.open + counts.others.reduce((n, o) => n + o.open, 0);
    assert.equal(everywhere, 5);
    assert.ok(!ids(lineThreads(threads, line)).includes("review"));
    assert.ok(!ids(lineThreads(threads, line)).includes("deleted-branch"));
  }
});

void test("resolved discussions leave the count but stay in the line's list", () => {
  const resolvedAll = threads.map((t) =>
    t.branchId === intro.id && !t.pullRequestId
      ? { ...t, status: "resolved" as const }
      : t,
  );
  const counts = lineDiscussionCounts(resolvedAll, branches, onIntro);
  assert.deepEqual([counts.open, counts.blocking], [0, 0]);
  assert.equal(lineThreads(resolvedAll, onIntro).length, 3);
  // Main no longer lists the branch among those with open discussions.
  assert.deepEqual(
    lineDiscussionCounts(resolvedAll, branches, onMain).others.map(
      (o) => o.branch.name,
    ),
    ["zeta-notes"],
  );
});

void test("a page without discussions, or before its history arrives, counts none", () => {
  assert.deepEqual(lineDiscussionCounts([], branches, onMain), {
    open: 0,
    blocking: 0,
    others: [],
  });
  // Until the page's branches arrive main is not known by id: only threads
  // without a recorded line are on it, and no other line is offered.
  const early = lineDiscussionCounts(threads, [], {
    branchId: undefined,
    isMain: true,
  });
  assert.deepEqual([early.open, early.others.length], [1, 0]);
  assert.deepEqual(
    lineThreads(threads, { branchId: undefined, isMain: false }),
    [],
  );
});
