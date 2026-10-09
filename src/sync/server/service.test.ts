import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../../db/schema";
import {
  createSyncService,
  DomainError,
  advanceSchedules,
  directory,
  iterationReport,
  searchEpics,
  searchMembers,
} from "./service";
import {
  PROTOCOL,
  pageSchema,
  type Command,
  type Entity,
} from "../shared/protocol";
import { reconcile, optimistic } from "../client/reconciliation";
import { seedOrganization } from "./organization";
const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_sync_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const service = createSyncService(db);
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});
async function fixture() {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: userId, name: "Project", email: `${userId}@example.test` },
    {
      id: reviewerId,
      name: "Engineering",
      email: `${reviewerId}@example.test`,
    },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values([
    {
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: reviewerId,
      role: "member",
      createdAt: new Date(),
    },
  ]);
  await seedOrganization(db, organizationId);
  const command = async (
    command: Command,
    actor = userId,
    id = crypto.randomUUID(),
  ) =>
    service.mutate(actor, { protocol: PROTOCOL, id, organizationId, command });
  const projectId = crypto.randomUUID();
  await command({
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  // A small project: the owner holds every default discipline, the reviewer
  // holds the two reviewing disciplines (Engineering, QA), narrowed here to
  // reviewing only.
  const seeded = await directory(db, userId, organizationId);
  const roles = Object.fromEntries(
    seeded.disciplines
      .filter((d) => d.projectId === projectId)
      .map((d) => [d.name, d.id]),
  ) as { Product: string; Engineering: string; QA: string };
  await command({
    type: "updateDiscipline",
    projectId,
    disciplineId: roles.Engineering,
    capabilities: {
      editSpecifications: false,
      changeProperties: false,
      requestReviews: true,
      review: true,
      publishDelivery: false,
    },
  });
  for (const [disciplineId, member] of [
    [roles.Engineering, userId],
    [roles.QA, userId],
    [roles.Engineering, reviewerId],
    [roles.QA, reviewerId],
  ] as const)
    await command({
      type: "setDisciplineMember",
      projectId,
      disciplineId,
      userId: member,
      member: true,
    });
  const project = (
    await db
      .select()
      .from(s.project)
      .where(eq(s.project.organizationId, organizationId))
  )[0]!;
  const dir = await directory(db, userId, organizationId);
  const types = Object.fromEntries(dir.types.map((t) => [t.name, t.id])) as {
    Epic: string;
    Story: string;
    Task: string;
    Bug: string;
    Subtask: string;
  };
  const statuses = Object.fromEntries(
    dir.statuses
      .filter((x) => x.projectId === project.id)
      .map((x) => [x.name, x.id]),
  ) as Record<
    "Backlog" | "Todo" | "In Progress" | "In Review" | "Done" | "Canceled",
    string
  >;
  const proposalId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId: project.id,
    workItemId: proposalId,
    typeId: types.Story,
    parentId: null,
    title: "Safe retries",
    description: "Avoid duplicate payments after timeout.",
  });
  const scope = {
    organizationId,
    projectId: project.id,
    workItemId: proposalId,
  };
  const read = async (cursor?: string, limit?: number) =>
    pageSchema.parse(await service.read(userId, scope, cursor, limit));
  const entities = async () =>
    (await read()).changes.flatMap((c) =>
      c.operation === "upsert" ? [c.entity] : [],
    );
  const current = async () =>
    (await entities())
      .filter((e) => e.type === "revision")
      .sort((a, b) => b.number - a.number)[0]!;
  return {
    organizationId,
    userId,
    reviewerId,
    roles,
    types,
    statuses,
    proposalId,
    projectId: project.id,
    scope,
    command,
    read,
    entities,
    current,
  };
}
void test("domain workflow converges through paginated deltas, retains history, and deduplicates retries", async () => {
  const f = await fixture();
  const initial = await f.read();
  let state = reconcile({}, initial.changes);
  const revision = await f.current();
  const threadId = crypto.randomUUID();
  await f.command({
    type: "createThread",
    workItemId: f.proposalId,
    baseRevisionId: revision.id,
    threadId,
    messageId: crypto.randomUUID(),
    body: "Define late responses.",
    section: "Failure behavior",
    blocking: true,
  });
  const messageId = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const reply: Command = {
    type: "replyToThread",
    workItemId: f.proposalId,
    threadId,
    messageId,
    body: "Reuse the same transaction ID.",
  };
  const receipts = await Promise.all([
    f.command(reply, f.userId, mutationId),
    f.command(reply, f.userId, mutationId),
  ]);
  assert.deepEqual(receipts[0], receipts[1]);
  assert.equal(
    (
      await db
        .select()
        .from(s.threadMessage)
        .where(eq(s.threadMessage.id, messageId))
    ).length,
    1,
  );
  await assert.rejects(
    f.command({ ...reply, body: "Different payload" }, f.userId, mutationId),
    DomainError,
  );
  await f.command({
    type: "setThreadState",
    workItemId: f.proposalId,
    threadId,
    resolved: true,
    blocking: true,
  });
  let cursor = initial.nextCursor;
  const cursors: bigint[] = [];
  while (true) {
    const page = await f.read(cursor, 2);
    assert.ok(page.changes.length <= 2);
    state = reconcile(state, page.changes);
    for (const c of page.changes) cursors.push(BigInt(c.cursor));
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  assert.ok(cursors.every((c, i) => i === 0 || c > cursors[i - 1]!));
  const full = reconcile({}, (await f.read()).changes);
  for (const key of new Set([...Object.keys(state), ...Object.keys(full)]))
    assert.deepEqual(state[key], full[key], key);
  assert.equal(state[`thread:${threadId}`]?.type, "thread");
  assert.equal((await f.read(cursor)).changes.length, 0);
  await f.command({
    type: "setThreadState",
    workItemId: f.proposalId,
    threadId,
    resolved: false,
    blocking: false,
  });
  const reopened = await f.entities();
  assert.equal(reopened.filter((e) => e.type === "message").length, 2);
  assert.ok(
    reopened.some(
      (e) => e.type === "thread" && e.status === "open" && !e.blocking,
    ),
  );
});
void test("approvals target exact revisions, only assignments authorize, and suggestions use the revision mutation path", async () => {
  const f = await fixture();
  const first = await f.current();
  const base = { workItemId: f.proposalId, baseRevisionId: first.id };
  await f.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  const review = (await f.entities()).find((e) => e.type === "review")!;
  await assert.rejects(
    f.command({
      type: "decideReview",
      ...base,
      reviewId: review.id,
      decision: "approve",
    }),
    /assigned reviewer/,
  );
  await f.command(
    { type: "decideReview", ...base, reviewId: review.id, decision: "approve" },
    f.reviewerId,
  );
  assert.ok(
    (await f.entities()).some(
      (e) =>
        e.type === "approval" &&
        e.revisionId === first.id &&
        e.status === "granted",
    ),
  );
  // The reviewer proposes a change, asks the owner (Product: edit + review)
  // to review it; the owner approves and merges. Merging is idempotent.
  const suggestionId = crypto.randomUUID();
  await f.command(
    {
      type: "createSuggestion",
      ...base,
      suggestionId,
      replacement:
        "# Safe retries\n\nRetries reuse the original transaction ID.",
      title: "Make idempotency explicit",
      rationale: "Make idempotency explicit",
      open: true,
    },
    f.reviewerId,
  );
  await f.command(
    {
      type: "setSuggestionReviewer",
      workItemId: f.proposalId,
      suggestionId,
      userId: f.userId,
      assigned: true,
    },
    f.reviewerId,
  );
  await f.command({
    type: "decideSuggestion",
    workItemId: f.proposalId,
    suggestionId,
    version: 1,
    decision: "approve",
  });
  const id = crypto.randomUUID();
  const merge: Command = { type: "mergeSuggestion", ...base, suggestionId };
  await f.command(merge, f.userId, id);
  await f.command(merge, f.userId, id);
  const second = await f.current();
  assert.equal(second.number, 2);
  const all = await f.entities();
  assert.ok(
    all.some(
      (e) =>
        e.type === "approval" &&
        e.status === "stale" &&
        e.revisionId === first.id,
    ),
  );
  assert.ok(
    all.some(
      (e) =>
        e.type === "revision" &&
        e.id === first.id &&
        e.content === first.content,
    ),
  );
  await assert.rejects(
    f.command({
      type: "updateSpecification",
      ...base,
      title: "Conflict",
      content: "Would overwrite",
      summary: "Stale",
    }),
    /specification changed/,
  );
  assert.equal((await f.current()).id, second.id);
});
void test("bootstrap, delta, and mutations reject foreign tenants and revoked membership", async () => {
  const a = await fixture();
  const b = await fixture();
  await assert.rejects(
    service.read(a.userId, b.scope),
    /access has been removed/,
  );
  await assert.rejects(
    service.read(a.userId, b.scope, "0"),
    /access has been removed/,
  );
  await assert.rejects(
    service.read(a.userId, { ...a.scope, projectId: b.projectId }),
    DomainError,
  );
  await assert.rejects(
    a.command({
      type: "replyToThread",
      workItemId: b.proposalId,
      threadId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      body: "Forbidden",
    }),
    DomainError,
  );
  const before = await a.read();
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, a.organizationId),
        eq(s.member.userId, a.userId),
      ),
    );
  await assert.rejects(a.read(before.nextCursor), /access has been removed/);
});
void test("concurrent writes preserve commit cursor order and log failure rolls back domain writes", async () => {
  const f = await fixture();
  const before = await f.read();
  await Promise.all(
    ["A", "B", "C"].map((title) =>
      f.command({
        type: "createWorkItem",
        projectId: f.projectId,
        workItemId: crypto.randomUUID(),
        typeId: f.types.Epic,
        parentId: null,
        title,
      }),
    ),
  );
  const page = pageSchema.parse(
    await service.read(
      f.userId,
      { organizationId: f.organizationId, projectId: f.projectId },
      before.nextCursor,
    ),
  );
  assert.equal(
    page.changes.filter(
      (c) => c.operation === "upsert" && c.entity.type === "workItem",
    ).length,
    3,
  );
  const failedProposalId = crypto.randomUUID();
  await client`CREATE FUNCTION reject_test_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced sync failure'; END $$`;
  await client`CREATE TRIGGER test_failure BEFORE INSERT ON sync_change FOR EACH ROW EXECUTE FUNCTION reject_test_change()`;
  try {
    await assert.rejects(
      f.command({
        type: "createWorkItem",
        projectId: f.projectId,
        workItemId: failedProposalId,
        typeId: f.types.Epic,
        parentId: null,
        title: "Rollback",
      }),
    );
  } finally {
    await client`DROP TRIGGER test_failure ON sync_change`;
  }
  assert.equal(
    (
      await db
        .select()
        .from(s.workItem)
        .where(eq(s.workItem.id, failedProposalId))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, failedProposalId))
    ).length,
    0,
  );
});
void test("archive and restore propagate, and tombstones remove normalized state", async () => {
  const f = await fixture();
  const initial = await f.read();
  await f.command({
    type: "archiveWorkItem",
    workItemId: f.proposalId,
    archived: true,
  });
  const page = await f.read(initial.nextCursor);
  const state = reconcile(reconcile({}, initial.changes), page.changes);
  const proposal = state[`workItem:${f.proposalId}`];
  assert.ok(proposal?.type === "workItem" && proposal.archivedAt);
  const first = await f.current();
  await assert.rejects(
    f.command({
      type: "updateSpecification",
      workItemId: f.proposalId,
      baseRevisionId: first.id,
      title: "Archived",
      content: "Not allowed",
      summary: "Blocked",
    }),
    /Restore/,
  );
  await f.command({
    type: "archiveWorkItem",
    workItemId: f.proposalId,
    archived: false,
  });
  assert.ok(
    (await f.entities()).some((e) => e.type === "workItem" && !e.archivedAt),
  );
  assert.equal(
    reconcile(state, [
      {
        operation: "delete",
        cursor: page.nextCursor,
        type: "workItem",
        id: f.proposalId,
      },
    ])[`workItem:${f.proposalId}`],
    undefined,
  );
});
void test("optimistic overlay is replayed over authoritative entities without mutating confirmed state", () => {
  const entity: Entity = {
    type: "thread",
    id: "thread",
    organizationId: "org",
    workItemId: "proposal",
    revisionId: "revision",
    suggestionId: null,
    pullRequestId: null,
    commitId: null,
    authorId: "user",
    status: "open",
    blocking: true,
    createdAt: new Date().toISOString(),
    anchor: null,
  };
  const state = { "thread:thread": entity };
  const next = optimistic(
    state,
    [
      {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId: "org",
        command: {
          type: "setThreadState",
          workItemId: "proposal",
          threadId: "thread",
          resolved: true,
          blocking: false,
        },
      },
    ],
    "user",
  );
  assert.equal(state["thread:thread"].status, "open");
  assert.ok(
    next["thread:thread"]?.type === "thread" &&
      next["thread:thread"].status === "resolved",
  );
  assert.deepEqual(optimistic(state, [], "user"), state);
});

void test("role membership grants a review decision only after explicit role assignment", async () => {
  const f = await fixture();
  const current = await f.current();
  const base = { workItemId: f.proposalId, baseRevisionId: current.id };
  await f.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.QA,
    userId: f.userId,
    required: true,
  });
  const unassigned = (await f.entities()).find((e) => e.type === "review")!;
  await assert.rejects(
    f.command(
      {
        type: "decideReview",
        ...base,
        reviewId: unassigned.id,
        decision: "approve",
      },
      f.reviewerId,
    ),
    /assigned reviewer/,
  );
  await f.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.QA,
    userId: null,
    required: true,
  });
  const assigned = (await f.entities()).find(
    (e) => e.type === "review" && e.id !== unassigned.id,
  )!;
  await f.command(
    {
      type: "decideReview",
      ...base,
      reviewId: assigned.id,
      decision: "approve",
    },
    f.reviewerId,
  );
  assert.ok(
    (await f.entities()).some(
      (e) =>
        e.type === "approval" &&
        e.reviewId === assigned.id &&
        e.reviewerId === f.reviewerId,
    ),
  );
});

void test("every current required review must complete, even when responsibilities have the same name", async () => {
  const f = await fixture();
  const first = await f.current();
  await f.command({
    type: "updateSpecification",
    workItemId: f.proposalId,
    baseRevisionId: first.id,
    title: "Safe retries",
    content:
      "# Intent\n\nRetries.\n\n## Acceptance criteria\n\n- [ ] No duplicate charge",
  });
  const current = await f.current();
  const base = { workItemId: f.proposalId, baseRevisionId: current.id };
  await f.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.Engineering,
    userId: f.userId,
    required: true,
  });
  await f.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  const reviews = (await f.entities()).filter((e) => e.type === "review");
  await f.command({
    type: "decideReview",
    ...base,
    reviewId: reviews[0]!.id,
    decision: "approve",
  });
  const readiness = (await f.entities()).find((e) => e.type === "readiness");
  assert.ok(
    readiness?.type === "readiness" &&
      !readiness.checks.find((c) => c.key === "reviews_approved")?.passed,
  );
  await f.command(
    {
      type: "decideReview",
      ...base,
      reviewId: reviews[1]!.id,
      decision: "approve",
    },
    f.reviewerId,
  );
  const ready = (await f.entities()).find((e) => e.type === "readiness");
  assert.ok(ready?.type === "readiness" && ready.checks.every((c) => c.passed));
});

void test("metadata updates never stale approvals; revisions carry reviews forward and gate ready", async () => {
  const f = await fixture();
  const first = await f.current();
  const base = { workItemId: f.proposalId, baseRevisionId: first.id };
  await f.command({
    type: "updateSpecification",
    ...base,
    title: "Safe retries",
    content:
      "# Intent\n\nRetries.\n\n## Acceptance criteria\n\n- [ ] No duplicate charge",
  });
  const second = await f.current();
  const base2 = { workItemId: f.proposalId, baseRevisionId: second.id };
  await f.command({
    type: "requestReview",
    ...base2,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  let item = (await f.entities()).find((e) => e.type === "workItem")!;
  assert.equal(item.type === "workItem" && item.refinementState, "in_review");
  const review = (await f.entities()).find((e) => e.type === "review")!;
  await f.command(
    {
      type: "decideReview",
      ...base2,
      reviewId: review.id,
      decision: "approve",
    },
    f.reviewerId,
  );
  item = (await f.entities()).find((e) => e.type === "workItem")!;
  assert.equal(item.type === "workItem" && item.refinementState, "ready");
  // Non-material: priority/assignee keep approvals and readiness intact.
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    priority: "high",
    assigneeId: f.reviewerId,
  });
  let all = await f.entities();
  assert.ok(all.some((e) => e.type === "approval" && e.status === "granted"));
  item = all.find((e) => e.type === "workItem")!;
  assert.ok(
    item.type === "workItem" &&
      item.refinementState === "ready" &&
      item.priority === "high",
  );
  // Protected main cannot be edited directly. Restoring an earlier revision
  // is an explicit capability-gated operation and stales the approval.
  await assert.rejects(
    f.command({
      type: "updateSpecification",
      ...base2,
      title: "Safe retries",
      content: "Unreviewed change",
    }),
    /ready/,
  );
  await f.command({
    type: "revertSpecification",
    ...base2,
    revisionId: first.id,
  });
  all = await f.entities();
  const third = await f.current();
  assert.ok(all.some((e) => e.type === "approval" && e.status === "stale"));
  const carried = all.filter(
    (e) => e.type === "review" && e.revisionId === third.id,
  );
  assert.equal(carried.length, 1);
  assert.equal(carried[0]!.type === "review" && carried[0].status, "requested");
  assert.ok(
    all.some(
      (e) =>
        e.type === "assignment" &&
        e.reviewId === carried[0]!.id &&
        e.userId === f.reviewerId,
    ),
  );
  item = all.find((e) => e.type === "workItem")!;
  assert.ok(
    item.type === "workItem" &&
      item.refinementState === "in_review" &&
      item.reviews.length === 1,
  );
  assert.deepEqual(item.type === "workItem" && item.reviews[0]!.assigneeIds, [
    f.reviewerId,
  ]);
  assert.ok(
    all.some((e) => e.type === "activity" && e.action === "refinement_changed"),
  );
});

void test("work item numbering, hierarchy validation and epic readiness over stories", async () => {
  const f = await fixture();
  const epicId = crypto.randomUUID();
  await f.command({
    type: "createWorkItem",
    projectId: f.projectId,
    workItemId: epicId,
    typeId: f.types.Epic,
    parentId: null,
    title: "Cancellation",
  });
  const items = (await f.entities()).filter((e) => e.type === "workItem");
  const numbers = items
    .map((e) => (e.type === "workItem" ? e.number : 0))
    .sort();
  assert.deepEqual(numbers, [1, 2]);
  await assert.rejects(
    f.command({
      type: "createWorkItem",
      projectId: f.projectId,
      workItemId: crypto.randomUUID(),
      typeId: f.types.Story,
      parentId: f.proposalId, // a story, not an epic
      title: "Invalid parent",
    }),
    /cannot be placed under a Story/,
  );
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    parentId: epicId,
  });
  const epicScope = {
    organizationId: f.organizationId,
    projectId: f.projectId,
    workItemId: epicId,
  };
  const epic = pageSchema
    .parse(await service.read(f.userId, epicScope))
    .changes.flatMap((c) => (c.operation === "upsert" ? [c.entity] : []));
  const summary = epic.find((e) => e.type === "workItem" && e.id === epicId)!;
  assert.ok(
    summary.type === "workItem" &&
      summary.childCount === 1 &&
      summary.childReadyCount === 0,
  );
  const readiness = epic.find((e) => e.type === "readiness")!;
  assert.ok(
    readiness.type === "readiness" &&
      readiness.checks.some((c) => c.key === "children_ready" && !c.passed),
  );
  await assert.rejects(
    f.command({
      type: "createProject",
      projectId: crypto.randomUUID(),
      name: "Other",
      key: "PAY",
    }),
    /already used/,
  );
});

void test("labels, milestones and manual ordering are project-scoped, non-material properties", async () => {
  const f = await fixture();
  const labelId = crypto.randomUUID();
  const milestoneId = crypto.randomUUID();
  await f.command({
    type: "createLabel",
    projectId: f.projectId,
    labelId,
    name: "Payments",
    color: "blue",
  });
  await assert.rejects(
    f.command({
      type: "createLabel",
      projectId: f.projectId,
      labelId: crypto.randomUUID(),
      name: "payments",
      color: "red",
    }),
    /already exists/,
  );
  await f.command({
    type: "createMilestone",
    projectId: f.projectId,
    milestoneId,
    name: "Q3 release",
    targetDate: "2026-09-30",
  });
  const first = await f.current();
  await f.command({
    type: "requestReview",
    workItemId: f.proposalId,
    baseRevisionId: first.id,
    reviewId: crypto.randomUUID(),
    disciplineId: f.roles.QA,
    userId: f.reviewerId,
    required: true,
  });
  const review = (await f.entities()).find((e) => e.type === "review")!;
  await f.command(
    {
      type: "decideReview",
      workItemId: f.proposalId,
      baseRevisionId: first.id,
      reviewId: review.id,
      decision: "approve",
    },
    f.reviewerId,
  );
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    labelIds: [labelId],
    milestoneId,
  });
  let all = await f.entities();
  let item = all.find((e) => e.type === "workItem" && e.id === f.proposalId)!;
  assert.ok(
    item.type === "workItem" &&
      item.labelIds.includes(labelId) &&
      item.milestoneId === milestoneId,
  );
  assert.ok(
    all.some((e) => e.type === "approval" && e.status === "granted"),
    "labels never stale approvals",
  );
  assert.ok(all.some((e) => e.type === "label" && e.id === labelId));
  assert.ok(
    all.some((e) => e.type === "activity" && e.action === "labels_changed"),
  );
  // Another project's label is rejected.
  const otherProject = crypto.randomUUID();
  await f.command({
    type: "createProject",
    projectId: otherProject,
    name: "Other",
    key: "OTH",
  });
  const foreignLabel = crypto.randomUUID();
  await f.command({
    type: "createLabel",
    projectId: otherProject,
    labelId: foreignLabel,
    name: "Foreign",
    color: "gray",
  });
  await assert.rejects(
    f.command({
      type: "updateWorkItem",
      workItemId: f.proposalId,
      labelIds: [foreignLabel],
    }),
    /unavailable in this project/,
  );
  // Ordering among siblings of an epic.
  const epicId = crypto.randomUUID();
  await f.command({
    type: "createWorkItem",
    projectId: f.projectId,
    workItemId: epicId,
    typeId: f.types.Epic,
    parentId: null,
    title: "Epic",
  });
  const stories = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  for (const [i, id] of stories.entries())
    await f.command({
      type: "createWorkItem",
      projectId: f.projectId,
      workItemId: id,
      typeId: f.types.Story,
      parentId: epicId,
      title: `S${i}`,
    });
  await f.command({
    type: "reorderWorkItem",
    workItemId: stories[2]!,
    beforeId: stories[0]!,
  });
  all = await f.entities();
  const order = all
    .filter(
      (e): e is Extract<typeof e, { type: "workItem" }> =>
        e.type === "workItem" && e.parentId === epicId,
    )
    .sort((a, b) => a.position - b.position)
    .map((e) => e.id);
  assert.deepEqual(order, [stories[2], stories[0], stories[1]]);
  await assert.rejects(
    f.command({
      type: "reorderWorkItem",
      workItemId: stories[1]!,
      beforeId: f.proposalId,
    }),
    /not a sibling/,
  );
  await f.command({
    type: "updateMilestone",
    projectId: f.projectId,
    milestoneId,
    status: "completed",
  });
  item = (await f.entities()).find(
    (e) => e.type === "milestone" && e.id === milestoneId,
  )!;
  assert.equal(item.type === "milestone" && item.status, "completed");
});
void test("member search pages and filters without returning the full roster", async () => {
  const f = await fixture();
  const tag = crypto.randomUUID().slice(0, 8).replace(/-/g, "");
  const extra = Array.from({ length: 25 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: i === 0 ? "Zelda Query" : `Member ${String(i).padStart(2, "0")}`,
    email: `member${i}@example.test`,
    handle: i === 0 ? `zq${tag}` : null,
  }));
  await db.insert(s.user).values(extra);
  await db.insert(s.member).values(
    extra.map((user) => ({
      id: crypto.randomUUID(),
      organizationId: f.organizationId,
      userId: user.id,
      role: "member",
      createdAt: new Date(),
    })),
  );
  const first = await searchMembers(db, f.userId, f.organizationId, "", 0, 20);
  assert.equal(first.members.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(first.members[0]?.id, f.userId);
  const rest = await searchMembers(db, f.userId, f.organizationId, "", 20, 20);
  assert.equal(rest.hasMore, false);
  assert.ok(rest.members.length > 0);
  const ids = new Set([
    ...first.members.map((m) => m.id),
    ...rest.members.map((m) => m.id),
  ]);
  assert.ok(ids.size > 20);
  const named = await searchMembers(
    db,
    f.userId,
    f.organizationId,
    "Zelda",
    0,
    20,
  );
  assert.equal(named.members.length, 1);
  assert.equal(named.members[0]?.name, "Zelda Query");
  assert.equal(named.hasMore, false);
  // Handles are searchable, with or without "@", and "_" is not a wildcard.
  const byHandle = await searchMembers(
    db,
    f.userId,
    f.organizationId,
    `@ZQ${tag}`,
  );
  assert.deepEqual(
    byHandle.members.map((m) => m.handle),
    [`zq${tag}`],
  );
  assert.equal(
    (await searchMembers(db, f.userId, f.organizationId, `zq${tag}`)).members
      .length,
    1,
  );
  assert.equal(
    (await searchMembers(db, f.userId, f.organizationId, "@z_")).members.length,
    0,
  );
  assert.equal(
    (await searchMembers(db, f.userId, f.organizationId, "@zelda")).members
      .length,
    0,
  );
  const outsider = crypto.randomUUID();
  await db.insert(s.user).values({
    id: outsider,
    name: "Outsider",
    email: `${outsider}@example.test`,
  });
  await assert.rejects(
    () => searchMembers(db, outsider, f.organizationId),
    /Organization access has been removed/,
  );
});
void test("epic search is paginated, project-scoped, searchable, and authorized", async () => {
  const f = await fixture();
  const epics = Array.from({ length: 25 }, (_, index) => ({
    id: crypto.randomUUID(),
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: f.types.Epic,
    statusId: f.statuses.Backlog,
    rank: `r${String(index).padStart(3, "0")}`,
    number: index + 2,
    title:
      index === 0 ? "Zelda Query" : `Epic ${String(index).padStart(2, "0")}`,
    createdById: f.userId,
  }));
  await db.insert(s.workItem).values(epics);
  await db.insert(s.workItem).values({
    id: crypto.randomUUID(),
    organizationId: f.organizationId,
    projectId: f.projectId,
    typeId: f.types.Epic,
    statusId: f.statuses.Backlog,
    rank: "z",
    number: 27,
    title: "Archived epic",
    createdById: f.userId,
    archivedAt: new Date(),
  });

  const first = await searchEpics(
    db,
    f.userId,
    f.organizationId,
    f.projectId,
    "",
    0,
    20,
  );
  assert.equal(first.epics.length, 20);
  assert.equal(first.hasMore, true);
  const rest = await searchEpics(
    db,
    f.userId,
    f.organizationId,
    f.projectId,
    "",
    20,
    20,
  );
  assert.equal(rest.epics.length, 5);
  assert.equal(rest.hasMore, false);
  assert.equal(
    new Set([...first.epics, ...rest.epics].map((epic) => epic.id)).size,
    25,
  );
  assert.ok(
    [...first.epics, ...rest.epics].every(
      (epic) => epic.title !== "Archived epic",
    ),
  );

  const named = await searchEpics(
    db,
    f.userId,
    f.organizationId,
    f.projectId,
    "Zelda",
  );
  assert.deepEqual(
    named.epics.map((epic) => epic.title),
    ["Zelda Query"],
  );
  const identified = await searchEpics(
    db,
    f.userId,
    f.organizationId,
    f.projectId,
    "PAY-2",
  );
  assert.deepEqual(
    identified.epics.map((epic) => epic.number),
    [2],
  );

  const outsider = crypto.randomUUID();
  await db.insert(s.user).values({
    id: outsider,
    name: "Epic Outsider",
    email: `${outsider}@example.test`,
  });
  await assert.rejects(
    () => searchEpics(db, outsider, f.organizationId, f.projectId, ""),
    /Organization access has been removed/,
  );
  await assert.rejects(
    () => searchEpics(db, f.userId, f.organizationId, crypto.randomUUID(), ""),
    /unavailable/,
  );
});

void test("disciplines grant capabilities in their project; project administrators manage them; reviews target reviewing disciplines", async () => {
  const f = await fixture();
  const revision = await f.current();
  const base = { workItemId: f.proposalId, baseRevisionId: revision.id };
  // The reviewer holds Engineering and QA only: no editing, no properties,
  // but discussion, suggestions and review requests remain available.
  await assert.rejects(
    f.command(
      {
        type: "updateSpecification",
        ...base,
        title: "Safe retries",
        content: "Rewritten",
      },
      f.reviewerId,
    ),
    /cannot edit specifications directly/,
  );
  await assert.rejects(
    f.command(
      {
        type: "createWorkItem",
        projectId: f.projectId,
        workItemId: crypto.randomUUID(),
        typeId: f.types.Story,
        parentId: null,
        title: "Another",
      },
      f.reviewerId,
    ),
    /cannot edit specifications directly/,
  );
  await assert.rejects(
    f.command(
      { type: "updateWorkItem", workItemId: f.proposalId, priority: "high" },
      f.reviewerId,
    ),
    /cannot change item properties/,
  );
  await assert.rejects(
    f.command(
      {
        type: "createLabel",
        projectId: f.projectId,
        labelId: crypto.randomUUID(),
        name: "api",
        color: "blue",
      },
      f.reviewerId,
    ),
    /cannot change item properties/,
  );
  const suggestionId = crypto.randomUUID();
  await f.command(
    {
      type: "createSuggestion",
      ...base,
      suggestionId,
      replacement: "Retries reuse the transaction ID.",
      title: "Idempotency was undefined.",
      rationale: "Idempotency was undefined.",
      open: true,
    },
    f.reviewerId,
  );
  // Nobody merges without being an assigned reviewer, not even an editor;
  // the reviewer (Engineering/QA: no edit capability) cannot be assigned.
  await assert.rejects(
    f.command({ type: "mergeSuggestion", ...base, suggestionId }),
    /assigned reviewer/,
  );
  await assert.rejects(
    f.command(
      {
        type: "setSuggestionReviewer",
        workItemId: f.proposalId,
        suggestionId,
        userId: f.reviewerId,
        assigned: true,
      },
      f.reviewerId,
    ),
    /both edit specifications and be asked to review/,
  );
  await f.command(
    {
      type: "setSuggestionReviewer",
      workItemId: f.proposalId,
      suggestionId,
      userId: f.userId,
      assigned: true,
    },
    f.reviewerId,
  );
  await f.command({
    type: "decideSuggestion",
    workItemId: f.proposalId,
    suggestionId,
    version: 1,
    decision: "approve",
  });
  await f.command({ type: "mergeSuggestion", ...base, suggestionId });
  const second = await f.current();
  assert.equal(second.number, 2);
  // Only project administrators manage disciplines.
  const roleId = crypto.randomUUID();
  const securityRole = {
    type: "createDiscipline" as const,
    projectId: f.projectId,
    disciplineId: roleId,
    name: "Security",
    capabilities: {
      editSpecifications: false,
      changeProperties: false,
      requestReviews: false,
      review: false,
      publishDelivery: false,
    },
  };
  await assert.rejects(
    f.command(securityRole, f.reviewerId),
    /project's administrators/,
  );
  await f.command(securityRole);
  await assert.rejects(
    f.command({
      ...securityRole,
      disciplineId: crypto.randomUUID(),
      name: "security",
    }),
    /already has a discipline named/,
  );
  // A discipline that cannot review cannot be asked, and a person can only be
  // asked through a discipline they hold.
  const base2 = { workItemId: f.proposalId, baseRevisionId: second.id };
  await assert.rejects(
    f.command({
      type: "requestReview",
      ...base2,
      reviewId: crypto.randomUUID(),
      disciplineId: roleId,
      userId: null,
      required: true,
    }),
    /cannot be asked to review/,
  );
  await f.command({
    type: "setDisciplineMember",
    projectId: f.projectId,
    disciplineId: roleId,
    userId: f.reviewerId,
    member: true,
  });
  await f.command({
    type: "updateDiscipline",
    projectId: f.projectId,
    disciplineId: roleId,
    capabilities: { ...securityRole.capabilities, review: true },
  });
  await assert.rejects(
    f.command({
      type: "requestReview",
      ...base2,
      reviewId: crypto.randomUUID(),
      disciplineId: roleId,
      userId: f.userId,
      required: true,
    }),
    /not a member of Security/,
  );
  const reviewId = crypto.randomUUID();
  await f.command({
    type: "requestReview",
    ...base2,
    reviewId,
    disciplineId: roleId,
    userId: null,
    required: true,
  });
  const page = await f.read();
  const review = page.changes
    .flatMap((c) => (c.operation === "upsert" ? [c.entity] : []))
    .find((e) => e.type === "review" && e.id === reviewId);
  assert.ok(review?.type === "review" && review.responsibility === "Security");
  assert.deepEqual(
    page.directory.disciplines.find((r) => r.id === roleId)?.userIds,
    [f.reviewerId],
  );
  assert.equal(
    page.directory.members.find((m) => m.id === f.userId)?.role,
    "admin",
  );
  assert.equal(
    page.directory.members.find((m) => m.id === f.reviewerId)?.role,
    "member",
  );
  await f.command(
    { type: "decideReview", ...base2, reviewId, decision: "approve" },
    f.reviewerId,
  );
  // Archiving a discipline removes its capabilities and hides it from
  // requests but keeps the historical assignment legible; restoring brings it
  // back.
  await f.command({
    type: "updateDiscipline",
    projectId: f.projectId,
    disciplineId: roleId,
    archived: true,
  });
  const archived = (await f.read()).directory.disciplines.find(
    (r) => r.id === roleId,
  );
  assert.ok(archived?.archivedAt);
  await assert.rejects(
    f.command({
      type: "requestReview",
      ...base2,
      reviewId: crypto.randomUUID(),
      disciplineId: roleId,
      userId: null,
      required: false,
    }),
    /unavailable/,
  );
  await f.command({
    type: "updateDiscipline",
    projectId: f.projectId,
    disciplineId: roleId,
    archived: false,
  });
  assert.equal(
    (await f.read()).directory.disciplines.find((r) => r.id === roleId)
      ?.archivedAt,
    null,
  );
  // Removing a person from every capable discipline revokes their access
  // immediately.
  for (const disciplineId of [f.roles.Engineering, f.roles.QA])
    await f.command({
      type: "setDisciplineMember",
      projectId: f.projectId,
      disciplineId,
      userId: f.reviewerId,
      member: false,
    });
  await assert.rejects(
    f.command(
      {
        type: "requestReview",
        ...base2,
        reviewId: crypto.randomUUID(),
        disciplineId: f.roles.Product,
        userId: null,
        required: false,
      },
      f.reviewerId,
    ),
    /cannot request or cancel reviews/,
  );
});

void test("suggestions follow a pull-request lifecycle: drafts, reviewer eligibility, versioned approvals, rebase and merge gates", async () => {
  const f = await fixture();
  const first = await f.current();
  const base = { workItemId: f.proposalId, baseRevisionId: first.id };
  const suggestionId = crypto.randomUUID();
  const item = () => ({ workItemId: f.proposalId, suggestionId });
  const suggestion = async () =>
    (await f.entities()).find(
      (e) => e.type === "suggestion" && e.id === suggestionId,
    ) as Extract<Entity, { type: "suggestion" }>;
  const summary = async () =>
    (await f.entities()).find(
      (e) => e.type === "workItem" && e.id === f.proposalId,
    ) as Extract<Entity, { type: "workItem" }>;
  // A draft is private work: it cannot receive reviewers' decisions and does
  // not count as an open suggestion.
  await f.command(
    {
      type: "createSuggestion",
      ...base,
      suggestionId,
      replacement: "# Safe retries\n\nVersion one.",
      title: "Define retries",
      rationale: "Define retries",
      open: false,
    },
    f.reviewerId,
  );
  assert.equal((await suggestion()).status, "draft");
  assert.equal((await summary()).openSuggestions, 0);
  // Only the author manages the suggestion.
  await assert.rejects(
    f.command({ type: "setSuggestionState", ...item(), status: "open" }),
    /Only the author/,
  );
  // Even an eligible author cannot review their own suggestion.
  await f.command({
    type: "setDisciplineMember",
    projectId: f.projectId,
    disciplineId: f.roles.Product,
    userId: f.reviewerId,
    member: true,
  });
  await assert.rejects(
    f.command(
      {
        type: "setSuggestionReviewer",
        ...item(),
        userId: f.reviewerId,
        assigned: true,
      },
      f.reviewerId,
    ),
    /cannot review your own/,
  );
  await f.command({
    type: "setDisciplineMember",
    projectId: f.projectId,
    disciplineId: f.roles.Product,
    userId: f.reviewerId,
    member: false,
  });
  await f.command(
    {
      type: "setSuggestionReviewer",
      ...item(),
      userId: f.userId,
      assigned: true,
    },
    f.reviewerId,
  );
  await assert.rejects(
    f.command({
      type: "decideSuggestion",
      ...item(),
      version: 1,
      decision: "approve",
    }),
    /not open for review/,
  );
  await f.command(
    { type: "setSuggestionState", ...item(), status: "open" },
    f.reviewerId,
  );
  assert.equal((await summary()).openSuggestions, 1);
  assert.deepEqual((await summary()).suggestionReviewerIds, [f.userId]);
  // Merge needs an approval of the current version.
  await assert.rejects(
    f.command({ type: "mergeSuggestion", ...base, suggestionId }),
    /at least one reviewer approval/,
  );
  await f.command({
    type: "decideSuggestion",
    ...item(),
    version: 1,
    decision: "approve",
  });
  assert.deepEqual((await summary()).suggestionReviewerIds, []);
  await f.command(
    {
      type: "updateSuggestion",
      ...base,
      suggestionId,
      replacement: "# Safe retries\n\nVersion one.",
      title: "Clarify retry behavior",
      rationale: "Review the idempotency behavior before implementation.",
    },
    f.reviewerId,
  );
  assert.equal((await suggestion()).version, 1);
  assert.equal((await suggestion()).title, "Clarify retry behavior");
  assert.equal(
    (await suggestion()).rationale,
    "Review the idempotency behavior before implementation.",
  );
  assert.deepEqual((await summary()).suggestionReviewerIds, []);
  // A blocking discussion on the suggestion blocks its merge, not readiness.
  const threadId = crypto.randomUUID();
  await f.command({
    type: "createThread",
    ...base,
    threadId,
    messageId: crypto.randomUUID(),
    body: "What about partial failures?",
    blocking: true,
    section: "",
    suggestionId,
  });
  assert.equal((await summary()).blockingThreads, 0);
  await assert.rejects(
    f.command({ type: "mergeSuggestion", ...base, suggestionId }),
    /blocking discussion/,
  );
  await f.command({
    type: "setThreadState",
    workItemId: f.proposalId,
    threadId,
    resolved: true,
    blocking: true,
  });
  // The author pushes a new version: the approval is superseded and the
  // reviewer must look again; a decision on a stale version is a conflict.
  await f.command(
    {
      type: "updateSuggestion",
      ...base,
      suggestionId,
      replacement: "# Safe retries\n\nVersion two handles partial failures.",
      title: "Define retries",
      rationale: "Define retries",
    },
    f.reviewerId,
  );
  assert.equal((await suggestion()).version, 2);
  const decisions = (await f.entities()).filter(
    (e) => e.type === "suggestionDecision",
  );
  assert.equal(decisions.length, 1);
  assert.match(decisions[0]!.supersededReason ?? "", /version 2/);
  assert.deepEqual((await summary()).suggestionReviewerIds, [f.userId]);
  await assert.rejects(
    f.command({
      type: "decideSuggestion",
      ...item(),
      version: 1,
      decision: "approve",
    }),
    /version 2/,
  );
  await assert.rejects(
    f.command({ type: "mergeSuggestion", ...base, suggestionId }),
    /at least one reviewer approval/,
  );
  await f.command({
    type: "decideSuggestion",
    ...item(),
    version: 2,
    decision: "approve",
  });
  // The mainline moves on: the suggestion is outdated until the author
  // updates it against the new revision (which supersedes nothing when the
  // text is unchanged, so the approval survives the rebase).
  await f.command({
    type: "updateSpecification",
    ...base,
    title: first.title,
    content: "# Safe retries\n\nMainline changed.",
    summary: "Mainline edit",
  });
  const second = await f.current();
  await assert.rejects(
    f.command({ type: "mergeSuggestion", ...base, suggestionId }),
    /specification changed/,
  );
  await assert.rejects(
    f.command({
      type: "mergeSuggestion",
      workItemId: f.proposalId,
      baseRevisionId: second.id,
      suggestionId,
    }),
    /author must update/,
  );
  await f.command(
    {
      type: "updateSuggestion",
      workItemId: f.proposalId,
      baseRevisionId: second.id,
      suggestionId,
      replacement: "# Safe retries\n\nVersion two handles partial failures.",
      title: "Define retries",
      rationale: "Define retries",
    },
    f.reviewerId,
  );
  assert.equal((await suggestion()).version, 2);
  assert.equal((await suggestion()).revisionId, second.id);
  await f.command({
    type: "mergeSuggestion",
    workItemId: f.proposalId,
    baseRevisionId: second.id,
    suggestionId,
  });
  const third = await f.current();
  assert.equal(third.number, 3);
  assert.equal(
    third.content,
    "# Safe retries\n\nVersion two handles partial failures.",
  );
  const merged = await suggestion();
  assert.equal(merged.status, "merged");
  assert.equal(merged.mergedRevisionId, third.id);
  assert.equal(merged.resolvedById, f.userId);
  // Merged is terminal; closing and reopening remain reversible otherwise.
  await assert.rejects(
    f.command(
      { type: "setSuggestionState", ...item(), status: "closed" },
      f.reviewerId,
    ),
    /merged suggestion/,
  );
  const other = crypto.randomUUID();
  await f.command(
    {
      type: "createSuggestion",
      workItemId: f.proposalId,
      baseRevisionId: third.id,
      suggestionId: other,
      replacement: "Something else",
      title: "Try",
      rationale: "Try",
      open: true,
    },
    f.reviewerId,
  );
  // An editor may close someone else's suggestion; only the author reopens.
  await f.command({
    type: "setSuggestionState",
    workItemId: f.proposalId,
    suggestionId: other,
    status: "closed",
  });
  await assert.rejects(
    f.command({
      type: "setSuggestionState",
      workItemId: f.proposalId,
      suggestionId: other,
      status: "open",
    }),
    /Only the author/,
  );
  await f.command(
    {
      type: "setSuggestionState",
      workItemId: f.proposalId,
      suggestionId: other,
      status: "draft",
    },
    f.reviewerId,
  );
  const reopened = (await f.entities()).find(
    (e) => e.type === "suggestion" && e.id === other,
  );
  assert.ok(reopened?.type === "suggestion" && reopened.status === "draft");
});

// ---------------------------------------------------------------------------
// Native delivery: types, workflows, iterations, relations.
// ---------------------------------------------------------------------------
const orgScope = (f: Awaited<ReturnType<typeof fixture>>) => ({
  organizationId: f.organizationId,
});
async function orgItems(f: Awaited<ReturnType<typeof fixture>>) {
  const page = pageSchema.parse(await service.read(f.userId, orgScope(f)));
  return page;
}
async function itemOf(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const page = await orgItems(f);
  const found = page.changes.find(
    (c) =>
      c.operation === "upsert" &&
      c.entity.type === "workItem" &&
      c.entity.id === id,
  );
  assert.ok(found?.operation === "upsert" && found.entity.type === "workItem");
  return found.entity;
}
async function create(
  f: Awaited<ReturnType<typeof fixture>>,
  typeId: string,
  extra: Partial<Extract<Command, { type: "createWorkItem" }>> = {},
) {
  const workItemId = crypto.randomUUID();
  await f.command({
    type: "createWorkItem",
    projectId: f.projectId,
    workItemId,
    typeId,
    parentId: null,
    title: "Item",
    ...extra,
  });
  return workItemId;
}

void test("type hierarchy follows levels and only spec-backed types are reviewed", async () => {
  const f = await fixture();
  const epic = await create(f, f.types.Epic);
  const task = await create(f, f.types.Task, { parentId: epic });
  await assert.rejects(
    create(f, f.types.Story, { parentId: task }),
    /cannot be placed under a Task/,
  );
  const subtask = await create(f, f.types.Subtask, { parentId: task });
  const taskItem = await itemOf(f, task);
  assert.equal(taskItem.refinementState, null);
  assert.equal(taskItem.readinessTotal, 0);
  assert.equal((await itemOf(f, subtask)).parentId, task);
  // Plain work has no specification to review.
  const revision = (
    await db
      .select()
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.workItemId, task))
  )[0]!;
  await assert.rejects(
    f.command({
      type: "requestReview",
      workItemId: task,
      baseRevisionId: revision.id,
      reviewId: crypto.randomUUID(),
      disciplineId: f.roles.Engineering,
      userId: null,
      required: true,
    }),
    /no specification to review/,
  );
  // Plain work supports non-blocking comments and replies without a review.
  const commentId = crypto.randomUUID();
  await f.command({
    type: "createThread",
    workItemId: task,
    baseRevisionId: revision.id,
    threadId: commentId,
    messageId: crypto.randomUUID(),
    body: "Screenshot attached in the description.",
    section: "",
    blocking: false,
  });
  await f.command({
    type: "replyToThread",
    workItemId: task,
    threadId: commentId,
    messageId: crypto.randomUUID(),
    body: "I can reproduce it.",
  });
  assert.equal(
    (
      await db
        .select()
        .from(s.threadMessage)
        .where(eq(s.threadMessage.threadId, commentId))
    ).length,
    2,
  );
  await assert.rejects(
    f.command({
      type: "createThread",
      workItemId: task,
      baseRevisionId: revision.id,
      threadId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      body: "Block this",
      section: "",
      blocking: true,
    }),
    /cannot block readiness/,
  );
  // A type with children cannot be demoted below them.
  await assert.rejects(
    f.command({
      type: "updateWorkItem",
      workItemId: task,
      typeId: f.types.Subtask,
    }),
    /cannot be placed under|children that cannot sit/,
  );
  // Decomposition records the parent revision it was derived from.
  const story = await create(f, f.types.Story, { parentId: epic });
  const epicRevision = (
    await db
      .select()
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.workItemId, epic))
  )[0]!;
  assert.equal((await itemOf(f, story)).sourceRevisionId, epicRevision.id);
});

void test("readiness gates starting spec-backed work according to team policy", async () => {
  const f = await fixture();
  // Default policy warns: the move succeeds and the override is recorded.
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    statusId: f.statuses["In Progress"],
  });
  const warned = (await f.entities()).find(
    (e) =>
      e.type === "activity" &&
      e.action === "status_changed" &&
      Array.isArray(e.detail?.startedBeforeReady),
  );
  assert.ok(warned, "override recorded in activity");
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    statusId: f.statuses.Todo,
  });
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    readinessPolicy: "block",
  });
  await assert.rejects(
    f.command({
      type: "updateWorkItem",
      workItemId: f.proposalId,
      statusId: f.statuses["In Progress"],
    }),
    /PAY-1 is not ready to start: .*acceptance criteria/,
  );
  // Plain tasks are never gated.
  const task = await create(f, f.types.Task);
  await f.command({
    type: "updateWorkItem",
    workItemId: task,
    statusId: f.statuses["In Progress"],
  });
  // Only project administrators configure the project.
  await assert.rejects(
    f.command(
      { type: "updateProject", projectId: f.projectId, readinessPolicy: "off" },
      f.reviewerId,
    ),
    /project's administrators/,
  );
});

void test("teams are optional groupings inside a project: moving keeps key, status and iteration", async () => {
  const f = await fixture();
  const platform = crypto.randomUUID();
  await f.command({
    type: "createTeam",
    projectId: f.projectId,
    teamId: platform,
    name: "Platform",
  });
  await assert.rejects(
    f.command({
      type: "createTeam",
      projectId: f.projectId,
      teamId: crypto.randomUUID(),
      name: "platform",
    }),
    /already has a team named/,
  );
  // Items start without a team unless one is chosen.
  assert.equal((await itemOf(f, f.proposalId)).teamId, null);
  const withTeam = await create(f, f.types.Task, { teamId: platform });
  assert.equal((await itemOf(f, withTeam)).teamId, platform);
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    statusId: f.statuses.Done,
  });
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    teamId: platform,
  });
  const moved = await itemOf(f, f.proposalId);
  assert.equal(moved.teamId, platform);
  assert.equal(moved.number, 1);
  assert.equal(moved.statusId, f.statuses.Done);
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    teamId: null,
  });
  assert.equal((await itemOf(f, f.proposalId)).teamId, null);
  // Archived teams keep their items but cannot receive new ones.
  await f.command({
    type: "updateTeam",
    projectId: f.projectId,
    teamId: platform,
    archived: true,
  });
  assert.equal((await itemOf(f, withTeam)).teamId, platform);
  await assert.rejects(
    create(f, f.types.Task, { teamId: platform }),
    /team is unavailable/,
  );
  // Team configuration belongs to project administrators.
  await assert.rejects(
    f.command(
      {
        type: "createTeam",
        projectId: f.projectId,
        teamId: crypto.randomUUID(),
        name: "Auth",
      },
      f.reviewerId,
    ),
    /project's administrators/,
  );
  // Statuses of another project are rejected.
  const other = crypto.randomUUID();
  await f.command({
    type: "createProject",
    projectId: other,
    name: "Billing",
    key: "BIL",
  });
  const otherStatus = (await orgItems(f)).directory.statuses.find(
    (x) => x.projectId === other,
  )!;
  await assert.rejects(
    f.command({
      type: "updateWorkItem",
      workItemId: f.proposalId,
      statusId: otherStatus.id,
    }),
    /unavailable in this project/,
  );
});

void test("archiving a status requires a replacement and moves its items explicitly", async () => {
  const f = await fixture();
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    statusId: f.statuses["In Review"],
  });
  await assert.rejects(
    f.command({
      type: "archiveStatus",
      projectId: f.projectId,
      statusId: f.statuses["In Review"],
      replacementId: f.statuses["In Review"],
    }),
    /another active status/,
  );
  await f.command({
    type: "archiveStatus",
    projectId: f.projectId,
    statusId: f.statuses["In Review"],
    replacementId: f.statuses["In Progress"],
  });
  assert.equal(
    (await itemOf(f, f.proposalId)).statusId,
    f.statuses["In Progress"],
  );
  const history = await db
    .select()
    .from(s.activity)
    .where(eq(s.activity.workItemId, f.proposalId));
  assert.ok(
    history.some(
      (a) =>
        a.action === "status_changed" && a.detail?.reason === "status_archived",
    ),
  );
});

void test("sprints: one active per project, carry-over on completion, frozen reports from recorded events", async () => {
  const f = await fixture();
  const sprint = crypto.randomUUID();
  const next = crypto.randomUUID();
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  for (const [iterationId, from, to] of [
    [sprint, -1, 13],
    [next, 13, 27],
  ] as const)
    await f.command({
      type: "createIteration",
      projectId: f.projectId,
      iterationId,
      name: null,
      goal: "Ship retries",
      startsAt: day(from),
      endsAt: day(to),
    });
  const done = await create(f, f.types.Task, { iterationId: sprint });
  const open = await create(f, f.types.Task, { iterationId: sprint });
  for (const [id, estimate] of [
    [done, 3],
    [open, 5],
  ] as const)
    await f.command({ type: "updateWorkItem", workItemId: id, estimate });
  await f.command({
    type: "startIteration",
    projectId: f.projectId,
    iterationId: sprint,
  });
  await assert.rejects(
    f.command({
      type: "startIteration",
      projectId: f.projectId,
      iterationId: next,
    }),
    /already has an active iteration/,
  );
  // Mid-sprint scope change is visible in the report.
  const late = await create(f, f.types.Bug, { iterationId: sprint });
  await f.command({ type: "updateWorkItem", workItemId: late, estimate: 2 });
  await f.command({
    type: "updateWorkItem",
    workItemId: done,
    statusId: f.statuses.Done,
  });
  const report = await iterationReport(db, f.userId, f.organizationId, sprint);
  assert.deepEqual(report.totals.atStart, { count: 2, points: 8 });
  assert.deepEqual(report.totals.addedAfterStart, { count: 1, points: 2 });
  assert.deepEqual(report.totals.completed, { count: 1, points: 3 });
  assert.equal(report.series.at(-1)!.remaining, 7);
  await f.command({
    type: "completeIteration",
    projectId: f.projectId,
    iterationId: sprint,
    carryOverTo: next,
  });
  assert.equal((await itemOf(f, open)).iterationId, next);
  assert.equal((await itemOf(f, late)).iterationId, next);
  assert.equal((await itemOf(f, done)).iterationId, sprint);
  const frozen = await iterationReport(db, f.userId, f.organizationId, sprint);
  assert.deepEqual(frozen.summary?.carriedOver, { count: 2, points: 7 });
  // Later edits never rewrite a completed iteration's report.
  await f.command({ type: "updateWorkItem", workItemId: done, estimate: 13 });
  const after = await iterationReport(db, f.userId, f.organizationId, sprint);
  assert.deepEqual(after.totals, frozen.totals);
  assert.deepEqual(after.summary, frozen.summary);
  // Completed iterations cannot receive work.
  await assert.rejects(
    f.command({
      type: "updateWorkItem",
      workItemId: open,
      iterationId: sprint,
    }),
    /is completed/,
  );
  // Planning requires project administration or changing properties.
  await assert.rejects(
    f.command(
      { type: "startIteration", projectId: f.projectId, iterationId: next },
      f.reviewerId,
    ),
    /cannot plan iterations/,
  );
  assert.equal(
    (await iterationReport(db, f.userId, f.organizationId, next)).velocity.at(
      -1,
    )?.completed,
    3,
  );
});

void test("automatic cycles are scheduled idempotently and roll unfinished work over", async () => {
  const f = await fixture();
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    iterationMode: "automatic",
    iterationWeeks: 1,
    upcomingIterations: 2,
  });
  const cycles = async () =>
    db
      .select()
      .from(s.iteration)
      .where(eq(s.iteration.projectId, f.projectId))
      .orderBy(s.iteration.number);
  let rows = await cycles();
  assert.equal(rows.filter((r) => r.state === "active").length, 1);
  assert.equal(rows.filter((r) => r.state === "planned").length, 2);
  const active = rows.find((r) => r.state === "active")!;
  const item = await create(f, f.types.Task, { iterationId: active.id });
  const first = await advanceSchedules(db, new Date());
  assert.equal(first.changedOrganizations, 0, "already up to date");
  // Two weeks later: the active cycle completes and the next one starts.
  const later = new Date(active.endsAt.getTime() + 8 * 86_400_000);
  await advanceSchedules(db, later);
  const again = await advanceSchedules(db, later);
  assert.equal(again.changedOrganizations, 0);
  rows = await cycles();
  assert.equal(rows.filter((r) => r.state === "active").length, 1);
  assert.equal(rows.filter((r) => r.state === "planned").length, 2);
  const current = rows.find((r) => r.state === "active")!;
  assert.ok(current.startsAt <= later && current.endsAt > later);
  assert.equal((await itemOf(f, item)).iterationId, current.id);
  // Scheduled changes reach clients through the change log.
  const moved = (await orgItems(f)).changes.some(
    (c) => c.operation === "upsert" && c.entity.type === "workItem",
  );
  assert.ok(moved);
});

void test("relations stay inside the organization, reject reverse blocks, and tombstone on removal", async () => {
  const f = await fixture();
  const g = await fixture();
  const a = await create(f, f.types.Task);
  await assert.rejects(
    f.command({
      type: "addRelation",
      workItemId: a,
      relationId: crypto.randomUUID(),
      toId: g.proposalId,
      kind: "relates",
    }),
    /unavailable/,
  );
  const relationId = crypto.randomUUID();
  await f.command({
    type: "addRelation",
    workItemId: a,
    relationId,
    toId: f.proposalId,
    kind: "blocks",
  });
  await assert.rejects(
    f.command({
      type: "addRelation",
      workItemId: f.proposalId,
      relationId: crypto.randomUUID(),
      toId: a,
      kind: "blocks",
    }),
    /other way round/,
  );
  const before = await orgItems(f);
  assert.ok(
    before.changes.some(
      (c) => c.operation === "upsert" && c.entity.id === relationId,
    ),
  );
  await f.command({
    type: "removeRelation",
    workItemId: f.proposalId,
    relationId,
  });
  const delta = pageSchema.parse(
    await service.read(f.userId, orgScope(f), before.nextCursor),
  );
  assert.ok(
    delta.changes.some(
      (c) =>
        c.operation === "delete" &&
        c.type === "relation" &&
        c.id === relationId,
    ),
  );
  // Foreign teams are unavailable too (tenant isolation on new references).
  const foreignTeam = crypto.randomUUID();
  await g.command({
    type: "createTeam",
    projectId: g.projectId,
    teamId: foreignTeam,
    name: "Elsewhere",
  });
  await assert.rejects(
    create(f, f.types.Task, { teamId: foreignTeam }),
    /team is unavailable/,
  );
});

void test("ranks order the backlog with single-row moves", async () => {
  const f = await fixture();
  const a = await create(f, f.types.Task);
  const b = await create(f, f.types.Task);
  await f.command({
    type: "rankWorkItem",
    workItemId: b,
    afterId: null,
    beforeId: f.proposalId,
  });
  const ranks = await Promise.all(
    [f.proposalId, a, b].map((id) => itemOf(f, id)),
  );
  const [p, ra, rb] = ranks.map((r) => r.rank);
  assert.ok(rb! < p! && p! < ra!);
});

void test("committed observers run once after authorization and commit, tolerate failure and ignore receipt replays", async () => {
  const f = await fixture();
  const notifications: string[] = [];
  const observed = createSyncService(db, {
    onMutationCommitted: (_user, mutation, snapshots) => {
      notifications.push(mutation.id);
      assert.ok(snapshots.after.some((entity) => entity.type === "workItem"));
      throw new Error("Analytics is offline");
    },
  });
  const mutation = {
    protocol: PROTOCOL,
    id: crypto.randomUUID(),
    organizationId: f.organizationId,
    command: {
      type: "updateWorkItem" as const,
      workItemId: f.proposalId,
      priority: "high" as const,
    },
  };
  const first = await observed.mutate(f.userId, mutation);
  const retry = await observed.mutate(f.userId, mutation);
  assert.deepEqual(first, retry);
  assert.deepEqual(notifications, [mutation.id]);
  const item = (await f.entities()).find(
    (entity) => entity.type === "workItem" && entity.id === f.proposalId,
  );
  assert.ok(item?.type === "workItem");
  assert.equal(item.priority, "high");
  await assert.rejects(
    observed.mutate("nonmember", { ...mutation, id: crypto.randomUUID() }),
    DomainError,
  );
  await assert.rejects(
    observed.mutate(f.userId, {
      ...mutation,
      id: crypto.randomUUID(),
      command: {
        type: "updateSpecification",
        workItemId: f.proposalId,
        baseRevisionId: "obsolete",
        title: "Changed",
        content: "Changed",
      },
    }),
    DomainError,
  );
  assert.deepEqual(notifications, [mutation.id]);
});

void test("shared branches merge independent commits, reject overlap and preserve main", async () => {
  const f = await fixture(),
    base = await f.current(),
    branchId = crypto.randomUUID();
  await f.command({
    type: "updateSpecification",
    workItemId: f.proposalId,
    baseRevisionId: base.id,
    title: base.title,
    content: "one\ntwo\nthree",
  });
  const main = await f.current();
  await f.command({
    type: "createBranch",
    workItemId: f.proposalId,
    baseRevisionId: main.id,
    branchId,
    name: "shared",
  });
  const branch = async () => {
    const all = await f.entities();
    return all.find(
      (e): e is Extract<Entity, { type: "specBranch" }> =>
        e.type === "specBranch" && e.id === branchId,
    )!;
  };
  const head = (await branch()).headId;
  await assert.rejects(
    f.command(
      {
        type: "commitBranch",
        workItemId: f.proposalId,
        branchId,
        baseCommitId: head,
        title: main.title,
        content: "ONE\ntwo\nthree",
        message: "First edit",
      },
      f.reviewerId,
    ),
    /invited collaborators/,
  );
  await f.command({
    type: "setBranchCollaborator",
    workItemId: f.proposalId,
    branchId,
    userId: f.reviewerId,
    assigned: true,
  });
  await f.command({
    type: "commitBranch",
    workItemId: f.proposalId,
    branchId,
    baseCommitId: head,
    title: main.title,
    content: "ONE\ntwo\nthree",
    message: "First edit",
  });
  await f.command(
    {
      type: "commitBranch",
      workItemId: f.proposalId,
      branchId,
      baseCommitId: head,
      title: main.title,
      content: "one\ntwo\nTHREE",
      message: "Independent edit",
    },
    f.reviewerId,
  );
  let all = await f.entities(),
    latest = all.find(
      (e) =>
        e.type === "specCommit" &&
        e.id ===
          (
            all.find(
              (e) => e.type === "specBranch" && e.id === branchId,
            ) as Extract<Entity, { type: "specBranch" }>
          ).headId,
    );
  assert.equal(
    latest?.type === "specCommit" && latest.content,
    "ONE\ntwo\nTHREE",
  );
  assert.equal((await f.current()).id, main.id);
  await assert.rejects(
    f.command({
      type: "commitBranch",
      workItemId: f.proposalId,
      branchId,
      baseCommitId: head,
      title: "My title",
      content: "DIFFERENT\ntwo\nthree",
      message: "Overlap",
    }),
    /overlap/,
  );
  const currentHead = (await branch()).headId;
  await assert.rejects(
    f.command({
      type: "commitBranch",
      workItemId: f.proposalId,
      branchId,
      baseCommitId: head,
      expectedHeadId: head,
      title: main.title,
      content: "resolved",
      message: "Old resolution",
    }),
    /changed again/,
  );
  await f.command({
    type: "commitBranch",
    workItemId: f.proposalId,
    branchId,
    baseCommitId: head,
    expectedHeadId: currentHead,
    title: "Resolved title",
    content: "RESOLVED\ntwo\nTHREE",
    message: "Resolve explicitly",
  });
  all = await f.entities();
  const resolvedHead = (await branch()).headId;
  latest = all.find((e) => e.type === "specCommit" && e.id === resolvedHead);
  assert.equal(latest?.type === "specCommit" && latest.title, "Resolved title");
  const first = all.find((e) => e.type === "specCommit" && e.id === head);
  assert.equal(
    first?.type === "specCommit" && first.content,
    "one\ntwo\nthree",
  );
});

void test("PR approval binds to merge result, supplies main reviews, protects main and restores revisions", async () => {
  const f = await fixture(),
    original = await f.current(),
    branchId = crypto.randomUUID(),
    pullRequestId = crypto.randomUUID();
  await f.command({
    type: "createBranch",
    workItemId: f.proposalId,
    baseRevisionId: original.id,
    branchId,
    name: "reviewed",
  });
  const get = async () => {
    const all = await f.entities();
    return {
      all,
      source: all.find(
        (e): e is Extract<Entity, { type: "specBranch" }> =>
          e.type === "specBranch" && e.id === branchId,
      )!,
      target: all.find(
        (e): e is Extract<Entity, { type: "specBranch" }> =>
          e.type === "specBranch" && e.name === "main",
      )!,
    };
  };
  let b = await get();
  await f.command({
    type: "commitBranch",
    workItemId: f.proposalId,
    branchId,
    baseCommitId: b.source.headId,
    title: "Safe retries reviewed",
    content:
      "Retry with the same key.\n\n## Acceptance criteria\n\n- [ ] No duplicate payments",
    message: "Define behavior",
  });
  await f.command({
    type: "createPullRequest",
    workItemId: f.proposalId,
    pullRequestId,
    sourceId: branchId,
    targetId: b.target.id,
    title: "Review retries",
    description: "Define safe retry behavior",
    draft: true,
  });
  await f.command({
    type: "requestPullRequestReview",
    workItemId: f.proposalId,
    pullRequestId,
    disciplineId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  b = await get();
  const review = b.all.find(
    (e): e is Extract<Entity, { type: "prReview" }> =>
      e.type === "prReview" && e.pullRequestId === pullRequestId,
  )!;
  const decide = () =>
    f.command(
      {
        type: "decidePullRequest",
        workItemId: f.proposalId,
        pullRequestId,
        reviewId: review.id,
        sourceHeadId: b.source.headId,
        targetHeadId: b.target.headId,
        decision: "approve",
      },
      f.reviewerId,
    );
  await assert.rejects(decide(), /draft/);
  await f.command({
    type: "setPullRequestDraft",
    workItemId: f.proposalId,
    pullRequestId,
    draft: false,
  });
  await decide();
  // A concurrent main title change changes the full resulting snapshot.
  await f.command({
    type: "updateSpecification",
    workItemId: f.proposalId,
    baseRevisionId: original.id,
    title: "Concurrent title",
    content: original.content,
  });
  b = await get();
  await assert.rejects(
    f.command({
      type: "mergePullRequest",
      workItemId: f.proposalId,
      pullRequestId,
      sourceHeadId: b.source.headId,
      targetHeadId: b.target.headId,
    }),
    /conflict/,
  );
  const commits = b.all.filter(
    (e): e is Extract<Entity, { type: "specCommit" }> =>
      e.type === "specCommit",
  );
  const source = commits.find((c) => c.id === b.source.headId)!;
  await f.command({
    type: "syncBranch",
    workItemId: f.proposalId,
    branchId,
    targetId: b.target.id,
    sourceHeadId: b.source.headId,
    targetHeadId: b.target.headId,
    title: "Final title",
    content: source.content,
  });
  b = await get();
  await assert.rejects(
    f.command({
      type: "mergePullRequest",
      workItemId: f.proposalId,
      pullRequestId,
      sourceHeadId: b.source.headId,
      targetHeadId: b.target.headId,
    }),
    /required responsibility/,
  );
  await decide();
  const mutationId = crypto.randomUUID(),
    mergeCommand = {
      type: "mergePullRequest" as const,
      workItemId: f.proposalId,
      pullRequestId,
      sourceHeadId: b.source.headId,
      targetHeadId: b.target.headId,
    };
  await assert.rejects(
    f.command(mergeCommand, f.reviewerId),
    /disciplines in this project cannot merge/,
  );
  // Cleanup and its audit event must roll back with the merge if any write fails.
  await client`CREATE FUNCTION reject_branch_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'branch_deleted' THEN RAISE EXCEPTION 'forced cleanup failure'; END IF; RETURN NEW; END $$`;
  await client`CREATE TRIGGER branch_cleanup_failure BEFORE INSERT ON activity FOR EACH ROW EXECUTE FUNCTION reject_branch_cleanup()`;
  try {
    await assert.rejects(f.command(mergeCommand, f.userId, mutationId));
  } finally {
    await client`DROP TRIGGER branch_cleanup_failure ON activity`;
    await client`DROP FUNCTION reject_branch_cleanup()`;
  }
  assert.equal((await f.current()).number, 2);
  const rolledBack = await f.entities();
  assert.ok(
    rolledBack.some((e) => e.type === "specBranch" && e.id === branchId),
  );
  assert.ok(
    rolledBack.some(
      (e) =>
        e.type === "pullRequest" &&
        e.id === pullRequestId &&
        e.status === "open",
    ),
  );
  assert.ok(
    !rolledBack.some(
      (e) => e.type === "activity" && e.action === "branch_deleted",
    ),
  );
  const checkpoint = (await f.read()).nextCursor;
  await f.command(mergeCommand, f.userId, mutationId);
  await f.command(mergeCommand, f.userId, mutationId);
  let all = await f.entities(),
    main = await f.current();
  assert.equal(main.title, "Final title");
  assert.equal(main.number, 3);
  assert.ok(!all.some((e) => e.type === "specBranch" && e.id === branchId));
  assert.ok(all.some((e) => e.type === "specBranch" && e.name === "main"));
  assert.ok(
    all.some((e) => e.type === "specCommit" && e.id === b.source.headId),
  );
  assert.ok(all.some((e) => e.type === "prReview" && e.id === review.id));
  const deletion = all.filter(
    (e): e is Extract<Entity, { type: "activity" }> =>
      e.type === "activity" && e.action === "branch_deleted",
  );
  assert.equal(deletion.length, 1);
  assert.equal(deletion[0]!.actorId, f.userId);
  assert.deepEqual(deletion[0]!.detail, {
    branchId,
    branch: "reviewed",
    automatic: true,
    reason: "pull_request_merged",
    pullRequestId,
  });
  assert.ok(
    all.some(
      (e) =>
        e.type === "activity" &&
        e.action === "pull_request_merged" &&
        e.createdAt < deletion[0]!.createdAt,
    ),
  );
  const delta = await f.read(checkpoint);
  assert.equal(
    delta.changes.filter(
      (c) =>
        c.operation === "delete" &&
        c.type === "specBranch" &&
        c.id === branchId,
    ).length,
    1,
  );
  await assert.rejects(
    f.command({
      type: "commitBranch",
      workItemId: f.proposalId,
      branchId,
      baseCommitId: b.source.headId,
      title: "Edit a deleted branch",
      content: "Unavailable",
      message: "Cannot commit",
    }),
    /unavailable/,
  );
  assert.equal(
    all.find((e) => e.type === "workItem" && e.id === f.proposalId)?.type ===
      "workItem" &&
      (
        all.find(
          (e) => e.type === "workItem" && e.id === f.proposalId,
        ) as Extract<Entity, { type: "workItem" }>
      ).refinementState,
    "ready",
  );
  assert.equal(
    all.filter(
      (e) =>
        e.type === "approval" &&
        e.status === "granted" &&
        e.revisionId === main.id,
    ).length,
    1,
  );
  await assert.rejects(
    f.command({
      type: "updateSpecification",
      workItemId: f.proposalId,
      baseRevisionId: main.id,
      title: main.title,
      content: "Silent edit",
    }),
    /ready/,
  );
  await assert.rejects(
    f.command(
      {
        type: "revertSpecification",
        workItemId: f.proposalId,
        baseRevisionId: main.id,
        revisionId: original.id,
      },
      f.reviewerId,
    ),
    /cannot restore specification revisions/,
  );
  await f.command({
    type: "revertSpecification",
    workItemId: f.proposalId,
    baseRevisionId: main.id,
    revisionId: original.id,
  });
  main = await f.current();
  assert.equal(main.number, 4);
  assert.equal(main.content, original.content);
  all = await f.entities();
  assert.ok(all.some((e) => e.type === "approval" && e.status === "stale"));
  await assert.rejects(
    f.command({
      type: "updateSpecification",
      workItemId: f.proposalId,
      baseRevisionId: main.id,
      title: main.title,
      content: "Bypass after revert",
    }),
    /ready/,
  );
});

for (const scenario of ["non-main", "draft-source", "open-target"] as const) {
  void test(`automatic branch cleanup retains a branch used by ${scenario}`, async () => {
    const f = await fixture(),
      original = await f.current(),
      sourceId = crypto.randomUUID(),
      otherId = crypto.randomUUID(),
      pullRequestId = crypto.randomUUID();
    for (const [branchId, name] of [
      [sourceId, "source"],
      [otherId, "other"],
    ]) {
      await f.command({
        type: "createBranch",
        workItemId: f.proposalId,
        baseRevisionId: original.id,
        branchId: branchId!,
        name: name!,
      });
    }
    const branch = async (id: string) =>
      (await f.entities()).find(
        (e): e is Extract<Entity, { type: "specBranch" }> =>
          e.type === "specBranch" && e.id === id,
      )!;
    await f.command({
      type: "commitBranch",
      workItemId: f.proposalId,
      branchId: sourceId,
      baseCommitId: (await branch(sourceId)).headId,
      title: original.title,
      content: "Reviewed behavior",
      message: "Source change",
    });
    const main = (await f.entities()).find(
      (e): e is Extract<Entity, { type: "specBranch" }> =>
        e.type === "specBranch" && e.name === "main",
    )!;
    const targetId = scenario === "non-main" ? otherId : main.id;
    await f.command({
      type: "createPullRequest",
      workItemId: f.proposalId,
      pullRequestId,
      sourceId,
      targetId,
      title: "Reviewed PR",
      description: "Review source behavior",
      draft: false,
    });
    if (scenario !== "non-main") {
      await f.command({
        type: "createPullRequest",
        workItemId: f.proposalId,
        pullRequestId: crypto.randomUUID(),
        sourceId: scenario === "draft-source" ? sourceId : otherId,
        targetId: scenario === "draft-source" ? otherId : sourceId,
        title: "Keep reviewing",
        description: "Still needs the source branch",
        draft: scenario === "draft-source",
      });
    }
    await f.command({
      type: "requestPullRequestReview",
      workItemId: f.proposalId,
      pullRequestId,
      disciplineId: f.roles.QA,
      userId: f.reviewerId,
      required: true,
    });
    const review = (await f.entities()).find(
      (e): e is Extract<Entity, { type: "prReview" }> =>
        e.type === "prReview" && e.pullRequestId === pullRequestId,
    )!;
    const heads = {
      sourceHeadId: (await branch(sourceId)).headId,
      targetHeadId: (await branch(targetId)).headId,
    };
    await f.command(
      {
        type: "decidePullRequest",
        workItemId: f.proposalId,
        pullRequestId,
        reviewId: review.id,
        decision: "approve",
        ...heads,
      },
      f.reviewerId,
    );
    await f.command({
      type: "mergePullRequest",
      workItemId: f.proposalId,
      pullRequestId,
      ...heads,
    });
    const all = await f.entities();
    assert.ok(all.some((e) => e.type === "specBranch" && e.id === sourceId));
    assert.ok(
      all.some(
        (e) =>
          e.type === "pullRequest" &&
          e.id === pullRequestId &&
          e.status === "merged",
      ),
    );
    assert.ok(
      !all.some((e) => e.type === "activity" && e.action === "branch_deleted"),
    );
    assert.equal((await f.current()).number, scenario === "non-main" ? 1 : 2);
  });
}

void test("branch/PR deletion emits tombstones, keeps history, and branches can target other branches", async () => {
  const f = await fixture(),
    revision = await f.current(),
    parentId = crypto.randomUUID(),
    childId = crypto.randomUUID(),
    pullRequestId = crypto.randomUUID();
  await f.command({
    type: "createBranch",
    workItemId: f.proposalId,
    baseRevisionId: revision.id,
    branchId: parentId,
    name: "parent",
  });
  await f.command({
    type: "createBranch",
    workItemId: f.proposalId,
    baseRevisionId: revision.id,
    branchId: childId,
    name: "child",
    fromBranchId: parentId,
  });
  let all = await f.entities();
  const child = all.find(
    (e): e is Extract<Entity, { type: "specBranch" }> =>
      e.type === "specBranch" && e.id === childId,
  )!;
  await f.command({
    type: "commitBranch",
    workItemId: f.proposalId,
    branchId: childId,
    baseCommitId: child.headId,
    title: revision.title,
    content: "Child change",
    message: "Child commit",
  });
  await f.command({
    type: "createPullRequest",
    workItemId: f.proposalId,
    pullRequestId,
    sourceId: childId,
    targetId: parentId,
    title: "Child PR",
    description: "Changes parent only",
    draft: true,
  });
  await assert.rejects(
    f.command({
      type: "deleteBranch",
      workItemId: f.proposalId,
      branchId: childId,
    }),
    /active pull requests/,
  );
  const checkpoint = (await f.read()).nextCursor;
  await f.command({
    type: "deletePullRequest",
    workItemId: f.proposalId,
    pullRequestId,
  });
  await f.command({
    type: "deleteBranch",
    workItemId: f.proposalId,
    branchId: childId,
  });
  const delta = await f.read(checkpoint);
  assert.ok(
    delta.changes.some(
      (c) =>
        c.operation === "delete" &&
        c.type === "pullRequest" &&
        c.id === pullRequestId,
    ),
  );
  assert.ok(
    delta.changes.some(
      (c) =>
        c.operation === "delete" && c.type === "specBranch" && c.id === childId,
    ),
  );
  all = await f.entities();
  assert.ok(
    all.some((e) => e.type === "specCommit" && e.message === "Child commit"),
  );
  assert.equal((await f.current()).id, revision.id);
  const main = all.find(
    (e): e is Extract<Entity, { type: "specBranch" }> =>
      e.type === "specBranch" && e.name === "main",
  )!;
  await assert.rejects(
    f.command({
      type: "deleteBranch",
      workItemId: f.proposalId,
      branchId: main.id,
    }),
    /cannot be deleted/,
  );
  const other = await fixture();
  await assert.rejects(
    other.command({
      type: "deleteBranch",
      workItemId: other.proposalId,
      branchId: parentId,
    }),
    /unavailable/,
  );
});

void test("projects start configured; project roles and disciplines are scoped to one project", async () => {
  const f = await fixture();
  const page = await orgItems(f);
  const project = page.directory.projects.find((p) => p.id === f.projectId)!;
  assert.equal(project.deliveryMode, "native");
  assert.equal(project.readinessPolicy, "warn");
  // The creator administers the project and holds Product.
  assert.deepEqual(
    page.directory.projectMembers.find(
      (m) => m.projectId === f.projectId && m.userId === f.userId,
    )?.role,
    "admin",
  );
  assert.deepEqual(
    page.directory.disciplines
      .filter((d) => d.projectId === f.projectId)
      .map((d) => d.name)
      .sort(),
    ["Engineering", "Product", "QA"],
  );
  assert.ok(
    page.directory.disciplines
      .find((d) => d.id === f.roles.Product)
      ?.userIds.includes(f.userId),
  );
  assert.ok(
    page.directory.projectTypes.filter((t) => t.projectId === f.projectId)
      .length >= 5,
  );
  // Only organization administrators create projects.
  await assert.rejects(
    f.command(
      {
        type: "createProject",
        projectId: crypto.randomUUID(),
        name: "Other",
        key: "OTH",
      },
      f.reviewerId,
    ),
    /administrator must create projects/,
  );
  // A second project with its own disciplines: holding Product in PAY grants
  // nothing in BIL.
  const billing = crypto.randomUUID();
  await f.command({
    type: "createProject",
    projectId: billing,
    name: "Billing",
    key: "BIL",
  });
  const product = (await orgItems(f)).directory.disciplines.find(
    (d) => d.projectId === billing && d.name === "Product",
  )!;
  await f.command({
    type: "setDisciplineMember",
    projectId: f.projectId,
    disciplineId: f.roles.Product,
    userId: f.reviewerId,
    member: true,
  });
  await assert.rejects(
    f.command(
      {
        type: "createWorkItem",
        projectId: billing,
        workItemId: crypto.randomUUID(),
        typeId: f.types.Story,
        parentId: null,
        title: "Invoices",
      },
      f.reviewerId,
    ),
    /cannot edit specifications/,
  );
  // A discipline belongs to its project.
  await assert.rejects(
    f.command({
      type: "setDisciplineMember",
      projectId: f.projectId,
      disciplineId: product.id,
      userId: f.reviewerId,
      member: true,
    }),
    /discipline is unavailable/,
  );
  // Project administrators configure their project, not others; organization
  // administration is not delegated.
  await f.command({
    type: "setProjectMember",
    projectId: f.projectId,
    userId: f.reviewerId,
    role: "admin",
  });
  await f.command(
    { type: "updateProject", projectId: f.projectId, readinessPolicy: "block" },
    f.reviewerId,
  );
  await assert.rejects(
    f.command(
      { type: "updateProject", projectId: billing, readinessPolicy: "block" },
      f.reviewerId,
    ),
    /project's administrators/,
  );
  await assert.rejects(
    f.command(
      { type: "archiveProject", projectId: f.projectId, archived: true },
      f.reviewerId,
    ),
    /organization administrator/,
  );
  await assert.rejects(
    f.command(
      {
        type: "createType",
        typeId: crypto.randomUUID(),
        name: "Spike",
        icon: "spike",
        color: "teal",
        level: 1,
        hasSpecification: false,
      },
      f.reviewerId,
    ),
    /organization administrator/,
  );
  // Leaving a project removes its disciplines there, so capabilities end.
  await f.command({
    type: "setProjectMember",
    projectId: f.projectId,
    userId: f.reviewerId,
    role: null,
  });
  const after = (await orgItems(f)).directory;
  assert.ok(
    !after.disciplines.some(
      (d) => d.projectId === f.projectId && d.userIds.includes(f.reviewerId),
    ),
  );
  assert.ok(
    !after.projectMembers.some(
      (m) => m.projectId === f.projectId && m.userId === f.reviewerId,
    ),
  );
  // Archived projects are read-only until restored.
  await f.command({
    type: "archiveProject",
    projectId: billing,
    archived: true,
  });
  await assert.rejects(
    f.command({
      type: "createWorkItem",
      projectId: billing,
      workItemId: crypto.randomUUID(),
      typeId: f.types.Story,
      parentId: null,
      title: "Late",
    }),
    /unavailable/,
  );
  await f.command({
    type: "archiveProject",
    projectId: billing,
    archived: false,
  });
  await f.command({
    type: "createWorkItem",
    projectId: billing,
    workItemId: crypto.randomUUID(),
    typeId: f.types.Story,
    parentId: null,
    title: "Restored",
  });
});

void test("enabled types are project configuration and plain work needs no specification rights", async () => {
  const f = await fixture();
  await assert.rejects(
    f.command({
      type: "setProjectType",
      projectId: f.projectId,
      typeId: f.types.Story,
      enabled: false,
    }),
    /Story item belongs/,
  );
  await f.command({
    type: "setProjectType",
    projectId: f.projectId,
    typeId: f.types.Bug,
    enabled: false,
  });
  await assert.rejects(create(f, f.types.Bug), /does not use Bug items/);
  await f.command({
    type: "setProjectType",
    projectId: f.projectId,
    typeId: f.types.Bug,
    enabled: true,
  });
  // A discipline that changes properties but does not edit specifications
  // can file plain work, never specifications.
  await f.command({
    type: "updateDiscipline",
    projectId: f.projectId,
    disciplineId: f.roles.QA,
    capabilities: {
      editSpecifications: false,
      changeProperties: true,
      requestReviews: true,
      review: true,
      publishDelivery: false,
    },
  });
  const bug = crypto.randomUUID();
  await f.command(
    {
      type: "createWorkItem",
      projectId: f.projectId,
      workItemId: bug,
      typeId: f.types.Bug,
      parentId: null,
      title: "Crash on retry",
    },
    f.reviewerId,
  );
  await assert.rejects(
    f.command(
      {
        type: "createWorkItem",
        projectId: f.projectId,
        workItemId: crypto.randomUUID(),
        typeId: f.types.Story,
        parentId: null,
        title: "Spec",
      },
      f.reviewerId,
    ),
    /cannot edit specifications/,
  );
});

void test("delivery mode decides who owns delivery: external projects never plan or estimate in Lictory", async () => {
  const f = await fixture();
  const sprint = crypto.randomUUID();
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await f.command({
    type: "createIteration",
    projectId: f.projectId,
    iterationId: sprint,
    name: null,
    goal: null,
    startsAt: day(-1),
    endsAt: day(13),
  });
  await f.command({
    type: "startIteration",
    projectId: f.projectId,
    iterationId: sprint,
  });
  await assert.rejects(
    f.command({
      type: "updateProject",
      projectId: f.projectId,
      deliveryMode: "external",
    }),
    /Complete the active iteration/,
  );
  await f.command({
    type: "completeIteration",
    projectId: f.projectId,
    iterationId: sprint,
    carryOverTo: null,
  });
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    deliveryMode: "external",
  });
  const project = (await orgItems(f)).directory.projects.find(
    (p) => p.id === f.projectId,
  )!;
  assert.equal(project.iterationMode, "off");
  assert.equal(project.estimateScale, "none");
  await assert.rejects(
    f.command({
      type: "updateProject",
      projectId: f.projectId,
      iterationMode: "manual",
    }),
    /plans and estimates it/,
  );
  await assert.rejects(
    f.command({
      type: "createIteration",
      projectId: f.projectId,
      iterationId: crypto.randomUUID(),
      name: null,
      goal: null,
      startsAt: day(1),
      endsAt: day(14),
    }),
    /external tool/,
  );
  await assert.rejects(
    f.command({
      type: "updateWorkItem",
      workItemId: f.proposalId,
      estimate: 3,
    }),
    /does not estimate work/,
  );
  // Switching back lets the project plan again.
  await f.command({
    type: "updateProject",
    projectId: f.projectId,
    deliveryMode: "native",
    iterationMode: "manual",
    estimateScale: "fibonacci",
  });
  await f.command({
    type: "updateWorkItem",
    workItemId: f.proposalId,
    estimate: 3,
  });
});
