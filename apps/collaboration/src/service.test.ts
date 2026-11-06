// The collaboration service against a disposable database and the real
// Better Auth instance: cookie authentication, access-change and draft
// signals after commit, the single-instance lock and health probes. The
// persistence contract itself is proven in
// packages/core/src/spaces/collaboration.test.ts.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import WebSocket from "ws";
import * as Y from "yjs";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import type * as Db from "@lictory/core/db";
import type * as Organization from "@lictory/core/domain/organization";
import type * as Service from "@lictory/core/domain/service";
import type * as Auth from "@lictory/core/lib/auth";
import type * as Collaboration from "@lictory/core/spaces/collaboration";
import type * as DraftAccess from "@lictory/core/spaces/draft-access";
import type * as Owner from "@lictory/collaboration/owner";
import type * as CollaborationService from "@lictory/collaboration/service";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_collaboration_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 2, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const origin = "http://platform.test";
let created = false;

// Application modules read their configuration at import, so they are
// imported after the environment points at this database.
let m: {
  auth: typeof Auth.auth;
  appDb: typeof Db.db;
  closeDatabase: typeof Db.closeDatabase;
  executeMutation: typeof Service.executeMutation;
  seedOrganization: typeof Organization.seedOrganization;
  CLOSE_REASONS: typeof Collaboration.CLOSE_REASONS;
  draftDocumentName: typeof DraftAccess.draftDocumentName;
  OwnerBusy: typeof Owner.OwnerBusy;
  sessionAuthenticator: typeof CollaborationService.sessionAuthenticator;
  startCollaboration: typeof CollaborationService.startCollaboration;
};

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    DATABASE_URL_UNPOOLED: url.toString(),
    PLATFORM_URL: origin,
    BETTER_AUTH_SECRET: "test-only-collaboration-secret-not-a-credential",
    LICTORY_SIGNUP_MODE: "",
    LICTORY_ALLOWED_EMAIL_DOMAINS: "",
    LICTORY_ORGANIZATION_CREATION: "",
  });
  const [
    { auth },
    { db: appDb, closeDatabase },
    { executeMutation },
    { seedOrganization },
    { CLOSE_REASONS },
    { draftDocumentName },
    { OwnerBusy },
    { sessionAuthenticator, startCollaboration },
  ] = await Promise.all([
    import("@lictory/core/lib/auth"),
    import("@lictory/core/db"),
    import("@lictory/core/domain/service"),
    import("@lictory/core/domain/organization"),
    import("@lictory/core/spaces/collaboration"),
    import("@lictory/core/spaces/draft-access"),
    import("@lictory/collaboration/owner"),
    import("@lictory/collaboration/service"),
  ]);
  m = {
    auth,
    appDb,
    closeDatabase,
    executeMutation,
    seedOrganization,
    CLOSE_REASONS,
    draftDocumentName,
    OwnerBusy,
    sessionAuthenticator,
    startCollaboration,
  };
});
after(async () => {
  await m?.closeDatabase().catch(() => undefined);
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
});

// A verified person signed in through Better Auth, with the session cookie
// the browser would send.
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
  const session = (await m.auth.api.getSession({
    headers: new Headers({ cookie }),
  }))!;
  return { id: session.user.id, sessionId: session.session.id, cookie };
}
type Person = Awaited<ReturnType<typeof person>>;

const mutate = (organizationId: string, userId: string, command: Command) =>
  m.executeMutation(
    db,
    { userId },
    { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
  );

// Alice creates an organization space (both edit) with one page; its main
// line has a live draft.
async function workspace() {
  const [alice, bob] = [await person("Alice"), await person("Bob")];
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [alice, bob].map((p) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId: p.id,
      role: "member",
      createdAt: new Date(),
    })),
  );
  await m.seedOrganization(db, organizationId);
  const spaceId = crypto.randomUUID();
  await mutate(organizationId, alice.id, {
    type: "createSpace",
    spaceId,
    name: "Handbook",
    slug: "handbook",
  });
  const page = await mutate(organizationId, alice.id, {
    type: "createPage",
    spaceId,
    pageId: crypto.randomUUID(),
    title: "Retries",
  });
  const draftId = page.summary?.draftId as string;
  return {
    organizationId,
    spaceId,
    alice,
    bob,
    documentName: m.draftDocumentName({ draftId, epoch: 1 }),
  };
}

// Periodic revalidation is effectively off, so only signals can close a
// connection within a test.
async function service(options: { ownerWaitMs?: number } = {}) {
  const lost: unknown[] = [];
  const instance = await m.startCollaboration({
    db: m.appDb,
    directUrl: url.toString(),
    port: 0,
    host: "127.0.0.1",
    allowedOrigin: origin,
    authenticate: m.sessionAuthenticator((headers) =>
      m.auth.api.getSession({ headers }),
    ),
    log: () => undefined,
    onOwnershipLost: (error) => lost.push(error),
    revalidateEveryMs: 3_600_000,
    ...options,
  });
  // LISTEN is established asynchronously.
  await until(() => instance.listening());
  return instance;
}
type Instance = Awaited<ReturnType<typeof service>>;

// What a browser on the platform's page sends: its Origin and the session
// cookie. The provider's token stays empty.
function connect(instance: Instance, documentName: string, who?: Person) {
  const headers: Record<string, string> = { origin };
  if (who) headers.cookie = who.cookie;
  class BrowserSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers });
    }
  }
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${instance.port}/collaboration`,
    name: documentName,
    document: new Y.Doc(),
    WebSocketPolyfill: BrowserSocket,
  } as ConstructorParameters<typeof HocuspocusProvider>[0]);
  const refused: string[] = [];
  const closed: string[] = [];
  provider.on("authenticationFailed", ({ reason }: { reason: string }) =>
    refused.push(reason),
  );
  provider.on("close", ({ event }: { event: { reason: string } }) =>
    closed.push(event.reason),
  );
  return { provider, refused, closed };
}

async function until(check: () => boolean | Promise<boolean>, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

void test("authentication uses the Better Auth session cookie and refuses missing, forged and expired sessions", async () => {
  const alice = await person("Alice");
  const authenticate = m.sessionAuthenticator((headers) =>
    m.auth.api.getSession({ headers }),
  );
  const as = (cookie?: string) =>
    authenticate({
      requestHeaders: new Headers(cookie ? { cookie } : {}),
    });
  assert.deepEqual(await as(alice.cookie), {
    userId: alice.id,
    sessionId: alice.sessionId,
  });
  assert.equal(await as(), null);
  // The raw session token without Better Auth's signature is not a session.
  const [session] = await db
    .select({ token: s.session.token })
    .from(s.session)
    .where(eq(s.session.id, alice.sessionId));
  const name = alice.cookie.split("=")[0]!;
  assert.equal(await as(`${name}=${session!.token}`), null);
  assert.equal(await as(`${name}=forged.signature`), null);
  // An expired (or revoked) session no longer authenticates.
  await db
    .update(s.session)
    .set({ expiresAt: new Date(Date.now() - 1_000) })
    .where(eq(s.session.id, alice.sessionId));
  assert.equal(await as(alice.cookie), null);
});

void test("a connection without a session is refused; one with a session edits", async () => {
  const { documentName, bob } = await workspace();
  const instance = await service();
  const anonymous = connect(instance, documentName);
  const member = connect(instance, documentName, bob);
  try {
    await until(() => anonymous.refused.length > 0);
    assert.deepEqual(anonymous.refused, [m.CLOSE_REASONS.signedOut]);
    await until(() => member.provider.synced);
    assert.equal(member.provider.authorizedScope, "read-write");
  } finally {
    anonymous.provider.destroy();
    member.provider.destroy();
    await instance.stop();
  }
});

void test("losing access is signalled after commit and closes that person's connection only", async () => {
  const { organizationId, spaceId, documentName, alice, bob } =
    await workspace();
  const instance = await service();
  const a = connect(instance, documentName, alice);
  const b = connect(instance, documentName, bob);
  try {
    await until(() => a.provider.synced && b.provider.synced);
    // Restricted: only named grants count. Alice, the creator, keeps hers;
    // Bob loses access (refreshSpaceAccess reports him and signals).
    await mutate(organizationId, alice.id, {
      type: "setSpaceAccessMode",
      spaceId,
      accessMode: "restricted",
    });
    await until(() => b.closed.length > 0);
    assert.deepEqual(b.closed, [m.CLOSE_REASONS.revoked]);
    assert.deepEqual(a.closed, []);
    assert.equal(
      instance.hocuspocus.documents.get(documentName)?.getConnectionsCount(),
      1,
    );
  } finally {
    a.provider.destroy();
    b.provider.destroy();
    await instance.stop();
  }
});

void test("fencing a draft closes its room, and its old name no longer opens", async () => {
  const { organizationId, spaceId, documentName, alice, bob } =
    await workspace();
  const instance = await service();
  const a = connect(instance, documentName, alice);
  const b = connect(instance, documentName, bob);
  try {
    await until(() => a.provider.synced && b.provider.synced);
    // Reviewed publishing closes main's live drafts (a trigger signals).
    await mutate(organizationId, alice.id, {
      type: "updateSpace",
      spaceId,
      publishing: "reviewed",
    });
    await until(() => a.closed.length > 0 && b.closed.length > 0);
    assert.deepEqual(a.closed, [m.CLOSE_REASONS.replaced]);
    assert.deepEqual(b.closed, [m.CLOSE_REASONS.replaced]);
    await until(() => !instance.hocuspocus.documents.has(documentName));
    const again = connect(instance, documentName, alice);
    try {
      await until(() => again.refused.length > 0);
      assert.deepEqual(again.refused, [m.CLOSE_REASONS.replaced]);
    } finally {
      again.provider.destroy();
    }
  } finally {
    a.provider.destroy();
    b.provider.destroy();
    await instance.stop();
  }
});

void test("only one instance serves: a second one refuses while the first holds the owner lock", async () => {
  const first = await service();
  try {
    await assert.rejects(service({ ownerWaitMs: 300 }), m.OwnerBusy);
  } finally {
    await first.stop();
  }
  // Stopping releases the lock.
  const next = await service({ ownerWaitMs: 5_000 });
  await next.stop();
});

void test("health probes: live while running, ready until it starts stopping", async () => {
  const instance = await service();
  const probe = (path: string) =>
    fetch(`http://127.0.0.1:${instance.port}${path}`).then((r) => r.status);
  assert.equal(await probe("/livez"), 200);
  assert.equal(await probe("/readyz"), 200);
  assert.equal(await probe("/collaboration"), 404);
  await instance.stop();
  await assert.rejects(probe("/livez"));
});
