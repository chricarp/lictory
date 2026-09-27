import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { authSchemaOptions } from "../lib/auth-schema-options";
import * as authSchema from "./auth-schema";
import * as s from "./schema";
import { seedDefaultRoles } from "../sync/server/roles";
import { seedDelivery } from "../sync/server/delivery";

// Never use DATABASE_URL: create and remove an isolated database, even locally.
const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_schema_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const client = postgres(testUrl.toString(), {
  max: 1,
  onnotice: () => undefined,
});
const db = drizzle(client, { schema: s });
let databaseCreated = false;
const legacyUserId = crypto.randomUUID();

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  databaseCreated = true;
  // Exercise upgrading the existing auth-only migration, preserving real records.
  const baseline = await mkdtemp(join(tmpdir(), "lictory-schema-baseline-"));
  try {
    await mkdir(join(baseline, "meta"));
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string }[] };
    journal.entries = journal.entries.slice(0, 1);
    const first = journal.entries[0];
    assert.ok(first);
    await writeFile(
      join(baseline, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    await copyFile(
      `drizzle/${first.tag}.sql`,
      join(baseline, `${first.tag}.sql`),
    );
    await migrate(db, { migrationsFolder: baseline });
    await db.insert(s.user).values({
      id: legacyUserId,
      name: "Existing user",
      email: "legacy@example.test",
    });
    await db.insert(s.account).values({
      id: "legacy-account",
      userId: legacyUserId,
      accountId: legacyUserId,
      providerId: "credential",
    });
    // Raw insert uses only columns that existed before the organization plugin.
    await client`INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ('legacy-session', 'legacy-token', ${legacyUserId}, now() + interval '1 day', now())`;
    await db.insert(s.verification).values({
      id: "legacy-verification",
      identifier: "legacy@example.test",
      value: "verification",
      expiresAt: new Date(Date.now() + 60000),
    });
    await migrate(db, { migrationsFolder: "drizzle" });
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await rm(baseline, { recursive: true, force: true });
  }
});

after(async () => {
  await client.end();
  if (databaseCreated) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function rejectsCode(operation: PromiseLike<unknown>, code: string) {
  await assert.rejects(
    async () => await operation,
    (error: unknown) => {
      const cause = error instanceof Error && error.cause ? error.cause : error;
      assert.ok(cause instanceof postgres.PostgresError);
      assert.equal(cause.code, code);
      return true;
    },
  );
}

async function fixture() {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const reviewId = crypto.randomUUID();
  const threadId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Reviewer", email: `${userId}@example.test` });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Organization",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    createdAt: new Date(),
  });
  const teamId = await seedDelivery(db, organizationId, "Team", [userId]);
  const [epic] = await db
    .select()
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, organizationId),
        eq(s.workItemType.name, "Epic"),
      ),
    );
  const [backlog] = await db
    .select()
    .from(s.workflowStatus)
    .where(eq(s.workflowStatus.teamId, teamId));
  await db.insert(s.project).values({
    id: projectId,
    organizationId,
    name: "Project",
    slug: "project",
    key: "PRD",
    defaultTeamId: teamId,
    createdById: userId,
  });
  const delivery = {
    teamId,
    typeId: epic!.id,
    statusId: backlog!.id,
  };
  await db.insert(s.workItem).values({
    id: proposalId,
    organizationId,
    projectId,
    number: 1,
    ...delivery,
    rank: "i",
    title: "Proposal",
    createdById: userId,
  });
  const context = { organizationId, workItemId: proposalId, revisionId };
  await db.insert(s.specificationRevision).values({
    id: revisionId,
    organizationId,
    workItemId: proposalId,
    number: 1,
    title: "Initial specification",
    content: "Original content",
    authorId: userId,
  });
  await db.insert(s.review).values({
    id: reviewId,
    ...context,
    responsibility: "engineering",
    requestedById: userId,
  });
  await db
    .insert(s.thread)
    .values({ id: threadId, ...context, reviewId, authorId: userId });
  return { ...context, ...delivery, userId, projectId, reviewId, threadId };
}

void test("migration preserves existing Better Auth records and its organization plugin works", async () => {
  assert.equal(
    (await db.select().from(s.user).where(eq(s.user.id, legacyUserId))).length,
    1,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.account)
        .where(eq(s.account.id, "legacy-account"))
    ).length,
    1,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.verification)
        .where(eq(s.verification.id, "legacy-verification"))
    ).length,
    1,
  );
  const [session] = await db
    .select()
    .from(s.session)
    .where(eq(s.session.id, "legacy-session"));
  assert.equal(session?.userId, legacyUserId);
  assert.equal(session.activeOrganizationId, null);
  const auth = betterAuth({
    ...authSchemaOptions,
    secret: "schema-test-only-secret-at-least-32-characters",
    baseURL: "http://localhost:3000",
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  });
  const org = await auth.api.createOrganization({
    body: {
      name: "Plugin organization",
      slug: "plugin-org",
      userId: legacyUserId,
    },
  });
  assert.ok(org);
  const [membership] = await db
    .select()
    .from(s.member)
    .where(eq(s.member.organizationId, org.id));
  assert.equal(membership?.userId, legacyUserId);
  assert.equal(membership.role, "owner");
});

void test("composite foreign keys reject foreign organizations and mismatched proposal/review contexts", async () => {
  const a = await fixture();
  const b = await fixture();
  await rejectsCode(
    db.insert(s.workItem).values({
      organizationId: a.organizationId,
      projectId: b.projectId,
      teamId: a.teamId,
      typeId: a.typeId,
      statusId: a.statusId,
      rank: "j",
      number: 2,
      title: "Invalid",
      createdById: a.userId,
    }),
    "23503",
  );
  await rejectsCode(
    db.insert(s.review).values({
      organizationId: a.organizationId,
      workItemId: a.workItemId,
      revisionId: b.revisionId,
      responsibility: "qa",
      requestedById: a.userId,
    }),
    "23503",
  );
  const secondRevisionId = crypto.randomUUID();
  await db.insert(s.specificationRevision).values({
    id: secondRevisionId,
    organizationId: a.organizationId,
    workItemId: a.workItemId,
    number: 2,
    title: "Revised",
    content: "New content",
    authorId: a.userId,
  });
  await rejectsCode(
    db.insert(s.thread).values({
      ...a,
      id: undefined,
      revisionId: secondRevisionId,
      authorId: a.userId,
    }),
    "23503",
  );
  await rejectsCode(
    db
      .insert(s.approval)
      .values({ ...a, revisionId: secondRevisionId, reviewerId: a.userId }),
    "23503",
  );
  await rejectsCode(
    db.insert(s.threadMessage).values({
      organizationId: b.organizationId,
      threadId: a.threadId,
      authorId: b.userId,
      body: "Wrong tenant",
    }),
    "23503",
  );
});

void test("revision numbering is unique and merged suggestions retain both snapshots", async () => {
  const a = await fixture();
  const revision = {
    organizationId: a.organizationId,
    workItemId: a.workItemId,
    title: "Revised",
    content: "Replacement",
    authorId: a.userId,
  };
  await rejectsCode(
    db.insert(s.specificationRevision).values({ ...revision, number: 1 }),
    "23505",
  );
  await rejectsCode(
    db.insert(s.specificationRevision).values({ ...revision, number: 0 }),
    "23514",
  );
  const suggestion = {
    organizationId: a.organizationId,
    workItemId: a.workItemId,
    revisionId: a.revisionId,
    authorId: a.userId,
    replacement: "Replacement",
    status: "merged" as const,
    resolvedById: a.userId,
    resolvedAt: new Date(),
  };
  await rejectsCode(db.insert(s.suggestion).values(suggestion), "23514");
  await rejectsCode(
    db
      .insert(s.suggestion)
      .values({ ...suggestion, acceptedRevisionId: a.revisionId }),
    "23514",
  );
  const b = await fixture();
  await rejectsCode(
    db
      .insert(s.suggestion)
      .values({ ...suggestion, acceptedRevisionId: b.revisionId }),
    "23503",
  );
  const acceptedRevisionId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .insert(s.specificationRevision)
      .values({ ...revision, id: acceptedRevisionId, number: 2 });
    await tx.insert(s.suggestion).values({ ...suggestion, acceptedRevisionId });
  });
  const revisions = await db
    .select()
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.workItemId, a.workItemId))
    .orderBy(s.specificationRevision.number);
  assert.deepEqual(
    revisions.map((r) => r.content),
    ["Original content", "Replacement"],
  );
});

void test("role membership grants no approval; assignments have exactly one tenant-scoped target", async () => {
  const a = await fixture();
  const b = await fixture();
  const roleId = crypto.randomUUID();
  await db.insert(s.organizationRole).values({
    id: roleId,
    organizationId: a.organizationId,
    name: "QA",
    canReview: true,
  });
  await db
    .insert(s.organizationRoleMember)
    .values({ organizationId: a.organizationId, roleId, userId: a.userId });
  // Active role names are unique per organization, case-insensitively; an
  // archived role releases its name.
  await rejectsCode(
    db.insert(s.organizationRole).values({
      organizationId: a.organizationId,
      name: "qa",
    }),
    "23505",
  );
  await db.insert(s.organizationRole).values({
    organizationId: a.organizationId,
    name: "Archived QA",
    archivedAt: new Date(),
  });
  await db.insert(s.organizationRole).values({
    organizationId: a.organizationId,
    name: "archived qa",
  });
  const assignment = {
    organizationId: a.organizationId,
    reviewId: a.reviewId,
    assignedById: a.userId,
  };
  await rejectsCode(db.insert(s.reviewAssignment).values(assignment), "23514");
  await rejectsCode(
    db
      .insert(s.reviewAssignment)
      .values({ ...assignment, roleId, userId: a.userId }),
    "23514",
  );
  await rejectsCode(
    db.insert(s.reviewAssignment).values({
      ...assignment,
      organizationId: b.organizationId,
      reviewId: b.reviewId,
      roleId,
    }),
    "23503",
  );
  await db.insert(s.reviewAssignment).values({ ...assignment, roleId });
  await rejectsCode(
    db.insert(s.reviewAssignment).values({ ...assignment, roleId }),
    "23505",
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.approval)
        .where(eq(s.approval.reviewId, a.reviewId))
    ).length,
    0,
  );
});

void test("historical approvals survive membership removal and revoked approvals can be granted again", async () => {
  const a = await fixture();
  const values = {
    organizationId: a.organizationId,
    workItemId: a.workItemId,
    revisionId: a.revisionId,
    reviewId: a.reviewId,
    reviewerId: a.userId,
  };
  const approvalId = crypto.randomUUID();
  await db.insert(s.approval).values({ ...values, id: approvalId });
  await rejectsCode(db.insert(s.approval).values(values), "23505");
  await db
    .update(s.approval)
    .set({
      status: "revoked",
      endedAt: new Date(),
      endedById: a.userId,
      endReason: "Reconsidered",
    })
    .where(eq(s.approval.id, approvalId));
  await db.insert(s.approval).values(values);
  await db.delete(s.member).where(eq(s.member.userId, a.userId));
  assert.equal(
    (
      await db
        .select()
        .from(s.approval)
        .where(eq(s.approval.reviewId, a.reviewId))
    ).length,
    2,
  );
  await rejectsCode(
    db
      .delete(s.specificationRevision)
      .where(eq(s.specificationRevision.id, a.revisionId)),
    "23503",
  );
  await rejectsCode(
    db.delete(s.workItem).where(eq(s.workItem.id, a.workItemId)),
    "23503",
  );
  await rejectsCode(
    db.delete(s.organization).where(eq(s.organization.id, a.organizationId)),
    "23503",
  );
  await rejectsCode(db.delete(s.user).where(eq(s.user.id, a.userId)), "23503");
});

void test("thread resolution keeps messages and readiness reruns retain previous results", async () => {
  const a = await fixture();
  await db.insert(s.threadMessage).values({
    organizationId: a.organizationId,
    threadId: a.threadId,
    authorId: a.userId,
    body: "Define timeout behavior",
  });
  await rejectsCode(
    db
      .update(s.thread)
      .set({ status: "resolved" })
      .where(eq(s.thread.id, a.threadId)),
    "23514",
  );
  await db
    .update(s.thread)
    .set({ status: "resolved", resolvedAt: new Date(), resolvedById: a.userId })
    .where(eq(s.thread.id, a.threadId));
  await db
    .update(s.thread)
    .set({ status: "open", resolvedAt: null, resolvedById: null })
    .where(eq(s.thread.id, a.threadId));
  assert.equal(
    (
      await db
        .select()
        .from(s.threadMessage)
        .where(eq(s.threadMessage.threadId, a.threadId))
    ).length,
    1,
  );
  await rejectsCode(
    db.delete(s.thread).where(eq(s.thread.id, a.threadId)),
    "23503",
  );
  const result = {
    organizationId: a.organizationId,
    workItemId: a.workItemId,
    revisionId: a.revisionId,
    key: "no-blocking-threads",
    evaluator: "test:v1",
    completedAt: new Date(),
  };
  await db.insert(s.readinessCheck).values([
    { ...result, status: "failed" },
    { ...result, status: "passed" },
  ]);
  assert.equal(
    (
      await db
        .select()
        .from(s.readinessCheck)
        .where(eq(s.readinessCheck.workItemId, a.workItemId))
    ).length,
    2,
  );
});

void test("decision provenance and delivery hierarchy cannot cross their source context", async () => {
  const a = await fixture();
  const b = await fixture();
  const decision = {
    organizationId: a.organizationId,
    projectId: a.projectId,
    title: "Timeout decision",
    body: "Retry with the original ID",
    authorId: a.userId,
  };
  await db.insert(s.decision).values(decision);
  await db.insert(s.decision).values({
    ...decision,
    workItemId: a.workItemId,
    revisionId: a.revisionId,
    sourceThreadId: a.threadId,
  });
  await rejectsCode(
    db.insert(s.decision).values({ ...decision, revisionId: a.revisionId }),
    "23514",
  );
  await rejectsCode(
    db.insert(s.decision).values({ ...decision, workItemId: b.workItemId }),
    "23503",
  );
  const connection = {
    organizationId: a.organizationId,
    provider: "jira_cloud" as const,
    name: "Acme Jira",
    baseUrl: "https://acme.atlassian.net",
    accountLabel: "bot@acme.test",
    encryptedCredential: "v1:opaque",
    lastVerifiedAt: new Date(),
    createdById: a.userId,
  };
  const connectionId = await db
    .insert(s.deliveryConnection)
    .values(connection)
    .returning({ id: s.deliveryConnection.id })
    .then((rows) => rows[0]!.id);
  // One active connection per external site.
  await rejectsCode(
    db.insert(s.deliveryConnection).values(connection),
    "23505",
  );
  const link = {
    organizationId: a.organizationId,
    workItemId: a.workItemId,
    connectionId,
    externalId: "123",
  };
  await db.insert(s.workItemExternalLink).values(link);
  // One destination per item and one local item per external identity:
  // retried publishes cannot duplicate delivery work.
  await rejectsCode(
    db.insert(s.workItemExternalLink).values({ ...link, externalId: "124" }),
    "23505",
  );
  await rejectsCode(
    db
      .insert(s.workItemExternalLink)
      .values({ ...link, organizationId: b.organizationId }),
    "23503",
  );
  await rejectsCode(
    db
      .insert(s.workItemExternalLink)
      .values({ ...link, externalId: null, status: "synced" }),
    "23514",
  );
});

void test("new organizations are seeded idempotently with roles, types and a working team", async () => {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Owner", email: `${userId}@example.test` });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: organizationId,
    createdAt: new Date(),
  });
  await seedDefaultRoles(db, organizationId, userId);
  await seedDefaultRoles(db, organizationId, userId);
  const roles = await db
    .select()
    .from(s.organizationRole)
    .where(eq(s.organizationRole.organizationId, organizationId));
  assert.deepEqual(roles.map((r) => r.name).sort(), [
    "Engineering",
    "Product",
    "QA",
  ]);
  const types = await db
    .select()
    .from(s.workItemType)
    .where(eq(s.workItemType.organizationId, organizationId));
  assert.deepEqual(
    types.map((t) => [t.name, t.level, t.hasSpecification]).sort(),
    [
      ["Bug", 1, false],
      ["Epic", 2, true],
      ["Story", 1, true],
      ["Subtask", 0, false],
      ["Task", 1, false],
    ],
  );
  const teams = await db
    .select()
    .from(s.team)
    .where(eq(s.team.organizationId, organizationId));
  assert.deepEqual(
    teams.map((t) => t.name),
    ["Acme"],
  );
  const statuses = await db
    .select()
    .from(s.workflowStatus)
    .where(eq(s.workflowStatus.teamId, teams[0]!.id));
  assert.deepEqual([...new Set(statuses.map((x) => x.category))].sort(), [
    "backlog",
    "canceled",
    "done",
    "started",
    "unstarted",
  ]);
  const members = await db
    .select()
    .from(s.teamMember)
    .where(eq(s.teamMember.teamId, teams[0]!.id));
  assert.deepEqual(
    members.map((m) => m.userId),
    [userId],
  );
});

void test("a work item's status must belong to its team and only one iteration is active per team", async () => {
  const a = await fixture();
  // Moving teams without remapping the status violates the composite key.
  const otherTeamId = crypto.randomUUID();
  await db.insert(s.team).values({
    id: otherTeamId,
    organizationId: a.organizationId,
    name: "Platform",
  });
  await rejectsCode(
    db
      .update(s.workItem)
      .set({ teamId: otherTeamId })
      .where(eq(s.workItem.id, a.workItemId)),
    "23503",
  );
  const iteration = (number: number, state: "planned" | "active") => ({
    organizationId: a.organizationId,
    teamId: a.teamId,
    number,
    startsAt: new Date("2026-01-01"),
    endsAt: new Date("2026-01-15"),
    state,
    startedAt: state === "active" ? new Date() : null,
  });
  await db.insert(s.iteration).values(iteration(1, "active"));
  await rejectsCode(
    db.insert(s.iteration).values(iteration(2, "active")),
    "23505",
  );
  await rejectsCode(
    db
      .insert(s.iteration)
      .values({ ...iteration(3, "planned"), startedAt: new Date() }),
    "23514",
  );
});
