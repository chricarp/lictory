import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
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

// A verified person with a session cookie, created through Better Auth.
async function person(name: string) {
  const email = `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const password = "Test-password-123";
  await m.auth.api.signUpEmail({ body: { name, email, password } });
  await db
    .update(s.user)
    .set({ emailVerified: true })
    .where(eq(s.user.email, email));
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
    { members: { id: string; name: string; role: string }[] } | undefined;

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
    const organization = await m.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Acme", slug: `acme-${crypto.randomUUID().slice(0, 8)}` },
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
    assert.ok(
      !(await directoryOf(organization.id))!.members.some(
        (x) => x.id === leaver.id,
      ),
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
    signIn: { password: true, ssoName: null },
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
