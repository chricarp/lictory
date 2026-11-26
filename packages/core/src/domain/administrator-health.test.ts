import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { noEffects } from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { seedOrganization } from "@lictory/core/domain/organization";
import type { AdministratorProblem } from "@lictory/core/domain/administrator-health";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_admin_health_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
});

const health = async (userId: string, organizationId: string) =>
  (
    (await invoke(
      { db, principal: { userId, surface: "web" }, effects: noEffects },
      "getAdministratorHealth",
      { organizationId },
    )) as { problems: AdministratorProblem[] }
  ).problems;

async function user(label: string) {
  const id = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id, name: label, email: `${id}@example.test` });
  return id;
}

async function organization(members: [string, string][]) {
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: `Org ${organizationId.slice(0, 4)}`,
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    members.map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  return organizationId;
}

async function failedEmail(organizationId: string, userId: string) {
  const [notice] = await db
    .insert(s.notification)
    .values({ organizationId, userId, kind: "review_requested" })
    .returning({ id: s.notification.id });
  await db.insert(s.notificationEmail).values({
    notificationId: notice!.id,
    organizationId,
    userId,
    status: "failed",
    lastError: "SMTP 535: authentication failed",
  });
}

void test("administrators see the server's checks of their organization's background work, and only theirs", async () => {
  const owner = await user("Owner");
  const member = await user("Member");
  const other = await user("Other owner");
  const organizationId = await organization([
    [owner, "owner"],
    [member, "member"],
  ]);
  const elsewhere = await organization([[other, "owner"]]);

  // All is well: nothing to show.
  assert.deepEqual(await health(owner, organizationId), []);

  // The worker has not reached a notification for an hour, and email fails.
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  await db.insert(s.notificationEvent).values({
    organizationId,
    notices: [],
    nextAttemptAt: hourAgo,
    createdAt: hourAgo,
  });
  await failedEmail(organizationId, member);
  await failedEmail(organizationId, owner);

  const problems = await health(owner, organizationId);
  assert.deepEqual(
    problems.map((p) => p.key),
    ["background_work", "email_failed"],
  );
  assert.match(problems[0]!.detail, /^1 task has waited/);
  assert.equal(problems[1]!.title, "2 notification emails could not be sent");
  assert.match(problems[1]!.detail, /SMTP 535/);

  // Another organization's administrator sees none of it.
  assert.deepEqual(await health(other, elsewhere), []);

  // Members do not read it.
  await assert.rejects(health(member, organizationId), (error: unknown) =>
    /administrators/.test((error as Error).message),
  );

  // Instance administrators also see the instance-wide replication slot
  // (this test database has none).
  await db
    .update(s.user)
    .set({ instanceAdmin: true })
    .where(eq(s.user.id, other));
  const instance = await health(other, elsewhere);
  assert.deepEqual(
    instance.map((p) => p.key),
    ["replication"],
  );
  assert.match(instance[0]!.detail, /No logical replication slot/);
});
