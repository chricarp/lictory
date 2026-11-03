import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { authenticateAccessToken } from "@lictory/core/capabilities/access-tokens";
import {
  CapabilityError,
  noEffects,
  type Principal,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import type { AuditEntry } from "@lictory/core/contracts/audit";
import { auditLogCsv, readAuditLog } from "@lictory/core/domain/audit-log";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  plannedAuthAudit,
  rememberPreviousRole,
} from "@lictory/core/lib/auth-audit-plan";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_audit_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
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

const as = (principal: Principal) => ({
  db,
  principal,
  effects: noEffects,
});
const web = (userId: string) => as({ userId, surface: "web" });

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

async function organization(
  members: [string, "owner" | "admin" | "member"][],
  seed = true,
) {
  const id = crypto.randomUUID();
  await db
    .insert(s.organization)
    .values({ id, name: "Org", slug: id, createdAt: new Date() });
  await db.insert(s.member).values(
    members.map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId: id,
      userId,
      role,
      createdAt: new Date(),
    })),
  );
  if (seed) await seedOrganization(db, id);
  return id;
}

async function everything(userId: string, organizationId: string) {
  const entries: AuditEntry[] = [];
  let cursor: string | null = null;
  do {
    const page = await readAuditLog(db, userId, organizationId, {
      cursor,
      limit: 2,
    });
    entries.push(...page.entries);
    cursor = page.nextCursor;
  } while (cursor);
  return entries;
}

void test("access token changes are recorded in every organization of their owner, without analytics", async () => {
  const owner = await user("Olive Owner");
  const other = await user("Oscar Other");
  const first = await organization([[owner, "owner"]]);
  const second = await organization([
    [other, "owner"],
    [owner, "member"],
  ]);
  const unrelated = await organization([[other, "owner"]]);

  const { token } = (await invoke(web(owner), "createAccessToken", {
    name: "Spec reviewer",
    access: "write",
    expiresInDays: 30,
  })) as { token: { id: string } };
  await invoke(web(owner), "revokeAccessToken", { tokenId: token.id });
  // Revoking again changes nothing and records nothing.
  await invoke(web(owner), "revokeAccessToken", { tokenId: token.id });

  for (const [reader, organizationId] of [
    [owner, first],
    [other, second],
  ] as const) {
    const tokens = (
      await readAuditLog(db, reader, organizationId, { category: "access" })
    ).entries;
    assert.deepEqual(
      tokens.map((e) => e.action),
      ["access_token.revoked", "access_token.created"],
    );
    assert.equal(tokens[1]!.actor?.name, "Olive Owner");
    assert.equal(tokens[1]!.target?.label, "Spec reviewer");
    assert.match(
      tokens[1]!.summary,
      /Created write access token “Spec reviewer”, expiring/,
    );
    // The secret never reaches the audit record.
    assert.doesNotMatch(JSON.stringify(tokens), /lct_[A-Za-z0-9_-]{20,}/);
  }
  const elsewhere = await readAuditLog(db, other, unrelated);
  assert.equal(
    elsewhere.entries.filter((e) => e.category === "access").length,
    0,
  );
});

void test("only administrators of the organization can read its audit log", async () => {
  const owner = await user("Ada Admin");
  const member = await user("Max Member");
  const outsider = await user("Otto Outsider");
  const organizationId = await organization([
    [owner, "owner"],
    [member, "member"],
  ]);
  const foreign = await organization([[outsider, "owner"]]);
  await recordAuditEvent(db, {
    organizationId: foreign,
    actor: { id: outsider },
    action: "organization.updated",
    detail: { name: "Secret plans" },
  });

  for (const [userId, organization] of [
    [member, organizationId],
    [outsider, organizationId],
    [owner, foreign],
  ] as const) {
    await assert.rejects(
      invoke(web(userId), "listAuditLog", { organizationId: organization }),
      (e: unknown) =>
        e instanceof CapabilityError && e.category === "forbidden",
    );
    await assert.rejects(
      auditLogCsv(db, userId, organization, {}),
      /Only organization administrators/,
    );
  }
  const own = (await invoke(web(owner), "listAuditLog", {
    organizationId,
  })) as { entries: AuditEntry[] };
  assert.ok(!JSON.stringify(own).includes("Secret plans"));
});

void test("agents cannot read the audit log", async () => {
  const owner = await user("Agent Owner");
  const organizationId = await organization([[owner, "owner"]]);
  const { secret } = (await invoke(web(owner), "createAccessToken", {
    name: "Reader",
    access: "read",
    expiresInDays: null,
  })) as { secret: string };
  const token = (await authenticateAccessToken(db, secret))!;
  await assert.rejects(
    invoke(
      as({
        userId: owner,
        surface: "mcp",
        tokenId: token.tokenId,
        access: "read",
      }),
      "listAuditLog",
      { organizationId },
    ),
    (e: unknown) =>
      e instanceof CapabilityError && e.details.kind === "human_only",
  );
  // The refused attempt is itself in the log, as an agent call.
  const agent = (
    await readAuditLog(db, owner, organizationId, { category: "agent" })
  ).entries;
  assert.equal(agent[0]?.action, "listAuditLog");
  assert.match(
    agent[0]?.summary ?? "",
    /MCP agent “Reader” called listAuditLog \(refused: forbidden\)/,
  );
});

void test("configuration changes and security events read as one log, newest first, page by page", async () => {
  const owner = await user("Paula Pager");
  const member = await user("Quinn");
  const organizationId = await organization([
    [owner, "owner"],
    [member, "member"],
  ]);
  const projectId = crypto.randomUUID();
  await invoke(web(owner), "createProject", {
    organizationId,
    projectId,
    name: "Payments",
    key: "PAY",
  });
  await invoke(web(owner), "setProjectMember", {
    organizationId,
    projectId,
    userId: member,
    role: "member",
  });
  // Several events in one transaction share a timestamp; the cursor still
  // returns each exactly once.
  await db.transaction(async (tx) => {
    for (let i = 0; i < 5; i++)
      await recordAuditEvent(tx, {
        organizationId,
        actor: { id: member },
        action: "invitation.created",
        target: {
          type: "invitation",
          id: `inv-${i}`,
          label: `p${i}@example.test`,
        },
        detail: { role: "member" },
      });
  });
  const all = await everything(owner, organizationId);
  assert.equal(new Set(all.map((e) => `${e.source}:${e.id}`)).size, all.length);
  assert.equal(all.filter((e) => e.action === "invitation.created").length, 5);
  const configuration = all.filter((e) => e.category === "configuration");
  const membership = configuration.find((e) => e.action === "setProjectMember");
  assert.equal(membership?.summary, "Set project member");
  assert.equal(membership?.actor?.name, "Paula Pager");
  const times = all.map((e) => e.at);
  assert.deepEqual(times, [...times].sort().reverse());

  const byMember = await readAuditLog(db, owner, organizationId, {
    actorId: member,
  });
  assert.equal(byMember.entries.length, 5);
  assert.ok(byMember.entries.every((e) => e.actor?.id === member));
  const tomorrow = new Date(Date.now() + 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const future = await readAuditLog(db, owner, organizationId, {
    from: tomorrow,
  });
  assert.equal(future.entries.length, 0);
  await assert.rejects(
    readAuditLog(db, owner, organizationId, { cursor: "not-a-cursor" }),
    /no longer valid/,
  );
});

void test("audit entries cannot be edited or deleted, but leave with their organization", async () => {
  const owner = await user("Ivy Immutable");
  // Unseeded, so the organization itself can be deleted at the end.
  const organizationId = await organization([[owner, "owner"]], false);
  await recordAuditEvent(db, {
    organizationId,
    actor: { id: owner },
    action: "member.role_changed",
    target: { type: "member", id: owner, label: "Ivy" },
    detail: { from: "member", to: "admin" },
  });
  await db.insert(s.configurationAudit).values({
    organizationId,
    actorId: owner,
    action: "updateProject",
    detail: {},
  });
  for (const statement of [
    sql`update audit_event set action = 'member.added' where organization_id = ${organizationId}`,
    sql`delete from audit_event where organization_id = ${organizationId}`,
    sql`update configuration_audit set actor_id = 'someone' where organization_id = ${organizationId}`,
    sql`delete from configuration_audit where organization_id = ${organizationId}`,
  ])
    await assert.rejects(db.execute(statement), (e: unknown) =>
      String((e as { cause?: unknown }).cause ?? e).includes(
        "cannot be changed or deleted",
      ),
    );

  // The actor's snapshot survives the account being deleted.
  const witness = await user("Wendy Witness");
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId: witness,
    role: "member",
    createdAt: new Date(),
  });
  await recordAuditEvent(db, {
    organizationId,
    actor: { id: witness },
    action: "member.left",
  });
  await db.delete(s.user).where(eq(s.user.id, witness));
  const left = (await readAuditLog(db, owner, organizationId)).entries.find(
    (e) => e.action === "member.left",
  );
  assert.equal(left?.actor?.name, "Wendy Witness");

  await db.delete(s.organization).where(eq(s.organization.id, organizationId));
  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.auditEvent)
    .where(eq(s.auditEvent.organizationId, organizationId));
  assert.equal(remaining!.n, 0);
});

void test("the CSV export holds every filtered entry and neutralizes formulas", async () => {
  const owner = await user('=HYPERLINK("http://evil")');
  const organizationId = await organization([[owner, "owner"]]);
  for (let i = 0; i < 3; i++)
    await recordAuditEvent(db, {
      organizationId,
      actor: { id: owner },
      action: "invitation.created",
      target: {
        type: "invitation",
        id: `i${i}`,
        label: `a,b"${i}@example.test`,
      },
    });
  let csv = "";
  for await (const chunk of await auditLogCsv(db, owner, organizationId, {
    category: "membership",
  }))
    csv += chunk;
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(
    lines[0],
    "Time (UTC),Category,Actor,Actor email,Action,Summary,Target type,Target,Details",
  );
  assert.equal(lines.length, 4);
  assert.ok(lines[1]!.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(lines[1]!.includes(`"a,b""2@example.test"`));
});

void test("Better Auth membership calls map to audit records", () => {
  const actor = { id: "u-admin" };
  rememberPreviousRole("m-1", "member");
  assert.deepEqual(
    plannedAuthAudit(
      "/organization/update-member-role",
      { memberId: "m-1", role: "admin" },
      { id: "m-1", organizationId: "o-1", userId: "u-2", role: "admin" },
      actor,
    ),
    {
      organizationId: "o-1",
      actor,
      action: "member.role_changed",
      target: { type: "member", id: "u-2" },
      targetUserId: "u-2",
      detail: { memberId: "m-1", from: "member", to: "admin" },
    },
  );
  assert.equal(
    plannedAuthAudit(
      "/organization/remove-member",
      {},
      { member: { id: "m-2", organizationId: "o-1", userId: "u-admin" } },
      actor,
    )?.action,
    "member.left",
  );
  assert.equal(
    plannedAuthAudit(
      "/organization/invite-member",
      {},
      {
        id: "i-1",
        organizationId: "o-1",
        email: "x@example.test",
        role: "member",
      },
      actor,
    )?.target?.label,
    "x@example.test",
  );
  // Reads and unknown paths record nothing.
  assert.equal(
    plannedAuthAudit("/organization/list-members", {}, { members: [] }, actor),
    null,
  );
  assert.equal(
    plannedAuthAudit(
      "/organization/update",
      { data: { logo: "x" } },
      { id: "o-1", name: "Org" },
      actor,
    ),
    null,
  );
});
