import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../../db/schema";
import { createSyncService, DomainError } from "./service";
import { pageSchema, type Command, type Entity } from "../shared/protocol";
import { reconcile, optimistic } from "../client/reconciliation";
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
    { id: userId, name: "Product", email: `${userId}@example.test` },
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
  const command = async (
    command: Command,
    actor = userId,
    id = crypto.randomUUID(),
  ) => service.mutate(actor, { protocol: 1, id, organizationId, command });
  await command({ type: "createProduct", name: "Payments", slug: "payments" });
  const product = (
    await db
      .select()
      .from(s.product)
      .where(eq(s.product.organizationId, organizationId))
  )[0]!;
  const proposalId = crypto.randomUUID();
  await command({
    type: "createProposal",
    productId: product.id,
    proposalId,
    title: "Safe retries",
    problem: "Avoid duplicate payments after timeout.",
  });
  const scope = { organizationId, productId: product.id, proposalId };
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
    proposalId,
    productId: product.id,
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
    proposalId: f.proposalId,
    baseRevisionId: revision.id,
    threadId,
    body: "Define late responses.",
    section: "Failure behavior",
    blocking: true,
  });
  const messageId = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const reply: Command = {
    type: "replyToThread",
    proposalId: f.proposalId,
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
    proposalId: f.proposalId,
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
  assert.deepEqual(state, reconcile({}, (await f.read()).changes));
  assert.equal(state[`thread:${threadId}`]?.type, "thread");
  assert.equal((await f.read(cursor)).changes.length, 0);
  await f.command({
    type: "setThreadState",
    proposalId: f.proposalId,
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
  const base = { proposalId: f.proposalId, baseRevisionId: first.id };
  await f.command({
    type: "requestReview",
    ...base,
    responsibility: "Engineering",
    target: { type: "user", id: f.reviewerId },
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
    service.read(a.userId, { ...a.scope, productId: b.productId }),
    DomainError,
  );
  await assert.rejects(
    a.command({
      type: "replyToThread",
      proposalId: b.proposalId,
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
        type: "createProposal",
        productId: f.productId,
        proposalId: crypto.randomUUID(),
        title,
        problem: "Concurrent intent",
      }),
    ),
  );
  const page = pageSchema.parse(
    await service.read(
      f.userId,
      { organizationId: f.organizationId, productId: f.productId },
      before.nextCursor,
    ),
  );
  assert.equal(
    page.changes.filter(
      (c) => c.operation === "upsert" && c.entity.type === "proposal",
    ).length,
    3,
  );
  const failedProposalId = crypto.randomUUID();
  await client`CREATE FUNCTION reject_test_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced sync failure'; END $$`;
  await client`CREATE TRIGGER test_failure BEFORE INSERT ON sync_change FOR EACH ROW EXECUTE FUNCTION reject_test_change()`;
  try {
    await assert.rejects(
      f.command({
        type: "createProposal",
        productId: f.productId,
        proposalId: failedProposalId,
        title: "Rollback",
        problem: "Must not persist without log",
      }),
    );
  } finally {
    await client`DROP TRIGGER test_failure ON sync_change`;
  }
  assert.equal(
    (
      await db
        .select()
        .from(s.proposal)
        .where(eq(s.proposal.id, failedProposalId))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.proposalId, failedProposalId))
    ).length,
    0,
  );
});
void test("archive and restore propagate, and tombstones remove normalized state", async () => {
  const f = await fixture();
  const initial = await f.read();
  await f.command({
    type: "archiveProposal",
    proposalId: f.proposalId,
    archived: true,
  });
  const page = await f.read(initial.nextCursor);
  const state = reconcile(reconcile({}, initial.changes), page.changes);
  const proposal = state[`proposal:${f.proposalId}`];
  assert.ok(proposal?.type === "proposal" && proposal.archivedAt);
  const first = await f.current();
  await assert.rejects(
    f.command({
      type: "updateSpecification",
      proposalId: f.proposalId,
      baseRevisionId: first.id,
      title: "Archived",
      content: "Not allowed",
      summary: "Blocked",
    }),
    /Restore/,
  );
  await f.command({
    type: "archiveProposal",
    proposalId: f.proposalId,
    archived: false,
  });
  assert.ok(
    (await f.entities()).some((e) => e.type === "proposal" && !e.archivedAt),
  );
  assert.equal(
    reconcile(state, [
      {
        operation: "delete",
        cursor: page.nextCursor,
        type: "proposal",
        id: f.proposalId,
      },
    ])[`proposal:${f.proposalId}`],
    undefined,
  );
});
void test("optimistic overlay is replayed over authoritative entities without mutating confirmed state", () => {
  const entity: Entity = {
    type: "thread",
    id: "thread",
    organizationId: "org",
    proposalId: "proposal",
    revisionId: "revision",
    authorId: "user",
    status: "open",
    blocking: true,
    anchor: null,
  };
  const state = { "thread:thread": entity };
  const next = optimistic(
    state,
    [
      {
        protocol: 1,
        id: crypto.randomUUID(),
        organizationId: "org",
        command: {
          type: "setThreadState",
          proposalId: "proposal",
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

void test("functional membership grants a review decision only after explicit group assignment", async () => {
  const f = await fixture();
  const groupId = crypto.randomUUID();
  await db
    .insert(s.group)
    .values({ id: groupId, organizationId: f.organizationId, name: "QA" });
  await db.insert(s.groupMember).values({
    organizationId: f.organizationId,
    groupId,
    userId: f.reviewerId,
  });
  const current = await f.current();
  const base = { proposalId: f.proposalId, baseRevisionId: current.id };
  await f.command({
    type: "requestReview",
    ...base,
    responsibility: "QA",
    target: { type: "user", id: f.userId },
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
    responsibility: "QA",
    target: { type: "group", id: groupId },
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
  const current = await f.current();
  const base = { proposalId: f.proposalId, baseRevisionId: current.id };
  await f.command({
    type: "requestReview",
    ...base,
    responsibility: "Engineering",
    target: { type: "user", id: f.userId },
    required: true,
  });
  await f.command({
    type: "requestReview",
    ...base,
    responsibility: "Engineering",
    target: { type: "user", id: f.reviewerId },
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
    readiness?.type === "readiness" && !readiness.checks.at(-1)?.passed,
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
