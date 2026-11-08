import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import type { Analyzer } from "@lictory/core/ai/analyzer";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory, executeMutation } from "@lictory/core/domain/service";
import { createJobDatabase, listenForWork } from "@lictory/core/jobs";
import { workerConfig, workerJobs } from "@lictory/worker/jobs";
import type { Log } from "@lictory/worker/log";
import { createSupervisor, type Job } from "@lictory/worker/supervisor";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_worker_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const databaseUrl = url.toString();
const { db, close } = createJobDatabase(databaseUrl, { max: 5 });
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await close();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting.");
    await sleep(10);
  }
}
const quiet: Log = () => undefined;

void test("a failing job backs off without holding up the others", async () => {
  let good = 0;
  let bad = 0;
  const jobs: Job[] = [
    {
      name: "bad",
      intervalMs: 5,
      async run() {
        bad++;
        throw new Error("boom");
      },
    },
    {
      name: "good",
      intervalMs: 5,
      async run() {
        good++;
        return {};
      },
    },
  ];
  const lines: string[] = [];
  const supervisor = createSupervisor(jobs, {
    log: (_level, event, fields) =>
      lines.push(JSON.stringify({ event, ...fields })),
    backoffMs: 40,
  });
  supervisor.start();
  // Progress and the scheduled delays, not run counts in a wall-clock window:
  // on a busy machine every timer fires late, so counts depend on its speed.
  await until(() => good > 15 && bad >= 3, 30_000);
  const retries = lines
    .map(
      (line) =>
        JSON.parse(line) as { event: string; job?: string; retryInMs?: number },
    )
    .filter((line) => line.event === "worker.job_failed" && line.job === "bad")
    .map((line) => line.retryInMs);
  assert.deepEqual(
    retries.slice(0, 3),
    [40, 80, 160],
    "the failing job backs off exponentially",
  );
  const status = supervisor.status().find((j) => j.name === "bad")!;
  assert.ok(status.consecutiveFailures >= 2);
  assert.equal(status.lastErrorCategory, "internal");
  assert.ok(supervisor.healthy(), "failing work does not make it unhealthy");
  assert.ok(
    lines.some((l) => l.includes('"worker.job_failed"') && !l.includes("boom")),
    "raw error messages are not logged",
  );
  assert.equal(
    await supervisor.stop({ timeoutMs: 100, cancelAfterMs: 50 }),
    true,
  );
});

void test("work signals run a job at once and coalesce while it runs", async () => {
  let runs = 0;
  let release!: () => void;
  const supervisor = createSupervisor(
    [
      {
        name: "email",
        kind: "email",
        intervalMs: 60 * 60_000,
        async run() {
          runs++;
          await new Promise<void>((r) => (release = r));
          return {};
        },
      },
    ],
    { log: quiet },
  );
  supervisor.start();
  await until(() => runs === 1);
  for (let i = 0; i < 10; i++) supervisor.signal("email");
  supervisor.signal("ai");
  release();
  await until(() => runs === 2);
  release();
  await sleep(30);
  assert.equal(runs, 2, "a burst of signals causes one extra run");
  supervisor.signal("email");
  await until(() => runs === 3);
  release();
  await supervisor.stop({ timeoutMs: 100, cancelAfterMs: 50 });
});

void test("shutdown waits for the run in flight, then cancels it at the deadline", async () => {
  let started = false;
  let finished = false;
  let cancelled = false;
  const slow = createSupervisor(
    [
      {
        name: "slow",
        intervalMs: 60_000,
        async run({ stopping, cancel }) {
          started = true;
          await sleep(100);
          assert.ok(stopping.aborted);
          cancelled = cancel.aborted;
          finished = true;
          return {};
        },
      },
    ],
    { log: quiet },
  );
  slow.start();
  await until(() => started);
  assert.equal(
    await slow.stop({ timeoutMs: 20_000, cancelAfterMs: 10_000 }),
    true,
  );
  assert.ok(finished);
  assert.equal(
    cancelled,
    false,
    "a run that finishes in time is not cancelled",
  );

  const stubborn = createSupervisor(
    [
      {
        name: "model",
        intervalMs: 60_000,
        run: ({ cancel }) =>
          new Promise((resolve) =>
            cancel.addEventListener("abort", () => resolve({})),
          ),
      },
    ],
    { log: quiet },
  );
  stubborn.start();
  // The run only ends when cancelled, so stopping before the deadline proves
  // cancellation ended it early.
  assert.equal(
    await stubborn.stop({ timeoutMs: 20_000, cancelAfterMs: 50 }),
    true,
  );

  const hung = createSupervisor(
    [
      {
        name: "hung",
        intervalMs: 60_000,
        run: () => new Promise(() => undefined),
      },
    ],
    { log: quiet },
  );
  hung.start();
  assert.equal(await hung.stop({ timeoutMs: 50, cancelAfterMs: 10 }), false);
});

async function organization() {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Owner", email: `${userId}@example.test` });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Org",
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
  await seedOrganization(db, organizationId);
  const command = (c: Command) =>
    executeMutation(
      db,
      { userId },
      {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command: c,
      },
    );
  const projectId = crypto.randomUUID();
  await command({
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  const types = (await directory(db, userId, organizationId)).types;
  const workItemId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId,
    workItemId,
    typeId: types.find((t) => t.name === "Epic")!.id,
    parentId: null,
    title: "Safe payments",
    description: "Customers are never charged twice.",
  });
  await command({ type: "setAiPolicy", enabled: true });
  const review = async () => {
    const runId = crypto.randomUUID();
    await command({ type: "requestAiReview", workItemId, runId });
    return async () =>
      (await db.select().from(s.aiRun).where(eq(s.aiRun.id, runId)))[0]!.status;
  };
  return { review };
}

const analyzer: Analyzer = {
  model: "fake",
  reviewItem: async () => ({ summary: "Clear.", strengths: [], findings: [] }),
  reviewPullRequest: async () => ({
    summary: "Clear.",
    strengths: [],
    findings: [],
  }),
};

void test("a committed request wakes the worker through LISTEN, also after the connection drops", async () => {
  process.env.OPENAI_API_KEY ??= "test-key";
  const org = await organization();
  // Polling is effectively off: only the signal can explain a prompt run.
  const config = workerConfig({
    WORKER_AI_INTERVAL_MS: String(60 * 60_000),
  });
  const supervisor = createSupervisor(
    workerJobs(db, config, { analyzer }).filter((j) => j.name === "ai"),
    { log: quiet },
  );
  const listens: boolean[] = [];
  const listener = listenForWork(databaseUrl, {
    onSignal: (kind) => supervisor.signal(kind),
    onListening: (reconnected) => {
      listens.push(reconnected);
      if (reconnected) supervisor.wakeAll();
    },
    onLost: () => undefined,
  });
  try {
    supervisor.start();
    await until(() => listener.listening());
    await until(() => supervisor.status()[0]!.runs === 1);

    // Polling is an hour apart, so completing at all proves the commit's
    // notification woke the worker; how fast depends on the machine.
    const first = await org.review();
    await until(async () => (await first()) === "completed", 30_000);

    // The server drops the LISTEN connection; the worker re-listens, and
    // looks for work it may have missed meanwhile.
    await admin`select pg_terminate_backend(pid) from pg_stat_activity
      where datname = ${databaseName} and query ilike 'listen%'`;
    await until(() => listens.length === 2, 30_000);
    assert.deepEqual(listens, [false, true]);
    const second = await org.review();
    await until(async () => (await second()) === "completed", 30_000);
  } finally {
    await listener.close();
    await supervisor.stop({ timeoutMs: 1_000, cancelAfterMs: 500 });
  }
});

void test("the AI job claims nothing until the AI provider settings have loaded", async () => {
  process.env.OPENAI_API_KEY ??= "test-key";
  const org = await organization();
  let loaded = false;
  const supervisor = createSupervisor(
    workerJobs(db, workerConfig({ WORKER_AI_INTERVAL_MS: "50" }), {
      analyzer,
      aiSettings: () =>
        loaded
          ? Promise.resolve()
          : Promise.reject(new Error("settings not loaded")),
    }).filter((j) => j.name === "ai"),
    { log: quiet, backoffMs: 20, maxBackoffMs: 50 },
  );
  const status = await org.review();
  const queued = await status();
  try {
    supervisor.start();
    await until(() => supervisor.status()[0]!.consecutiveFailures >= 3);
    // Still waiting, not claimed and failed for want of a provider.
    assert.equal(await status(), queued);
    loaded = true;
    await until(async () => (await status()) === "completed", 30_000);
  } finally {
    await supervisor.stop({ timeoutMs: 1_000, cancelAfterMs: 500 });
  }
});

void test("the worker process reports health and exits cleanly on SIGTERM", async () => {
  const child = spawn(process.execPath, ["apps/worker/src/index.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
      WORKER_HEALTH_PORT: "0",
      WORKER_SHUTDOWN_TIMEOUT_MS: "5000",
      NODE_ENV: "production",
      PLATFORM_URL: "http://localhost:3001",
      RESEND_API_KEY: "",
      SMTP_HOST: "localhost",
      SMTP_FROM: "Lictory <no-reply@lictory.local>",
      // Production startup validation rejects published example secrets
      // (such as the CI runbook's), so the test brings its own.
      BETTER_AUTH_SECRET: "worker-test-secret-local-only-at-least-32-bytes",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: Record<string, unknown>[] = [];
  const read = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n"))
      if (line.startsWith("{")) lines.push(JSON.parse(line) as never);
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  const exited = new Promise<number | null>((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  try {
    await until(
      () =>
        lines.some((l) => l.event === "worker.health") &&
        lines.some((l) => l.event === "worker.listening"),
      15_000,
    );
    const port = lines.find((l) => l.event === "worker.health")!.port as number;
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      listening: boolean;
      jobs: { name: string }[];
    };
    assert.equal(body.listening, true);
    assert.deepEqual(body.jobs.map((j) => j.name).sort(), [
      "ai",
      "chat-1",
      "chat-2",
      "chat-3",
      "chat-4",
      "delivery",
      "delivery-status",
      "email",
      "export",
      "organization-deletion",
      "schedules",
    ]);
    child.kill("SIGTERM");
    assert.equal(await exited, 0);
    const stopped = lines.find((l) => l.event === "worker.stopped");
    assert.equal(stopped?.clean, true);
  } finally {
    child.kill("SIGKILL");
  }
});

void test("in production the worker refuses to start with partial mail settings", async () => {
  const child = spawn(process.execPath, ["apps/worker/src/index.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      WORKER_HEALTH_PORT: "0",
      NODE_ENV: "production",
      PLATFORM_URL: "http://localhost:3001",
      RESEND_API_KEY: "",
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve) =>
    child.on("exit", (exitCode) => resolve(exitCode)),
  );
  assert.notEqual(code, 0);
  assert.match(output, /SMTP_FROM is required in production/);
  assert.doesNotMatch(output, /worker\.started/);
});
