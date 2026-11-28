import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import type * as Db from "@lictory/core/db";
import type * as App from "@lictory/api/app";
import type * as Agents from "@lictory/core/factory/agents";
import type * as Runners from "@lictory/core/factory/runners";
import type * as Sessions from "@lictory/core/factory/sessions";

// The runner protocol over HTTP, against the API app and a disposable
// database: registration, bearer authentication, long-poll claims, lease
// fencing, sequence gaps, steering, completion and per-runner rate limits.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_runner_api_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 2, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;

type Modules = {
  app: ReturnType<typeof App.createApp>;
  closeDatabase: typeof Db.closeDatabase;
  createAgent: typeof Agents.createAgent;
  createRunnerRegistration: typeof Runners.createRunnerRegistration;
  startSession: typeof Sessions.startSession;
  sendSessionMessage: typeof Sessions.sendSessionMessage;
  appDb: typeof Db.db;
};
let m: Modules;

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    DATABASE_URL_UNPOOLED: url.toString(),
    PLATFORM_URL: "http://platform.test",
    BETTER_AUTH_SECRET: "test-only-runner-secret-not-a-production-credential",
    ZERO_MUTATE_API_KEY: "zero-test-key",
  });
  const [
    { createApp },
    { closeDatabase, db: appDb },
    agents,
    runners,
    sessions,
  ] = await Promise.all([
    import("@lictory/api/app"),
    import("@lictory/core/db"),
    import("@lictory/core/factory/agents"),
    import("@lictory/core/factory/runners"),
    import("@lictory/core/factory/sessions"),
  ]);
  m = {
    app: createApp(),
    closeDatabase,
    appDb,
    createAgent: agents.createAgent,
    createRunnerRegistration: runners.createRunnerRegistration,
    startSession: sessions.startSession,
    sendSessionMessage: sessions.sendSessionMessage,
  };
});
after(async () => {
  await m?.closeDatabase().catch(() => undefined);
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
});

const machine = {
  os: "linux",
  arch: "arm64",
  version: "0.1.0",
  harnesses: [{ id: "claude-code", version: "2.1.0" }],
  maxSessions: 1,
  isolation: "host",
};

function post(path: string, body: unknown, credential?: string) {
  return m.app.request(`/api/runner/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function workspace() {
  const userId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Ada", email: `${userId}@example.test` });
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Northwind",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: "owner",
    createdAt: new Date(),
  });
  return { userId, organizationId };
}

void test("a runner registers, claims a session on a lease, streams fenced events, receives steering and completes", async () => {
  const { userId, organizationId } = await workspace();
  const { token } = await m.createRunnerRegistration(
    m.appDb,
    userId,
    organizationId,
    {
      personal: false,
    },
  );
  // Unauthenticated calls are refused.
  assert.equal(
    (await post("/heartbeat", { ...machine, sessions: [] })).status,
    401,
  );
  const registered = await post("/register", {
    ...machine,
    token,
    name: "build-1",
  });
  assert.equal(registered.status, 200);
  const { credential } = (await registered.json()) as { credential: string };
  // The token was single use.
  assert.equal(
    (await post("/register", { ...machine, token, name: "again" })).status,
    403,
  );

  // Nothing queued: the long-poll answers "nothing yet".
  assert.equal((await post("/claim", { wait: 0 }, credential)).status, 204);

  const agent = await m.createAgent(m.appDb, userId, organizationId, {
    name: "Forge",
    handle: "forge",
    kind: "runner",
    harness: "claude-code",
    access: "write",
  });
  const session = await m.startSession(
    m.appDb,
    { userId },
    {
      organizationId,
      agentId: agent.id,
      prompt: "Add refunds.",
    },
  );
  const claim = await post("/claim", { wait: 2 }, credential);
  assert.equal(claim.status, 200);
  const assignment = (await claim.json()) as {
    sessionId: string;
    leaseToken: string;
    inputCursor: number;
    lictory: { token: string };
  };
  assert.equal(assignment.sessionId, session.id);
  assert.match(assignment.lictory.token, /^lct_/);
  const path = (action: string) => `/sessions/${session.id}/${action}`;

  // A write with another lease token is fenced off.
  const stale = await post(
    path("events"),
    {
      leaseToken: "not-the-lease",
      events: [{ seq: 1, type: "message", data: { text: "hi" } }],
    },
    credential,
  );
  assert.equal(stale.status, 409);
  assert.equal(
    ((await stale.json()) as { error: { kind: string } }).error.kind,
    "lease_lost",
  );

  assert.equal(
    (
      await post(
        path("start"),
        { leaseToken: assignment.leaseToken },
        credential,
      )
    ).status,
    200,
  );
  const batch = (seq: number) => ({
    leaseToken: assignment.leaseToken,
    events: [{ seq, type: "message", data: { text: `step ${seq}` } }],
  });
  assert.equal((await post(path("events"), batch(1), credential)).status, 200);
  // A gap says where to resume.
  const gap = await post(path("events"), batch(3), credential);
  assert.equal(gap.status, 409);
  assert.deepEqual(
    ((await gap.json()) as { error: { kind: string; acked: number } }).error,
    {
      category: "conflict",
      kind: "sequence_gap",
      message: "Events must continue after sequence 1. Resend from there.",
      acked: 1,
    },
  );

  // A steering message reaches the runner's inbox long-poll.
  setTimeout(
    () =>
      void m.sendSessionMessage(
        m.appDb,
        { userId },
        {
          organizationId,
          sessionId: session.id,
          text: "Use the v2 API.",
        },
      ),
    300,
  );
  const inputs = await post(
    path("inputs"),
    {
      leaseToken: assignment.leaseToken,
      after: assignment.inputCursor,
      wait: 5,
    },
    credential,
  );
  const inbox = (await inputs.json()) as {
    inputs: { kind: string; data: { text: string } }[];
  };
  assert.deepEqual(
    inbox.inputs.map((i) => [i.kind, i.data.text]),
    [["message", "Use the v2 API."]],
  );

  // The built-in model proxy is not for this harness (and AI is off).
  const model = await post(
    path("model"),
    { leaseToken: assignment.leaseToken, call: { prompt: [] } },
    credential,
  );
  assert.ok([403, 404].includes(model.status), String(model.status));

  const done = await post(
    path("complete"),
    {
      leaseToken: assignment.leaseToken,
      outcome: "completed",
      summary: "Done.",
      lastSeq: 1,
    },
    credential,
  );
  assert.equal(done.status, 200);
  // After completion the lease is gone.
  assert.equal((await post(path("events"), batch(2), credential)).status, 409);
});

void test("each runner is rate limited", async () => {
  const { userId, organizationId } = await workspace();
  const { token } = await m.createRunnerRegistration(
    m.appDb,
    userId,
    organizationId,
    {
      personal: true,
    },
  );
  const registered = await post("/register", {
    ...machine,
    token,
    name: "laptop",
  });
  const { credential } = (await registered.json()) as { credential: string };
  const statuses: number[] = [];
  // 300 at once, refilled at 20 a second: well within a thousand calls.
  for (let i = 0; i < 1000; i++) {
    const response = await post(
      `/sessions/${crypto.randomUUID()}/start`,
      { leaseToken: "x" },
      credential,
    );
    statuses.push(response.status);
    if (response.status === 429) {
      assert.equal(response.headers.get("retry-after"), "2");
      break;
    }
  }
  assert.equal(statuses.at(-1), 429);
  assert.ok(statuses.slice(0, -1).every((status) => status === 409));
});
