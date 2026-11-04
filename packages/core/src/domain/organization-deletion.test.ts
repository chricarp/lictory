import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, asc, eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { organizationProfileKey } from "@lictory/core/contracts/projection";
import { deleteAccount } from "@lictory/core/domain/account-deletion";
import { DomainError } from "@lictory/core/domain/errors";
import {
  cancelOrganizationDeletion,
  deletionOrder,
  processOrganizationDeletions,
  scheduleOrganizationDeletion,
} from "@lictory/core/domain/organization-deletion";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory, executeMutation } from "@lictory/core/domain/service";
import {
  listOrganizationExports,
  requestOrganizationExport,
} from "@lictory/core/export/service";
import type { ObjectStorage } from "@lictory/core/storage/s3";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_org_deletion_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

const DAY = 86_400_000;
const GRACE = 30;

async function user(label: string) {
  const id = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id, name: label, email: `${id}@example.test` });
  return id;
}

// An organization with an owner, an administrator and an Engineering
// reviewer; a specification whose second revision the reviewer approved; an
// attachment; a Jira connection with its (encrypted) credential; a former
// member; and an export. Enough to reach most kinds of organization rows.
async function workspace(title: string, key: string) {
  const owner = await user(`${title} Owner`);
  const administrator = await user(`${title} Admin`);
  const reviewer = await user(`${title} Reviewer`);
  const former = await user(`${title} Former`);
  const organizationId = crypto.randomUUID();
  const slug = `${key.toLowerCase()}-${organizationId.slice(0, 8)}`;
  await db.insert(s.organization).values({
    id: organizationId,
    name: title,
    slug,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    (
      [
        [owner, "owner"],
        [administrator, "admin"],
        [reviewer, "member"],
      ] as const
    ).map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    })),
  );
  await db.insert(s.formerMember).values({ organizationId, userId: former });
  await seedOrganization(db, organizationId);
  const command = (next: Command, actor = owner) =>
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
  await command({ type: "createProject", projectId, name: title, key });
  const roster = await directory(db, owner, organizationId);
  const engineering = roster.disciplines.find((d) => d.name === "Engineering")!;
  await command({
    type: "setDisciplineMember",
    projectId,
    disciplineId: engineering.id,
    userId: reviewer,
    member: true,
  });
  const workItemId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId,
    workItemId,
    typeId: roster.types.find((t) => t.name === "Story")!.id,
    parentId: null,
    title,
    description: "# Behavior\n\nRetries reuse the transaction ID.",
  });
  const revisions = () =>
    db
      .select({ id: s.specificationRevision.id })
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.workItemId, workItemId))
      .orderBy(asc(s.specificationRevision.createdAt));
  const [first] = await revisions();
  await command({
    type: "updateSpecification",
    workItemId,
    baseRevisionId: first!.id,
    title,
    content: "# Behavior\n\nRetries reuse the original transaction ID.",
  });
  const second = (await revisions()).at(-1)!;
  const reviewId = crypto.randomUUID();
  await command({
    type: "requestReview",
    workItemId,
    baseRevisionId: second.id,
    reviewId,
    disciplineId: engineering.id,
    userId: reviewer,
    required: true,
  });
  await command(
    {
      type: "decideReview",
      workItemId,
      baseRevisionId: second.id,
      reviewId,
      decision: "approve",
    },
    reviewer,
  );
  const objectKeys = [0, 1].map(
    (n) => `organizations/${organizationId}/files/${crypto.randomUUID()}-${n}`,
  );
  await db.insert(s.fileObject).values(
    objectKeys.map((objectKey, n) => ({
      organizationId,
      projectId,
      workItemId,
      objectKey,
      filename: `trace-${n}.txt`,
      mimeType: "text/plain",
      size: 10,
      createdById: owner,
      readyAt: n === 0 ? new Date() : null,
    })),
  );
  await db.insert(s.deliveryConnection).values({
    organizationId,
    provider: "jira_cloud",
    name: "Jira",
    baseUrl: `https://${slug}.atlassian.net`,
    accountLabel: "bot@example.test",
    encryptedCredential: "v1:encrypted-secret",
    lastVerifiedAt: new Date(),
    createdById: owner,
  });
  await requestOrganizationExport(db, owner, organizationId);
  return {
    owner,
    administrator,
    reviewer,
    organizationId,
    slug,
    projectId,
    workItemId,
    objectKeys,
    command,
  };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DomainError, String(error));
    return error;
  }
  assert.fail("expected the call to be refused");
}

function recordingStorage() {
  const deleted: string[] = [];
  const unused = () => Promise.reject(new Error("not used by deletion"));
  const storage: ObjectStorage = {
    presignUpload: unused,
    presignDownload: unused,
    stat: unused,
    copy: unused,
    delete: (key) => {
      deleted.push(key);
      return Promise.resolve();
    },
  };
  return { storage, deleted };
}

// Row counts of every table that has an organization_id, for one
// organization.
async function organizationRows(organizationId: string) {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'organization_id'
    order by table_name`);
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await db.execute<{ total: string }>(
      sql`select count(*) as total from ${sql.identifier(table_name)} where organization_id = ${organizationId}`,
    );
    counts[table_name] = Number(row!.total);
  }
  return counts;
}

// The worker claims any due deletion; a test that runs it starts with no
// deletion left over from another test.
const forgetOtherDeletions = () => db.delete(s.organizationDeletion);

const schedule = (
  w: { owner: string; organizationId: string; slug: string },
  now?: Date,
) =>
  scheduleOrganizationDeletion(db, w.owner, w.organizationId, {
    confirmation: w.slug,
    graceDays: GRACE,
    now,
  });

void test("only an owner schedules a deletion, confirmed with the handle; it locks the organization at once and tells every member", async () => {
  const w = await workspace("Lockdown", "LCK");

  const notOwner = await refusal(
    scheduleOrganizationDeletion(db, w.administrator, w.organizationId, {
      confirmation: w.slug,
      graceDays: GRACE,
    }),
  );
  assert.equal(notOwner.category, "forbidden");
  assert.match(notOwner.message, /Only an owner/);
  const unconfirmed = await refusal(
    scheduleOrganizationDeletion(db, w.owner, w.organizationId, {
      confirmation: "Lockdown",
      graceDays: GRACE,
    }),
  );
  assert.equal(unconfirmed.category, "validation");
  assert.match(unconfirmed.message, new RegExp(w.slug));

  const now = new Date("2026-11-04T10:00:00Z");
  const { deletion, existing } = await schedule(w, now);
  assert.equal(existing, false);
  assert.equal(deletion.status, "scheduled");
  assert.equal(
    deletion.deleteAfter,
    new Date(now.getTime() + GRACE * DAY).toISOString(),
  );
  // Asking again returns the same schedule.
  assert.equal((await schedule(w)).existing, true);

  // Members, administrators and the owner alike are locked out of the work.
  for (const actor of [w.reviewer, w.administrator, w.owner]) {
    const locked = await refusal(
      w.command(
        {
          type: "createWorkItem",
          projectId: w.projectId,
          workItemId: crypto.randomUUID(),
          typeId: (
            await db
              .select()
              .from(s.workItemType)
              .where(eq(s.workItemType.organizationId, w.organizationId))
          )[0]!.id,
          parentId: null,
          title: "Should not exist",
          description: "",
        },
        actor,
      ),
    );
    assert.equal(locked.kind, "organization_deletion_scheduled");
    assert.match(locked.message, /scheduled for deletion on December 4, 2026/);
  }
  await refusal(directory(db, w.reviewer, w.organizationId));

  // Owners can still take the data with them; administrators cannot.
  const listing = await listOrganizationExports(db, w.owner, w.organizationId);
  assert.equal(listing.exports.length, 1);
  await refusal(listOrganizationExports(db, w.administrator, w.organizationId));

  // Every member's app sees the lock through the synchronized profile.
  const [profile] = await db
    .select({ data: s.syncEntity.data })
    .from(s.syncEntity)
    .where(eq(s.syncEntity.key, organizationProfileKey(w.organizationId)));
  assert.deepEqual((profile!.data as { deletion: unknown }).deletion, {
    deleteAfter: deletion.deleteAfter,
    requestedBy: "Lockdown Owner",
  });

  // The other members are told in the app and by email, whatever their
  // preferences; the owner who scheduled it is not.
  await db.insert(s.notificationPreference).values({
    organizationId: w.organizationId,
    userId: w.reviewer,
    scope: "organization",
    scopeId: w.organizationId,
    kind: "organization_deletion_cancelled",
    inApp: false,
    email: false,
  });
  const notices = await db
    .select({
      userId: s.notification.userId,
      kind: s.notification.kind,
      email: s.notificationEmail.status,
    })
    .from(s.notification)
    .leftJoin(
      s.notificationEmail,
      eq(s.notificationEmail.notificationId, s.notification.id),
    )
    .where(
      and(
        eq(s.notification.organizationId, w.organizationId),
        eq(s.notification.kind, "organization_deletion_scheduled"),
      ),
    );
  assert.deepEqual(
    notices.map((n) => [n.userId, n.kind, n.email]).sort(),
    [
      [w.administrator, "organization_deletion_scheduled", "pending"],
      [w.reviewer, "organization_deletion_scheduled", "pending"],
    ].sort(),
  );

  // Recorded in the organization's log and in the installation's history.
  const [audited] = await db
    .select()
    .from(s.auditEvent)
    .where(
      and(
        eq(s.auditEvent.organizationId, w.organizationId),
        eq(s.auditEvent.action, "organization.deletion_scheduled"),
      ),
    );
  assert.equal(audited?.actorId, w.owner);
  assert.equal(audited?.detail.deleteAfter, deletion.deleteAfter);
  const [instance] = await db
    .select()
    .from(s.instanceAuditEvent)
    .where(
      and(
        eq(s.instanceAuditEvent.targetId, w.organizationId),
        eq(s.instanceAuditEvent.action, "organization.deletion_scheduled"),
      ),
    );
  assert.equal(instance?.actorId, w.owner);

  // Cancelling opens it again and tells the members, even one who turned
  // that notice off.
  assert.deepEqual(
    await cancelOrganizationDeletion(db, w.owner, w.organizationId),
    { cancelled: true },
  );
  assert.deepEqual(
    await cancelOrganizationDeletion(db, w.owner, w.organizationId),
    { cancelled: false },
  );
  const roster = await directory(db, w.reviewer, w.organizationId);
  assert.ok(roster.projects.length > 0);
  const cancelled = await db
    .select({ userId: s.notification.userId })
    .from(s.notification)
    .where(
      and(
        eq(s.notification.organizationId, w.organizationId),
        eq(s.notification.kind, "organization_deletion_cancelled"),
      ),
    );
  assert.deepEqual(
    cancelled.map((n) => n.userId).sort(),
    [w.administrator, w.reviewer].sort(),
  );
  const [reopened] = await db
    .select({ data: s.syncEntity.data })
    .from(s.syncEntity)
    .where(eq(s.syncEntity.key, organizationProfileKey(w.organizationId)));
  assert.equal((reopened!.data as { deletion: unknown }).deletion, null);
  const [cancelAudit] = await db
    .select()
    .from(s.instanceAuditEvent)
    .where(
      and(
        eq(s.instanceAuditEvent.targetId, w.organizationId),
        eq(s.instanceAuditEvent.action, "organization.deletion_cancelled"),
      ),
    );
  assert.equal(cancelAudit?.actorId, w.owner);
});

void test(
  "after the grace period the worker deletes the organization's rows, files and credentials, and nothing of another organization",
  { timeout: 60_000 },
  async () => {
    const w = await workspace("Sunset", "SUN");
    await forgetOtherDeletions();
    const other = await workspace("Keep", "KEP");
    const before = await organizationRows(other.organizationId);
    const users = await db.select({ id: s.user.id }).from(s.user);
    const now = new Date();
    const { deletion } = await schedule(w, now);
    const due = new Date(deletion.deleteAfter);
    const { storage, deleted } = recordingStorage();

    // Nothing happens before the date.
    assert.deepEqual(
      await processOrganizationDeletions(db, {
        storage: () => storage,
        now: () => new Date(due.getTime() - 60_000),
      }),
      { claimed: 0, deleted: 0, failed: 0 },
    );

    const result = await processOrganizationDeletions(db, {
      storage: () => storage,
      now: () => new Date(due.getTime() + 60_000),
    });
    assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });

    // Every stored object of the organization, and only those.
    assert.deepEqual(deleted.sort(), [...w.objectKeys].sort());
    // No row of the organization is left anywhere; the organization is gone.
    const left = await organizationRows(w.organizationId);
    assert.deepEqual(
      Object.entries(left).filter(([, count]) => count > 0),
      [],
    );
    assert.equal(
      (
        await db
          .select()
          .from(s.organization)
          .where(eq(s.organization.id, w.organizationId))
      ).length,
      0,
    );
    // The other organization is untouched, and accounts are kept.
    assert.deepEqual(await organizationRows(other.organizationId), before);
    assert.equal(
      (await db.select({ id: s.user.id }).from(s.user)).length,
      users.length,
    );

    // The installation's history keeps the record.
    const [record] = await db
      .select()
      .from(s.instanceAuditEvent)
      .where(
        and(
          eq(s.instanceAuditEvent.targetId, w.organizationId),
          eq(s.instanceAuditEvent.action, "organization.deleted"),
        ),
      );
    assert.equal(record?.via, "worker");
    assert.equal(record?.actorId, w.owner);
    assert.equal(record?.targetLabel, "Sunset");
    const detail = record.detail as {
      slug: string;
      members: number;
      files: number;
      rows: Record<string, number>;
    };
    assert.equal(detail.slug, w.slug);
    assert.equal(detail.members, 3);
    assert.equal(detail.files, 2);
    assert.equal(detail.rows.delivery_connection, 1);
    assert.ok(detail.rows.specification_revision >= 2);

    // Running again finds nothing.
    assert.equal(
      (
        await processOrganizationDeletions(db, {
          storage: () => storage,
          now: () => new Date(due.getTime() + 2 * DAY),
        })
      ).claimed,
      0,
    );
  },
);

void test(
  "without file storage the deletion waits with an actionable reason and finishes on retry; once started it cannot be cancelled",
  { timeout: 60_000 },
  async () => {
    const w = await workspace("Stranded", "STR");
    await forgetOtherDeletions();
    const { deletion } = await schedule(w);
    const due = new Date(deletion.deleteAfter).getTime() + 60_000;

    const blocked = await processOrganizationDeletions(db, {
      storage: () => null,
      now: () => new Date(due),
    });
    assert.deepEqual(blocked, { claimed: 1, deleted: 0, failed: 1 });
    const [waiting] = await db
      .select()
      .from(s.organizationDeletion)
      .where(eq(s.organizationDeletion.organizationId, w.organizationId));
    assert.equal(waiting?.status, "deleting");
    assert.match(waiting.error!, /2 stored files.*no file storage configured/);
    assert.equal(waiting?.filesDeletedAt, null);
    // Nothing was deleted.
    assert.ok((await organizationRows(w.organizationId)).work_item! > 0);

    // The worker has started: an owner can no longer cancel.
    const late = await refusal(
      cancelOrganizationDeletion(db, w.owner, w.organizationId),
    );
    assert.equal(late.category, "conflict");

    // The retry waits for its time, then completes once storage is there.
    const { storage, deleted } = recordingStorage();
    assert.equal(
      (
        await processOrganizationDeletions(db, {
          storage: () => storage,
          now: () => new Date(due + 60_000),
        })
      ).claimed,
      0,
    );
    assert.deepEqual(
      await processOrganizationDeletions(db, {
        storage: () => storage,
        now: () => new Date(due + 20 * 60_000),
      }),
      { claimed: 1, deleted: 1, failed: 0 },
    );
    assert.equal(deleted.length, 2);
    assert.equal(
      (
        await db
          .select()
          .from(s.organization)
          .where(eq(s.organization.id, w.organizationId))
      ).length,
      0,
    );
  },
);

void test(
  "the only owner can delete their account once the organization is scheduled for deletion, and the deletion still runs",
  { timeout: 60_000 },
  async () => {
    const w = await workspace("Farewell", "FAR");
    await forgetOtherDeletions();
    await assert.rejects(deleteAccount(db, w.owner), /only owner of Farewell/);
    const { deletion } = await schedule(w);
    await deleteAccount(db, w.owner);
    const { storage } = recordingStorage();
    assert.equal(
      (
        await processOrganizationDeletions(db, {
          storage: () => storage,
          now: () => new Date(new Date(deletion.deleteAfter).getTime() + 1),
        })
      ).deleted,
      1,
    );
  },
);

// The worker deletes organization tables in `deletionOrder`; anything not
// listed must go with the organization row. A new organization table fails
// here until it is placed in the order.
void test("the deletion order covers every organization table and deletes children before the rows they reference", async () => {
  const listed = deletionOrder.map((t) => getTableConfig(t).name);
  const keys = await db.execute<{
    child: string;
    parent: string;
    action: string;
  }>(sql`
    select c.conrelid::regclass::text as child,
      c.confrelid::regclass::text as parent,
      c.confdeltype as action
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
  const strip = (name: string) => name.replaceAll('"', "");
  const fromOrganization = keys.filter(
    (k) => strip(k.parent) === "organization",
  );
  for (const key of fromOrganization)
    if (key.action !== "c")
      assert.ok(
        listed.includes(strip(key.child)),
        `${strip(key.child)} references organization without ON DELETE CASCADE; add it to deletionOrder`,
      );
  // Every listed table is an organization table.
  for (const table of listed)
    assert.ok(
      fromOrganization.some((k) => strip(k.child) === table),
      `${table} in deletionOrder has no organization foreign key`,
    );
  // Tables that reference a listed table are listed earlier (or cascade).
  for (const key of keys) {
    const child = strip(key.child);
    const parent = strip(key.parent);
    if (child === parent || !listed.includes(parent) || key.action === "c")
      continue;
    assert.ok(
      listed.includes(child) && listed.indexOf(child) < listed.indexOf(parent),
      `${child} references ${parent}, so it must be deleted first`,
    );
  }
  // Every table with an organization_id goes one way or the other.
  const scoped = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'organization_id'`);
  for (const { table_name } of scoped)
    assert.ok(
      listed.includes(table_name) ||
        fromOrganization.some(
          (k) => strip(k.child) === table_name && k.action === "c",
        ),
      `${table_name} has an organization_id but would survive the organization's deletion`,
    );
});
