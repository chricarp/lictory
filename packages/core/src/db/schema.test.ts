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

import { authSchemaOptions } from "@lictory/core/lib/auth-schema-options";
import * as authSchema from "@lictory/core/db/auth-schema";
import * as s from "@lictory/core/db/schema";
import { seedOrganization } from "@lictory/core/domain/organization";
import { seedTypes } from "@lictory/core/domain/delivery";

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
    // Raw insert: the baseline predates later user columns (such as handle).
    await client`INSERT INTO "user" (id, name, email) VALUES (${legacyUserId}, 'Existing user', 'legacy@example.test')`;
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
  await seedTypes(db, organizationId);
  const [epic] = await db
    .select()
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, organizationId),
        eq(s.workItemType.name, "Epic"),
      ),
    );
  await db.insert(s.project).values({
    id: projectId,
    organizationId,
    name: "Project",
    slug: "project",
    key: "PRD",
    createdById: userId,
  });
  const teamId = crypto.randomUUID();
  await db
    .insert(s.team)
    .values({ id: teamId, organizationId, projectId, name: "Team" });
  const [backlog] = await db
    .insert(s.workflowStatus)
    .values({
      organizationId,
      projectId,
      name: "Backlog",
      category: "backlog",
    })
    .returning();
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

void test("discipline membership grants no approval; assignments have exactly one tenant-scoped target", async () => {
  const a = await fixture();
  const b = await fixture();
  const roleId = crypto.randomUUID();
  await db.insert(s.discipline).values({
    id: roleId,
    organizationId: a.organizationId,
    projectId: a.projectId,
    name: "QA",
    canReview: true,
  });
  await db.insert(s.disciplineMember).values({
    organizationId: a.organizationId,
    disciplineId: roleId,
    userId: a.userId,
  });
  // Active discipline names are unique per project, case-insensitively; an
  // archived discipline releases its name, and another project may reuse it.
  await rejectsCode(
    db.insert(s.discipline).values({
      organizationId: a.organizationId,
      projectId: a.projectId,
      name: "qa",
    }),
    "23505",
  );
  await db.insert(s.discipline).values({
    organizationId: a.organizationId,
    projectId: a.projectId,
    name: "Archived QA",
    archivedAt: new Date(),
  });
  await db.insert(s.discipline).values({
    organizationId: a.organizationId,
    projectId: a.projectId,
    name: "archived qa",
  });
  await db.insert(s.discipline).values({
    organizationId: b.organizationId,
    projectId: b.projectId,
    name: "QA",
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
      .values({ ...assignment, disciplineId: roleId, userId: a.userId }),
    "23514",
  );
  await rejectsCode(
    db.insert(s.reviewAssignment).values({
      ...assignment,
      organizationId: b.organizationId,
      reviewId: b.reviewId,
      disciplineId: roleId,
    }),
    "23503",
  );
  await db
    .insert(s.reviewAssignment)
    .values({ ...assignment, disciplineId: roleId });
  await rejectsCode(
    db
      .insert(s.reviewAssignment)
      .values({ ...assignment, disciplineId: roleId }),
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

void test("new organizations are seeded idempotently with the type registry only", async () => {
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: organizationId,
    createdAt: new Date(),
  });
  await seedOrganization(db, organizationId);
  await seedOrganization(db, organizationId);
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
  assert.equal(
    (
      await db
        .select()
        .from(s.team)
        .where(eq(s.team.organizationId, organizationId))
    ).length,
    0,
  );
});

void test("a work item's team, status and iteration must belong to its project; one iteration is active per project", async () => {
  const a = await fixture();
  const b = await fixture();
  // Another project's team or status violates the composite keys.
  await rejectsCode(
    db
      .update(s.workItem)
      .set({ teamId: b.teamId })
      .where(eq(s.workItem.id, a.workItemId)),
    "23503",
  );
  await rejectsCode(
    db
      .update(s.workItem)
      .set({ statusId: b.statusId })
      .where(eq(s.workItem.id, a.workItemId)),
    "23503",
  );
  // Team is optional.
  await db
    .update(s.workItem)
    .set({ teamId: null })
    .where(eq(s.workItem.id, a.workItemId));
  const iteration = (number: number, state: "planned" | "active") => ({
    organizationId: a.organizationId,
    projectId: a.projectId,
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
  const [foreignIteration] = await db
    .insert(s.iteration)
    .values({
      ...iteration(1, "planned"),
      organizationId: b.organizationId,
      projectId: b.projectId,
    })
    .returning();
  await rejectsCode(
    db
      .update(s.workItem)
      .set({ iterationId: foreignIteration!.id })
      .where(eq(s.workItem.id, a.workItemId)),
    "23503",
  );
});

void test("project-owned configuration migration moves workflow, teams, roles and targets to projects", async () => {
  const name = `lictory_project_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
  const upgradeUrl = new URL(adminUrl);
  upgradeUrl.pathname = `/${name}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const upgradeClient = postgres(upgradeUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  const baseline = await mkdtemp(join(tmpdir(), "lictory-project-upgrade-"));
  try {
    await mkdir(join(baseline, "meta"));
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.idx < 9);
    await writeFile(
      join(baseline, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      await copyFile(
        `drizzle/${entry.tag}.sql`,
        join(baseline, `${entry.tag}.sql`),
      );
    const upgradeDb = drizzle(upgradeClient, { schema: s });
    await migrate(upgradeDb, { migrationsFolder: baseline });
    const q = upgradeClient;
    type Row = Record<string, string | boolean | number | string[] | null>;
    await q`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Owner', 'owner@upgrade.test'), ('dev', 'Dev', 'dev@upgrade.test')`;
    await q`INSERT INTO organization (id, name, slug, created_at) VALUES ('org', 'Acme', 'acme-upgrade', now()), ('empty', 'Empty', 'empty-upgrade', now())`;
    await q`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m1', 'org', 'owner', 'owner', now()), ('m2', 'org', 'dev', 'member', now())`;
    await q`INSERT INTO work_item_type (id, organization_id, name, icon, color, level, has_specification) VALUES ('story', 'org', 'Story', 'story', 'green', 1, true), ('task', 'org', 'Task', 'task', 'blue', 1, false)`;
    // A team shared by two projects, a second team in PAY, and an orphan team
    // of an organization that never created a project.
    await q`INSERT INTO team (id, organization_id, name, delivery_mode, readiness_policy, iteration_mode) VALUES ('shared', 'org', 'Core', 'native', 'block', 'manual'), ('mobile', 'org', 'Mobile', 'native', 'warn', 'manual'), ('orphan', 'empty', 'Empty', 'native', 'warn', 'manual')`;
    await q`INSERT INTO project (id, organization_id, name, slug, key, created_by_id, default_team_id, created_at) VALUES ('pay', 'org', 'Payments', 'pay', 'PAY', 'owner', 'shared', now() - interval '1 day'), ('plt', 'org', 'Platform', 'plt', 'PLT', 'owner', 'shared', now())`;
    await q`INSERT INTO team_project (organization_id, team_id, project_id) VALUES ('org', 'shared', 'pay'), ('org', 'shared', 'plt'), ('org', 'mobile', 'pay')`;
    await q`INSERT INTO team_work_item_type (organization_id, team_id, type_id) VALUES ('org', 'shared', 'story')`;
    await q`INSERT INTO team_member (organization_id, team_id, user_id) VALUES ('org', 'shared', 'dev')`;
    await q`INSERT INTO workflow_status (id, organization_id, team_id, name, color, category, position) VALUES ('s-todo', 'org', 'shared', 'Todo', 'gray', 'unstarted', 0), ('s-doing', 'org', 'shared', 'Doing', 'blue', 'started', 1), ('m-todo', 'org', 'mobile', 'Todo', 'gray', 'unstarted', 0), ('m-qa', 'org', 'mobile', 'QA check', 'amber', 'started', 1), ('o-todo', 'empty', 'orphan', 'Todo', 'gray', 'unstarted', 0)`;
    await q`INSERT INTO iteration (id, organization_id, team_id, number, state, starts_at, ends_at, started_at) VALUES ('it-shared', 'org', 'shared', 1, 'active', '2026-09-01', '2026-09-15', '2026-09-01'), ('it-mobile', 'org', 'mobile', 1, 'active', '2026-09-02', '2026-09-16', '2026-09-02')`;
    await q`INSERT INTO work_item (id, organization_id, project_id, team_id, type_id, number, title, status_id, iteration_id, rank, created_by_id, refinement_state) VALUES ('w1', 'org', 'pay', 'shared', 'story', 1, 'Retries', 's-doing', 'it-shared', 'a', 'owner', 'draft'), ('w2', 'org', 'pay', 'mobile', 'task', 2, 'QA', 'm-qa', 'it-mobile', 'b', 'owner', null), ('w3', 'org', 'plt', 'shared', 'story', 1, 'Platform', 's-todo', 'it-shared', 'c', 'owner', 'draft')`;
    await q`INSERT INTO specification_revision (id, organization_id, work_item_id, number, title, content, author_id) VALUES ('r1', 'org', 'w1', 1, 'Retries', 'x', 'owner'), ('r3', 'org', 'w3', 1, 'Platform', 'y', 'owner')`;
    await q`INSERT INTO organization_role (id, organization_id, name, can_review, can_edit_specifications) VALUES ('eng', 'org', 'Engineering', true, false)`;
    await q`INSERT INTO organization_role_member (organization_id, role_id, user_id) VALUES ('org', 'eng', 'dev')`;
    await q`INSERT INTO review (id, organization_id, work_item_id, revision_id, responsibility, requested_by_id) VALUES ('rv1', 'org', 'w1', 'r1', 'Engineering', 'owner'), ('rv3', 'org', 'w3', 'r3', 'Engineering', 'owner')`;
    await q`INSERT INTO review_assignment (id, organization_id, review_id, role_id, assigned_by_id) VALUES ('a1', 'org', 'rv1', 'eng', 'owner'), ('a3', 'org', 'rv3', 'eng', 'owner')`;
    await q`INSERT INTO delivery_connection (id, organization_id, provider, name, base_url, account_label, encrypted_credential, last_verified_at, created_by_id) VALUES ('conn', 'org', 'jira_cloud', 'Jira', 'https://acme.atlassian.net', 'bot', 'x', now(), 'owner')`;
    await q`INSERT INTO delivery_target (id, organization_id, connection_id, team_id, external_project_id, external_project_key) VALUES ('default-target', 'org', 'conn', null, '1', 'ORG')`;
    await q`INSERT INTO configuration_role (id, organization_id, name, scope, permissions) VALUES ('tpl', 'org', 'Manager', 'project', '["projectSettings"]'::jsonb)`;
    await q`INSERT INTO configuration_assignment (id, organization_id, role_id, user_id, project_id) VALUES ('ca', 'org', 'tpl', 'dev', 'plt')`;
    await migrate(upgradeDb, { migrationsFolder: "drizzle" });

    const projects = await q<
      Row[]
    >`SELECT id, readiness_policy FROM project ORDER BY id`;
    assert.deepEqual(
      projects.map((p) => [p.id, p.readiness_policy]),
      [
        ["pay", "block"],
        ["plt", "block"],
      ],
    );
    // The shared team stays with its first project; Platform gets a copy
    // with the same members, and its work moves to the copy.
    const teams = await q<
      Row[]
    >`SELECT id, project_id, name FROM team ORDER BY name`;
    assert.equal(teams.length, 3);
    const copy = teams.find((t) => t.project_id === "plt")!;
    assert.equal(copy.name, "Core (PLT)");
    assert.equal(teams.find((t) => t.id === "shared")!.project_id, "pay");
    assert.equal(teams.find((t) => t.id === "mobile")!.project_id, "pay");
    assert.deepEqual(
      (
        await q<
          Row[]
        >`SELECT user_id FROM team_member WHERE team_id = ${String(copy.id)}`
      ).map((m) => m.user_id),
      ["dev"],
    );
    const items = await q<
      Row[]
    >`SELECT w.id, w.team_id, w.iteration_id, s.name, s.category, s.project_id FROM work_item w JOIN workflow_status s ON s.id = w.status_id ORDER BY w.id`;
    assert.deepEqual(
      items.map((i) => [i.id, i.name, i.category, i.project_id]),
      [
        ["w1", "Doing", "started", "pay"],
        // Mobile's "QA check" is not part of PAY's workflow: same category.
        ["w2", "Doing", "started", "pay"],
        ["w3", "Todo", "unstarted", "plt"],
      ],
    );
    assert.equal(items.find((i) => i.id === "w3")!.team_id, copy.id);
    // One active iteration per project; Platform's work leaves Core's sprint.
    const iterations = await q<
      Row[]
    >`SELECT id, project_id, state FROM iteration ORDER BY id`;
    assert.deepEqual(
      iterations.map((i) => [i.id, i.project_id, i.state]),
      [
        ["it-mobile", "pay", "active"],
        ["it-shared", "pay", "completed"],
      ],
    );
    assert.equal(items.find((i) => i.id === "w3")!.iteration_id, null);
    // Roles become disciplines per project and assignments follow the item.
    const disciplines = await q<
      Row[]
    >`SELECT d.id, d.project_id, d.can_review, (SELECT array_agg(user_id) FROM discipline_member m WHERE m.discipline_id = d.id) AS members FROM discipline d ORDER BY d.project_id`;
    assert.deepEqual(
      disciplines.map((d) => [d.project_id, d.can_review, d.members]),
      [
        ["pay", true, ["dev"]],
        ["plt", true, ["dev"]],
      ],
    );
    const assignments = await q<
      Row[]
    >`SELECT a.review_id, d.project_id FROM review_assignment a JOIN discipline d ON d.id = a.discipline_id ORDER BY a.review_id`;
    assert.deepEqual(
      assignments.map((a) => [a.review_id, a.project_id]),
      [
        ["rv1", "pay"],
        ["rv3", "plt"],
      ],
    );
    // Everyone stays in every project; project managers become admins.
    const members = await q<
      Row[]
    >`SELECT project_id, user_id, role FROM project_member ORDER BY project_id, user_id`;
    assert.deepEqual(
      members.map((m) => [m.project_id, m.user_id, m.role]),
      [
        ["pay", "dev", "member"],
        ["pay", "owner", "member"],
        ["plt", "dev", "admin"],
        ["plt", "owner", "member"],
      ],
    );
    // The organization default target applies to each project.
    assert.deepEqual(
      (
        await q<
          Row[]
        >`SELECT project_id, external_project_key FROM delivery_target ORDER BY project_id`
      ).map((t) => [t.project_id, t.external_project_key]),
      [
        ["pay", "ORG"],
        ["plt", "ORG"],
      ],
    );
    assert.deepEqual(
      (
        await q<
          Row[]
        >`SELECT type_id FROM project_work_item_type WHERE project_id = 'pay' ORDER BY type_id`
      ).map((t) => t.type_id),
      ["story", "task"],
    );
    // An organization without projects keeps no orphan team.
    assert.equal(
      (
        await q<
          Row[]
        >`SELECT count(*)::int AS n FROM team WHERE organization_id = 'empty'`
      )[0]!.n,
      0,
    );
  } finally {
    await upgradeClient.end();
    await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
    await rm(baseline, { recursive: true, force: true });
  }
});
