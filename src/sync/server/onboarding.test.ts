import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../../db/schema";
import {
  PROTOCOL,
  onboardingSetupSchema,
  type OnboardingSetup,
} from "../shared/protocol";
import { createSyncService, directory } from "./service";
import { seedOrganization } from "./organization";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_onboarding_test_${crypto.randomUUID().replaceAll("-", "")}`;
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
  const userId = crypto.randomUUID(),
    memberId = crypto.randomUUID(),
    organizationId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: userId, name: "Owner", email: `${userId}@example.test` },
    { id: memberId, name: "Member", email: `${memberId}@example.test` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "New workspace",
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
      userId: memberId,
      role: "member",
      createdAt: new Date(),
    },
  ]);
  await seedOrganization(db, organizationId);
  const setup: OnboardingSetup = {
    deliveryMode: "native",
    readinessPolicy: "block",
    iterationMode: "manual",
    estimateScale: "tshirt",
    iterationWeeks: 2,
    iterationStartDay: 1,
    invitations: 2,
    aiEnabled: true,
  };
  const mutation = (patch: Partial<OnboardingSetup> = {}) => ({
    protocol: PROTOCOL,
    id: crypto.randomUUID(),
    organizationId,
    command: {
      type: "createProject" as const,
      projectId: crypto.randomUUID(),
      name: "Payments",
      key: "PAY",
      setup: { ...setup, ...patch },
    },
  });
  return { userId, memberId, organizationId, setup, mutation };
}
void test("setup configures the first project from explicit choices and records the decision with an idempotent receipt", async () => {
  const f = await fixture();
  const mutation = f.mutation();
  const first = await service.mutate(f.userId, mutation);
  const retry = await service.mutate(f.userId, mutation);
  assert.equal(first.cursor, retry.cursor);
  const roster = await directory(db, f.userId, f.organizationId);
  assert.equal(roster.projects.length, 1);
  const project = roster.projects[0]!;
  assert.equal(project.readinessPolicy, "block");
  assert.equal(project.iterationMode, "manual");
  assert.equal(project.estimateScale, "tshirt");
  assert.equal(roster.ai.enabled, true);
  // No team is needed to start: the project carries the workflow, and its
  // creator administers it in the Product discipline.
  assert.equal(roster.teams.length, 0);
  assert.ok(roster.statuses.some((x) => x.projectId === project.id));
  assert.deepEqual(roster.projectMembers, [
    { projectId: project.id, userId: f.userId, role: "admin" },
  ]);
  assert.deepEqual(
    roster.disciplines.find((d) => d.name === "Product")?.userIds,
    [f.userId],
  );
  const [record] = await db
    .select()
    .from(s.organizationOnboarding)
    .where(eq(s.organizationOnboarding.organizationId, f.organizationId));
  assert.equal(record!.decidedById, f.userId);
  assert.deepEqual(record!.decisions, f.setup);
  await assert.rejects(
    service.mutate(f.userId, f.mutation()),
    /already used|already been completed/,
  );
});
void test("initial setup requires an organization administrator", async () => {
  const f = await fixture(),
    foreign = await fixture();
  await assert.rejects(
    service.mutate(f.memberId, f.mutation()),
    /administrator/,
  );
  assert.equal(
    (await directory(db, f.userId, f.organizationId)).projects.length,
    0,
  );
  assert.equal(
    (await directory(db, f.userId, f.organizationId)).ai.enabled,
    false,
  );
  assert.equal(
    (await directory(db, foreign.userId, foreign.organizationId)).ai.enabled,
    false,
  );
});
void test("a failed change-log write rolls back the project, setup decisions, disciplines and automatic cycles", async () => {
  const f = await fixture();
  await client`CREATE FUNCTION reject_onboarding_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced sync failure'; END $$`;
  await client`CREATE TRIGGER onboarding_failure BEFORE INSERT ON sync_change FOR EACH ROW EXECUTE FUNCTION reject_onboarding_change()`;
  try {
    await assert.rejects(
      service.mutate(f.userId, f.mutation({ iterationMode: "automatic" })),
      /sync_change/,
    );
  } finally {
    await client`DROP TRIGGER onboarding_failure ON sync_change`;
  }
  const roster = await directory(db, f.userId, f.organizationId);
  assert.equal(roster.projects.length, 0);
  assert.equal(roster.disciplines.length, 0);
  assert.equal(roster.statuses.length, 0);
  assert.equal(roster.iterations.length, 0);
  assert.equal(roster.ai.enabled, false);
  assert.equal(
    (
      await db
        .select()
        .from(s.organizationOnboarding)
        .where(eq(s.organizationOnboarding.organizationId, f.organizationId))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.syncMutation)
        .where(eq(s.syncMutation.organizationId, f.organizationId))
    ).length,
    0,
  );
});
void test("concurrent first setups have one authoritative winner", async () => {
  const f = await fixture();
  const second = f.mutation({
    deliveryMode: "external",
    iterationMode: "off",
    estimateScale: "none",
    aiEnabled: false,
  });
  second.command.key = "OTHER";
  const results = await Promise.allSettled([
    service.mutate(f.userId, f.mutation()),
    service.mutate(f.userId, second),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const roster = await directory(db, f.userId, f.organizationId);
  assert.equal(roster.projects.length, 1);
  const [record] = await db
    .select()
    .from(s.organizationOnboarding)
    .where(eq(s.organizationOnboarding.organizationId, f.organizationId));
  assert.equal(
    roster.projects[0]!.deliveryMode,
    record!.decisions.deliveryMode,
  );
  assert.equal(roster.projects[0]!.id, record!.projectId);
  assert.equal(roster.ai.enabled, record!.decisions.aiEnabled);
});
void test("opting out applies organization-wide and administrators can change Lictory Intelligence later without rewriting the onboarding decision", async () => {
  const f = await fixture();
  await service.mutate(f.userId, f.mutation({ aiEnabled: false }));
  assert.equal(
    (await directory(db, f.memberId, f.organizationId)).ai.enabled,
    false,
  );
  await service.mutate(f.userId, {
    protocol: PROTOCOL,
    id: crypto.randomUUID(),
    organizationId: f.organizationId,
    command: { type: "setAiPolicy", enabled: true },
  });
  assert.equal(
    (await directory(db, f.memberId, f.organizationId)).ai.enabled,
    true,
  );
  const [record] = await db
    .select()
    .from(s.organizationOnboarding)
    .where(eq(s.organizationOnboarding.organizationId, f.organizationId));
  assert.equal(record!.decisions.aiEnabled, false);
});
void test("legacy setup without a Lictory Intelligence choice preserves the existing organization policy", async () => {
  for (const enabled of [false, true]) {
    const f = await fixture();
    await service.mutate(f.userId, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: f.organizationId,
      command: { type: "setAiPolicy", enabled },
    });
    const mutation = f.mutation();
    delete mutation.command.setup.aiEnabled;
    await service.mutate(f.userId, mutation);
    assert.equal(
      (await directory(db, f.userId, f.organizationId)).ai.enabled,
      enabled,
    );
  }
});
void test("external setup cannot enable native iteration planning", () => {
  const setup = {
    deliveryMode: "external",
    readinessPolicy: "warn",
    estimateScale: "none",
    iterationMode: "off",
    iterationWeeks: 2,
    iterationStartDay: 1,
  };
  assert.equal(onboardingSetupSchema.safeParse(setup).success, true);
  assert.equal(
    onboardingSetupSchema.safeParse({ ...setup, iterationMode: "manual" })
      .success,
    false,
  );
  assert.equal(
    onboardingSetupSchema.safeParse({ ...setup, estimateScale: "fibonacci" })
      .success,
    false,
  );
});
