import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  SpaceEntity,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import {
  contextLinks,
  contextStep,
  itemKnowledge,
  pageAttention,
  pageCountsByItem,
  pagesAwaitingMyReview,
  proposalState,
  type PageLookup,
} from "@lictory/platform/data/knowledge";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";

const org = "org";
const inSpace = (spaceId: string) => ({ organizationId: org, spaceId });
const space = (id: string, archivedAt: string | null = null) =>
  ({ id, archivedAt, name: id }) as unknown as Space;
const page = (
  id: string,
  spaceId: string,
  extra: Partial<SpacePage> = {},
): SpacePage =>
  ({
    id,
    spaceId,
    title: `Page ${id}`,
    publishedCommitId: `${id}-c2`,
    archivedAt: null,
    ...extra,
  }) as SpacePage;

const lookup = (pages: SpacePage[], spaces: Space[]): PageLookup => ({
  pageById: new Map(pages.map((p) => [p.id, p])),
  spaceById: new Map(spaces.map((s) => [s.id, s])),
});

const reference = (pageId: string, workItemId: string, spaceId = "s1") =>
  ({
    ...inSpace(spaceId),
    id: `${pageId}:${workItemId}`,
    type: "pageReference",
    pageId,
    workItemId,
    commitId: `${pageId}-c2`,
    blockIds: ["b1"],
  }) as SpaceEntityOf<"pageReference">;
const attachment = (
  pageId: string,
  workItemId: string,
  commitId: string | null = null,
  spaceId = "s1",
) =>
  ({
    ...inSpace(spaceId),
    id: `att-${pageId}`,
    type: "pageAttachment",
    pageId,
    workItemId,
    purpose: "runbook",
    commitId,
    createdById: "u1",
    createdAt: "2026-01-01T00:00:00Z",
  }) as SpaceEntityOf<"pageAttachment">;

void describe("item knowledge", () => {
  const item = { id: "item", revisionId: "rev-3" };
  const known = lookup(
    [
      page("a", "s1"),
      page("b", "s1"),
      page("c", "s1"),
      page("archived", "s1", { archivedAt: "2026-01-01T00:00:00Z" }),
      page("old-space", "gone"),
    ],
    [space("s1"), space("gone", "2026-01-01T00:00:00Z")],
  );

  void test("one entry per readable page, attached and cited first", () => {
    const rows: SpaceEntity[] = [
      reference("b", "item"),
      reference("a", "item"),
      attachment("a", "item", "a-c1"),
      {
        ...inSpace("s1"),
        id: "item:c",
        type: "specificationCitation",
        pageId: "c",
        workItemId: "item",
        revisions: [
          {
            revisionId: "rev-1",
            number: 1,
            commitIds: ["c-c1"],
            latest: false,
          },
          {
            revisionId: "rev-3",
            number: 3,
            commitIds: ["c-c2"],
            latest: false,
          },
        ],
      },
      reference("archived", "item"),
      reference("old-space", "item", "gone"),
      reference("unknown", "item"),
      reference("a", "another-item"),
    ];
    const k = itemKnowledge(rows, known, item);
    assert.deepEqual(
      k.pages.map((p) => p.page.id),
      ["a", "c", "b"],
    );
    const a = k.pages[0]!;
    assert.deepEqual(a.mention?.blockIds, ["b1"]);
    assert.equal(a.attachment?.commitId, "a-c1");
    // Pinned to an older version than the published one.
    assert.equal(a.newer, true);
    const c = k.pages[1]!;
    assert.deepEqual(c.citation?.current, {
      number: 3,
      commitIds: ["c-c2"],
      latest: false,
    });
    assert.equal(c.newer, false);
  });

  void test("a page only earlier revisions cite says so and comes last", () => {
    const rows: SpaceEntity[] = [
      reference("b", "item"),
      {
        ...inSpace("s1"),
        id: "item:a",
        type: "specificationCitation",
        pageId: "a",
        workItemId: "item",
        revisions: [
          { revisionId: "rev-1", number: 1, commitIds: [], latest: true },
          {
            revisionId: "rev-2",
            number: 2,
            commitIds: ["a-c1"],
            latest: false,
          },
        ],
      },
    ];
    const k = itemKnowledge(rows, known, item);
    assert.deepEqual(
      k.pages.map((p) => p.page.id),
      ["b", "a"],
    );
    assert.deepEqual(k.pages[1]!.citation, {
      earlier: { number: 2, commitIds: ["a-c1"] },
    });
    // Earlier pins are history, not a "newer version" prompt.
    assert.equal(k.pages[1]!.newer, false);
  });

  void test("source and proposals need a readable page too", () => {
    const origin = (pageId: string, createdAt: string) =>
      ({
        ...inSpace("s1"),
        id: `branch-${pageId}`,
        type: "pageBranchOrigin",
        pageId,
        branchId: `branch-${pageId}`,
        workItemId: "item",
        revisionId: "rev-3",
        name: "pay-2-docs",
        authorId: "u1",
        createdAt,
        deletedAt: null,
        pullRequests: [],
      }) as SpaceEntityOf<"pageBranchOrigin">;
    const k = itemKnowledge(
      [
        {
          ...inSpace("s1"),
          id: "item",
          type: "workItemSource",
          pageId: "unknown",
          workItemId: "item",
          commitId: "x",
          blockId: null,
          quote: "secret",
          createdById: "u1",
          createdAt: "2026-01-01T00:00:00Z",
        },
        origin("a", "2026-01-01T00:00:00Z"),
        origin("b", "2026-02-01T00:00:00Z"),
        origin("unknown", "2026-03-01T00:00:00Z"),
      ],
      known,
      item,
    );
    assert.equal(k.source, undefined);
    assert.deepEqual(
      k.proposals.map((p) => p.pageId),
      ["b", "a"],
    );
    assert.deepEqual(k.pages, []);
  });

  void test("proposal state follows the newest pull request", () => {
    const base = {
      ...inSpace("s1"),
      id: "b",
      type: "pageBranchOrigin" as const,
      pageId: "a",
      branchId: "b",
      workItemId: "item",
      revisionId: "r",
      name: "n",
      authorId: "u",
      createdAt: "",
      deletedAt: null,
      pullRequests: [],
    };
    assert.equal(proposalState(base).state, "no_pull_request");
    assert.equal(
      proposalState({ ...base, deletedAt: "x" }).state,
      "branch_deleted",
    );
    assert.deepEqual(
      proposalState({
        ...base,
        pullRequests: [
          {
            id: "1",
            status: "closed",
            targetBranchId: "m",
            mergeCommitId: null,
          },
          { id: "2", status: "open", targetBranchId: "m", mergeCommitId: null },
        ],
      }),
      { state: "open", pullRequestId: "2" },
    );
  });
});

void test("page counts count each readable page once per item, as Knowledge lists them", () => {
  const known = lookup(
    [page("a", "s1"), page("b", "s1"), page("c", "s1"), page("d", "s1")],
    [space("s1")],
  );
  const citation = (pageId: string, workItemId: string, revisions = 1) =>
    ({
      ...inSpace("s1"),
      id: `${workItemId}:${pageId}`,
      type: "specificationCitation",
      pageId,
      workItemId,
      revisions: Array.from({ length: revisions }, (_, i) => ({
        revisionId: `rev-${i + 1}`,
        number: i + 1,
        commitIds: [],
        latest: true,
      })),
    }) as SpaceEntityOf<"specificationCitation">;
  const source = (pageId: string, workItemId: string) =>
    ({
      ...inSpace("s1"),
      id: workItemId,
      type: "workItemSource",
      pageId,
      workItemId,
      commitId: `${pageId}-c2`,
      blockId: null,
      quote: null,
      createdById: "u1",
      createdAt: "2026-01-01T00:00:00Z",
    }) as SpaceEntityOf<"workItemSource">;
  const rows: SpaceEntity[] = [
    reference("a", "x"),
    attachment("a", "x"),
    reference("b", "x"),
    // Cited by the specification counts too.
    citation("c", "x"),
    // The page it came from counts once, also when it mentions it.
    source("a", "x"),
    source("d", "w"),
    // A citation row without revisions is not listed, so not counted.
    citation("d", "z", 0),
    reference("hidden", "x"),
    reference("hidden", "y"),
  ];
  const counts = pageCountsByItem(rows, known);
  assert.equal(counts.get("x"), 3);
  assert.equal(counts.get("w"), 1);
  // The count is what the item's Knowledge section shows.
  const shown = itemKnowledge(rows, known, { id: "x", revisionId: "rev-1" });
  assert.equal(
    new Set([
      ...shown.pages.map((p) => p.page.id),
      ...(shown.source ? [shown.source.page.id] : []),
    ]).size,
    3,
  );
  assert.equal(counts.has("z"), false);
  // Nothing at all for an item only an unreadable page mentions.
  assert.equal(counts.has("y"), false);
});

void describe("context links", () => {
  const known = lookup(
    [page("a", "s1"), page("b", "s1"), page("c", "s1"), page("d", "s1")],
    [space("s1")],
  );
  const link = (
    id: string,
    pageId: string,
    rank: string,
    scope: { teamId?: string; iterationId?: string } = {},
  ) =>
    ({
      ...inSpace("s1"),
      id,
      type: "pageContextLink",
      pageId,
      projectId: "p",
      teamId: scope.teamId ?? null,
      iterationId: scope.iterationId ?? null,
      rank,
      createdById: "u",
      createdAt: "",
    }) as SpaceEntityOf<"pageContextLink">;
  const rows = [
    link("l2", "b", "b"),
    link("l1", "a", "a"),
    link("l3", "c", "c"),
    link("t1", "d", "a", { teamId: "team" }),
    link("i1", "d", "a", { iterationId: "it" }),
    link("hidden", "zzz", "0"),
  ];
  void test("each list in rank order, readable pages only", () => {
    assert.deepEqual(
      contextLinks(rows, known, {}).map((l) => l.id),
      ["l1", "l2", "l3"],
    );
    assert.deepEqual(
      contextLinks(rows, known, { teamId: "team" }).map((l) => l.id),
      ["t1"],
    );
    assert.deepEqual(
      contextLinks(rows, known, { iterationId: "it" }).map((l) => l.id),
      ["i1"],
    );
  });
  void test("moving one step names the neighbours to land between", () => {
    const list = contextLinks(rows, known, {});
    assert.deepEqual(contextStep(list, "l2", -1), {
      afterId: null,
      beforeId: "l1",
    });
    assert.deepEqual(contextStep(list, "l2", 1), {
      afterId: "l3",
      beforeId: null,
    });
    assert.deepEqual(contextStep(list, "l1", 1), {
      afterId: "l2",
      beforeId: "l3",
    });
    assert.equal(contextStep(list, "l1", -1), null);
    assert.equal(contextStep(list, "l3", 1), null);
  });
});

void describe("page attention", () => {
  const me = "me";
  const pr = (
    id: string,
    extra: Partial<SpaceEntityOf<"pagePullRequest">> = {},
    mergeability: Partial<
      NonNullable<SpaceEntityOf<"pagePullRequest">["mergeability"]>
    > = {},
  ) =>
    ({
      ...inSpace("s1"),
      id,
      type: "pagePullRequest",
      pageId: `page-${id}`,
      sourceBranchId: "b",
      targetBranchId: "m",
      title: id,
      description: null,
      status: "open",
      authorId: "other",
      reviewers: [{ userId: me, required: true, requestedById: "other" }],
      createdAt: "",
      updatedAt: "",
      mergedAt: null,
      mergedById: null,
      mergeCommitId: null,
      mergeability: {
        sourceHeadId: "s",
        targetHeadId: "t",
        baseCommitId: "x",
        resultHash: "h",
        conflicts: 0,
        contributorIds: ["other"],
        blockingThreads: 0,
        requiredReviews: 1,
        requiredApprovals: 0,
        approvals: 0,
        changesRequested: 0,
        staleReviews: 0,
        blockers: ["review_pending"],
        ...mergeability,
      },
      ...extra,
    }) as SpaceEntityOf<"pagePullRequest">;
  const review = (
    pullRequestId: string,
    extra: Partial<SpaceEntityOf<"pagePullRequestReview">> = {},
  ) =>
    ({
      ...inSpace("s1"),
      id: `r-${pullRequestId}-${extra.staleAt ?? "now"}`,
      type: "pagePullRequestReview",
      pageId: `page-${pullRequestId}`,
      pullRequestId,
      reviewerId: me,
      decision: "approved",
      resultHash: "h",
      sourceHeadId: "s",
      targetHeadId: "t",
      staleAt: null,
      staleReason: null,
      withdrawnAt: null,
      createdAt: "",
      ...extra,
    }) as SpaceEntityOf<"pagePullRequestReview">;
  const all = () => true;

  void test("asks for my review until I decide, and again when it went stale", () => {
    const prs = [
      pr("asked"),
      pr("answered"),
      pr("stale"),
      pr("draft", { status: "draft" }),
      pr("merged", { status: "merged" }),
      pr("not-me", { reviewers: [] }),
      pr("my-commits", {}, { contributorIds: ["other", me] }),
    ];
    assert.deepEqual(pagesAwaitingMyReview(prs, me), [
      "page-answered",
      "page-asked",
      "page-my-commits",
      "page-stale",
    ]);
    const entries = pageAttention(
      prs,
      [review("answered"), review("stale", { staleAt: "2026-01-01" })],
      me,
      all,
    );
    assert.deepEqual(
      entries.map((e) => [e.pullRequest.id, e.reason]),
      [
        ["asked", "review_requested"],
        ["stale", "review_again"],
      ],
    );
  });

  void test("my own pull requests: changes requested, then ready to merge", () => {
    const entries = pageAttention(
      [
        pr("changes", { authorId: me }, { changesRequested: 1 }),
        pr(
          "approved",
          { authorId: me },
          { approvals: 1, requiredApprovals: 1, blockers: [] },
        ),
        // Nothing approved it: no "ready" nudge in a space without reviews.
        pr("direct", { authorId: me }, { blockers: [] }),
        pr("pending", { authorId: me }),
      ],
      [],
      me,
      all,
    );
    assert.deepEqual(
      entries.map((e) => [e.pullRequest.id, e.reason]),
      [
        ["changes", "changes_requested"],
        ["approved", "ready_to_merge"],
      ],
    );
  });

  void test("pull requests of pages I cannot read are skipped", () => {
    assert.deepEqual(
      pageAttention([pr("asked")], [], me, () => false),
      [],
    );
  });
});
