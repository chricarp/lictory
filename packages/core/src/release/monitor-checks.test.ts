import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";

// deploy/monitor/checks.sql against the real schema: every check parses and
// the factory, agent-event and Slack checks report what an operator must act
// on (and stay quiet about personal runners and healthy queues).

const repository = new URL("../../../../", import.meta.url).pathname;
const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_monitor_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 2, onnotice: () => undefined });
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

// The file is run by psql; its one meta-command block (\gset, \if) guards
// the WAL listing, which the test database may not grant. The rest is one
// statement with psql variables.
function checksQuery() {
  const sql = readFileSync(`${repository}deploy/monitor/checks.sql`, "utf8")
    .replace(/^SELECT has_function_privilege[\s\S]*?\\endif\n/m, "")
    .replaceAll(":slot_lag_bytes", "2147483648")
    .replaceAll(":wal_bytes", "6442450944");
  assert.doesNotMatch(sql, /^\\/m, "no psql meta-commands left");
  return sql;
}

async function problems() {
  const rows = await client.unsafe<{ name: string; detail: string }[]>(
    `SELECT * FROM (${checksQuery().replace(/;\s*$/, "")}) AS checks(name, detail)`,
  );
  return rows.filter((row) => row.name !== "replication_slot");
}

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000);

test("the monitor reports offline runners, stranded sessions, suspended webhooks and Slack failures", async () => {
  assert.deepEqual(await problems(), [], "an empty installation is healthy");

  const owner = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: owner, name: "Owner", email: `${owner}@example.test` });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Monitor",
    slug: `monitor-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  const runner = (
    name: string,
    lastSeenAt: Date,
    extra: Partial<typeof s.runner.$inferInsert> = {},
  ) => ({
    id: crypto.randomUUID(),
    organizationId,
    name,
    credentialHash: crypto.randomUUID(),
    credentialPrefix: "lcr_test",
    harnesses: [{ id: "codex", version: null }],
    lastSeenAt,
    createdById: owner,
    ...extra,
  });
  await db.insert(s.runner).values([
    runner("build-01", minutesAgo(30)),
    runner("online-01", minutesAgo(0.5)),
    runner("retired-01", minutesAgo(600), { revokedAt: minutesAgo(500) }),
    // A laptop asleep overnight is not an operator problem.
    runner("laptop", minutesAgo(600), { ownerId: owner }),
  ]);
  const agent = (harness: string) => ({
    id: crypto.randomUUID(),
    organizationId,
    handle: `agent_${harness.replace("-", "_")}`,
    name: harness,
    ownerId: owner,
    kind: "runner" as const,
    harness,
    createdById: owner,
  });
  const codex = agent("codex");
  const claude = agent("claude-code");
  await db.insert(s.agent).values([codex, claude]);
  const session = (
    agentId: string,
    status: "queued" | "assigned",
    createdAt: Date,
  ) => ({
    id: crypto.randomUUID(),
    organizationId,
    agentId,
    requestedById: owner,
    status,
    title: "Task",
    prompt: "Do it",
    createdAt,
    assignedAt: status === "assigned" ? createdAt : null,
  });
  await db.insert(s.agentSession).values([
    // Only an offline or missing runner could run it.
    session(claude.id, "queued", minutesAgo(20)),
    // A capable runner is online and picks it up: just busy for now.
    session(codex.id, "queued", minutesAgo(20)),
    session(codex.id, "assigned", minutesAgo(12)),
  ]);
  await db.insert(s.agentEventSubscription).values({
    id: crypto.randomUUID(),
    kind: "webhook",
    userId: owner,
    organizationId,
    name: "Receiver",
    url: "https://receiver.example.test/events",
    secret: "encrypted",
    status: "suspended",
    statusReason: "Suspended after 5 failed attempts to deliver one event.",
    cursorSeq: 0,
  });
  const [installation] = await db
    .insert(s.slackInstallation)
    .values({
      organizationId,
      appId: "A1",
      clientId: "1.2",
      encryptedClientSecret: "x",
      encryptedSigningSecret: "x",
      status: "invalid",
      lastError: "Slack refused the token (token_revoked).",
    })
    .returning();
  await db.insert(s.slackEvent).values({
    organizationId,
    installationId: installation!.id,
    eventId: "Ev1",
    eventType: "message",
    payload: {},
    failedAt: minutesAgo(5),
    lastError: "channel_not_found",
  });

  const found = await problems();
  const details = (check: string) =>
    found.filter((p) => p.name === check).map((p) => p.detail);
  assert.deepEqual(details("runner"), [
    `1 organization runner(s) offline for more than 10 min: build-01 (last seen ${(
      await client`SELECT last_seen_at::text AS t FROM runner WHERE name = 'build-01'`
    )[0]!.t as string}) (revoke a retired runner in Factory -> Runners)`,
  ]);
  const sessions = details("agent_session");
  assert.equal(sessions.length, 2, sessions.join("\n"));
  assert.match(
    sessions[0]!,
    /^1 queued for more than 15 min with no online runner/,
  );
  assert.match(sessions[1]!, /^1 assigned to a runner for more than 10 min/);
  assert.deepEqual(details("agent_event_subscription"), [
    "1 webhook subscription(s) suspended (latest: Suspended after 5 failed attempts to deliver one event.)",
  ]);
  assert.deepEqual(details("slack"), [
    "1 Slack installation(s) need reinstalling: Slack refused the token (latest: Slack refused the token (token_revoked).)",
    "1 Slack event(s) failed in the last 24 h (latest: channel_not_found)",
  ]);
});
