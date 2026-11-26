import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  StatusCategory,
  WorkItem,
} from "@lictory/core/contracts/protocol";
import type { ExternalLink } from "@lictory/core/lib/lifecycle";
import { deliveryIndex, type Project } from "@lictory/core/lib/work-items";
import {
  inFlight,
  readyToStart,
  recentPages,
  waitingOnYou,
} from "@lictory/platform/components/shell/home/derive";

const delivery = deliveryIndex({
  types: [],
  teams: [],
  iterations: [],
  projectTypes: [],
  statuses: (
    ["backlog", "unstarted", "started", "done", "canceled"] as StatusCategory[]
  ).map((category, position) => ({
    id: category,
    projectId: "native",
    name: category,
    color: "gray",
    category,
    position,
    archivedAt: null,
  })),
});
const projects = [
  { id: "native", key: "PAY", deliveryMode: "native" },
  { id: "jira", key: "OPS", deliveryMode: "external" },
] as Project[];

let sequence = 0;
function item(overrides: Partial<WorkItem>): WorkItem {
  sequence += 1;
  return {
    id: `item-${sequence}`,
    projectId: "native",
    number: sequence,
    title: `Item ${sequence}`,
    statusId: "backlog",
    assigneeId: null,
    refinementState: null,
    committedRevisionId: null,
    archivedAt: null,
    updatedAt: `2026-11-0${sequence % 9}T00:00:00Z`,
    ...overrides,
  } as WorkItem;
}

const me = "ada";
const context = (
  items: WorkItem[],
  links: ReadonlyMap<string, ExternalLink> = new Map(),
) => ({ items, projects, delivery, links, userId: me });

void test("in flight is my started work, newest first, in either delivery mode", () => {
  const older = item({
    statusId: "started",
    assigneeId: me,
    updatedAt: "2026-11-01T00:00:00Z",
  });
  const newer = item({
    statusId: "started",
    assigneeId: me,
    updatedAt: "2026-11-03T00:00:00Z",
  });
  const theirs = item({ statusId: "started", assigneeId: "grace" });
  const notStarted = item({ statusId: "unstarted", assigneeId: me });
  const archived = item({
    statusId: "started",
    assigneeId: me,
    archivedAt: "2026-11-04T00:00:00Z",
  });
  // External delivery: the tool reports the work in progress.
  const published = item({
    projectId: "jira",
    assigneeId: me,
    updatedAt: "2026-11-02T00:00:00Z",
  });
  const links = new Map([
    [
      published.id,
      {
        workItemId: published.id,
        externalKey: "OPS-1",
        externalStatusCategory: "in_progress",
      } as ExternalLink,
    ],
  ]);
  const result = inFlight(
    context([older, newer, theirs, notStarted, archived, published], links),
    10,
  );
  assert.deepEqual(
    result.rows.map((r) => r.id),
    [newer.id, published.id, older.id],
  );
  assert.equal(result.total, 3);
});

void test("ready to start lists ready work that is mine or unassigned, mine first", () => {
  const unassigned = item({
    refinementState: "ready",
    updatedAt: "2026-11-05T00:00:00Z",
  });
  const mine = item({
    refinementState: "ready",
    assigneeId: me,
    updatedAt: "2026-11-01T00:00:00Z",
  });
  const theirs = item({ refinementState: "ready", assigneeId: "grace" });
  const committed = item({
    refinementState: "ready",
    committedRevisionId: "revision",
  });
  const inReview = item({ refinementState: "in_review" });
  const started = item({ refinementState: "ready", statusId: "started" });
  const result = readyToStart(
    context([unassigned, mine, theirs, committed, inReview, started]),
    10,
  );
  assert.deepEqual(
    result.rows.map((r) => r.id),
    [mine.id, unassigned.id],
  );
});

void test("lists keep their total beyond the rows shown", () => {
  const all = Array.from({ length: 7 }, () =>
    item({ statusId: "started", assigneeId: me }),
  );
  const result = inFlight(context(all), 3);
  assert.equal(result.rows.length, 3);
  assert.equal(result.total, 7);
});

void test("recent pages skip archived pages and pages of archived spaces", () => {
  const pages = [
    { id: "a", spaceId: "s1", updatedAt: "2026-11-01", archivedAt: null },
    { id: "b", spaceId: "s1", updatedAt: "2026-11-03", archivedAt: null },
    { id: "c", spaceId: "s1", updatedAt: "2026-11-04", archivedAt: "x" },
    { id: "d", spaceId: "gone", updatedAt: "2026-11-05", archivedAt: null },
  ];
  const result = recentPages(pages, new Set(["s1"]), 5);
  assert.deepEqual(
    result.rows.map((p) => p.id),
    ["b", "a"],
  );
  assert.equal(result.total, 2);
});

void test("waiting on you is one queue: agents' questions first, each thing once", () => {
  const rows = waitingOnYou({
    items: [
      {
        reason: "Changes requested",
        weight: 1,
        item: { id: "i1", updatedAt: "2026-11-05" },
      },
      {
        reason: "Review requested",
        weight: 0,
        item: { id: "i2", updatedAt: "2026-11-01" },
      },
    ],
    pages: [
      {
        reason: "ready_to_merge" as const,
        pullRequest: { id: "p1", updatedAt: "2026-11-09" },
      },
      {
        reason: "review_requested" as const,
        pullRequest: { id: "p2", updatedAt: "2026-11-02" },
      },
    ],
    requests: [
      {
        session: { id: "s1", updatedAt: "2026-10-30" },
        approval: { id: "a1", createdAt: "2026-10-30" },
      },
      {
        session: { id: "s1", updatedAt: "2026-10-30" },
        approval: { id: "a2", createdAt: "2026-10-31" },
      },
      // Waiting for my next message: the session itself, once.
      { session: { id: "s2", updatedAt: "2026-10-29" } },
      // A session I started that failed waits like a review.
      { session: { id: "s3", updatedAt: "2026-11-03" }, failed: true },
    ],
  });
  // An agent waiting on a person is stopped: its questions lead, newest
  // first; then reviews (items and pages by time), changes, merges.
  assert.deepEqual(
    rows.map((r) => r.key),
    [
      "agent:a2",
      "agent:a1",
      "agent:session:s2",
      "agent:failed:s3",
      "page:p2",
      "item:i2:Review requested",
      "item:i1:Changes requested",
      "page:p1",
    ],
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
});
