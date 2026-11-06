import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpaceEntityOf } from "@lictory/core/contracts/protocol";
import {
  predictPageTree,
  predictsPageTree,
} from "@lictory/core/spaces/optimistic";

type Page = SpaceEntityOf<"page">;
const context = {
  organizationId: "org",
  userId: "me",
  now: "2026-11-06T10:00:00.000Z",
};
const page = (
  id: string,
  rank: string,
  parentId: string | null = null,
): Page => ({
  type: "page",
  id,
  organizationId: "org",
  spaceId: "space",
  parentId,
  rank,
  title: id,
  publishedCommitId: `${id}-commit`,
  createdById: "me",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt: null,
  openThreads: 0,
  blockingThreads: 0,
});

void test("only page tree commands are predicted", () => {
  assert.equal(
    predictsPageTree({ type: "archivePage", pageId: "a", archived: true }),
    true,
  );
  assert.equal(
    predictsPageTree({
      type: "setSpaceAccessMode",
      spaceId: "s",
      accessMode: "restricted",
    }),
    false,
  );
});

void test("a new page lands between the named siblings, or last", () => {
  const pages = [page("a", "a"), page("b", "c")];
  const [between] = predictPageTree(
    pages,
    {
      type: "createPage",
      spaceId: "space",
      pageId: "n",
      title: " Runbook ",
      afterId: "a",
      beforeId: "b",
    },
    context,
  );
  assert.ok(between && between.rank > "a" && between.rank < "c");
  assert.equal(between.title, "Runbook");
  const [last] = predictPageTree(
    pages,
    { type: "createPage", spaceId: "space", pageId: "m", title: "Last" },
    context,
  );
  assert.ok(last && last.rank > "c");
});

void test("a page never moves under its own subtree", () => {
  const pages = [page("a", "a"), page("b", "b", "a"), page("c", "c", "b")];
  assert.deepEqual(
    predictPageTree(
      pages,
      { type: "movePage", pageId: "a", parentId: "c" },
      context,
    ),
    [],
  );
  const [moved] = predictPageTree(
    pages,
    { type: "movePage", pageId: "c", parentId: null, beforeId: "a" },
    context,
  );
  assert.equal(moved?.parentId, null);
  assert.ok(moved && moved.rank < "a");
});

void test("restoring brings back only what was archived together", () => {
  const earlier = "2026-11-02T00:00:00.000Z";
  const pages = [
    page("a", "a"),
    page("b", "b", "a"),
    { ...page("c", "c", "a"), archivedAt: earlier },
  ];
  const archived = predictPageTree(
    pages,
    { type: "archivePage", pageId: "a", archived: true },
    context,
  );
  assert.deepEqual(
    archived.map((p) => p.id),
    ["a", "b"],
  );
  const after = pages.map((p) => archived.find((x) => x.id === p.id) ?? p);
  const restored = predictPageTree(
    after,
    { type: "archivePage", pageId: "a", archived: false },
    context,
  );
  assert.deepEqual(
    restored.map((p) => [p.id, p.archivedAt]),
    [
      ["a", null],
      ["b", null],
    ],
  );
});
