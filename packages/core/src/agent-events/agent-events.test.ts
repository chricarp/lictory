import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { noEffects } from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { handleMcp, handleMcpHttp } from "@lictory/core/mcp/server";
import { postMessage } from "@lictory/core/channels/writer";
import { drainNotifications } from "@lictory/core/notifications/drain.test-helper";
import { verificationSnippet } from "@lictory/core/agent-events/reference";
import type { AgentScope } from "@lictory/core/factory/authority";
import {
  lockFeed,
  readAgentEvents,
  stopAgentEventListener,
  waitForAgentEvents,
  type AgentEventView,
} from "@lictory/core/agent-events/feed";
import {
  sign,
  verify,
  webhookHeaders,
} from "@lictory/core/agent-events/signing";
import {
  createWebhook,
  expireSubscriptions,
  listSubscriptions,
  setAgentEventPolicy,
  setSubscriptionState,
  subscribeMcp,
  unsubscribeMcp,
  testWebhook,
  EventsProtocolError,
} from "@lictory/core/agent-events/subscriptions";
import {
  MAX_DELIVERY_ATTEMPTS,
  processAgentEventDeliveries,
} from "@lictory/core/agent-events/delivery";
import {
  queueClaimEvent,
  queueCodePullRequestEvent,
} from "@lictory/core/agent-events/producers";
import {
  checkDestinationUrl,
  classifyAddress,
  egressRequest,
  EgressError,
} from "@lictory/core/lib/egress";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_agent_events_test_${crypto.randomUUID().replaceAll("-", "")}`;
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
  // The wait's LISTEN connection uses the test database.
  process.env.DATABASE_URL = url.toString();
  delete process.env.DATABASE_URL_UNPOOLED;
  // Webhook secrets are encrypted at rest.
  process.env.DELIVERY_CREDENTIALS_KEY ??=
    "agent-events-test-key-0123456789abcdef";
});
after(async () => {
  await stopAgentEventListener();
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

// ------------------------------------------------------------ fixtures

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

async function organization(members: [string, string][]) {
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  for (const [userId, role] of members)
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    });
  await seedOrganization(db, organizationId);
  return organizationId;
}

async function fixture() {
  const [owner, ada, bo, outsider] = await Promise.all(
    ["Owner", "Ada", "Bo", "Outsider"].map(user),
  );
  const organizationId = await organization([
    [owner!, "owner"],
    [ada!, "member"],
    [bo!, "member"],
  ]);
  const otherOrganizationId = await organization([[outsider!, "owner"]]);
  const run = (actor: string, command: Command) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
    );
  const projectId = crypto.randomUUID();
  await run(owner!, {
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  const otherProjectId = crypto.randomUUID();
  await run(owner!, {
    type: "createProject",
    projectId: otherProjectId,
    name: "Growth",
    key: "GRO",
  });
  const channel = async (
    actor: string,
    name: string,
    kind: "public" | "private" = "public",
    memberIds: string[] = [],
    homeProjectId: string | null = null,
  ) => {
    const channelId = crypto.randomUUID();
    await run(actor, {
      type: "createChannel",
      channelId,
      kind,
      name,
      memberIds,
      ...(homeProjectId ? { home: { projectId: homeProjectId } } : {}),
    });
    return channelId;
  };
  const post = (actor: string, channelId: string, body: string) =>
    db.transaction((tx) =>
      postMessage(tx, { userId: actor }, { organizationId, channelId, body }),
    );
  const mention = (userId: string) => `@[Someone](mention:${userId})`;
  // A Factory agent owned by `ownerId` (an external MCP agent).
  const agent = async (
    ownerId: string,
    handle: string,
    projectIds: string[] | null = null,
  ): Promise<AgentScope> => {
    const id = crypto.randomUUID();
    await db.insert(s.agent).values({
      id,
      organizationId,
      handle,
      name: handle,
      ownerId,
      kind: "external",
      projectIds,
      createdById: ownerId,
    });
    return {
      id,
      organizationId,
      name: handle,
      handle,
      access: "write",
      projectIds,
      sessionId: null,
    };
  };
  return {
    organizationId,
    otherOrganizationId,
    projectId,
    otherProjectId,
    owner: owner!,
    ada: ada!,
    bo: bo!,
    outsider: outsider!,
    run,
    channel,
    post,
    mention,
    agent,
  };
}

const events = async (userId: string, agent: AgentScope | null = null) =>
  (await readAgentEvents(db, { userId, agent })).events;

// A local receiver standing in for an agent's webhook endpoint.
async function receiver(
  respond: (request: IncomingMessage, body: string) => Answer | Promise<Answer>,
) {
  const received: { headers: Headers; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers))
        if (typeof value === "string") headers.set(name, value);
      received.push({ headers, body });
      void Promise.resolve(respond(request, body)).then((answer) => {
        response.writeHead(answer.status, answer.headers ?? {});
        response.end(answer.body ?? "");
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    stop: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
type Answer = {
  status: number;
  body?: string;
  headers?: Record<string, string>;
};
const json = (value: unknown): Answer => ({
  status: 200,
  body: JSON.stringify(value),
  headers: { "content-type": "application/json" },
});

// Webhooks to the local receiver need the operator's private-network
// permission; every other test runs without it.
async function withPrivateNetworks<T>(run: () => Promise<T>) {
  const previous = process.env.AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS;
  process.env.AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS = "true";
  try {
    return await run();
  } finally {
    if (previous === undefined)
      delete process.env.AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS;
    else process.env.AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS = previous;
  }
}

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

async function token(userId: string, agentId: string | null = null) {
  const id = crypto.randomUUID();
  await db.insert(s.accessToken).values({
    id,
    userId,
    name: `token-${id.slice(0, 6)}`,
    scope: "write",
    prefix: "lct_test",
    tokenHash: crypto.randomUUID(),
    agentId,
  });
  return id;
}

// ------------------------------------------------------------ derivation

void test("events are addressed: only the mentioned person, never the body, whatever their preferences", async () => {
  const f = await fixture();
  const general = await f.channel(f.ada, "general");
  await f.run(f.bo, { type: "joinChannel", channelId: general });
  // Bo turned channel mentions off in the inbox: the agent still hears.
  await db.insert(s.notificationPreference).values({
    userId: f.bo,
    organizationId: f.organizationId,
    scope: "organization",
    scopeId: f.organizationId,
    kind: "channel_mentioned",
    inApp: false,
    email: false,
  });
  await f.post(
    f.ada,
    general,
    `${f.mention(f.bo)} can you check the refund flow? secret plan`,
  );
  await drainNotifications(db);
  const [event, ...rest] = await events(f.bo);
  assert.equal(rest.length, 0);
  assert.equal(event!.type, "channel.mentioned");
  assert.equal(event!.subject.channelId, general);
  assert.equal(event!.subject.channelName, "general");
  assert.ok(event!.subject.messageId);
  assert.ok(!JSON.stringify(event).includes("refund flow"), "no message body");
  assert.ok(!JSON.stringify(event).includes("secret plan"));
  assert.match(event!.url, /\/channels\//);
  // No inbox notification (preference off), still an agent event.
  const inbox = await db
    .select()
    .from(s.notification)
    .where(eq(s.notification.userId, f.bo));
  assert.equal(inbox.length, 0);
  // The author and uninvolved members get nothing; neither does anyone
  // in another organization.
  assert.equal((await events(f.ada)).length, 0);
  assert.equal((await events(f.owner)).length, 0);
  assert.equal((await events(f.outsider)).length, 0);
  await assert.rejects(
    readAgentEvents(
      db,
      { userId: f.outsider },
      { organizationId: f.organizationId },
    ),
    /not found/i,
  );
});

void test("a mention in a private channel the person cannot read produces nothing; losing access drops the event", async () => {
  const f = await fixture();
  const secret = await f.channel(f.ada, "secret", "private", [f.bo]);
  // Owner is not a member: mentioning them tells no one.
  await f.post(f.ada, secret, `${f.mention(f.owner)} hello`);
  await f.post(f.ada, secret, `${f.mention(f.bo)} hello`);
  await drainNotifications(db);
  assert.equal((await events(f.owner)).length, 0);
  const before = await readAgentEvents(db, { userId: f.bo });
  assert.equal(before.events.length, 1);
  // Bo leaves the private channel: the event is dropped at read time, and
  // the cursor still moves past it.
  await f.run(f.ada, {
    type: "removeChannelMember",
    channelId: secret,
    userId: f.bo,
  });
  const afterLeaving = await readAgentEvents(db, { userId: f.bo });
  assert.equal(afterLeaving.events.length, 0);
  assert.equal(afterLeaving.cursor, before.cursor);
});

void test("agents see their person's events and their own, inside their scope", async () => {
  const f = await fixture();
  const forge = await f.agent(f.bo, "forge");
  const scout = await f.agent(f.bo, "scout", [f.projectId]);
  const general = await f.channel(f.ada, "general");
  const payments = await f.channel(
    f.ada,
    "payments",
    "public",
    [],
    f.projectId,
  );
  // Ada mentions Bo in an organization-wide channel and in a project one,
  // and mentions Forge by name.
  await f.post(f.ada, general, `${f.mention(f.bo)} org-wide`);
  await f.post(f.ada, payments, `${f.mention(f.bo)} in payments`);
  await db.transaction((tx) =>
    // The agent mention, as the conversation writer queues it once the
    // Factory's agent directory resolves the handle.
    import("@lictory/core/notifications/events").then(
      ({ queueNotifications }) =>
        queueNotifications(tx, f.organizationId, [
          {
            userIds: [f.bo],
            kind: "agent_mentioned",
            actorId: f.ada,
            agentId: forge.id,
            channelId: general,
            detail: {
              channelId: general,
              channelName: "general",
              messageId: "m1",
            },
          },
        ]),
    ),
  );
  await drainNotifications(db);
  // Bo's own token (unbound) sees all three.
  assert.equal((await events(f.bo)).length, 3);
  // Forge sees Bo's two and its own mention.
  const forgeEvents = await events(f.bo, forge);
  assert.equal(forgeEvents.length, 3);
  assert.equal(forgeEvents.filter((e) => e.agentId === forge.id).length, 1);
  // Scout is limited to Payments: only the project channel's event, never
  // Forge's.
  const scoutEvents = await events(f.bo, scout);
  assert.deepEqual(
    scoutEvents.map((e) => e.subject.channelId),
    [payments],
  );
  // An agent of the other organization reaches none of them.
  assert.equal(
    (await events(f.bo, { ...forge, organizationId: f.otherOrganizationId }))
      .length,
    0,
  );
});

void test("claim events wake the claiming agent, also when its own person acted, never itself", async () => {
  const f = await fixture();
  const [taskType] = await db
    .select({ id: s.workItemType.id })
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, f.organizationId),
        eq(s.workItemType.name, "Task"),
      ),
    );
  const workItemId = crypto.randomUUID();
  await f.run(f.owner, {
    type: "createWorkItem",
    projectId: f.projectId,
    workItemId,
    typeId: taskType!.id,
    parentId: null,
    title: "Retry refunds",
  });
  const forge = await f.agent(f.bo, "forge");
  const [claim] = await db
    .insert(s.workItemClaim)
    .values({
      organizationId: f.organizationId,
      projectId: f.projectId,
      workItemId,
      agentId: forge.id,
      agentName: "forge",
      ownerId: f.bo,
      source: "agent",
      state: "active",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  // The agent releasing its own claim: nothing.
  await db.transaction((tx) =>
    queueClaimEvent(tx, claim!, {
      kind: "claim_released",
      state: "released",
      reason: "agent",
      byId: f.bo,
    }),
  );
  await drainNotifications(db);
  assert.equal((await events(f.bo)).length, 0);
  // Its person releasing it in the browser: Forge is told.
  await db.transaction((tx) =>
    queueClaimEvent(
      tx,
      { ...claim!, id: crypto.randomUUID() },
      {
        kind: "claim_released",
        state: "released",
        reason: "person",
        byId: f.bo,
      },
    ),
  );
  await drainNotifications(db);
  const [released] = await events(f.bo, forge);
  assert.equal(released!.type, "claim.released");
  assert.equal(released!.agentId, forge.id);
  assert.equal(released!.subject.itemKey, "PAY-1");
  assert.equal(released!.subject.title, "Retry refunds");
  assert.equal(released!.subject.reason, "person");
  // Another agent of the same person does not see it.
  const scout = await f.agent(f.bo, "scout");
  assert.equal((await events(f.bo, scout)).length, 0);
});

void test("the Code module's pull request events keep identifiers and titles only", async () => {
  const f = await fixture();
  const pr = crypto.randomUUID();
  for (let i = 0; i < 2; i++)
    await db.transaction((tx) =>
      queueCodePullRequestEvent(tx, {
        organizationId: f.organizationId,
        kind: "code_pull_request_unmergeable",
        userIds: [f.bo],
        actorId: null,
        projectId: f.projectId,
        detail: {
          codePullRequestId: pr,
          number: 42,
          pullRequestTitle: "Retry refunds",
          provider: "github",
          reason: "conflicts",
          excerpt: "diff --git a/secret.ts",
        },
        // Retried by the host's webhook: delivered once.
        dedupeKey: `${pr}:abc123:unmergeable`,
      }),
    );
  await drainNotifications(db);
  const found = await events(f.bo);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.type, "pull_request.unmergeable");
  assert.deepEqual(found[0]!.subject, {
    codePullRequestId: pr,
    pullRequestTitle: "Retry refunds",
    reason: "conflicts",
    number: 42,
    provider: "github",
  });
  // No inbox notification for agent-only kinds.
  const inbox = await db
    .select()
    .from(s.notification)
    .where(eq(s.notification.userId, f.bo));
  assert.equal(inbox.length, 0);
});

// ------------------------------------------------------------ the cursor

void test("a cursor never skips an event whose transaction commits late", async () => {
  const f = await fixture();
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  // As the fan-out writes: the feed lock first, then the rows.
  const write = async (tx: Tx, tag: string) => {
    await lockFeed(tx);
    await tx.insert(s.agentEvent).values({
      organizationId: f.organizationId,
      userId: f.bo,
      type: "channel.mentioned",
      sourceKind: "channel_mentioned",
      data: { title: tag },
    });
  };
  const start = await readAgentEvents(
    db,
    { userId: f.bo },
    { after: "latest" },
  );
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let inserted!: () => void;
  const started = new Promise<void>((r) => (inserted = r));
  // A writes first and stays open.
  const slow = db.transaction(async (tx) => {
    await write(tx, "first");
    inserted();
    await held;
  });
  await started;
  // B cannot draw a number before A commits, so it cannot commit first.
  let secondDone = false;
  const second = db
    .transaction((tx) => write(tx, "second"))
    .then(() => (secondDone = true));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(secondDone, false);
  const early = await readAgentEvents(
    db,
    { userId: f.bo },
    { after: start.cursor },
  );
  assert.deepEqual(
    early.events.map((e) => e.subject.title),
    [],
  );
  release();
  await slow;
  await second;
  const late = await readAgentEvents(
    db,
    { userId: f.bo },
    { after: early.cursor },
  );
  assert.deepEqual(
    late.events.map((e) => e.subject.title),
    ["first", "second"],
  );
  // Reading on from the end returns nothing twice.
  const again = await readAgentEvents(
    db,
    { userId: f.bo },
    { after: late.cursor },
  );
  assert.equal(again.events.length, 0);
});

void test("waitForEvents over MCP wakes on a channel mention", async () => {
  const f = await fixture();
  const general = await f.channel(f.ada, "general");
  const ctx = {
    db,
    principal: {
      userId: f.bo,
      surface: "mcp" as const,
      access: "write" as const,
      tokenId: await token(f.bo),
    },
    effects: noEffects,
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = (await handleMcp(ctx, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    })) as {
      result: { content: { text: string }[]; isError: boolean };
    };
    assert.equal(response.result.isError, false, JSON.stringify(response));
    return JSON.parse(response.result.content[0]!.text) as Record<
      string,
      unknown
    >;
  };
  const { cursor } = (await call("listEvents", { after: "latest" })) as {
    cursor: string;
  };
  const started = Date.now();
  const waiting = call("waitForEvents", { after: cursor, timeoutSeconds: 20 });
  await new Promise((r) => setTimeout(r, 300));
  await f.post(f.ada, general, `${f.mention(f.bo)} wake up`);
  await drainNotifications(db);
  const woken = (await waiting) as { events: AgentEventView[]; cursor: string };
  assert.equal(woken.events.length, 1);
  assert.equal(woken.events[0]!.type, "channel.mentioned");
  assert.ok(Date.now() - started < 10_000, "woken, not timed out");
  // An empty wait returns when its time passes.
  const empty = (await call("waitForEvents", {
    after: woken.cursor,
    timeoutSeconds: 0,
  })) as { events: unknown[] };
  assert.equal(empty.events.length, 0);
});

// ------------------------------------------------------------ signatures

void test("signatures match the Standard Webhooks test vectors", () => {
  // libraries/javascript/src/webhook.test.ts (and the Python and Go suites).
  const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
  const timestamp = 1614265330;
  assert.equal(
    sign(SECRET, id, timestamp, '{"test": 2432232314}'),
    "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  );
  const binary = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  assert.equal(
    sign(SECRET, id, timestamp, binary),
    "v1,sEcZ042G8Crqgxbybb3y0eDxQR3TcfYsk11I1XULhSI=",
  );
  // Several keys during a rotation; a receiver accepts any listed one.
  const other = "whsec_" + Buffer.alloc(32, 7).toString("base64");
  const headers = webhookHeaders([other, SECRET], id, timestamp, "{}");
  assert.equal(headers["webhook-signature"].split(" ").length, 2);
  assert.ok(
    verify(
      SECRET,
      {
        id,
        timestamp: String(timestamp),
        signature: headers["webhook-signature"],
      },
      "{}",
      timestamp * 1000,
    ),
  );
  // Outside the five-minute tolerance, or tampered: refused.
  assert.ok(
    !verify(
      SECRET,
      {
        id,
        timestamp: String(timestamp),
        signature: headers["webhook-signature"],
      },
      "{}",
      (timestamp + 301) * 1000,
    ),
  );
  assert.ok(
    !verify(
      SECRET,
      {
        id,
        timestamp: String(timestamp),
        signature: headers["webhook-signature"],
      },
      "{ }",
      timestamp * 1000,
    ),
  );
});

// ------------------------------------------------------------ egress

void test("outbound requests refuse private, link-local and metadata destinations", async () => {
  assert.equal(classifyAddress("8.8.8.8"), "public");
  assert.equal(classifyAddress("2606:4700::1111"), "public");
  for (const address of [
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.10",
    "127.0.0.1",
    "100.64.0.1",
    "::1",
    "fd12::1",
  ])
    assert.equal(classifyAddress(address), "private", address);
  for (const address of [
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "fe80::1",
    "::",
    "fd00:ec2::254",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
  ])
    assert.equal(classifyAddress(address), "forbidden", address);
  assert.equal(classifyAddress("::ffff:10.0.0.1"), "private");

  const refusedUrl = (raw: string, allowPrivateNetworks = false) =>
    assert.throws(
      () => checkDestinationUrl(raw, { allowPrivateNetworks }),
      (e: unknown) => e instanceof EgressError,
      raw,
    );
  refusedUrl("http://hooks.example.com/x");
  refusedUrl("https://user:pass@hooks.example.com/x");
  refusedUrl("https://127.0.0.1/x");
  refusedUrl("https://localhost/x");
  refusedUrl("https://agent.internal/x");
  refusedUrl("https://169.254.169.254/latest/meta-data", true);
  refusedUrl("https://[fe80::1]/x", true);
  refusedUrl("ftp://hooks.example.com/x");
  assert.equal(
    checkDestinationUrl("https://hooks.example.com/x").host,
    "hooks.example.com",
  );
  // The operator's permission admits the LAN, with http there.
  assert.ok(
    checkDestinationUrl("http://192.168.1.20:8080/hook", {
      allowPrivateNetworks: true,
    }),
  );
  refusedUrl("http://hooks.example.com/x", true);

  // A public name that resolves to a private or metadata address is
  // refused at connection time, whatever the URL says.
  for (const address of ["10.0.0.5", "169.254.169.254"])
    await assert.rejects(
      egressRequest(
        "https://rebind.example.com/hook",
        { body: "{}" },
        { resolve: async () => [{ address, family: 4 }] },
      ),
      (e: unknown) =>
        e instanceof EgressError && e.reason === "blocked_address",
    );
  // A name with one bad address among good ones is refused too.
  await assert.rejects(
    egressRequest(
      "https://mixed.example.com/hook",
      { body: "{}" },
      {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      },
    ),
    (e: unknown) => e instanceof EgressError && e.reason === "blocked_address",
  );
  // Redirects are answered, never followed.
  const redirect = await receiver(() => ({
    status: 302,
    headers: { location: "http://169.254.169.254/" },
  }));
  try {
    const answer = await egressRequest(
      redirect.url,
      { body: "{}" },
      { allowPrivateNetworks: true },
    );
    assert.equal(answer.status, 302);
    assert.equal(redirect.received.length, 1);
  } finally {
    redirect.stop();
  }
  // Slow receivers time out.
  const slow = await receiver(
    () =>
      new Promise<Answer>((r) =>
        setTimeout(() => r({ status: 200, body: "late" }), 2_000),
      ),
  );
  try {
    await assert.rejects(
      egressRequest(
        slow.url,
        { body: "{}", timeoutMs: 200 },
        { allowPrivateNetworks: true },
      ),
      (e: unknown) => e instanceof EgressError && e.reason === "timeout",
    );
  } finally {
    slow.stop();
  }
});

// ------------------------------------------------------------ MCP Events

void test("an MCP subscription is verified by challenge, renewed by subscribing again and expires without renewal", async () => {
  const f = await fixture();
  const tokenId = await token(f.bo);
  const principal = { userId: f.bo, tokenId, agent: null };
  let echo = true;
  const hook = await receiver((_request, body) => {
    const parsed = JSON.parse(body) as { type?: string; challenge?: string };
    if (parsed.type === "verification")
      return json({ challenge: echo ? parsed.challenge : "nope" });
    return { status: 204 };
  });
  try {
    await withPrivateNetworks(async () => {
      const params = {
        name: "channel.mentioned",
        arguments: { organizationId: f.organizationId },
        delivery: { mode: "webhook", url: hook.url, secret: SECRET },
        ttlMs: 60_000,
      };
      // A wrong echo fails the call with CallbackEndpointError.
      echo = false;
      await assert.rejects(
        subscribeMcp(db, principal, params),
        (e: unknown) => {
          assert.ok(e instanceof EventsProtocolError);
          assert.equal(e.kind, "callback_endpoint");
          assert.equal(e.data?.reason, "challenge_failed");
          return true;
        },
      );
      echo = true;
      const first = await subscribeMcp(db, principal, params);
      assert.match(first.id, /^sub_/);
      // The handshake was signed like a delivery.
      const challenge = hook.received.at(-1)!;
      assert.match(challenge.headers.get("webhook-id")!, /^msg_verification_/);
      assert.equal(challenge.headers.get("x-mcp-subscription-id"), first.id);
      assert.ok(
        verify(
          SECRET,
          {
            id: challenge.headers.get("webhook-id")!,
            timestamp: challenge.headers.get("webhook-timestamp")!,
            signature: challenge.headers.get("webhook-signature")!,
          },
          challenge.body,
        ),
      );
      // The TTL is clamped to at least five minutes.
      const granted = new Date(first.refreshBefore).getTime() - Date.now();
      assert.ok(
        granted > 4 * 60_000 && granted <= 5 * 60_000 + 1000,
        String(granted),
      );
      // Subscribing again with the same key renews the same subscription,
      // without another challenge (verified pair cached).
      const challenges = hook.received.length;
      const again = await subscribeMcp(db, principal, {
        ...params,
        arguments: { organizationId: f.organizationId },
      });
      assert.equal(again.id, first.id);
      assert.equal(hook.received.length, challenges);
      // Expiry when the lease passes, and renewal recreates delivery.
      await expireSubscriptions(db, new Date(Date.now() + 10 * 60_000));
      const [expired] = await db
        .select()
        .from(s.agentEventSubscription)
        .where(eq(s.agentEventSubscription.id, first.id));
      assert.equal(expired!.status, "expired");
      const renewed = await subscribeMcp(db, principal, params);
      assert.equal(renewed.id, first.id);
      assert.equal(renewed.deliveryStatus.active, true);
      // Unsubscribe by key; a second time is NotFound.
      await unsubscribeMcp(db, principal, params);
      await assert.rejects(
        unsubscribeMcp(db, principal, params),
        (e: unknown) =>
          e instanceof EventsProtocolError && e.kind === "not_found",
      );
      // Unknown events, other modes and non-whsec secrets are refused.
      await assert.rejects(
        subscribeMcp(db, principal, { ...params, name: "nope" }),
        /Unknown event/,
      );
      await assert.rejects(
        subscribeMcp(db, principal, { ...params, delivery: { mode: "push" } }),
        (e: unknown) =>
          e instanceof EventsProtocolError && e.kind === "unsupported",
      );
      await assert.rejects(
        subscribeMcp(db, principal, {
          ...params,
          delivery: { ...params.delivery, secret: "whsec_c2hvcnQ=" },
        }),
        (e: unknown) =>
          e instanceof EventsProtocolError && e.kind === "invalid_params",
      );
    });
  } finally {
    hook.stop();
  }
});

void test("MCP deliveries are signed occurrences, in order, and the server advertises events in both eras", async () => {
  const f = await fixture();
  const general = await f.channel(f.ada, "general");
  const tokenId = await token(f.bo);
  const hook = await receiver((_request, body) => {
    const parsed = JSON.parse(body) as { type?: string; challenge?: string };
    if (parsed.type === "verification")
      return json({ challenge: parsed.challenge });
    return { status: 200 };
  });
  const ctx = {
    db,
    principal: {
      userId: f.bo,
      surface: "mcp" as const,
      access: "read" as const,
      tokenId,
    },
    effects: noEffects,
  };
  try {
    await withPrivateNetworks(async () => {
      const discover = (
        await handleMcpHttp(
          ctx,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "server/discover",
            params: {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              },
            },
          },
          {
            headers: new Headers({
              "mcp-protocol-version": "2026-07-28",
              "mcp-method": "server/discover",
            }),
          },
        )
      ).body as { result: Record<string, unknown> };
      assert.ok(
        (discover.result.supportedVersions as string[]).includes("2026-07-28"),
      );
      const capabilities = discover.result.capabilities as Record<
        string,
        Record<string, unknown>
      >;
      assert.ok(capabilities.events);
      assert.ok(capabilities.extensions!["io.modelcontextprotocol/events"]);
      assert.equal(discover.result.resultType, "complete");
      // Legacy clients see the same capability in initialize.
      const init = (await handleMcp(ctx, {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      })) as { result: { capabilities: Record<string, unknown> } };
      assert.ok(init.result.capabilities.events);
      // A header that contradicts the body is refused with 400.
      const mismatch = await handleMcpHttp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "events/list",
          params: {
            _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
          },
        },
        { headers: new Headers({ "mcp-protocol-version": "2025-06-18" }) },
      );
      assert.equal(mismatch.status, 400);
      assert.equal(
        (mismatch.body as { error: { code: number } }).error.code,
        -32020,
      );
      const unsupported = await handleMcpHttp(ctx, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: {
          _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" },
        },
      });
      assert.equal(unsupported.status, 400);
      assert.equal(
        (unsupported.body as { error: { code: number } }).error.code,
        -32022,
      );

      const listed = (await handleMcp(ctx, {
        jsonrpc: "2.0",
        id: 5,
        method: "events/list",
      })) as {
        result: {
          events: {
            name: string;
            delivery: string[];
            payloadSchema: unknown;
          }[];
        };
      };
      assert.ok(
        listed.result.events.some((e) => e.name === "review.requested"),
      );
      assert.deepEqual(listed.result.events[0]!.delivery, ["webhook"]);
      // A read token may subscribe.
      const subscribed = (await handleMcp(ctx, {
        jsonrpc: "2.0",
        id: 6,
        method: "events/subscribe",
        params: {
          name: "channel.mentioned",
          delivery: { mode: "webhook", url: hook.url, secret: SECRET },
        },
      })) as { result: { id: string } };
      assert.match(subscribed.result.id, /^sub_/);
      await f.post(f.ada, general, `${f.mention(f.bo)} one`);
      await f.post(f.ada, general, `${f.mention(f.bo)} two`);
      await drainNotifications(db);
      const outcome = await processAgentEventDeliveries(db);
      assert.equal(outcome.delivered, 2);
      const deliveries = hook.received.filter(
        (r) => !r.body.includes('"verification"'),
      );
      assert.equal(deliveries.length, 2);
      const bodies = deliveries.map(
        (d) =>
          JSON.parse(d.body) as {
            eventId: string;
            name: string;
            timestamp: string;
            data: { subject: Record<string, unknown> };
            cursor: string;
          },
      );
      assert.equal(bodies[0]!.name, "channel.mentioned");
      assert.ok(
        bodies[0]!.cursor < bodies[1]!.cursor ||
          bodies[0]!.cursor !== bodies[1]!.cursor,
      );
      for (const [index, d] of deliveries.entries()) {
        assert.equal(d.headers.get("webhook-id"), bodies[index]!.eventId);
        assert.equal(
          d.headers.get("x-mcp-subscription-id"),
          subscribed.result.id,
        );
        assert.ok(
          verify(
            SECRET,
            {
              id: d.headers.get("webhook-id")!,
              timestamp: d.headers.get("webhook-timestamp")!,
              signature: d.headers.get("webhook-signature")!,
            },
            d.body,
          ),
        );
        assert.ok(
          !d.body.includes(" one") && !d.body.includes(" two"),
          "no message bodies",
        );
      }
      // Nothing is sent twice.
      assert.equal((await processAgentEventDeliveries(db)).delivered, 0);
    });
  } finally {
    hook.stop();
  }
});

// The snippet the agent events reference prints, loaded as a receiver
// would run it.
async function documentedVerifier() {
  const dir = mkdtempSync(join(tmpdir(), "lictory-verify-"));
  const file = join(dir, "verify.mjs");
  writeFileSync(file, verificationSnippet);
  const module = (await import(file)) as {
    verifyLictoryWebhook: (
      secret: string,
      headers: Record<string, string>,
      body: string,
      now?: number,
    ) => boolean;
  };
  rmSync(dir, { recursive: true, force: true });
  return module.verifyLictoryWebhook;
}

// ------------------------------------------------------------ webhooks

void test("a failing webhook retries with backoff, is suspended, and resumes in order", async () => {
  const f = await fixture();
  const general = await f.channel(f.ada, "general");
  let status = 500;
  const hook = await receiver(() => ({ status }));
  try {
    await withPrivateNetworks(async () => {
      const webhook = await createWebhook(db, f.bo, {
        name: "Grok",
        url: hook.url,
        secret: "grok-secret",
        organizationId: f.organizationId,
        eventTypes: ["channel.mentioned"],
      });
      // The test button reports what the receiver answered.
      const tested = await testWebhook(db, f.bo, webhook.id);
      assert.equal(tested.ok, false);
      const test = hook.received.at(-1)!;
      assert.equal(test.headers.get("authorization"), "Bearer grok-secret");
      assert.equal(test.headers.get("x-lictory-event-type"), "lictory.test");
      // Signed with the secret, as the events reference shows receivers.
      const expected = createHmac("sha256", "grok-secret")
        .update(
          `${test.headers.get("webhook-id")}.${test.headers.get("webhook-timestamp")}.${test.body}`,
        )
        .digest("base64");
      assert.equal(test.headers.get("webhook-signature"), `v1,${expected}`);
      // The reference's verification snippet accepts it, and only it.
      const verifyDelivery = await documentedVerifier();
      const headers = Object.fromEntries(test.headers.entries());
      assert.equal(verifyDelivery("grok-secret", headers, test.body), true);
      assert.equal(verifyDelivery("other-secret", headers, test.body), false);
      assert.equal(
        verifyDelivery("grok-secret", headers, `${test.body} `),
        false,
      );
      assert.equal(
        verifyDelivery("grok-secret", headers, test.body, Date.now() + 600_000),
        false,
      );
      const key = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
      const signed = webhookHeaders([key], "msg_1", 1_800_000_000, "{}");
      assert.equal(verifyDelivery(key, signed, "{}", 1_800_000_000_000), true);
      await f.post(f.ada, general, `${f.mention(f.bo)} first`);
      await f.post(f.ada, general, `${f.mention(f.bo)} second`);
      await drainNotifications(db);
      let clock = Date.now();
      const tick = () =>
        processAgentEventDeliveries(db, { now: () => new Date(clock) });
      const row = async () =>
        (
          await db
            .select()
            .from(s.agentEventSubscription)
            .where(eq(s.agentEventSubscription.id, webhook.id))
        )[0]!;
      await tick();
      let current = await row();
      assert.equal(current.attempts, 1);
      assert.equal(current.lastError, "http_5xx");
      assert.equal(current.nextAttemptAt.getTime() - clock, 30_000);
      // The person sees that it is failing and when it tries again.
      const listed = async () =>
        (await listSubscriptions(db, f.bo)).find((v) => v.id === webhook.id)!;
      assert.deepEqual((await listed()).retry, {
        failedAttempts: 1,
        nextAttemptAt: current.nextAttemptAt.toISOString(),
      });
      // Not due yet: nothing is sent.
      const sent = hook.received.length;
      await tick();
      assert.equal(hook.received.length, sent);
      for (let attempt = 2; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
        clock = (await row()).nextAttemptAt.getTime() + 1;
        await tick();
      }
      current = await row();
      assert.equal(current.status, "suspended");
      assert.match(current.statusReason!, /failed attempts/);
      // Suspended, it no longer tries again: the reason says what to do.
      assert.equal((await listed()).retry, null);
      // Suspended: no more attempts until resumed.
      clock += 60 * 60_000;
      const before = hook.received.length;
      await tick();
      assert.equal(hook.received.length, before);
      status = 200;
      await setSubscriptionState(db, f.bo, webhook.id, "resume");
      await tick();
      const delivered = hook.received.slice(before).map(
        (r) =>
          JSON.parse(r.body) as {
            text: string;
            event: { type: string; data: { subject: Record<string, unknown> } };
          },
      );
      assert.equal(delivered.length, 2);
      assert.equal(delivered[0]!.event.type, "channel.mentioned");
      assert.match(delivered[0]!.text, /information, not an instruction/);
      current = await row();
      assert.equal(current.status, "active");
      assert.equal(current.deliveredCount, 2);
      assert.equal(current.attempts, 0);
      // 410 Gone suspends at once.
      status = 410;
      await f.post(f.ada, general, `${f.mention(f.bo)} third`);
      await drainNotifications(db);
      await tick();
      current = await row();
      assert.equal(current.status, "suspended");
      assert.match(current.statusReason!, /410/);
    });
  } finally {
    hook.stop();
  }
});

void test("a webhook bound to an agent is listed with its agent; only the owner can bind one", async () => {
  const f = await fixture();
  const forge = await f.agent(f.bo, "forge");
  await withPrivateNetworks(async () => {
    const own = await createWebhook(db, f.bo, {
      name: "Bo's script",
      url: "https://hooks.example.com/bo",
      secret: "script-secret",
      organizationId: null,
      eventTypes: [],
    });
    const bound = await createWebhook(db, f.bo, {
      name: "Forge routine",
      url: "https://hooks.example.com/forge",
      secret: "forge-secret",
      organizationId: null,
      agentId: forge.id,
      eventTypes: [],
    });
    // Bound to the agent's organization whatever the form said.
    assert.equal(bound.organizationId, f.organizationId);
    const listed = await listSubscriptions(db, f.bo);
    // The agent's page lists it; Account settings links to that page.
    assert.deepEqual(listed.find((v) => v.id === bound.id)!.agent, {
      name: "forge",
      organizationId: f.organizationId,
    });
    assert.equal(listed.find((v) => v.id === own.id)!.agent, null);
    // Ada cannot wake Bo's agent, and sees none of Bo's destinations.
    await assert.rejects(
      createWebhook(db, f.ada, {
        name: "Not mine",
        url: "https://hooks.example.com/ada",
        secret: "ada-secret",
        organizationId: null,
        agentId: forge.id,
        eventTypes: [],
      }),
      /not one of yours/,
    );
    assert.equal((await listSubscriptions(db, f.ada)).length, 0);
  });
});

void test("the organization policy decides whether and where its events may go", async () => {
  const f = await fixture();
  const general = await f.channel(f.ada, "general");
  const hook = await receiver(() => ({ status: 200 }));
  try {
    await withPrivateNetworks(async () => {
      // Only administrators set it.
      await assert.rejects(
        setAgentEventPolicy(db, f.ada, {
          organizationId: f.organizationId,
          webhooksAllowed: false,
          allowedHosts: null,
        }),
        /administrators/,
      );
      const webhook = await createWebhook(db, f.bo, {
        name: "Claude routine",
        url: hook.url,
        secret: "routine-secret",
        organizationId: f.organizationId,
        eventTypes: [],
      });
      await setAgentEventPolicy(db, f.owner, {
        organizationId: f.organizationId,
        webhooksAllowed: true,
        allowedHosts: ["hooks.example.com", "*.agents.example.com"],
      });
      // A new destination elsewhere is refused…
      await assert.rejects(
        createWebhook(db, f.bo, {
          name: "Other",
          url: hook.url,
          secret: "x",
          organizationId: f.organizationId,
          eventTypes: [],
        }),
        /only allows webhooks to hooks\.example\.com/,
      );
      // …and an existing one stops receiving the organization's events.
      await f.post(f.ada, general, `${f.mention(f.bo)} held back`);
      await drainNotifications(db);
      const outcome = await processAgentEventDeliveries(db);
      assert.equal(outcome.delivered, 0);
      assert.equal(outcome.skipped, 1);
      const [row] = await db
        .select()
        .from(s.agentEventSubscription)
        .where(eq(s.agentEventSubscription.id, webhook.id));
      assert.equal(row!.lastError, "policy");
      // The change is in the configuration audit.
      const audit = await db
        .select()
        .from(s.configurationAudit)
        .where(
          and(
            eq(s.configurationAudit.organizationId, f.organizationId),
            eq(s.configurationAudit.action, "setAgentEventPolicy"),
          ),
        );
      assert.equal(audit.length, 1);
      // Creating the webhook was an access audit event.
      const [created] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from audit_event where action = 'event_webhook.created' and organization_id = ${f.organizationId}`,
      );
      assert.equal(created!.n, 1);
    });
  } finally {
    hook.stop();
  }
});

void test("webhooks are web-only and the feed is available to every surface", async () => {
  const f = await fixture();
  const ctx = (surface: "web" | "mcp" | "agent") => ({
    db,
    principal: { userId: f.bo, surface, access: "write" as const },
    effects: noEffects,
  });
  await assert.rejects(
    invoke(ctx("mcp"), "createEventWebhook", {
      name: "x",
      url: "https://hooks.example.com",
      secret: "s",
      organizationId: f.organizationId,
      eventTypes: [],
    }),
    (e: unknown) =>
      (e as { details?: { kind?: string } }).details?.kind === "human_only",
  );
  await assert.rejects(
    invoke(ctx("mcp"), "setAgentEventPolicy", {
      organizationId: f.organizationId,
      webhooksAllowed: false,
      allowedHosts: null,
    }),
    (e: unknown) =>
      (e as { details?: { kind?: string } }).details?.kind === "human_only",
  );
  const listed = (await invoke(ctx("mcp"), "listEvents", {
    organizationId: f.organizationId,
  })) as { events: unknown[]; cursor: string };
  assert.equal(listed.events.length, 0);
  const types = (await invoke(ctx("agent"), "listEventTypes", {})) as {
    types: { name: string }[];
  };
  assert.ok(types.types.some((t) => t.name === "claim.question_resolved"));
});

void test("waits are bounded and wake only for the waiting person", async () => {
  const f = await fixture();
  const general = await f.channel(f.ada, "general");
  const { cursor } = await readAgentEvents(
    db,
    { userId: f.ada },
    { after: "latest" },
  );
  const started = Date.now();
  const waiting = waitForAgentEvents(
    db,
    { userId: f.ada },
    { after: cursor, timeoutSeconds: 2 },
  );
  // Someone else's mention does not wake Ada.
  await f.post(f.ada, general, `${f.mention(f.bo)} not for Ada`);
  await drainNotifications(db);
  const result = await waiting;
  assert.equal(result.events.length, 0);
  assert.ok(Date.now() - started >= 1_900);
});
