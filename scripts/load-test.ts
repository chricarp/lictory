// Load test for a running Lictory stack: seeds representative organizations
// through the real domain write path, then drives concurrent signed-in Zero
// clients through the platform origin while sampling the server.
//
//   bun scripts/load-test.ts seed   # DATABASE_URL of the stack under test
//   bun scripts/load-test.ts run    # PLATFORM_URL of the same stack
//
// Seed settings: LOAD_ORGS (10), LOAD_MEMBERS (10 per organization),
// LOAD_PROJECTS (2), LOAD_ITEMS (300 per project), LOAD_THREADS (0.3 per
// item), LOAD_CONCURRENCY (4). Run settings: LOAD_CLIENTS (50),
// LOAD_DURATION_S (180), LOAD_MUTATION_INTERVAL_MS (15000 per client),
// LOAD_ITEMS_OPENED (3 per client), LOAD_SAMPLE_COMMAND (a shell command
// printing one JSON object of server metrics, run every 10 s; optional).
// Seeded users share the password in LOAD_PASSWORD. Never point this at a
// production database: it creates accounts and organizations.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";
import { serializeSignedCookie } from "better-call";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import WebSocket from "ws";
import { Zero } from "@rocicorp/zero";
import * as s from "@lictory/core/db/schema";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation, type Database } from "@lictory/core/domain/service";
import {
  PROTOCOL,
  type Command,
  type Directory,
} from "@lictory/core/contracts/protocol";
import { schema } from "@lictory/zero/schema";
import { queries } from "@lictory/zero/queries";
import { mutators } from "@lictory/zero/mutators";

const env = (name: string, fallback: number) =>
  Number(process.env[name] ?? fallback);
const password = process.env.LOAD_PASSWORD ?? "load-test-password-0001";

const run = process.argv[2];

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!,
  );
}
const summary = (values: number[]) => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  p99: percentile(values, 99),
  max: values.length ? Math.round(Math.max(...values)) : null,
});

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const client = postgres(url, { max: 10, onnotice: () => undefined });
  const db = drizzle(client, { schema: s }) as unknown as Database;
  const orgs = env("LOAD_ORGS", 10);
  const members = env("LOAD_MEMBERS", 10);
  const projects = env("LOAD_PROJECTS", 2);
  const items = env("LOAD_ITEMS", 300);
  const threadRate = env("LOAD_THREADS", 0.3);
  const concurrency = env("LOAD_CONCURRENCY", 4);
  const hash = await hashPassword(password);
  const started = Date.now();
  let mutations = 0;
  // Sessions are minted like Better Auth's own (random token, signed cookie),
  // so the run is not throttled by the per-address sign-in rate limit.
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET of the stack is required.");
  const users: {
    email: string;
    organizationId: string;
    userId: string;
    token: string;
  }[] = [];

  async function seedOrg(index: number) {
    const organizationId = crypto.randomUUID();
    const now = new Date();
    await db.insert(s.organization).values({
      id: organizationId,
      name: `Load ${index}`,
      slug: `load-${index}-${organizationId.slice(0, 6)}`,
      createdAt: now,
    });
    const people = Array.from({ length: members }, (_, m) => ({
      id: crypto.randomUUID(),
      email: `load-${index}-${m}-${organizationId.slice(0, 6)}@load.test`,
      name: `Person ${index}.${m}`,
    }));
    await db.insert(s.user).values(
      people.map((p) => ({
        ...p,
        emailVerified: true,
        handle: `l${p.id.replaceAll("-", "").slice(0, 20)}`,
      })),
    );
    await db.insert(s.account).values(
      people.map((p) => ({
        id: crypto.randomUUID(),
        accountId: p.id,
        providerId: "credential",
        userId: p.id,
        password: hash,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(s.member).values(
      people.map((p, m) => ({
        id: crypto.randomUUID(),
        organizationId,
        userId: p.id,
        role: m === 0 ? "owner" : "member",
        createdAt: now,
      })),
    );
    await seedOrganization(db, organizationId);
    const sessions = people.map((p) => ({
      id: crypto.randomUUID(),
      token: crypto.randomUUID().replaceAll("-", ""),
      userId: p.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(s.session).values(sessions);
    for (const [i, p] of people.entries())
      users.push({
        email: p.email,
        organizationId,
        userId: p.id,
        token: sessions[i]!.token,
      });
    const owner = people[0]!.id;
    const command = async (c: Command, actor = owner) => {
      mutations++;
      await executeMutation(
        db,
        { userId: actor },
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command: c,
        },
      );
    };
    const directory = async () =>
      (
        await db
          .select({ data: s.syncEntity.data })
          .from(s.syncEntity)
          .where(eq(s.syncEntity.key, `directory:${organizationId}`))
      )[0]!.data as unknown as Omit<Directory, "organizations">;
    for (let p = 0; p < projects; p++) {
      const projectId = crypto.randomUUID();
      await command({
        type: "createProject",
        projectId,
        name: `Project ${p}`,
        key: `P${String.fromCharCode(65 + p)}${index % 100}`.slice(0, 6),
      });
      const roster = await directory();
      const types = roster.types;
      // Everyone edits properties and specifications, as in a small team
      // where all members hold the Product discipline.
      const product = roster.disciplines.find(
        (d) => d.projectId === projectId && d.name === "Product",
      )!;
      const epicType = types.find((t) => t.name === "Epic")!;
      const storyType = types.find((t) => t.name === "Story")!;
      for (const person of people.slice(1)) {
        await command({
          type: "setProjectMember",
          projectId,
          userId: person.id,
          role: "member",
        });
        await command({
          type: "setDisciplineMember",
          projectId,
          disciplineId: product.id,
          userId: person.id,
          member: true,
        });
      }
      let epicId: string | null = null;
      for (let i = 0; i < items; i++) {
        const workItemId = crypto.randomUUID();
        const isEpic = i % 20 === 0;
        await command({
          type: "createWorkItem",
          projectId,
          workItemId,
          typeId: isEpic ? epicType.id : storyType.id,
          parentId: isEpic ? null : epicId,
          title: `${isEpic ? "Epic" : "Story"} ${i}: retry failed payments with idempotent keys`,
          description:
            "## Behaviour\n\nWhen the provider times out, the payment is retried with the original transaction id.\n\n## Acceptance criteria\n\n- Retries reuse the id\n- Customers are charged once\n",
        });
        if (isEpic) epicId = workItemId;
        if (Math.random() < threadRate) {
          const [revision] = await db
            .select({ key: s.syncEntity.key })
            .from(s.syncEntity)
            .where(
              and(
                eq(s.syncEntity.workItemId, workItemId),
                eq(s.syncEntity.type, "revision"),
              ),
            );
          if (!revision) continue;
          const threadId = crypto.randomUUID();
          await command({
            type: "createThread",
            workItemId,
            baseRevisionId: revision.key.slice("revision:".length),
            threadId,
            messageId: crypto.randomUUID(),
            body: "What happens when the provider answers after our timeout?",
            blocking: Math.random() < 0.3,
            section: "Behaviour",
          });
          await command({
            type: "replyToThread",
            workItemId,
            threadId,
            messageId: crypto.randomUUID(),
            body: "We keep the first answer and record the late one for reconciliation.",
          });
        }
      }
    }
  }

  const queue = Array.from({ length: orgs }, (_, i) => i);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift())
        await seedOrg(next);
    }),
  );
  const [{ rows, bytes } = { rows: 0, bytes: "" }] = await client<
    { rows: number; bytes: string }[]
  >`
    select count(*)::int as rows, pg_size_pretty(pg_total_relation_size('sync_entity')) as bytes from sync_entity`;
  const [{ size } = { size: "" }] = await client<
    { size: string }[]
  >`select pg_size_pretty(pg_database_size(current_database())) as size`;
  writeFileSync("/tmp/lictory-load-users.json", JSON.stringify(users));
  console.log(
    JSON.stringify({
      event: "seeded",
      orgs,
      users: users.length,
      mutations,
      seconds: Math.round((Date.now() - started) / 1000),
      projectionRows: rows,
      projectionSize: bytes,
      databaseSize: size,
    }),
  );
  await client.end();
}

async function load() {
  const platform = process.env.PLATFORM_URL ?? "http://localhost:3001";
  const users = JSON.parse(
    readFileSync("/tmp/lictory-load-users.json", "utf8"),
  ) as {
    email: string;
    organizationId: string;
    userId: string;
    token: string;
  }[];
  const clients = Math.min(env("LOAD_CLIENTS", 50), users.length);
  const duration = env("LOAD_DURATION_S", 180) * 1000;
  const interval = env("LOAD_MUTATION_INTERVAL_MS", 15_000);
  const opened = env("LOAD_ITEMS_OPENED", 3);
  // Spread clients across organizations.
  const byOrg = new Map<string, typeof users>();
  for (const u of users)
    byOrg.set(u.organizationId, [...(byOrg.get(u.organizationId) ?? []), u]);
  const chosen: typeof users = [];
  for (let round = 0; chosen.length < clients; round++)
    for (const list of byOrg.values()) {
      const user = list[round];
      if (user && chosen.length < clients) chosen.push(user);
    }

  // Each simulated browser sends its own session cookie on the WebSocket.
  const cookies = new Map<string, string>();
  (globalThis as { WebSocket: unknown }).WebSocket = class extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      const userID = new URL(address).searchParams.get("userID") ?? "";
      super(address, protocols, {
        headers: { cookie: cookies.get(userID) ?? "", origin: platform },
      });
    }
  };

  const hydration: number[] = [];
  const itemHydration: number[] = [];
  const serverAck: number[] = [];
  const propagation: number[] = [];
  let rejected = 0;
  let failedSignIns = 0;
  const watchers = new Map<string, Map<string, number>>(); // org -> key -> sent at
  const zeros: Zero[] = [];
  let stop = false;

  // The seeded session, presented exactly as a browser would (signed cookie).
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET of the stack is required.");
  const cookieName =
    process.env.LOAD_COOKIE_NAME ??
    (platform.startsWith("https:")
      ? "__Secure-better-auth.session_token"
      : "better-auth.session_token");
  async function signIn(user: (typeof users)[number]) {
    const cookie = (
      await serializeSignedCookie(cookieName, user.token, secret!)
    ).split(";")[0]!;
    const response = await fetch(`${platform}/api/session`, {
      headers: { cookie },
    });
    const body = (await response.json()) as { user: { id: string } | null };
    if (!response.ok || body.user?.id !== user.userId)
      throw new Error(`session ${response.status}`);
    return { cookie, userID: user.userId };
  }

  async function simulate(user: (typeof users)[number], observer: boolean) {
    let session;
    try {
      session = await signIn(user);
    } catch {
      failedSignIns++;
      return;
    }
    cookies.set(session.userID, session.cookie);
    const z = new Zero({
      userID: session.userID,
      context: { userID: session.userID },
      cacheURL: `${platform}/zero`,
      schema,
      mutators,
      kvStore: "mem",
      logLevel: "error",
    });
    zeros.push(z);
    const start = performance.now();
    const view = z.materialize(
      queries.organization({ organizationId: user.organizationId }),
    );
    await new Promise<void>((resolve) =>
      view.addListener((_data, resultType) => {
        if (resultType === "complete") resolve();
      }),
    );
    hydration.push(performance.now() - start);
    const rows = view.data as {
      key: string;
      type: string;
      data: Record<string, unknown>;
    }[];
    const items = rows.filter((r) => r.type === "workItem");
    if (observer)
      view.addListener((data) => {
        const sent = watchers.get(user.organizationId);
        if (!sent) return;
        for (const row of data as unknown as {
          key: string;
          data: { priority?: string };
        }[]) {
          const at = sent.get(`${row.key}:${row.data.priority}`);
          if (at !== undefined) {
            propagation.push(performance.now() - at);
            sent.delete(`${row.key}:${row.data.priority}`);
          }
        }
      });
    for (let i = 0; i < opened && items.length; i++) {
      const item = items[Math.floor(Math.random() * items.length)]!;
      const t = performance.now();
      const itemView = z.materialize(
        queries.workItem({
          organizationId: user.organizationId,
          workItemId: String(item.data.id),
        }),
      );
      await new Promise<void>((resolve) =>
        itemView.addListener((_d, resultType) => {
          if (resultType === "complete") resolve();
        }),
      );
      itemHydration.push(performance.now() - t);
    }
    if (observer) return;
    while (!stop) {
      await new Promise((r) => setTimeout(r, interval * (0.5 + Math.random())));
      if (stop || !items.length) break;
      const item = items[Math.floor(Math.random() * items.length)]!;
      const key = `workItem:${String(item.data.id)}`;
      // A property change: the server recomputes the item summary and
      // rewrites its projection, which every member's list subscription sees.
      const current = (
        view.data as unknown as { key: string; data: { priority?: string } }[]
      ).find((row) => row.key === key)?.data.priority;
      const choices = (["low", "medium", "high", "urgent"] as const).filter(
        (p) => p !== current,
      );
      const priority = choices[Math.floor(Math.random() * choices.length)]!;
      const sent =
        watchers.get(user.organizationId) ?? new Map<string, number>();
      watchers.set(user.organizationId, sent);
      const at = performance.now();
      sent.set(`${key}:${priority}`, at);
      const write = z.mutate(
        mutators.workspace.apply({
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId: user.organizationId,
          command: {
            type: "updateWorkItem",
            workItemId: String(item.data.id),
            priority,
          },
        }),
      );
      const result = await write.server;
      if (result.type === "error") {
        rejected++;
        sent.delete(`${key}:${priority}`);
      } else serverAck.push(performance.now() - at);
    }
  }

  const samples: unknown[] = [];
  const sampler = setInterval(() => {
    const command = process.env.LOAD_SAMPLE_COMMAND;
    if (!command) return;
    try {
      samples.push({
        at: new Date().toISOString(),
        ...JSON.parse(execSync(command, { encoding: "utf8" })),
      });
    } catch (error) {
      samples.push({ at: new Date().toISOString(), error: String(error) });
    }
  }, 10_000);

  const started = Date.now();
  const observers = new Set<string>();
  const tasks = chosen.map((user, i) => {
    const observer = !observers.has(user.organizationId);
    if (observer) observers.add(user.organizationId);
    // Ramp up over 30 s rather than a thundering herd.
    return new Promise((r) => setTimeout(r, (i / chosen.length) * 30_000)).then(
      () => simulate(user, observer),
    );
  });
  await new Promise((r) => setTimeout(r, duration));
  stop = true;
  await Promise.allSettled(tasks);
  clearInterval(sampler);
  await Promise.allSettled(zeros.map((z) => z.close()));
  const report = {
    event: "load",
    clients: chosen.length,
    organizations: observers.size,
    seconds: Math.round((Date.now() - started) / 1000),
    failedSignIns,
    rejected,
    organizationHydrationMs: summary(hydration),
    itemHydrationMs: summary(itemHydration),
    mutationServerAckMs: summary(serverAck),
    // From the writer's call to the change appearing in another member's
    // open organization subscription.
    propagationMs: summary(propagation),
    samples,
  };
  writeFileSync(
    process.env.LOAD_REPORT ?? "/tmp/lictory-load-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, samples: samples.length }));
  process.exit(0);
}

if (run === "seed") await seed();
else if (run === "run") await load();
else {
  console.error("Usage: bun scripts/load-test.ts seed|run");
  process.exit(2);
}
