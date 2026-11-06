// Proves the live draft persistence contract against real PostgreSQL (the
// migrated Spaces tables) and a real Hocuspocus server.
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
import { PROTOCOL } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { draftCollaboration } from "@lictory/core/spaces/collaboration";
import {
  draftDocumentName,
  resolveDraftDocument,
} from "@lictory/core/spaces/draft-access";
import { listenCollaboration } from "@lictory/core/spaces/transport";
import {
  appendDraftUpdates,
  DraftWriter,
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
  for (const userId of [alice, bob]) await signIn(userId);
  // An organization space (both edit) in Direct publishing: each page's
  // main line has a live draft.
  await seedOrganization(db, organizationId);
  const spaceId = crypto.randomUUID();
  await executeMutation(
    db,
    { userId: alice },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createSpace",
        spaceId,
        name: "Handbook",
        slug: "handbook",
      },
    },
  );
  spaces.set(organizationId, { spaceId, creator: alice });
  return { organizationId, alice, bob };
}
const spaces = new Map<string, { spaceId: string; creator: string }>();

// One Better Auth session per person; the provider sends its token.
const sessions = new Map<string, { sessionId: string; token: string }>();
async function signIn(userId: string) {
  const session = {
    sessionId: crypto.randomUUID(),
    token: crypto.randomUUID(),
  };
  await db.insert(s.session).values({
    id: session.sessionId,
    token: session.token,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
    updatedAt: new Date(),
  });
  sessions.set(userId, session);
}
const author = (userId: string) => ({
  userId,
  sessionId: sessions.get(userId)!.sessionId,
});

// A new page's main draft, created through the domain command.
async function draft(organizationId: string): Promise<DraftRef> {
  const { spaceId, creator } = spaces.get(organizationId)!;
  const result = await executeMutation(
    db,
    { userId: creator },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createPage",
        spaceId,
        pageId: crypto.randomUUID(),
        title: "Retries",
      },
    },
  );
  const draftId = result.summary?.draftId;
  assert.equal(typeof draftId, "string");
  return { organizationId, draftId: draftId as string, epoch: 1 };
}

const documentName = draftDocumentName;

// Access is a test double here (draft-access.ts adapts the real checks, see
// spaces.test.ts): everyone may read; people in `readOnly` may not edit;
// writes can be slowed to observe ordering.
const writes = { delayMs: 0 };
const readOnly = new Set<string>();
const canRead: DraftAccess = async () => true;
const canEdit: DraftAccess = async (_, userId) => {
  if (writes.delayMs) await new Promise((r) => setTimeout(r, writes.delayMs));
  return !readOnly.has(userId);
};
// A real database failure for draft writes only: a NOT VALID check constraint
// rejects every new row.
const failWrites = (fail: boolean) =>
  db.execute(
    fail
      ? sql`alter table space_draft_update add constraint test_fail_writes check (false) not valid`
      : sql`alter table space_draft_update drop constraint if exists test_fail_writes`,
  );

const collaboration = (retryForMs: number, revalidateEveryMs: number) =>
  draftCollaboration({
    retryForMs,
    revalidateEveryMs,
    db,
    // The token names a session; production reads the Better Auth session
    // cookie instead.
    authenticate: async ({ token }) => {
      const [session] = await db
        .select({ id: s.session.id, userId: s.session.userId })
        .from(s.session)
        .where(sql`${s.session.token} = ${token}`);
      return session ? { userId: session.userId, sessionId: session.id } : null;
    },
    resolve: (name) => resolveDraftDocument(db, name),
    canRead,
    canEdit,
  });

async function server(
  port = 0,
  { retryForMs = 10_000, revalidateEveryMs = 30_000 } = {},
) {
  const extension = collaboration(retryForMs, revalidateEveryMs);
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
    token: sessions.get(userId)!.token,
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
  const instance = await server(0, { retryForMs: 300 });
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
  const instance = await server(0, { revalidateEveryMs: 200 });
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
    // Bob only reads; periodic revalidation closes his connection without
    // any signal.
    await db.execute(
      sql`delete from member where organization_id = ${organizationId} and user_id = ${bob}`,
    );
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
    [{ ...author(alice), update: update("a") }],
    () =>
      new Promise<boolean>((resolve) => (releaseSlow = () => resolve(true))),
  );
  await until(() => releaseSlow !== undefined);
  await appendDraftUpdates(
    db,
    second,
    [{ ...author(alice), update: update("b") }],
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
    [{ ...author(alice), update: update("c") }],
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
        [{ ...author(alice), update: update(String(i)) }],
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

void test("an ended session can no longer write or read, even for a member", async () => {
  const { organizationId, alice, bob } = await organization();
  const ref = await draft(organizationId);
  const instance = await server(0, { revalidateEveryMs: 200 });
  const a = connect(instance, ref, alice);
  const b = connect(instance, ref, bob);
  try {
    await until(() => a.provider.synced && b.provider.synced);
    await db.delete(s.session).where(sql`${s.session.userId} = ${alice}`);
    a.text.insert(0, "Written after signing out.");
    await until(() => a.closes.length > 0);
    assert.equal(await stored(ref), "");
    assert.equal(b.text.toJSON(), "");
    await db.delete(s.session).where(sql`${s.session.userId} = ${bob}`);
    await until(() => b.closes.length > 0);
  } finally {
    a.provider.destroy();
    b.provider.destroy();
    await instance.destroy();
  }
});

void test("losing edit access is immediate; gaining it needs a new connection", async () => {
  const { organizationId, alice } = await organization();
  const ref = await draft(organizationId);
  const instance = await server();
  readOnly.add(alice);
  const a = connect(instance, ref, alice);
  try {
    await until(() => a.provider.synced);
    const connection = () =>
      instance.hocuspocus.documents
        .get(documentName(ref))!
        .getConnections()[0]!;
    assert.equal(connection().readOnly, true);
    // Promoting mid-message could apply an update the storage hook skipped.
    readOnly.delete(alice);
    await instance.revalidate();
    assert.equal(connection().readOnly, true);
    a.text.insert(0, "Not stored.");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await stored(ref), "");
  } finally {
    readOnly.delete(alice);
    a.provider.destroy();
    await instance.destroy();
  }
});

void test("direct connections, which bypass storage, are refused", async () => {
  const instance = await server();
  try {
    await assert.rejects(
      instance.hocuspocus.openDirectConnection("any"),
      /bypass draft storage/,
    );
  } finally {
    await instance.destroy();
  }
});

void test("malformed and repeated updates are never stored", async () => {
  const { organizationId, alice } = await organization();
  const ref = await draft(organizationId);
  const writer = new DraftWriter(db, ref, async () => true);
  await assert.rejects(
    writer.submit(author(alice), new Uint8Array([1, 200, 7, 3, 9])),
    /could not be read/,
  );
  // A retry after a commit whose acknowledgement was lost.
  const entry = { ...author(alice), update: update("Once.") };
  await appendDraftUpdates(db, ref, [entry], async () => true);
  const again = await appendDraftUpdates(db, ref, [entry], async () => true);
  assert.equal(again.sequence, 1);
  const rows = await db.execute(
    sql`select sequence from space_draft_update where draft_id = ${ref.draftId}`,
  );
  assert.equal(rows.length, 1);
  assert.equal(await stored(ref), "Once.");
});

void test("oversized frames and floods disconnect the client, not the service", async () => {
  const hocuspocus = new Hocuspocus({ quiet: true });
  const transport = await listenCollaboration({
    hocuspocus,
    port: 0,
    host: "127.0.0.1",
  });
  const closed = (send: (socket: WebSocket) => void) =>
    new Promise<number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${transport.port}`);
      socket.on("open", () => send(socket));
      socket.on("error", () => undefined);
      socket.on("close", (code) => resolve(code));
    });
  try {
    // Above maxPayload.
    assert.equal(
      await closed((socket) => socket.send(new Uint8Array(2 * 1024 * 1024))),
      1009,
    );
    // Under maxPayload each, but beyond the inbound budget together.
    assert.ok(
      [1006, 1008].includes(
        await closed((socket) => {
          for (let i = 0; i < 5; i++) socket.send(new Uint8Array(900 * 1024));
        }),
      ),
    );
    // The service still accepts connections.
    assert.equal(
      await new Promise<string>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${transport.port}`);
        socket.on("open", () => {
          socket.close();
          resolve("open");
        });
        socket.on("error", () => resolve("error"));
      }),
      "open",
    );
  } finally {
    await transport.close();
  }
});
