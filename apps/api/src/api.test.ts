import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { attachmentsAvailable } from "@lictory/core/storage";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import type * as Db from "@lictory/core/db";
import type * as Service from "@lictory/core/domain/service";
import type * as Auth from "@lictory/core/lib/auth";
import type * as App from "@lictory/api/app";

// The API process against a disposable database: Better Auth membership
// changes through its own API, the HTTP boundary of the Zero endpoints and
// the SPA document. The application modules read their configuration at
// import, so they are imported after the environment points at this database.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_api_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 2, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const origin = "http://platform.test";
let created = false;

type Modules = {
  auth: typeof Auth.auth;
  executeMutation: typeof Service.executeMutation;
  app: ReturnType<typeof App.createApp>;
  closeDatabase: typeof Db.closeDatabase;
};
let m: Modules;

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    DATABASE_URL_UNPOOLED: url.toString(),
    PLATFORM_URL: origin,
    BETTER_AUTH_SECRET: "test-only-api-secret-not-a-production-credential",
    ZERO_MUTATE_API_KEY: "zero-test-key",
    // The self-hosted defaults (invitations only, organizations by instance
    // administrators), whatever a developer's .env says.
    LICTORY_SIGNUP_MODE: "",
    LICTORY_ALLOWED_EMAIL_DOMAINS: "",
    LICTORY_ORGANIZATION_CREATION: "",
  });
  const [{ auth }, { executeMutation }, { createApp }, { closeDatabase }] =
    await Promise.all([
      import("@lictory/core/lib/auth"),
      import("@lictory/core/domain/service"),
      import("@lictory/api/app"),
      import("@lictory/core/db"),
    ]);
  m = { auth, executeMutation, app: createApp(), closeDatabase };
});
after(async () => {
  await m?.closeDatabase().catch(() => undefined);
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
});

// A verified person with a session cookie: an account an administrator
// created through Better Auth (self-service sign-up needs an invitation).
async function person(name: string) {
  const email = `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const password = "Test-password-123";
  await m.auth.api.provisionUser({ body: { name, email, password } });
  const response = await m.auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const headers = new Headers({ cookie, origin });
  const session = (await m.auth.api.getSession({ headers }))!;
  return { id: session.user.id, email, cookie, headers };
}

const directoryOf = async (organizationId: string) =>
  (
    await db
      .select()
      .from(s.syncEntity)
      .where(eq(s.syncEntity.key, `directory:${organizationId}`))
  )[0]?.data as
    | {
        members: { id: string; name: string; role: string }[];
        formerMembers: { id: string; name: string }[];
      }
    | undefined;

void test("auth rate limits use the gateway's single client address and ignore other IP headers", async () => {
  const context = await m.auth.$context;
  const enabled = context.rateLimit.enabled;
  context.rateLimit.enabled = true;
  const attempt = (address: string, claimedAddress = "203.0.113.99") =>
    m.app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-forwarded-for": address,
        "cf-connecting-ip": claimedAddress,
        "x-real-ip": claimedAddress,
      },
      // Validation fails before credential lookup, but the request still
      // consumes the sign-in endpoint's production rate limit.
      body: "{}",
    });
  try {
    for (let i = 0; i < 3; i++)
      assert.equal((await attempt("198.51.100.117")).status, 400);
    assert.equal((await attempt("198.51.100.117")).status, 429);
    // Changing untrusted headers cannot escape this client's bucket.
    assert.equal(
      (await attempt("198.51.100.117", "203.0.113.100")).status,
      429,
    );
    // Another visitor can still attempt a sign-in.
    assert.equal((await attempt("198.51.100.118")).status, 400);
  } finally {
    context.rateLimit.enabled = enabled;
  }
});

void test(
  "membership changes through Better Auth refresh the directory and govern domain access",
  { timeout: 30_000 },
  async () => {
    const owner = await person("Owner");
    const member = await person("Member");
    // Created for the owner, as the admin console does.
    const organization = await m.auth.api.createOrganization({
      body: {
        name: "Acme",
        slug: `acme-${crypto.randomUUID().slice(0, 8)}`,
        userId: owner.id,
      },
    });
    const [profile] = await db
      .select()
      .from(s.syncEntity)
      .where(eq(s.syncEntity.key, `organizationProfile:${organization.id}`));
    assert.equal(profile?.data.name, "Acme");
    await m.auth.api.addMember({
      body: {
        userId: member.id,
        organizationId: organization.id,
        role: "member",
      },
    });
    assert.ok(
      (await directoryOf(organization.id))!.members.some(
        (x) => x.id === member.id,
      ),
    );
    const command = (actor: string, c: Command) =>
      m.executeMutation(
        db,
        { userId: actor },
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId: organization.id,
          command: c,
        },
      );
    await command(owner.id, {
      type: "createProject",
      projectId: crypto.randomUUID(),
      name: "Payments",
      key: "PAY",
    });
    const [membership] = await db
      .select({ id: s.member.id })
      .from(s.member)
      .where(eq(s.member.userId, member.id));
    await m.auth.api.updateMemberRole({
      headers: owner.headers,
      body: {
        memberId: membership!.id,
        role: "admin",
        organizationId: organization.id,
      },
    });
    assert.equal(
      (await directoryOf(organization.id))!.members.find(
        (x) => x.id === member.id,
      )?.role,
      "admin",
    );
    // Renames reach every directory listing the person.
    await m.auth.api.updateUser({
      headers: member.headers,
      body: { name: "Renamed" },
    });
    assert.equal(
      (await directoryOf(organization.id))!.members.find(
        (x) => x.id === member.id,
      )?.name,
      "Renamed",
    );
    await command(member.id, { type: "setAiPolicy", enabled: false });

    await m.auth.api.removeMember({
      headers: owner.headers,
      body: { memberIdOrEmail: member.email, organizationId: organization.id },
    });
    assert.ok(
      !(await directoryOf(organization.id))!.members.some(
        (x) => x.id === member.id,
      ),
    );
    await assert.rejects(
      command(member.id, { type: "setAiPolicy", enabled: true }),
      /You are not a member of this organization/,
    );
    // The member row Zero authorizes subscriptions with is gone.
    assert.equal(
      (
        await db
          .select()
          .from(s.member)
          .where(
            and(
              eq(s.member.organizationId, organization.id),
              eq(s.member.userId, member.id),
            ),
          )
      ).length,
      0,
    );
    // Leaving has no organization hook; the API path refreshes too.
    const leaver = await person("Leaver");
    await m.auth.api.addMember({
      body: {
        userId: leaver.id,
        organizationId: organization.id,
        role: "member",
      },
    });
    const left = await m.app.request("/api/auth/organization/leave", {
      method: "POST",
      headers: {
        cookie: leaver.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ organizationId: organization.id }),
    });
    assert.equal(left.status, 200);
    const afterLeaving = (await directoryOf(organization.id))!;
    assert.ok(!afterLeaving.members.some((x) => x.id === leaver.id));
    // People who left or were removed keep their history attributed by name.
    assert.deepEqual(
      afterLeaving.formerMembers.map((x) => x.id).sort(),
      [leaver.id, member.id].sort(),
    );
  },
);

void test("the API boundary: sessions, internal Zero endpoints, origins and the document", async () => {
  const user = await person("Boundary");
  const session = await m.app.request("/api/session", {
    headers: { cookie: user.cookie },
  });
  assert.equal(session.headers.get("cache-control"), "no-store");
  const body = (await session.json()) as { user: { id: string } | null };
  assert.equal(body.user?.id, user.id);
  assert.deepEqual(await (await m.app.request("/api/session")).json(), {
    user: null,
    providers: { google: false, microsoft: false, oidc: false },
    signIn: { password: true, ssoName: null, signUpMode: "invite" },
    // Follows this environment's S3_*/R2_* settings (a developer .env may set them).
    attachments: attachmentsAvailable(),
  });
  assert.equal((await m.app.request("/api/account")).status, 401);
  const account = await m.app.request("/api/account", {
    headers: { cookie: user.cookie },
  });
  assert.equal(
    ((await account.json()) as { sessionCount: number }).sessionCount,
    1,
  );

  const push = (headers: Record<string, string>) =>
    m.app.request("/api/zero/mutate?schema=zero_0&appID=zero", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    });
  assert.equal((await push({ "x-api-key": "zero-test-key" })).status, 401);
  assert.equal(
    (await push({ cookie: user.cookie, "x-api-key": "wrong" })).status,
    401,
  );
  assert.equal((await push({ cookie: user.cookie })).status, 401);
  assert.equal(
    (await push({ cookie: user.cookie, "x-api-key": "zero-test-key" })).status,
    200,
  );

  const write = (requestOrigin?: string) =>
    m.app.request("/api/appearance", {
      method: "POST",
      headers: {
        cookie: user.cookie,
        "content-type": "application/json",
        ...(requestOrigin ? { origin: requestOrigin } : {}),
      },
      body: JSON.stringify({ appearance: "dark" }),
    });
  assert.equal((await write("https://evil.example")).status, 403);
  assert.equal((await write()).status, 403);
  assert.equal((await write(origin)).status, 200);

  assert.equal((await m.app.request("/healthz")).status, 200);
  assert.equal((await m.app.request("/readyz")).status, 200);
  assert.equal((await m.app.request("/api/unknown")).status, 404);
  assert.equal((await m.app.request("/api/sync")).status, 404);
});

const json = (body: unknown) => ({
  origin,
  "content-type": "application/json",
  body: JSON.stringify(body),
});
const post = (path: string, body: unknown, cookie?: string) => {
  const { body: payload, ...headers } = json(body);
  return m.app.request(path, {
    method: "POST",
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    body: payload,
  });
};
const makeInstanceAdmin = (id: string) =>
  db.update(s.user).set({ instanceAdmin: true }).where(eq(s.user.id, id));

void test("instance policy: self-service accounts need an invitation, organizations an instance administrator", async () => {
  const password = "Test-password-123";
  const signUp = (email: string) =>
    post("/api/auth/sign-up/email", { name: "Newcomer", email, password });
  const accountFor = async (email: string) =>
    (await db.select().from(s.user).where(eq(s.user.email, email))).length;

  const stranger = `stranger-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const refused = await signUp(stranger);
  assert.equal(refused.status, 403);
  assert.equal(
    ((await refused.json()) as { code: string }).code,
    "signup_invitation_required",
  );
  assert.equal(await accountFor(stranger), 0);

  const owner = await person("Inviter");
  const organization = await m.auth.api.createOrganization({
    body: {
      name: "Invites",
      slug: `invites-${crypto.randomUUID().slice(0, 8)}`,
      userId: owner.id,
    },
  });
  const invite = (email: string, expiresAt: Date) =>
    db.insert(s.invitation).values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      email,
      role: "member",
      status: "pending",
      expiresAt,
      inviterId: owner.id,
      createdAt: new Date(),
    });
  const invited = `invited-${crypto.randomUUID().slice(0, 8)}@example.test`;
  await invite(invited, new Date(Date.now() + 86_400_000));
  assert.equal((await signUp(invited.toUpperCase())).status, 200);
  assert.equal(await accountFor(invited), 1);
  // An expired invitation no longer opens the door.
  const late = `late-${crypto.randomUUID().slice(0, 8)}@example.test`;
  await invite(late, new Date(Date.now() - 1000));
  assert.equal((await signUp(late)).status, 403);

  // Only instance administrators create organizations.
  const create = () =>
    post(
      "/api/auth/organization/create",
      { name: "Mine", slug: `mine-${crypto.randomUUID().slice(0, 8)}` },
      owner.cookie,
    );
  assert.equal((await create()).status, 403);
  const before = (await (
    await m.app.request("/api/session", { headers: { cookie: owner.cookie } })
  ).json()) as {
    user: { instanceAdmin: boolean; canCreateOrganization: boolean };
  };
  assert.deepEqual(
    [before.user.instanceAdmin, before.user.canCreateOrganization],
    [false, false],
  );
  await makeInstanceAdmin(owner.id);
  assert.equal((await create()).status, 200);
  const after = (await (
    await m.app.request("/api/session", { headers: { cookie: owner.cookie } })
  ).json()) as {
    user: { instanceAdmin: boolean; canCreateOrganization: boolean };
  };
  assert.deepEqual(
    [after.user.instanceAdmin, after.user.canCreateOrganization],
    [true, true],
  );
});

void test("the admin API serves instance administrators only, and deactivation ends access until reactivation", async () => {
  const admin = await person("Admin");
  // The only instance administrator (earlier tests may have made others).
  await db.update(s.user).set({ instanceAdmin: false });
  await makeInstanceAdmin(admin.id);
  const member = await person("Member");
  assert.equal((await m.app.request("/api/admin/overview")).status, 401);
  assert.equal(
    (
      await m.app.request("/api/admin/overview", {
        headers: { cookie: member.cookie },
      })
    ).status,
    403,
  );
  const overview = await m.app.request("/api/admin/overview", {
    headers: { cookie: admin.cookie },
  });
  assert.equal(overview.status, 200);
  assert.equal(
    ((await overview.json()) as { policy: { signUpMode: string } }).policy
      .signUpMode,
    "invite",
  );
  // Writes must come from the platform's own origin.
  assert.equal(
    (
      await m.app.request("/api/admin/users", {
        method: "POST",
        headers: {
          cookie: admin.cookie,
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "X", email: "x@example.test" }),
      })
    ).status,
    403,
  );

  // An account created in the console can sign in right away.
  const email = `created-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const created = await post(
    "/api/admin/users",
    { name: "Created", email, password: "Created-password-1" },
    admin.cookie,
  );
  assert.equal(created.status, 200);
  await m.auth.api.signInEmail({
    body: { email, password: "Created-password-1" },
  });

  const deactivate = (id: string, deactivated: boolean) =>
    post(`/api/admin/users/${id}/deactivation`, { deactivated }, admin.cookie);
  assert.equal((await deactivate(member.id, true)).status, 200);
  assert.equal(await m.auth.api.getSession({ headers: member.headers }), null);
  await assert.rejects(
    m.auth.api.signInEmail({
      body: { email: member.email, password: "Test-password-123" },
    }),
    (error: { body?: { code?: string } }) =>
      error.body?.code === "account_deactivated",
  );
  // Nobody locks themselves or the installation out.
  assert.equal((await deactivate(admin.id, true)).status, 409);
  const revoke = await post(
    `/api/admin/users/${admin.id}/administrator`,
    { instanceAdmin: false },
    admin.cookie,
  );
  assert.equal(revoke.status, 409);
  assert.equal(
    ((await revoke.json()) as { error: { code: string } }).error.code,
    "last_administrator",
  );
  assert.equal((await deactivate(member.id, false)).status, 200);
  await m.auth.api.signInEmail({
    body: { email: member.email, password: "Test-password-123" },
  });

  // Organizations created for someone else make them the owner.
  const organization = await post(
    "/api/admin/organizations",
    { name: "Console Org", owner: { email: member.email } },
    admin.cookie,
  );
  assert.equal(organization.status, 200);
  const { organization: made } = (await organization.json()) as {
    organization: { id: string; slug: string };
  };
  assert.equal(made.slug, "console-org");
  const [ownership] = await db
    .select({ role: s.member.role })
    .from(s.member)
    .where(
      and(eq(s.member.organizationId, made.id), eq(s.member.userId, member.id)),
    );
  assert.equal(ownership?.role, "owner");
  // The administrator gains no membership by creating it.
  const [adminMembership] = await db
    .select()
    .from(s.member)
    .where(
      and(eq(s.member.organizationId, made.id), eq(s.member.userId, admin.id)),
    );
  assert.equal(adminMembership, undefined);

  const activity = (await (
    await m.app.request("/api/admin/activity", {
      headers: { cookie: admin.cookie },
    })
  ).json()) as {
    events: { action: string; actor: { email: string } | null }[];
  };
  for (const action of [
    "user.created",
    "user.deactivated",
    "user.reactivated",
    "organization.created",
  ])
    assert.ok(
      activity.events.some(
        (e) => e.action === action && e.actor?.email === admin.email,
      ),
      `activity records ${action}`,
    );
  // Instance history is append-only.
  await assert.rejects(db.delete(s.instanceAuditEvent));
});
