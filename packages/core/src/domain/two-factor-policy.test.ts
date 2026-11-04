import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import {
  noEffects,
  type CapabilityError,
  type Principal,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { seedOrganization } from "@lictory/core/domain/organization";
import { auditLogCsv, readAuditLog } from "@lictory/core/domain/audit-log";
import { authorize, directory } from "@lictory/core/domain/service";
import { openOrganizationExport } from "@lictory/core/export/service";
import { heldOrganizations } from "@lictory/core/domain/two-factor-policy";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_two_factor_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

const as = (userId: string, surface: Principal["surface"] = "web") => ({
  db,
  principal: { userId, surface },
  effects: noEffects,
});

async function user(label: string, twoFactorEnabled = false) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({
    id,
    name: label,
    email: `${id}@example.test`,
    twoFactorEnabled,
  });
  if (twoFactorEnabled)
    await db.insert(s.twoFactor).values({
      id: crypto.randomUUID(),
      userId: id,
      secret: "encrypted-secret",
      backupCodes: "encrypted-codes",
      verified: true,
    });
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

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as CapabilityError & { kind?: string };
  }
  assert.fail("expected a rejection");
}

async function audit(organizationId: string, action: string) {
  return db
    .select()
    .from(s.auditEvent)
    .where(
      and(
        eq(s.auditEvent.organizationId, organizationId),
        eq(s.auditEvent.action, action),
      ),
    );
}

void test("requiring two-factor holds members without it on every server path until they enroll", async () => {
  const owner = await user("Owner");
  const member = await user("Member");
  const outsider = await user("Outsider");
  const organizationId = await organization([
    [owner, "owner"],
    [member, "member"],
  ]);
  const elsewhere = await organization([[member, "owner"]]);

  // Lockout: the administrator turning it on needs two-factor first.
  const unprotected = await rejection(
    invoke(as(owner), "setTwoFactorRequirement", {
      organizationId,
      required: true,
    }),
  );
  assert.equal(unprotected.category, "validation");
  assert.match(unprotected.message, /your own account/);
  // Members cannot change it at all.
  const notAdmin = await rejection(
    invoke(as(member), "setTwoFactorRequirement", {
      organizationId,
      required: false,
    }),
  );
  assert.equal(notAdmin.category, "forbidden");

  await db
    .update(s.user)
    .set({ twoFactorEnabled: true })
    .where(eq(s.user.id, owner));
  const result = (await invoke(as(owner), "setTwoFactorRequirement", {
    organizationId,
    required: true,
  })) as { requireTwoFactor: boolean; membersWithoutTwoFactor: number };
  assert.equal(result.requireTwoFactor, true);
  assert.equal(result.membersWithoutTwoFactor, 1);
  const [recorded] = await audit(
    organizationId,
    "two_factor.requirement_changed",
  );
  assert.equal(recorded?.actorId, owner);
  assert.deepEqual(recorded?.detail, {
    requireTwoFactor: true,
    previous: false,
  });

  // The member is held: capabilities on every surface, domain authorization
  // and the directory refuse with the same reason.
  for (const surface of ["web", "mcp", "agent"] as const) {
    const held = await rejection(
      invoke(as(member, surface), "getWorkspace", { organizationId }),
    );
    assert.equal(held.category, "forbidden");
    assert.equal(held.details.kind, "two_factor_required");
  }
  const domain = await rejection(authorize(db, member, organizationId));
  assert.equal(domain.kind, "two_factor_required");
  const roster = await rejection(directory(db, member, organizationId));
  assert.equal(roster.kind, "two_factor_required");
  assert.deepEqual(
    (await heldOrganizations(db, member)).map((o) => o.id),
    [organizationId],
  );
  // Other organizations, the enrolled owner and outsiders are unaffected;
  // outsiders learn nothing about the policy.
  await invoke(as(member), "getWorkspace", { organizationId: elsewhere });
  await invoke(as(owner), "getWorkspace", { organizationId });
  const stranger = await rejection(
    invoke(as(outsider), "getWorkspace", { organizationId }),
  );
  assert.equal(stranger.details.kind, undefined);
  assert.match(stranger.message, /not a member/);

  // Enrolling lifts the hold immediately; turning it off holds again.
  await db
    .update(s.user)
    .set({ twoFactorEnabled: true })
    .where(eq(s.user.id, member));
  await invoke(as(member), "getWorkspace", { organizationId });
  assert.deepEqual(await heldOrganizations(db, member), []);
  await db
    .update(s.user)
    .set({ twoFactorEnabled: false })
    .where(eq(s.user.id, member));
  assert.equal(
    (await rejection(authorize(db, member, organizationId))).kind,
    "two_factor_required",
  );

  // The inverse: an administrator can stop requiring it.
  await invoke(as(owner), "setTwoFactorRequirement", {
    organizationId,
    required: false,
  });
  await authorize(db, member, organizationId);
  assert.equal(
    (await audit(organizationId, "two_factor.requirement_changed")).length,
    2,
  );
  // Administrators see who has two-factor; members do not.
  const security = (await invoke(as(owner), "getOrganizationSecurity", {
    organizationId,
  })) as { members: { userId: string; twoFactorEnabled: boolean }[] };
  assert.deepEqual(
    security.members.map((m) => [m.userId, m.twoFactorEnabled]).sort(),
    [
      [member, false],
      [owner, true],
    ].sort(),
  );
  assert.equal(
    (
      await rejection(
        invoke(as(member), "getOrganizationSecurity", { organizationId }),
      )
    ).category,
    "forbidden",
  );
  // Agents cannot weaken sign-in requirements.
  assert.equal(
    (
      await rejection(
        invoke(as(owner, "mcp"), "setTwoFactorRequirement", {
          organizationId,
          required: false,
        }),
      )
    ).details.kind,
    "human_only",
  );
});

void test("an administrator resets a member's two-factor with an audit entry", async () => {
  const owner = await user("Owner", true);
  const adminWithout = await user("Admin without two-factor");
  const adminWith = await user("Admin", true);
  const member = await user("Member", true);
  const outsider = await user("Outsider", true);
  const organizationId = await organization([
    [owner, "owner"],
    [adminWithout, "admin"],
    [adminWith, "admin"],
    [member, "member"],
  ]);
  await db.insert(s.verification).values({
    id: crypto.randomUUID(),
    identifier: "trust-device-abc",
    value: member,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const reset = (actor: string, userId: string) =>
    invoke(as(actor), "resetMemberTwoFactor", { organizationId, userId });
  assert.match(
    (await rejection(reset(adminWithout, member))).message,
    /your own account/,
  );
  assert.match(
    (await rejection(reset(adminWith, adminWith))).message,
    /Account settings/,
  );
  assert.equal(
    (await rejection(reset(adminWith, owner))).category,
    "forbidden",
  );
  assert.equal(
    (await rejection(reset(member, adminWith))).category,
    "forbidden",
  );
  assert.equal(
    (await rejection(reset(adminWith, outsider))).category,
    "not_found",
  );

  await reset(adminWith, member);
  const [after] = await db
    .select({ twoFactorEnabled: s.user.twoFactorEnabled })
    .from(s.user)
    .where(eq(s.user.id, member));
  assert.equal(after?.twoFactorEnabled, false);
  assert.deepEqual(
    await db.select().from(s.twoFactor).where(eq(s.twoFactor.userId, member)),
    [],
  );
  assert.deepEqual(
    await db
      .select()
      .from(s.verification)
      .where(eq(s.verification.value, member)),
    [],
  );
  const [entry] = await audit(organizationId, "two_factor.member_reset");
  assert.equal(entry?.actorId, adminWith);
  assert.equal(entry?.targetType, "member");
  assert.equal(entry?.targetId, member);
  // Nothing left to reset; owners can reset other owners and admins.
  assert.equal(
    (await rejection(reset(adminWith, member))).category,
    "validation",
  );
  await reset(owner, adminWith);
});

void test("a held administrator cannot download the audit log or a data export", async () => {
  const owner = await user("Owner", true);
  const heldAdmin = await user("Held admin");
  const organizationId = await organization([
    [owner, "owner"],
    [heldAdmin, "admin"],
  ]);
  await invoke(as(owner), "setTwoFactorRequirement", {
    organizationId,
    required: true,
  });

  // The download routes call these directly, without the capability registry.
  const csv = await rejection(auditLogCsv(db, heldAdmin, organizationId, {}));
  assert.equal(csv.kind, "two_factor_required");
  const archive = await rejection(
    openOrganizationExport(db, heldAdmin, organizationId, crypto.randomUUID()),
  );
  assert.equal(archive.kind, "two_factor_required");

  // The enrolled owner reads the policy change in the audit log.
  const { entries } = await readAuditLog(db, owner, organizationId, {
    category: "access",
  });
  assert.deepEqual(
    entries.map((e) => [e.action, e.summary]),
    [
      [
        "two_factor.requirement_changed",
        "Required two-factor authentication for members",
      ],
    ],
  );
});
