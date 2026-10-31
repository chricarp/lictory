import assert from "node:assert/strict";
import { test } from "node:test";
import type { Directory, Entity } from "@lictory/core/contracts/protocol";
import {
  computeInsights,
  type InsightCard,
} from "@lictory/core/intelligence/insights";

const now = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 86_400_000).toISOString();

const directory = {
  projects: [
    { id: "p1", key: "PAY", name: "Payments", deliveryMode: "native" },
    { id: "p2", key: "OPS", name: "Operations", deliveryMode: "native" },
  ],
  members: [
    { id: "u1", name: "Ada" },
    { id: "u2", name: "Grace" },
  ],
  statuses: [
    { id: "s-backlog", category: "backlog" },
    { id: "s-todo", category: "unstarted" },
    { id: "s-doing", category: "started" },
    { id: "s-done", category: "done" },
    { id: "s-cancel", category: "canceled" },
  ],
  teams: [],
  iterations: [],
  types: [],
  projectTypes: [],
  delivery: { connections: [], targets: [] },
} as unknown as Directory;

let n = 0;
function item(fields: Record<string, unknown>): Entity {
  n += 1;
  return {
    type: "workItem",
    id: `i${n}`,
    projectId: "p1",
    teamId: null,
    number: n,
    title: `Item ${n}`,
    statusId: "s-todo",
    refinementState: null,
    assigneeId: null,
    iterationId: null,
    estimate: null,
    archivedAt: null,
    updatedAt: daysAgo(1),
    blockingThreads: 0,
    reviews: [],
    readinessPassed: 0,
    readinessTotal: 0,
    ...fields,
  } as unknown as Entity;
}

const card = <K extends InsightCard["kind"]>(
  cards: InsightCard[],
  id: string,
): Extract<InsightCard, { kind: K }> =>
  cards.find((c) => c.id === id) as Extract<InsightCard, { kind: K }>;

void test("refinement insights count open specifications and surface blockers first", () => {
  const entities = [
    item({ refinementState: "ready", readinessPassed: 4, readinessTotal: 4 }),
    item({
      refinementState: "in_review",
      blockingThreads: 2,
      readinessPassed: 1,
      readinessTotal: 4,
      reviews: [
        { status: "requested", approved: false, assigneeIds: ["u1"] },
        { status: "completed", approved: true, assigneeIds: ["u2"] },
        { status: "cancelled", approved: false, assigneeIds: [] },
      ],
    }),
    item({ refinementState: "refinement", updatedAt: daysAgo(20) }),
    // Delivered, archived, other project and plain work are not counted.
    item({ refinementState: "draft", statusId: "s-done" }),
    item({ refinementState: "draft", archivedAt: daysAgo(2) }),
    item({ refinementState: "draft", projectId: "p2" }),
    item({}),
  ];
  const insights = computeInsights({
    topic: "refinement",
    entities,
    directory,
    projectId: "p1",
    now,
  });
  assert.equal(
    insights.headline,
    "1 of 3 open specifications is ready; 1 has blocking discussions.",
  );
  assert.equal(insights.scope.projectName, "Payments");
  const states = card<"distribution">(insights.cards, "refinement-state");
  assert.deepEqual(
    states.segments.map((s) => [s.key, s.value]),
    [
      ["draft", 0],
      ["refinement", 1],
      ["in_review", 1],
      ["ready", 1],
    ],
  );
  const reviews = card<"distribution">(insights.cards, "reviews");
  assert.equal(reviews.value, 1);
  assert.equal(reviews.caption, "of 2 reviews");
  assert.equal(card<"distribution">(insights.cards, "readiness").value, 5);
  const attention = card<"attention">(insights.cards, "refinement-attention");
  assert.deepEqual(
    attention.items.map((i) => [i.key, i.reason]),
    [
      ["PAY-2", "2 blocking discussions"],
      ["PAY-3", "No change in 20 days"],
    ],
  );
});

void test("delivery insights flag blocked and ownerless work and use the active iteration", () => {
  const blocker = item({ statusId: "s-doing", assigneeId: "u1" });
  const blocked = item({ statusId: "s-todo" });
  const ownerless = item({ statusId: "s-doing" });
  const entities = [
    blocker,
    blocked,
    ownerless,
    item({ statusId: "s-done" }),
    item({ statusId: "s-cancel" }),
    {
      type: "relation",
      kind: "blocks",
      fromId: blocker.id,
      toId: blocked.id,
    } as unknown as Entity,
  ];
  const insights = computeInsights({
    topic: "delivery",
    entities,
    directory,
    projectId: "p1",
    now,
    iteration: {
      iteration: { id: "it1", number: 4, name: null } as never,
      report: {
        series: [
          {
            at: "2026-10-12T00:00:00Z",
            scope: 10,
            remaining: 10,
            scopeCount: 4,
            remainingCount: 4,
          },
          {
            at: "2026-10-13T00:00:00Z",
            scope: 12,
            remaining: 7,
            scopeCount: 5,
            remainingCount: 3,
          },
        ],
        totals: { completed: { points: 5 }, final: { points: 12 } },
        velocity: [
          { number: 2, name: null, committed: 10, completed: 8 },
          { number: 3, name: null, committed: 12, completed: 12 },
        ],
      } as never,
    },
  });
  assert.equal(
    insights.headline,
    "2 in progress, 1 done and 1 not started; 1 item is blocked.",
  );
  const status = card<"distribution">(insights.cards, "delivery-status");
  assert.equal(status.caption, "1 done of 4 items");
  const burndown = card<"trend">(insights.cards, "burndown");
  assert.equal(burndown.title, "Burndown · Iteration 4");
  assert.equal(burndown.caption, "5 of 12 points done");
  assert.deepEqual(burndown.series[1]!.values, [10, 7]);
  assert.equal(
    card<"trend">(insights.cards, "velocity").labels[0],
    "Iteration 2",
  );
  const attention = card<"attention">(insights.cards, "delivery-attention");
  assert.deepEqual(
    attention.items.map((i) => i.reason),
    [
      `Blocked by PAY-${blocker.id.slice(1)}`,
      "In progress without an assignee",
    ],
  );
});

void test("people insights show open work per person and pending review load", () => {
  const entities = [
    item({ assigneeId: "u1", statusId: "s-doing", estimate: 3 }),
    item({ assigneeId: "u1", statusId: "s-todo", estimate: 2 }),
    item({ assigneeId: "u2", statusId: "s-todo" }),
    item({ assigneeId: "u2", statusId: "s-done" }),
    item({
      statusId: "s-backlog",
      reviews: [
        { status: "requested", approved: false, assigneeIds: ["u2"] },
        { status: "in_progress", approved: false, assigneeIds: ["u2"] },
        { status: "requested", approved: true, assigneeIds: ["u1"] },
      ],
    }),
  ];
  const insights = computeInsights({
    topic: "people",
    entities,
    directory,
    projectId: "p1",
    now,
  });
  assert.equal(
    insights.headline,
    "2 people hold assigned work; Ada has the most (2 items · 5 pts).",
  );
  const workload = card<"breakdown">(insights.cards, "workload");
  assert.deepEqual(
    workload.rows.map((r) => [r.label, r.segments.map((s) => s.value)]),
    [
      ["Ada", [1, 1]],
      ["Grace", [1, 0]],
    ],
  );
  const reviews = card<"breakdown">(insights.cards, "review-load");
  assert.deepEqual(
    reviews.rows.map((r) => [r.label, r.note]),
    [["Grace", "2 reviews"]],
  );
});

void test("burndowns fall back to item counts and need two days of history", () => {
  const report = (series: { scope: number; scopeCount: number }[]) =>
    computeInsights({
      topic: "delivery",
      entities: [],
      directory,
      projectId: "p1",
      now,
      iteration: {
        iteration: { id: "it1", number: 1, name: "Sprint 1" } as never,
        report: {
          series: series.map((p, i) => ({
            at: `2026-10-1${i}T00:00:00Z`,
            remaining: p.scope,
            remainingCount: p.scopeCount,
            ...p,
          })),
          totals: {
            completed: { points: 0, count: 1 },
            final: { points: 0, count: 4 },
          },
          velocity: [
            { number: 1, name: null, committed: 0, completed: 0 },
            { number: 2, name: null, committed: 0, completed: 0 },
          ],
        } as never,
      },
    }).cards.map((c) => [c.id, c.kind === "trend" ? c.unit : null]);
  // Unestimated work burns down in items; empty velocity is not drawn.
  assert.deepEqual(
    report([
      { scope: 0, scopeCount: 4 },
      { scope: 0, scopeCount: 4 },
    ]),
    [
      ["delivery-status", null],
      ["burndown", "items"],
    ],
  );
  assert.deepEqual(report([{ scope: 5, scopeCount: 2 }]), [
    ["delivery-status", null],
  ]);
});

void test("two samples from the same day are not a burndown", () => {
  const insights = computeInsights({
    topic: "delivery",
    entities: [],
    directory,
    projectId: "p1",
    now,
    iteration: {
      iteration: { id: "it1", number: 1, name: null } as never,
      report: {
        series: ["2026-10-16T08:00:00Z", "2026-10-16T12:00:00Z"].map((at) => ({
          at,
          scope: 5,
          remaining: 5,
          scopeCount: 2,
          remainingCount: 2,
        })),
        totals: {
          completed: { points: 0, count: 0 },
          final: { points: 5, count: 2 },
        },
        velocity: [],
      } as never,
    },
  });
  assert.ok(!insights.cards.some((c) => c.id === "burndown"));
});

void test("external delivery insights use provider status and exclude completed specifications from refinement", () => {
  const external = {
    ...directory,
    projects: directory.projects.map((p) => ({
      ...p,
      deliveryMode: "external" as const,
    })),
  };
  const work = item({
    id: "external-work",
    refinementState: "ready",
    statusId: "s-backlog",
  });
  const link = {
    type: "externalLink",
    id: "external-link",
    workItemId: "external-work",
    projectId: "p1",
    connectionId: "jira",
    externalKey: "PAY-42",
    externalStatusCategory: "done",
    status: "synced",
    syncedAt: daysAgo(1),
  } as unknown as Entity;
  const result = computeInsights({
    topic: "delivery",
    directory: external,
    entities: [work, link],
    projectId: "p1",
    now,
  });
  assert.equal(
    card<"distribution">(result.cards, "delivery-status").segments.find(
      (s) => s.key === "done",
    )!.value,
    1,
  );
  const refinement = computeInsights({
    topic: "refinement",
    directory: external,
    entities: [work, link],
    projectId: "p1",
    now,
  });
  assert.equal(
    card<"distribution">(refinement.cards, "refinement-state").segments.reduce(
      (sum, s) => sum + s.value,
      0,
    ),
    0,
  );
});
