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
import { seedDefaultRoles } from "./roles";
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
  // A small team: the owner holds every default role, the reviewer holds the
  // two reviewer-only roles (Engineering, QA).
  await seedDefaultRoles(db, organizationId, userId);
  const roleRows = await db
    .select()
    .from(s.organizationRole)
    .where(eq(s.organizationRole.organizationId, organizationId));
  const roles = Object.fromEntries(roleRows.map((r) => [r.name, r.id])) as {
    Product: string;
    Engineering: string;
    QA: string;
  };
  await db.insert(s.organizationRoleMember).values([
    { organizationId, roleId: roles.Engineering, userId },
    { organizationId, roleId: roles.QA, userId },
    { organizationId, roleId: roles.Engineering, userId: reviewerId },
    { organizationId, roleId: roles.QA, userId: reviewerId },
  ]);
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
  const project = (
    await db
      .select()
      .from(s.project)
      .where(eq(s.project.organizationId, organizationId))
  )[0]!;
  const proposalId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId: project.id,
    workItemId: proposalId,
    kind: "story",
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
    roleId: f.roles.Engineering,
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
  await f.command({
    type: "createSuggestion",
    ...base,
    suggestionId: crypto.randomUUID(),
    replacement: "# Safe retries\n\nRetries reuse the original transaction ID.",
    rationale: "Make idempotency explicit",
  });
  const suggestion = (await f.entities()).find((e) => e.type === "suggestion")!;
  const id = crypto.randomUUID();
  const accept: Command = {
    type: "decideSuggestion",
    ...base,
    suggestionId: suggestion.id,
    accept: true,
  };
  await f.command(accept, f.userId, id);
  await f.command(accept, f.userId, id);
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
        kind: "epic",
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
        kind: "epic",
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
    roleId: f.roles.QA,
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
    roleId: f.roles.QA,
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
    roleId: f.roles.Engineering,
    userId: f.userId,
    required: true,
  });
  await f.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    roleId: f.roles.Engineering,
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
  await assert.rejects(
    f.command({
      type: "updateWorkItem",
      workItemId: f.proposalId,
      status: "ready",
    }),
    /Not ready yet/,
  );
  await f.command({
    type: "requestReview",
    ...base2,
    reviewId: crypto.randomUUID(),
    roleId: f.roles.Engineering,
    userId: f.reviewerId,
    required: true,
  });
  let item = (await f.entities()).find((e) => e.type === "workItem")!;
  assert.equal(item.type === "workItem" && item.status, "in_review");
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
  assert.equal(item.type === "workItem" && item.status, "ready");
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
      item.status === "ready" &&
      item.priority === "high",
  );
  // Material: a new revision stales the approval, re-requests the review with
  // the same assignment, and drops the item back to in_review.
  await f.command({
    type: "updateSpecification",
    ...base2,
    title: "Safe retries",
    content:
      "# Intent\n\nRetries with idempotency keys.\n\n## Acceptance criteria\n\n- [ ] No duplicate charge",
    summary: "Define idempotency",
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
      item.status === "in_review" &&
      item.reviews.length === 1,
  );
  assert.deepEqual(item.type === "workItem" && item.reviews[0]!.assigneeIds, [
    f.reviewerId,
  ]);
  assert.ok(
    all.some((e) => e.type === "activity" && e.action === "status_changed"),
  );
});

void test("work item numbering, hierarchy validation and epic readiness over stories", async () => {
  const f = await fixture();
  const epicId = crypto.randomUUID();
  await f.command({
    type: "createWorkItem",
    projectId: f.projectId,
    workItemId: epicId,
    kind: "epic",
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
      kind: "story",
      parentId: f.proposalId, // a story, not an epic
      title: "Invalid parent",
    }),
    /belong to an Epic/,
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
      readiness.checks.some((c) => c.key === "stories_ready" && !c.passed),
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
    roleId: f.roles.QA,
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
    kind: "epic",
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
      kind: "story",
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
  const extra = Array.from({ length: 25 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: i === 0 ? "Zelda Query" : `Member ${String(i).padStart(2, "0")}`,
    email: `member${i}@example.test`,
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
    kind: "epic" as const,
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
    kind: "epic",
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

void test("organization roles grant capabilities; administrators manage roles; reviews target reviewer roles", async () => {
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
        kind: "story",
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
      rationale: "Idempotency was undefined.",
    },
    f.reviewerId,
  );
  await assert.rejects(
    f.command(
      { type: "decideSuggestion", ...base, suggestionId, accept: true },
      f.reviewerId,
    ),
    /cannot edit specifications directly/,
  );
  await f.command({
    type: "decideSuggestion",
    ...base,
    suggestionId,
    accept: true,
  });
  const second = await f.current();
  assert.equal(second.number, 2);
  // Only administrators manage roles.
  const roleId = crypto.randomUUID();
  const securityRole = {
    type: "createRole" as const,
    roleId,
    name: "Security",
    capabilities: {
      editSpecifications: false,
      changeProperties: false,
      requestReviews: false,
      review: false,
    },
  };
  await assert.rejects(
    f.command(securityRole, f.reviewerId),
    /administrator must manage roles/,
  );
  await f.command(securityRole);
  await assert.rejects(
    f.command({
      ...securityRole,
      roleId: crypto.randomUUID(),
      name: "security",
    }),
    /already exists/,
  );
  // A role that cannot review cannot be asked, and a person can only be asked
  // through a role they hold.
  const base2 = { workItemId: f.proposalId, baseRevisionId: second.id };
  await assert.rejects(
    f.command({
      type: "requestReview",
      ...base2,
      reviewId: crypto.randomUUID(),
      roleId,
      userId: null,
      required: true,
    }),
    /cannot be asked to review/,
  );
  await f.command({
    type: "setRoleMembership",
    roleId,
    userId: f.reviewerId,
    member: true,
  });
  await f.command({
    type: "updateRole",
    roleId,
    capabilities: { ...securityRole.capabilities, review: true },
  });
  await assert.rejects(
    f.command({
      type: "requestReview",
      ...base2,
      reviewId: crypto.randomUUID(),
      roleId,
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
    roleId,
    userId: null,
    required: true,
  });
  const page = await f.read();
  const review = page.changes
    .flatMap((c) => (c.operation === "upsert" ? [c.entity] : []))
    .find((e) => e.type === "review" && e.id === reviewId);
  assert.ok(review?.type === "review" && review.responsibility === "Security");
  assert.deepEqual(page.directory.roles.find((r) => r.id === roleId)?.userIds, [
    f.reviewerId,
  ]);
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
  // Archiving a role removes its capabilities and hides it from requests but
  // keeps the historical assignment legible; restoring brings it back.
  await f.command({ type: "updateRole", roleId, archived: true });
  const archived = (await f.read()).directory.roles.find(
    (r) => r.id === roleId,
  );
  assert.ok(archived?.archivedAt);
  await assert.rejects(
    f.command({
      type: "requestReview",
      ...base2,
      reviewId: crypto.randomUUID(),
      roleId,
      userId: null,
      required: false,
    }),
    /unavailable/,
  );
  await f.command({ type: "updateRole", roleId, archived: false });
  assert.equal(
    (await f.read()).directory.roles.find((r) => r.id === roleId)?.archivedAt,
    null,
  );
  // Removing a person from every capable role revokes their access immediately.
  await f.command({
    type: "setRoleMembership",
    roleId: f.roles.Engineering,
    userId: f.reviewerId,
    member: false,
  });
  await f.command({
    type: "setRoleMembership",
    roleId: f.roles.QA,
    userId: f.reviewerId,
    member: false,
  });
  await assert.rejects(
    f.command(
      {
        type: "requestReview",
        ...base2,
        reviewId: crypto.randomUUID(),
        roleId: f.roles.Product,
        userId: null,
        required: false,
      },
      f.reviewerId,
    ),
    /cannot request or cancel reviews/,
  );
});
