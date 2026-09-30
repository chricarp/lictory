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
import { seedDefaultRoles } from "./roles";

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
  await seedDefaultRoles(db, organizationId, userId);
  const roster = await directory(db, userId, organizationId);
  const team = roster.teams[0]!;
  const setup: OnboardingSetup = {
    teamId: team.id,
    teamName: "Payments",
    deliveryMode: "native",
    readinessPolicy: "block",
    iterationMode: "manual",
    estimateScale: "tshirt",
    iterationWeeks: 2,
    iterationStartDay: 1,
    acceptStarterConfiguration: true,
    deferInvitations: true,
    deferIntegration: true,
    deferAdvancedConfiguration: true,
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
  return { userId, memberId, organizationId, team, setup, mutation };
}
void test("setup saves explicit team choices and the decision record with an idempotent project receipt", async () => {
  const f = await fixture();
  const mutation = f.mutation();
  const first = await service.mutate(f.userId, mutation);
  const retry = await service.mutate(f.userId, mutation);
  assert.equal(first.cursor, retry.cursor);
  const roster = await directory(db, f.userId, f.organizationId);
  assert.equal(roster.projects.length, 1);
  assert.equal(roster.projects[0]!.defaultTeamId, f.team.id);
  assert.equal(roster.teams[0]!.readinessPolicy, "block");
  assert.equal(roster.teams[0]!.iterationMode, "manual");
  assert.equal(roster.teams[0]!.estimateScale, "tshirt");
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
void test("initial setup requires an administrator and a team from the same organization", async () => {
  const f = await fixture(),
    foreign = await fixture();
  await assert.rejects(
    service.mutate(f.memberId, f.mutation()),
    /administrator/,
  );
  await assert.rejects(
    service.mutate(f.userId, f.mutation({ teamId: foreign.team.id })),
    /unavailable/,
  );
  const [unchanged] = await db
    .select()
    .from(s.team)
    .where(eq(s.team.id, foreign.team.id));
  assert.equal(unchanged!.name, foreign.team.name);
  assert.equal(
    (await directory(db, f.userId, f.organizationId)).projects.length,
    0,
  );
});
void test("a failed change-log write rolls back the project, setup decisions, team and automatic cycles", async () => {
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
  assert.deepEqual(roster.teams[0], f.team);
  assert.equal(roster.iterations.length, 0);
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
    teamName: "Another team",
    deliveryMode: "external",
    iterationMode: "off",
    estimateScale: "none",
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
  assert.equal(roster.teams[0]!.deliveryMode, record!.decisions.deliveryMode);
  assert.equal(roster.teams[0]!.name, record!.decisions.teamName);
});
void test("external setup cannot enable native iteration planning, and confirmations are required", () => {
  assert.equal(
    onboardingSetupSchema.safeParse({
      deliveryMode: "external",
      iterationMode: "manual",
    }).success,
    false,
  );
  for (const field of [
    "acceptStarterConfiguration",
    "deferInvitations",
    "deferIntegration",
    "deferAdvancedConfiguration",
  ]) {
    const setup = {
      teamId: "team",
      teamName: "Team",
      deliveryMode: "external",
      readinessPolicy: "warn",
      estimateScale: "none",
      iterationMode: "off",
      iterationWeeks: 2,
      iterationStartDay: 1,
      acceptStarterConfiguration: true,
      deferInvitations: true,
      deferIntegration: true,
      deferAdvancedConfiguration: true,
    };
    assert.equal(onboardingSetupSchema.safeParse(setup).success, true);
    assert.equal(
      onboardingSetupSchema.safeParse({ ...setup, [field]: false }).success,
      false,
    );
    assert.equal(
      onboardingSetupSchema.safeParse({ ...setup, iterationMode: "manual" })
        .success,
      false,
    );
  }
});
