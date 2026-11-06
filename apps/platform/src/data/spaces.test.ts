import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ancestorsOf,
  createSpaceRowMemo,
  indexSpaces,
  pageTree,
  placeUnder,
  placement,
  siblingStep,
  spaceBySlug,
  suggestSlug,
  visibleRows,
  type Space,
  type SpacePage,
} from "@lictory/platform/data/spaces";

const page = (
  id: string,
  rank: string,
  parentId: string | null = null,
  archivedAt: string | null = null,
): SpacePage => ({
  type: "page",
  id,
  organizationId: "org",
  spaceId: "space",
  parentId,
  rank,
  title: id.toUpperCase(),
  publishedCommitId: `${id}-commit`,
  createdById: "me",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt,
  openThreads: 0,
  blockingThreads: 0,
});
const space = (id: string, slug: string, archivedAt: string | null = null) =>
  ({
    type: "space",
    id,
    organizationId: "org",
    name: slug,
    slug,
    description: null,
    icon: null,
    projectId: null,
    teamId: null,
    accessMode: "inherited",
    publishing: "direct",
    createdById: "me",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    archivedAt,
  }) satisfies Space;

// a
// ├─ b
// │  └─ c
// └─ d (archived)
// e
const pages = [
  page("e", "m"),
  page("a", "c"),
  page("b", "a", "a"),
  page("c", "a", "b"),
  page("d", "b", "a", "2026-11-02T00:00:00.000Z"),
];

void test("the tree hides archived pages unless asked, in rank order", () => {
  const tree = pageTree(pages);
  assert.deepEqual(
    tree.children.get(null)?.map((p) => p.id),
    ["a", "e"],
  );
  assert.deepEqual(
    tree.children.get("a")?.map((p) => p.id),
    ["b"],
  );
  assert.deepEqual(
    pageTree(pages, true)
      .children.get("a")
      ?.map((p) => p.id),
    ["b", "d"],
  );
});

void test("visible rows follow expansion with tree positions", () => {
  const tree = pageTree(pages);
  assert.deepEqual(
    visibleRows(tree, new Set()).map((r) => r.page.id),
    ["a", "e"],
  );
  const rows = visibleRows(tree, new Set(["a", "b"]));
  assert.deepEqual(
    rows.map((r) => [r.page.id, r.depth, r.position, r.siblings]),
    [
      ["a", 1, 1, 2],
      ["b", 2, 1, 1],
      ["c", 3, 1, 1],
      ["e", 1, 2, 2],
    ],
  );
  assert.equal(rows[0]!.hasChildren, true);
  assert.equal(rows[2]!.hasChildren, false);
});

void test("ancestors start at the top level", () => {
  const tree = pageTree(pages);
  assert.deepEqual(
    ancestorsOf(tree.byId, "c").map((p) => p.id),
    ["a", "b"],
  );
});

void test("drops name the neighbours the server places the page between", () => {
  const tree = pageTree(pages);
  assert.deepEqual(placement(tree, "e", "a", "before"), {
    parentId: null,
    afterId: null,
    beforeId: "a",
  });
  assert.deepEqual(placement(tree, "e", "b", "inside"), {
    parentId: "b",
    afterId: "c",
    beforeId: null,
  });
  assert.deepEqual(placement(tree, "c", "a", "after"), {
    parentId: null,
    afterId: "a",
    beforeId: "e",
  });
  // Into its own subtree, onto itself, or to where it already is.
  assert.equal(placement(tree, "a", "c", "inside"), null);
  assert.equal(placement(tree, "a", "a", "after"), null);
  assert.equal(placement(tree, "a", "e", "before"), null);
});

void test("keyboard moves step among siblings or go first or last", () => {
  const tree = pageTree(pages);
  assert.deepEqual(siblingStep(tree, "e", -1), {
    parentId: null,
    afterId: null,
    beforeId: "a",
  });
  assert.equal(siblingStep(tree, "a", -1), null);
  assert.deepEqual(placeUnder(tree, "e", "a", "first"), {
    parentId: "a",
    afterId: null,
    beforeId: "b",
  });
  assert.equal(placeUnder(tree, "a", "b", "last"), null);
  assert.equal(placeUnder(tree, "e", null, "last"), null);
});

void test("handles are suggested from names and resolved to active spaces first", () => {
  assert.equal(suggestSlug("Payments Handbook"), "payments-handbook");
  assert.equal(suggestSlug("  Équipe — Sécurité!  "), "equipe-securite");
  assert.equal(suggestSlug("???"), "");
  const spaces = [
    space("old", "handbook", "2026-01-01T00:00:00.000Z"),
    space("new", "handbook"),
  ];
  assert.equal(spaceBySlug(spaces, "Handbook")?.id, "new");
  assert.equal(spaceBySlug([spaces[0]!], "handbook")?.id, "old");
});

void test("unchanged rows and per-space lists keep their identity", () => {
  const memo = createSpaceRowMemo();
  const rows = [
    { key: "space:s", type: "space", data: space("s", "s"), updatedAt: 1 },
    { key: "page:a", type: "page", data: page("a", "a"), updatedAt: 1 },
  ];
  const first = memo(rows);
  const second = memo(rows.map((r) => ({ ...r, data: { ...r.data } })));
  assert.equal(first.get("page:a"), second.get("page:a"));
  const index = indexSpaces(first.values());
  const again = indexSpaces(second.values(), index);
  assert.equal(
    again.pagesBySpace.get("space"),
    index.pagesBySpace.get("space"),
  );
  assert.equal(again.spaces, index.spaces);
});
