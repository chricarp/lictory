import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";

// Two API processes in production mode against one disposable database, the
// way several replicas run behind the gateway. They share nothing but
// PostgreSQL, so a limit reached through one is only enforced by the other
// when the counters live in the database.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_rate_limit_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const databaseUrl = url.toString();
const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const origin = "http://platform.test";
let created = false;

type Replica = { base: string };
const children: { child: ChildProcess; exited: Promise<unknown> }[] = [];

async function startReplica(): Promise<Replica> {
  const child = spawn(process.execPath, ["apps/api/src/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
      PLATFORM_URL: origin,
      BETTER_AUTH_SECRET: "test-only-rate-limit-secret-not-a-production-value",
      HOST: "127.0.0.1",
      PORT: "0",
      SHUTDOWN_TIMEOUT_MS: "1000",
      ZERO_QUERY_API_KEY: "zero-test-key",
      ZERO_MUTATE_API_KEY: "zero-test-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  children.push({ child, exited });
  let output = "";
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`The API did not start:\n${output}`)),
      180_000,
    );
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const port = /"event":"api\.listening","port":(\d+)/.exec(output)?.[1];
      if (port) {
        clearTimeout(timer);
        resolve(Number(port));
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    void exited.then(() => {
      clearTimeout(timer);
      reject(new Error(`The API exited before listening:\n${output}`));
    });
  });
  return { base: `http://127.0.0.1:${port}` };
}

before(
  async () => {
    await admin`CREATE DATABASE ${admin(databaseName)}`;
    created = true;
    await migrate(db, { migrationsFolder: "drizzle" });
  },
  { timeout: 120_000 },
);
after(
  async () => {
    for (const { child, exited } of children) {
      if (child.exitCode === null) child.kill("SIGTERM");
      await exited;
    }
    await client.end();
    if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
    await admin.end();
  },
  { timeout: 60_000 },
);

// The gateway sends each request with exactly one client address.
const requestReset = (replica: Replica, address: string) =>
  fetch(`${replica.base}/api/auth/request-password-reset`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-forwarded-for": address,
    },
    // Validation fails before any lookup or email; the attempt still
    // consumes the endpoint's limit (3 per minute, which leaves room for a
    // slow machine).
    body: "{}",
  });

void test(
  "authentication rate limits are shared by API replicas",
  { timeout: 300_000 },
  async () => {
    const [a, b] = await Promise.all([startReplica(), startReplica()]);
    // Warm both processes up so the attempts below fit in one window.
    for (const replica of [a, b])
      assert.equal(
        (
          await fetch(`${replica.base}/api/auth/ok`, {
            headers: { "x-forwarded-for": "192.0.2.1" },
          })
        ).status,
        200,
      );

    const visitor = "198.51.100.21";
    for (let i = 0; i < 3; i++)
      assert.equal((await requestReset(a, visitor)).status, 400);
    const limited = await requestReset(b, visitor);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("x-retry-after")) > 0);
    // Back on the first replica the visitor is still limited.
    assert.equal((await requestReset(a, visitor)).status, 429);
    // Another visitor has an independent limit on either replica.
    assert.equal((await requestReset(b, "198.51.100.22")).status, 400);

    const [row] = await db
      .select()
      .from(s.rateLimit)
      .where(eq(s.rateLimit.key, `${visitor}|/request-password-reset`));
    assert.equal(row?.count, 3);
  },
);
