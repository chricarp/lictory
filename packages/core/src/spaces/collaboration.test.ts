// Spike: proves the live draft persistence contract against real PostgreSQL
// and a real Hocuspocus server before Spaces builds on it.
// See docs/internals/spaces.md#draft-writes-a-narrow-exception-to-the-domain-write-rule.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import { Hocuspocus } from "@hocuspocus/server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as Y from "yjs";
import * as s from "@lictory/core/db/schema";
import { draftCollaboration } from "@lictory/core/spaces/collaboration";
import { listenCollaboration } from "@lictory/core/spaces/transport";
import {
  appendDraftUpdates,
  loadDraft,
  type DraftAccess,
  type DraftRef,
} from "@lictory/core/spaces/drafts";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_spaces_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 12, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  // Spike tables; the real ones arrive with the Spaces schema.
  await db.execute(sql`
    create table space_draft (
      id text primary key,
      organization_id text not null references organization(id),
      epoch integer not null default 1,
      sequence integer not null default 0,
      snapshot bytea,
      snapshot_sequence integer not null default 0,
      fenced_at timestamp,
      updated_at timestamp not null default now()
    );
    create table space_draft_update (
      organization_id text not null references organization(id),
      draft_id text not null references space_draft(id),
      epoch integer not null,
      sequence integer not null,
      author_id text not null references "user"(id),
      "update" bytea not null,
      created_at timestamp not null default now(),
      primary key (draft_id, sequence)
    );
  `);
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function organization() {
  const organizationId = crypto.randomUUID();
  const [alice, bob] = [crypto.randomUUID(), crypto.randomUUID()];
  await db
    .insert(s.user)
    .values(
      [alice, bob].map((id) => ({ id, name: id, email: `${id}@example.test` })),
    );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [alice, bob].map((userId) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "member",
      createdAt: new Date(),
    })),
  );
  return { organizationId, alice, bob };
}

async function draft(organizationId: string): Promise<DraftRef> {
  const draftId = crypto.randomUUID();
  await db.execute(
    sql`insert into space_draft (id, organization_id) values (${draftId}, ${organizationId})`,
  );
  return { organizationId, draftId, epoch: 1 };
}

const documentName = (ref: DraftRef) => `${ref.draftId}.${ref.epoch}`;

// Space access is not built yet: everyone may read and edit; writes can be
// slowed to observe ordering.
const writes = { delayMs: 0 };
const canRead: DraftAccess = async () => true;
const canEdit: DraftAccess = async () => {
  if (writes.delayMs) await new Promise((r) => setTimeout(r, writes.delayMs));
  return true;
};
// A real database failure for draft writes only: a NOT VALID check constraint
// rejects every new row.
const failWrites = (fail: boolean) =>
  db.execute(
    fail
      ? sql`alter table space_draft_update add constraint spike_fail check (false) not valid`
      : sql`alter table space_draft_update drop constraint if exists spike_fail`,
  );

const collaboration = (retryForMs = 10_000) =>
  draftCollaboration({
    retryForMs,
    db,
    // Tests authenticate with the user id as token; production uses the
    // Better Auth session cookie.
    authenticate: async ({ token }) => token || null,
    resolve: async (name) => {
      const [draftId, epoch] = name.split(".");
      const rows = await db.execute<{ organization_id: string; epoch: number }>(
        sql`select organization_id, epoch from space_draft where id = ${draftId ?? ""}`,
      );
      const row = rows[0];
      return row && String(row.epoch) === epoch
        ? {
            organizationId: row.organization_id,
            draftId: draftId!,
            epoch: row.epoch,
          }
        : null;
    },
    canRead,
    canEdit,
  });

async function server(port = 0, retryForMs = 10_000) {
  const extension = collaboration(retryForMs);
  const hocuspocus = new Hocuspocus({
    quiet: true,
    extensions: [extension.extension],
  });
  const transport = await listenCollaboration({
    hocuspocus,
    port,
    host: "127.0.0.1",
  });
  return {
    hocuspocus,
    revalidate: () => extension.revalidate(hocuspocus),
    port: transport.port,
    destroy: () => transport.close(),
  };
}
type Instance = Awaited<ReturnType<typeof server>>;

function connect(instance: Instance, ref: DraftRef, userId: string) {
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${instance.port}`,
    name: documentName(ref),
    token: userId,
    document,
  });
  const closes: number[] = [];
  provider.on("close", ({ event }: { event: { code: number } }) =>
    closes.push(event.code),
  );
  return { provider, document, text: document.getText("body"), closes };
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function stored(ref: DraftRef) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await loadDraft(db, ref)).state);
  return doc.getText("body").toJSON();
}

void test("edits are stored before peers see them, and Saved means stored", async () => {
  const { organizationId, alice, bob } = await organization();
  const ref = await draft(organizationId);
  const instance = await server();
  const a = connect(instance, ref, alice);
  const b = connect(instance, ref, bob);
  try {
    await until(() => a.provider.synced && b.provider.synced);
    writes.delayMs = 300;
    a.text.insert(0, "Retries reuse the transaction ID.");
    await new Promise((r) => setTimeout(r, 150));
    // Mid-write: not stored, not acknowledged, not visible to Bob.
    assert.equal(a.provider.hasUnsyncedChanges, true);
    assert.equal(b.text.toJSON(), "");
    assert.equal(await stored(ref), "");
    await until(() => !a.provider.hasUnsyncedChanges);
    // "Saved": the database already holds it.
    assert.equal(await stored(ref), "Retries reuse the transaction ID.");
    await until(() => b.text.toJSON() === "Retries reuse the transaction ID.");
  } finally {
    writes.delayMs = 0;
    a.provider.destroy();
    b.provider.destroy();
    await instance.destroy();
  }
});

void test("a database outage keeps edits unsaved and private until they are stored", async () => {
  const { organizationId, alice, bob } = await organization();
  const ref = await draft(organizationId);
  const instance = await server();
  const a = connect(instance, ref, alice);
  const b = connect(instance, ref, bob);
  try {
    await until(() => a.provider.synced && b.provider.synced);
    await failWrites(true);
    a.text.insert(0, "Timeout after 30 seconds.");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(a.provider.hasUnsyncedChanges, true);
    assert.equal(b.text.toJSON(), "");
    assert.equal(await stored(ref), "");
    await failWrites(false);
    await until(() => !a.provider.hasUnsyncedChanges);
    assert.equal(await stored(ref), "Timeout after 30 seconds.");
    await until(() => b.text.toJSON() === "Timeout after 30 seconds.");
    assert.deepEqual(a.closes, []);
  } finally {
    await failWrites(false);
    a.provider.destroy();
    b.provider.destroy();
    await instance.destroy();
  }
});

void test("a long outage resets the connection and the edits are saved after reconnecting", async () => {
  const { organizationId, alice, bob } = await organization();
  const ref = await draft(organizationId);
  const instance = await server(0, 300);
  const a = connect(instance, ref, alice);
  const b = connect(instance, ref, bob);
  try {
    await until(() => a.provider.synced && b.provider.synced);
    await failWrites(true);
    a.text.insert(0, "Cancellation after settlement is unsupported.");
    await until(() => a.closes.length > 0);
    assert.equal(b.text.toJSON(), "");
    await failWrites(false);
    await until(
      async () =>
        (await stored(ref)) === "Cancellation after settlement is unsupported.",
    );
    await until(
      () => b.text.toJSON() === "Cancellation after settlement is unsupported.",
    );
  } finally {
    await failWrites(false);
    a.provider.destroy();
    b.provider.destroy();
    await instance.destroy();
  }
});

void test("a removed member can no longer write or read", async () => {
  const { organizationId, alice, bob } = await organization();
  const ref = await draft(organizationId);
  const instance = await server();
  const a = connect(instance, ref, alice);
  const b = connect(instance, ref, bob);
  try {
    await until(() => a.provider.synced && b.provider.synced);
    a.text.insert(0, "Shared. ");
    await until(() => b.text.toJSON() === "Shared. ");
    await db.execute(
      sql`delete from member where organization_id = ${organizationId} and user_id = ${alice}`,
    );
    a.text.insert(a.text.length, "Written after removal.");
    await until(() => a.closes.length > 0);
    assert.equal(await stored(ref), "Shared. ");
    assert.equal(b.text.toJSON(), "Shared. ");
    // Bob loses read access the same way; revalidation closes his socket.
    await db.execute(
      sql`delete from member where organization_id = ${organizationId} and user_id = ${bob}`,
    );
    await instance.revalidate();
    await until(() => b.closes.length > 0);
  } finally {
    a.provider.destroy();
    b.provider.destroy();
    await instance.destroy();
  }
});

void test("edits made while the service restarts are saved when it returns", async () => {
  const { organizationId, alice, bob } = await organization();
  const ref = await draft(organizationId);
  let instance = await server();
  const port = instance.port;
  const a = connect(instance, ref, alice);
  try {
    await until(() => a.provider.synced);
    a.text.insert(0, "Before restart. ");
    await until(() => !a.provider.hasUnsyncedChanges);
    await instance.destroy();
    a.text.insert(a.text.length, "While offline.");
    instance = await server(port);
    await until(
      async () => (await stored(ref)) === "Before restart. While offline.",
    );
    const b = connect(instance, ref, bob);
    await until(() => b.text.toJSON() === "Before restart. While offline.");
    b.provider.destroy();
  } finally {
    a.provider.destroy();
    await instance.destroy();
  }
});

void test("writes for a replaced epoch are refused", async () => {
  const { organizationId, alice } = await organization();
  const ref = await draft(organizationId);
  const instance = await server();
  const a = connect(instance, ref, alice);
  try {
    await until(() => a.provider.synced);
    await db.execute(
      sql`update space_draft set epoch = 2 where id = ${ref.draftId}`,
    );
    a.text.insert(0, "Late edit.");
    await until(() => a.closes.length > 0);
    const rows = await db.execute(
      sql`select 1 from space_draft_update where draft_id = ${ref.draftId}`,
    );
    assert.equal(rows.length, 0);
  } finally {
    a.provider.destroy();
    await instance.destroy();
  }
});

const update = (text: string) => {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
};

void test("drafts wait for exclusive organization mutations but not for each other", async () => {
  const { organizationId, alice } = await organization();
  const [first, second] = [
    await draft(organizationId),
    await draft(organizationId),
  ];
  // A slow draft write holds the shared lock; another draft still commits.
  let releaseSlow!: () => void;
  const slow = appendDraftUpdates(
    db,
    first,
    [{ userId: alice, update: update("a") }],
    () =>
      new Promise<boolean>((resolve) => (releaseSlow = () => resolve(true))),
  );
  await until(() => releaseSlow !== undefined);
  await appendDraftUpdates(
    db,
    second,
    [{ userId: alice, update: update("b") }],
    async () => true,
  );
  releaseSlow();
  await slow;
  // An exclusive domain mutation holds the lock; the draft write waits.
  let releaseExclusive!: () => void;
  const exclusive = db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
    );
    await new Promise<void>((resolve) => (releaseExclusive = resolve));
  });
  await until(() => releaseExclusive !== undefined);
  let written = false;
  const waiting = appendDraftUpdates(
    db,
    second,
    [{ userId: alice, update: update("c") }],
    async () => true,
  ).then(() => (written = true));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(written, false);
  releaseExclusive();
  await exclusive;
  await waiting;
  assert.equal(written, true);
});

void test("measure: save latency while the organization runs domain mutations", async () => {
  const { organizationId, alice } = await organization();
  const ref = await draft(organizationId);
  const measure = async (samples: number) => {
    const times: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await appendDraftUpdates(
        db,
        ref,
        [{ userId: alice, update: update(String(i)) }],
        async () => true,
      );
      times.push(performance.now() - start);
    }
    times.sort((x, y) => x - y);
    return {
      p50: times[Math.floor(samples * 0.5)]!,
      p95: times[Math.floor(samples * 0.95)]!,
    };
  };
  const quiet = await measure(200);
  // Four sessions run back-to-back 10 ms exclusive mutations: a busy
  // organization (reviews, delivery, configuration) at ~100% lock occupancy.
  let running = true;
  const mutations = Array.from({ length: 4 }, async () => {
    while (running)
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
        );
        await tx.execute(sql`select pg_sleep(0.01)`);
      });
  });
  const busy = await measure(200);
  running = false;
  await Promise.all(mutations);
  console.info(
    `draft save latency ms: quiet p50 ${quiet.p50.toFixed(1)} p95 ${quiet.p95.toFixed(1)}; ` +
      `saturated organization lock p50 ${busy.p50.toFixed(1)} p95 ${busy.p95.toFixed(1)}`,
  );
  assert.ok(quiet.p95 < 300, "an idle organization saves well within 300 ms");
});

void test("cross-site WebSocket connections are refused before authentication", async () => {
  const hocuspocus = new Hocuspocus({ quiet: true });
  const transport = await listenCollaboration({
    hocuspocus,
    port: 0,
    host: "127.0.0.1",
    allowedOrigin: "https://lictory.example",
  });
  const open = (origin: string) =>
    new Promise<string>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${transport.port}`, {
        headers: { origin },
      });
      socket.on("open", () => {
        socket.close();
        resolve("open");
      });
      socket.on("error", () => resolve("refused"));
    });
  try {
    assert.equal(await open("https://attacker.example"), "refused");
    assert.equal(await open("https://lictory.example"), "open");
  } finally {
    await transport.close();
  }
});
