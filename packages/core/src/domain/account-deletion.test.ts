import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import {
  AccountDeletionError,
  deleteAccount,
  deletedEmail,
  recordDeparture,
} from "@lictory/core/domain/account-deletion";
import { seedOrganization } from "@lictory/core/domain/organization";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import { directory, executeMutation } from "@lictory/core/domain/service";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_account_deletion_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

// An organization whose owner set up a project and whose member wrote a
// specification: the member's account is referenced by history.
async function workspace() {
  const ownerId = crypto.randomUUID();
  const authorId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: ownerId, name: "Olive Owner", email: `${ownerId}@example.test` },
    {
      id: authorId,
      name: "Ada Author",
      email: `${authorId}@example.test`,
      emailVerified: true,
      handle: `ada_${authorId.slice(0, 8)}`,
      image: `/api/users/${authorId}/photo?v=1`,
    },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values([
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: ownerId,
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: authorId,
      role: "member",
      createdAt: new Date(),
    },
  ]);
  await seedOrganization(db, organizationId);
  const command = (next: Command, actor: string) =>
    executeMutation(
      db,
      { userId: actor },
      {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command: next,
      },
    );
  const projectId = crypto.randomUUID();
  await command(
    { type: "createProject", projectId, name: "Payments", key: "PAY" },
    ownerId,
  );
  const roster = await directory(db, ownerId, organizationId);
  const product = roster.disciplines.find(
    (d) => d.projectId === projectId && d.name === "Product",
  )!;
  await command(
    {
      type: "setDisciplineMember",
      projectId,
      disciplineId: product.id,
      userId: authorId,
      member: true,
    },
    ownerId,
  );
  const workItemId = crypto.randomUUID();
  await command(
    {
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: roster.types.find((t) => t.name === "Story")!.id,
      parentId: null,
      title: "Safe retries",
      description: "Avoid duplicate payments after a timeout.",
    },
    authorId,
  );
  return { ownerId, authorId, organizationId, projectId, workItemId };
}

// Sign-in methods and personal data a real account accumulates.
async function personalData(userId: string, organizationId: string) {
  await db.insert(s.session).values({
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    updatedAt: new Date(),
  });
  await db.insert(s.account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: "hash",
    updatedAt: new Date(),
  });
  await db.insert(s.twoFactor).values({
    id: crypto.randomUUID(),
    userId,
    secret: "secret",
    backupCodes: "codes",
  });
  await db.insert(s.passkey).values({
    id: crypto.randomUUID(),
    userId,
    publicKey: "key",
    credentialID: crypto.randomUUID(),
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });
  await db.insert(s.accessToken).values({
    userId,
    name: "CLI",
    scope: "read",
    prefix: "lct_",
    tokenHash: crypto.randomUUID(),
  });
  await db.insert(s.verification).values({
    id: crypto.randomUUID(),
    identifier: `reset-password:${crypto.randomUUID()}`,
    value: userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await db.insert(s.profilePhoto).values({
    userId,
    content: Buffer.from("photo"),
    sha256: "1",
  });
  await db.insert(s.intelligenceChat).values({ organizationId, userId });
}

const rowsOf = async (table: string, userId: string) => {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)} where user_id = ${userId}`,
  );
  return result[0]!.count;
};

void test("deleting an account with history anonymizes it and keeps the history", async () => {
  const f = await workspace();
  await personalData(f.authorId, f.organizationId);
  const revisionsBefore = await db
    .select()
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.authorId, f.authorId));
  assert.equal(revisionsBefore.length, 1);

  const result = await deleteAccount(db, f.authorId);
  assert.deepEqual(result.organizationIds, [f.organizationId]);

  // The account is a tombstone: name kept, everything that identifies or
  // reaches the person gone, never able to sign in again.
  const [account] = await db
    .select()
    .from(s.user)
    .where(eq(s.user.id, f.authorId));
  assert.equal(account!.name, "Ada Author");
  assert.equal(account!.email, deletedEmail(f.authorId));
  assert.equal(account!.emailVerified, false);
  assert.equal(account!.image, null);
  assert.equal(account!.handle, null);
  assert.ok(account!.deletedAt);
  assert.ok(account!.deactivatedAt);
  for (const table of [
    "session",
    "account",
    "two_factor",
    "passkey",
    "access_token",
    "profile_photo",
    "intelligence_chat",
    "member",
    "project_member",
    "discipline_member",
  ])
    assert.equal(await rowsOf(table, f.authorId), 0, table);
  const tokens = await db
    .select()
    .from(s.verification)
    .where(eq(s.verification.value, f.authorId));
  assert.equal(tokens.length, 0);

  // Historical revisions are untouched and still attributed.
  assert.deepEqual(
    await db
      .select()
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.authorId, f.authorId)),
    revisionsBefore,
  );

  // The organization lists the person as a former member by name only, and
  // its projections are consistent with the domain.
  const roster = await directory(db, f.ownerId, f.organizationId);
  assert.equal(
    roster.members.some((m) => m.id === f.authorId),
    false,
  );
  assert.deepEqual(roster.formerMembers, [
    { id: f.authorId, name: "Ada Author" },
  ]);
  assert.equal(
    roster.disciplines.some((d) => d.userIds.includes(f.authorId)),
    false,
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);

  // Recorded for the organization and for the installation.
  const audit = await db
    .select()
    .from(s.auditEvent)
    .where(
      and(
        eq(s.auditEvent.organizationId, f.organizationId),
        eq(s.auditEvent.action, "member.account_deleted"),
      ),
    );
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.targetId, f.authorId);
  const instance = await db
    .select()
    .from(s.instanceAuditEvent)
    .where(eq(s.instanceAuditEvent.targetId, f.authorId));
  assert.deepEqual(
    instance.map((e) => e.action),
    ["user.deleted"],
  );

  // A second request changes nothing and records nothing more.
  assert.deepEqual(await deleteAccount(db, f.authorId), {
    organizationIds: [],
  });
  assert.equal(
    (
      await db
        .select()
        .from(s.instanceAuditEvent)
        .where(eq(s.instanceAuditEvent.targetId, f.authorId))
    ).length,
    1,
  );
});

void test("the only owner of an organization cannot delete their account", async () => {
  const f = await workspace();
  await personalData(f.ownerId, f.organizationId);
  await assert.rejects(
    deleteAccount(db, f.ownerId),
    (error: unknown) =>
      error instanceof AccountDeletionError &&
      error.code === "sole_owner" &&
      error.message.includes("Acme"),
  );
  // Refused before anything changed.
  const [owner] = await db
    .select()
    .from(s.user)
    .where(eq(s.user.id, f.ownerId));
  assert.equal(owner!.deletedAt, null);
  assert.equal(await rowsOf("session", f.ownerId), 1);
  assert.equal(await rowsOf("member", f.ownerId), 1);

  // Once someone else owns it too, the owner can leave this way.
  await db
    .update(s.member)
    .set({ role: "owner" })
    .where(eq(s.member.userId, f.authorId));
  await deleteAccount(db, f.ownerId);
  const roster = await directory(db, f.authorId, f.organizationId);
  assert.deepEqual(
    roster.formerMembers.map((m) => m.name),
    ["Olive Owner"],
  );
});

void test("the last active instance administrator cannot delete their account", async () => {
  const f = await workspace();
  await db
    .update(s.user)
    .set({ instanceAdmin: true })
    .where(eq(s.user.id, f.authorId));
  await assert.rejects(
    deleteAccount(db, f.authorId),
    (error: unknown) =>
      error instanceof AccountDeletionError &&
      error.code === "last_administrator",
  );
  // Clean up: other tests share the database.
  await db
    .update(s.user)
    .set({ instanceAdmin: false })
    .where(eq(s.user.id, f.authorId));
});

void test("people who leave stay in the directory by name until they rejoin", async () => {
  const f = await workspace();
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, f.organizationId),
        eq(s.member.userId, f.authorId),
      ),
    );
  await recordDeparture(db, f.organizationId, f.authorId);
  let roster = await directory(db, f.ownerId, f.organizationId);
  assert.deepEqual(roster.formerMembers, [
    { id: f.authorId, name: "Ada Author" },
  ]);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);

  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId: f.organizationId,
    userId: f.authorId,
    role: "member",
    createdAt: new Date(),
  });
  roster = await directory(db, f.ownerId, f.organizationId);
  assert.deepEqual(roster.formerMembers, []);
  assert.equal(
    roster.members.some((m) => m.id === f.authorId),
    true,
  );
});

// Every table whose rows would vanish with a hard-deleted account must be
// decided on here: either account deletion removes the person's rows, or they
// are kept on purpose. A new table referencing users fails this test until
// someone makes that decision in `deleteAccount`.
void test("account deletion decides on every table that references a user with ON DELETE CASCADE", async () => {
  const removed = [
    "access_token",
    "account",
    "capability_invocation",
    "discipline_member",
    "intelligence_chat",
    "member",
    "notification",
    "notification_email",
    "notification_preference",
    "passkey",
    "profile_photo",
    "project_member",
    "session",
    "team_member",
    "two_factor",
    "work_item_watcher",
  ];
  // Organization records: who invited whom, who left.
  const kept = ["former_member", "invitation"];
  const rows = await db.execute<{ table: string }>(sql`
    select distinct c.conrelid::regclass::text as table
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = '"user"'::regclass
      and c.confdeltype = 'c'
  `);
  assert.deepEqual(
    rows.map((r) => r.table.replaceAll('"', "")).sort(),
    [...removed, ...kept].sort(),
  );
});
