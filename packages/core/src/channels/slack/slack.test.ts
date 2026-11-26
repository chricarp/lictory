import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";
import { invoke } from "@lictory/core/capabilities/registry";
import { noEffects } from "@lictory/core/capabilities/core";
import {
  registerAgentDirectory,
  type AgentDirectory,
  type AgentMentionEvent,
  type ChannelAgent,
} from "@lictory/core/channels/agents";
import {
  deleteMessage,
  editMessage,
  postMessage,
  reactToMessage,
} from "@lictory/core/channels/writer";
import { slackClient } from "@lictory/core/channels/slack/api";
import {
  completeSlackInstall,
  disconnectSlack,
  saveSlackApp,
  slackAppManifest,
  startSlackInstall,
} from "@lictory/core/channels/slack/installation";
import {
  linkSlackChannel,
  listSlackChannels,
  unlinkSlackChannel,
} from "@lictory/core/channels/slack/links";
import {
  processSlackBackfills,
  processSlackEvents,
  receiveSlackRequest,
} from "@lictory/core/channels/slack/inbound";
import {
  processChannelMirrors,
  retryChannelMirror,
} from "@lictory/core/channels/slack/outbound";
import { setSlackIntelligenceReads } from "@lictory/core/channels/slack/ai-access";
import {
  markdownToSlack,
  slackToMarkdown,
} from "@lictory/core/channels/slack/format";
import {
  slackSignature,
  verifySlackSignature,
} from "@lictory/core/channels/slack/signature";
import {
  createFakeSlack,
  signSlackBody,
  type FakeSlack,
} from "../../../../../scripts/e2e-fakes/slack";

// The Slack ChatProvider end to end against the fake Slack
// (scripts/e2e-fakes/slack.ts): signed deliveries into the Events API
// handler, the worker's processing, and the Web API calls it makes.

process.env.DELIVERY_CREDENTIALS_KEY ??=
  "slack-test-credentials-key-0123456789";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_slack_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 8, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;

const agents: ChannelAgent[] = [];
const mentions: AgentMentionEvent[] = [];
let mayAddress: AgentDirectory["mayAddress"];

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  registerAgentDirectory({
    agents: async (_tx, _org, ids) => agents.filter((a) => ids.includes(a.id)),
    search: async (_tx, _org, prefix, limit) =>
      agents.filter((a) => a.handle.startsWith(prefix)).slice(0, limit),
    actingAgent: async () => null,
    mentioned: async (_tx, event) => {
      mentions.push(event);
    },
    get mayAddress() {
      return mayAddress;
    },
  });
});
after(async () => {
  registerAgentDirectory({
    agents: async () => [],
    search: async () => [],
    actingAgent: async () => null,
  });
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function user(name: string, verified = true) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({
    id,
    name,
    email: `${name.toLowerCase()}-${id.slice(0, 6)}@example.test`,
    emailVerified: verified,
  });
  const [row] = await db.select().from(s.user).where(eq(s.user.id, id));
  return { id, email: row!.email, name };
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

const eventsUrl = (organizationId: string) =>
  `https://lictory.test/api/slack/events/${organizationId}`;

// Deliveries go straight into the Events API handler, by organization id in
// the URL, as the API route does.
function deliverer() {
  return async (request: { url: string; headers: Headers; body: string }) => {
    const organizationId = request.url.split("/").at(-1)!;
    return receiveSlackRequest(db, {
      organizationId,
      kind: "events",
      headers: request.headers,
      body: request.body,
    });
  };
}

let appSequence = 0;
// An organization connected to its own fake Slack workspace, with Ada
// (mapped by her verified email), Bo (mapped, not an agent owner) and a
// guest with no Lictory account, and #general linked to Slack's #general.
async function connected(options: { privateChannel?: boolean } = {}) {
  const [owner, ada, bo, outsider] = await Promise.all([
    user("Owner"),
    user("Ada"),
    user("Bo"),
    user("Outsider"),
  ]);
  const organizationId = await organization([
    [owner.id, "owner"],
    [ada.id, "member"],
    [bo.id, "member"],
  ]);
  const n = ++appSequence;
  const fake = createFakeSlack({
    app: {
      appId: `A0TEST${String(n).padStart(4, "0")}`,
      clientId: `${1000000 + n}.${2000000 + n}`,
      clientSecret: `${String(n).padStart(2, "0")}aabbccddeeff00112233445566778`,
      signingSecret: `${String(n).padStart(2, "0")}ffeeddccbbaa99887766554433221`,
      teamId: `T0TEST${n}`,
      teamName: `Slack ${n}`,
      botUserId: `U0BOT${n}`,
      botId: `B0BOT${n}`,
    },
    deliver: deliverer(),
  });
  fake.setEventsUrl(eventsUrl(organizationId));
  const slack = slackClient({ fetch: fake.fetch });
  fake.addPerson({ id: "UADA", name: "Ada", email: ada.email });
  fake.addPerson({ id: "UBO", name: "Bo", email: bo.email });
  fake.addPerson({ id: "UGUEST", name: "Ines", email: "ines@agency.test" });
  fake.addPerson({ id: "UOUT", name: "Outsider", email: outsider.email });
  await saveSlackApp(
    db,
    owner.id,
    {
      organizationId,
      appId: fake.app.appId,
      clientId: fake.app.clientId,
      clientSecret: fake.app.clientSecret,
      signingSecret: fake.app.signingSecret,
    },
    { client: slack },
  );
  const { url: authorizeUrl } = await startSlackInstall(
    db,
    owner.id,
    organizationId,
  );
  const authorize = new URL(authorizeUrl);
  const code = fake.authorize(authorize.searchParams.get("redirect_uri")!);
  await completeSlackInstall(db, slack, {
    userId: owner.id,
    state: authorize.searchParams.get("state")!,
    code,
  });
  const run = (actor: string, command: Command) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
    );
  const channelId = crypto.randomUUID();
  await run(owner.id, {
    type: "createChannel",
    channelId,
    kind: options.privateChannel ? "private" : "public",
    name: `general-${n}`,
    memberIds: options.privateChannel ? [ada.id] : [],
  });
  if (!options.privateChannel) {
    await run(ada.id, { type: "joinChannel", channelId });
    await run(bo.id, { type: "joinChannel", channelId });
  }
  const slackChannel = `C0GEN${n}`;
  fake.addChannel({
    id: slackChannel,
    name: "general",
    isPrivate: options.privateChannel ?? false,
  });
  await linkSlackChannel(db, slack, owner.id, {
    organizationId,
    channelId,
    slackChannelId: slackChannel,
  });
  return {
    owner,
    ada,
    bo,
    outsider,
    organizationId,
    fake,
    slack,
    channelId,
    slackChannel,
    run,
  };
}

/** Runs the worker until Slack and Lictory are quiet. */
async function drain(fake: FakeSlack, slack: ReturnType<typeof slackClient>) {
  for (let i = 0; i < 20; i++) {
    await fake.settled();
    const events = await processSlackEvents(db, slack);
    const mirrors = await processChannelMirrors(db, slack);
    await fake.settled();
    if (!events.claimed && !mirrors.claimed) return;
  }
  throw new Error("The worker did not settle.");
}

const messagesOf = (channelId: string) =>
  db
    .select()
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.channelId, channelId),
        eq(s.channelMessage.kind, "message"),
      ),
    )
    .orderBy(asc(s.channelMessage.sequence));

async function rejectsWith(promise: Promise<unknown>, kind: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error));
    assert.equal(error.kind ?? error.category, kind);
    return true;
  });
}

void test("signatures: v0 HMAC over v0:ts:body, five-minute window, constant-time compare", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const body = '{"type":"event_callback"}';
  const now = new Date("2026-11-24T12:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  const headers = (signature: string, timestamp = ts) =>
    new Headers({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    });
  assert.deepEqual(
    verifySlackSignature(
      secret,
      headers(slackSignature(secret, ts, body)),
      body,
      now,
    ),
    { ok: true },
  );
  // Another body, another secret, a tampered digest: refused.
  assert.equal(
    verifySlackSignature(
      secret,
      headers(slackSignature(secret, ts, `${body} `)),
      body,
      now,
    ).ok,
    false,
  );
  assert.equal(
    verifySlackSignature(
      secret,
      headers(slackSignature("other", ts, body)),
      body,
      now,
    ).ok,
    false,
  );
  assert.deepEqual(verifySlackSignature(secret, headers("v0=abc"), body, now), {
    ok: false,
    reason: "mismatch",
  });
  // Older or newer than five minutes: stale, even when correctly signed.
  const old = String(Number(ts) - 301);
  assert.deepEqual(
    verifySlackSignature(
      secret,
      headers(slackSignature(secret, old, body), old),
      body,
      now,
    ),
    { ok: false, reason: "stale" },
  );
  const edge = String(Number(ts) - 299);
  assert.equal(
    verifySlackSignature(
      secret,
      headers(slackSignature(secret, edge, body), edge),
      body,
      now,
    ).ok,
    true,
  );
  assert.deepEqual(verifySlackSignature(secret, new Headers(), body, now), {
    ok: false,
    reason: "missing",
  });
});

void test("the Events API refuses bad and stale signatures, answers the URL check and stores each event once", async () => {
  const f = await connected();
  const challenge = JSON.stringify({
    type: "url_verification",
    challenge: "c-123",
  });
  const answered = await receiveSlackRequest(db, {
    organizationId: f.organizationId,
    kind: "events",
    headers: signSlackBody(f.fake.app.signingSecret, challenge),
    body: challenge,
  });
  assert.equal(answered.status, 200);
  assert.deepEqual(JSON.parse(answered.body), { challenge: "c-123" });
  // The challenge needs a valid signature too.
  const unsigned = await receiveSlackRequest(db, {
    organizationId: f.organizationId,
    kind: "events",
    headers: signSlackBody("0000000000000000aaaaaaaaaaaaaaaa", challenge),
    body: challenge,
  });
  assert.equal(unsigned.status, 401);

  const event = JSON.stringify({
    type: "event_callback",
    team_id: f.fake.app.teamId,
    api_app_id: f.fake.app.appId,
    event_id: "EvSTALE",
    event: {
      type: "message",
      channel: f.slackChannel,
      user: "UADA",
      text: "stale",
      ts: "1.1",
    },
  });
  const stale = await receiveSlackRequest(db, {
    organizationId: f.organizationId,
    kind: "events",
    headers: signSlackBody(
      f.fake.app.signingSecret,
      event,
      Math.floor(Date.now() / 1000) - 600,
    ),
    body: event,
  });
  assert.equal(stale.status, 401);
  const tampered = await receiveSlackRequest(db, {
    organizationId: f.organizationId,
    kind: "events",
    headers: signSlackBody(f.fake.app.signingSecret, event),
    body: event.replace("stale", "STALE"),
  });
  assert.equal(tampered.status, 401);
  assert.equal(
    (
      await db
        .select()
        .from(s.slackEvent)
        .where(eq(s.slackEvent.organizationId, f.organizationId))
    ).length,
    0,
  );

  // Slack retries a delivery with the same event id: stored and shown once.
  const sent = await f.fake.say({
    channel: f.slackChannel,
    user: "UADA",
    text: "Hello from Slack",
    eventId: "EvONCE",
  });
  assert.equal(sent.event?.status, 200);
  const retried = await f.fake.resend(
    {
      type: "message",
      channel: f.slackChannel,
      user: "UADA",
      text: "Hello from Slack",
      ts: sent.ts,
    },
    "EvONCE",
  );
  assert.equal(retried?.status, 200);
  const stored = await db
    .select()
    .from(s.slackEvent)
    .where(eq(s.slackEvent.eventId, "EvONCE"));
  assert.equal(stored.length, 1);
  await drain(f.fake, f.slack);
  const messages = await messagesOf(f.channelId);
  assert.equal(messages.filter((m) => m.body === "Hello from Slack").length, 1);
});

void test("an event for one installation never writes into another organization", async () => {
  const a = await connected();
  const b = await connected();
  // Signed with A's secret, delivered to B's URL: refused.
  const body = JSON.stringify({
    type: "event_callback",
    team_id: a.fake.app.teamId,
    api_app_id: a.fake.app.appId,
    event_id: "EvCROSS1",
    event: {
      type: "message",
      channel: a.slackChannel,
      user: "UADA",
      text: "cross",
      ts: "5.5",
    },
  });
  const crossed = await receiveSlackRequest(db, {
    organizationId: b.organizationId,
    kind: "events",
    headers: signSlackBody(a.fake.app.signingSecret, body),
    body,
  });
  assert.equal(crossed.status, 401);
  // B's own app and secret, but A's workspace: acknowledged, never stored.
  const otherTeam = JSON.stringify({
    type: "event_callback",
    team_id: a.fake.app.teamId,
    api_app_id: b.fake.app.appId,
    event_id: "EvCROSS2",
    event: {
      type: "message",
      channel: b.slackChannel,
      user: "UADA",
      text: "cross",
      ts: "5.6",
    },
  });
  const ignored = await receiveSlackRequest(db, {
    organizationId: b.organizationId,
    kind: "events",
    headers: signSlackBody(b.fake.app.signingSecret, otherTeam),
    body: otherTeam,
  });
  assert.equal(ignored.status, 200);
  assert.equal(
    (
      await db
        .select()
        .from(s.slackEvent)
        .where(eq(s.slackEvent.eventId, "EvCROSS2"))
    ).length,
    0,
  );
  // B's valid event naming A's Slack channel finds no link in B.
  await b.fake.sendEvent({
    type: "message",
    channel: a.slackChannel,
    user: "UADA",
    text: "into A?",
    ts: "5.7",
  });
  await drain(b.fake, b.slack);
  assert.equal((await messagesOf(a.channelId)).length, 0);
  assert.equal((await messagesOf(b.channelId)).length, 0);
});

void test("Slack messages arrive owned by Slack; people map by verified email, everyone else is external", async () => {
  const f = await connected();
  const root = await f.fake.say({
    channel: f.slackChannel,
    user: "UADA",
    text: "*Refunds* over the API? <@UBO>",
  });
  await f.fake.say({
    channel: f.slackChannel,
    user: "UGUEST",
    text: "We need them by Q3",
    threadTs: root.ts,
  });
  await f.fake.say({
    channel: f.slackChannel,
    user: "UOUT",
    text: "Not a member here",
  });
  await drain(f.fake, f.slack);
  const [fromAda, guest, outsider] = await messagesOf(f.channelId);
  assert.equal(fromAda!.authorKind, "user");
  assert.equal(fromAda!.authorUserId, f.ada.id);
  assert.equal(fromAda!.externalSource, "slack");
  assert.equal(fromAda!.externalId, root.ts);
  assert.equal(
    fromAda!.body,
    `**Refunds** over the API? @[Bo](mention:${f.bo.id})`,
  );
  // Bo is told: a mapped mention is a mention.
  const mention = await db
    .select()
    .from(s.channelMention)
    .where(eq(s.channelMention.messageId, fromAda!.id));
  assert.deepEqual(
    mention.map((m) => m.mentionedId),
    [f.bo.id],
  );
  assert.equal(guest!.authorKind, "external");
  assert.equal(guest!.authorUserId, null);
  assert.equal(guest!.externalAuthorName, "Ines");
  assert.equal(guest!.threadRootId, fromAda!.id);
  // A Lictory account outside the organization maps to no one.
  assert.equal(outsider!.authorKind, "external");
  const [rootRow] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, fromAda!.id));
  assert.equal(rootRow!.replyCount, 1);

  // Lictory never edits or deletes a message Slack owns.
  await rejectsWith(
    db.transaction((tx) =>
      editMessage(
        tx,
        { userId: f.ada.id },
        {
          organizationId: f.organizationId,
          channelId: f.channelId,
          messageId: fromAda!.id,
          body: "rewritten",
        },
      ),
    ),
    "external_owner",
  );
  await rejectsWith(
    db.transaction((tx) =>
      deleteMessage(
        tx,
        { userId: f.owner.id },
        {
          organizationId: f.organizationId,
          channelId: f.channelId,
          messageId: guest!.id,
        },
      ),
    ),
    "external_owner",
  );

  // Edits and deletions made in Slack apply, keeping history.
  await f.fake.edit({
    channel: f.slackChannel,
    ts: root.ts,
    text: "Refunds over the API, partial too?",
  });
  await f.fake.remove({
    channel: f.slackChannel,
    ts: outsiderTs(f.fake.messages(f.slackChannel)),
  });
  await drain(f.fake, f.slack);
  const [edited, , removed] = await messagesOf(f.channelId);
  assert.equal(edited!.body, "Refunds over the API, partial too?");
  assert.ok(edited!.editedAt);
  assert.ok(removed!.deletedAt);
  assert.equal(removed!.body, "");
  const revisions = await db
    .select()
    .from(s.channelMessageRevision)
    .where(eq(s.channelMessageRevision.messageId, edited!.id));
  assert.equal(
    revisions[0]!.body,
    `**Refunds** over the API? @[Bo](mention:${f.bo.id})`,
  );

  // Reactions: a mapped person's is theirs; a guest's is counted by name.
  await f.fake.react({
    channel: f.slackChannel,
    ts: root.ts,
    user: "UBO",
    name: "thumbsup",
  });
  await f.fake.react({
    channel: f.slackChannel,
    ts: root.ts,
    user: "UGUEST",
    name: "eyes",
  });
  await drain(f.fake, f.slack);
  const reactions = await db
    .select()
    .from(s.channelReaction)
    .where(eq(s.channelReaction.messageId, edited!.id));
  assert.deepEqual(
    reactions.map((r) => [r.userId, r.emoji, r.externalSource]),
    [[f.bo.id, "👍", "slack"]],
  );
  const [withReactions] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, edited!.id));
  assert.deepEqual(withReactions!.externalReactions, [
    { emoji: "👀", names: ["Ines"], externalIds: ["UGUEST"] },
  ]);
  // Bo's Slack reaction is not mirrored back to Slack as the bot's.
  assert.ok(!f.fake.calls.some((c) => c.method === "reactions.add"));
  await f.fake.react({
    channel: f.slackChannel,
    ts: root.ts,
    user: "UGUEST",
    name: "eyes",
    add: false,
  });
  await drain(f.fake, f.slack);
  const [cleared] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, edited!.id));
  assert.deepEqual(cleared!.externalReactions, []);
});

function outsiderTs(messages: { user?: string; ts: string }[]) {
  return messages.find((m) => m.user === "UOUT")!.ts;
}

void test("Lictory messages reach Slack once, as their author, with replies, edits, deletions and reactions; nothing echoes back", async () => {
  const f = await connected();
  const post = (body: string, threadRootId?: string) =>
    db.transaction((tx) =>
      postMessage(
        tx,
        { userId: f.ada.id },
        {
          organizationId: f.organizationId,
          channelId: f.channelId,
          body,
          ...(threadRootId ? { threadRootId } : {}),
        },
      ),
    );
  const { message: root } = await post(
    `Ship it **today**, @[Bo](mention:${f.bo.id})`,
  );
  const { message: reply } = await post("Thread reply", root.id);
  await drain(f.fake, f.slack);
  const inSlack = f.fake.messages(f.slackChannel);
  assert.equal(inSlack.length, 2);
  const [slackRoot, slackReply] = inSlack as unknown as {
    text: string;
    ts: string;
    username: string;
    thread_ts?: string;
    metadata: { event_payload: { message_id: string } };
  }[];
  assert.equal(slackRoot!.text, "Ship it *today*, <@UBO>");
  assert.equal(slackRoot!.username, "Ada");
  assert.equal(slackRoot!.metadata.event_payload.message_id, root.id);
  assert.equal(slackReply!.thread_ts, slackRoot!.ts);
  // The bot's own message events came back and were ignored.
  const outcomes = await db
    .select({ outcome: s.slackEvent.outcome })
    .from(s.slackEvent)
    .where(eq(s.slackEvent.organizationId, f.organizationId));
  assert.ok(outcomes.length >= 2);
  assert.ok(
    outcomes.every((o) => o.outcome === "ignored: own bot"),
    JSON.stringify(outcomes),
  );
  assert.equal((await messagesOf(f.channelId)).length, 2);

  await db.transaction((tx) =>
    editMessage(
      tx,
      { userId: f.ada.id },
      {
        organizationId: f.organizationId,
        channelId: f.channelId,
        messageId: root.id,
        body: "Ship it tomorrow",
      },
    ),
  );
  await db.transaction((tx) =>
    reactToMessage(
      tx,
      { userId: f.bo.id },
      {
        organizationId: f.organizationId,
        channelId: f.channelId,
        messageId: root.id,
        emoji: "🎉",
        add: true,
      },
    ),
  );
  await db.transaction((tx) =>
    deleteMessage(
      tx,
      { userId: f.ada.id },
      {
        organizationId: f.organizationId,
        channelId: f.channelId,
        messageId: reply.id,
      },
    ),
  );
  await drain(f.fake, f.slack);
  const after = f.fake.messages(f.slackChannel) as {
    text: string;
    reactions?: { name: string }[];
  }[];
  assert.equal(after.length, 1);
  assert.equal(after[0]!.text, "Ship it tomorrow");
  assert.deepEqual(
    after[0]!.reactions?.map((r) => r.name),
    ["tada"],
  );
  // A Slack edit of a message Lictory owns is ignored (only Slack-written
  // messages change from Slack).
  await f.fake.sendEvent({
    type: "message",
    subtype: "message_changed",
    channel: f.slackChannel,
    message: {
      type: "message",
      user: "UBO",
      text: "hijacked",
      ts: slackRoot!.ts,
      edited: { user: "UBO", ts: "9.9" },
    },
  });
  await drain(f.fake, f.slack);
  const [kept] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, root.id));
  assert.equal(kept!.body, "Ship it tomorrow");
  assert.equal((await messagesOf(f.channelId)).length, 2);
});

void test("posting is idempotent by message id: a lost answer is found again, not posted twice", async () => {
  const f = await connected();
  f.fake.loseNextPostAnswer();
  const { message } = await db.transaction((tx) =>
    postMessage(
      tx,
      { userId: f.ada.id },
      {
        organizationId: f.organizationId,
        channelId: f.channelId,
        body: "Exactly once",
      },
    ),
  );
  await processChannelMirrors(db, f.slack);
  const [mirror] = await db
    .select()
    .from(s.channelMirror)
    .where(eq(s.channelMirror.messageId, message.id));
  assert.equal(mirror!.externalId, null);
  assert.ok(mirror!.dueAt && mirror!.dueAt > new Date());
  await db
    .update(s.channelMirror)
    .set({ dueAt: new Date() })
    .where(eq(s.channelMirror.id, mirror!.id));
  await drain(f.fake, f.slack);
  const posted = f.fake.messages(f.slackChannel);
  assert.equal(posted.length, 1);
  const [settled] = await db
    .select()
    .from(s.channelMirror)
    .where(eq(s.channelMirror.id, mirror!.id));
  assert.equal(settled!.externalId, posted[0]!.ts);
  assert.equal(
    f.fake.calls.filter((c) => c.method === "chat.postMessage").length,
    1,
  );
});

void test("rate limits wait for Retry-After; permanent failures show on the message and can be retried", async () => {
  const f = await connected();
  f.fake.rateLimitNext("chat.postMessage", 7);
  const { message } = await db.transaction((tx) =>
    postMessage(
      tx,
      { userId: f.ada.id },
      {
        organizationId: f.organizationId,
        channelId: f.channelId,
        body: "Later",
      },
    ),
  );
  const before = Date.now();
  await processChannelMirrors(db, f.slack);
  const [waiting] = await db
    .select()
    .from(s.channelMirror)
    .where(eq(s.channelMirror.messageId, message.id));
  assert.ok(
    waiting!.dueAt!.getTime() >= before + 6_000,
    "waits for Retry-After",
  );
  assert.equal(waiting!.attempts, 0, "a rate limit is not a failed attempt");
  assert.equal(waiting!.failedAt, null);
  await db
    .update(s.channelMirror)
    .set({ dueAt: new Date() })
    .where(eq(s.channelMirror.id, waiting!.id));
  await drain(f.fake, f.slack);
  assert.equal(f.fake.messages(f.slackChannel).length, 1);

  f.fake.failNext("chat.postMessage", "msg_too_long");
  const { message: failing } = await db.transaction((tx) =>
    postMessage(
      tx,
      { userId: f.bo.id },
      {
        organizationId: f.organizationId,
        channelId: f.channelId,
        body: "Too long for Slack",
      },
    ),
  );
  await drain(f.fake, f.slack);
  const [failed] = await db
    .select()
    .from(s.channelMirror)
    .where(eq(s.channelMirror.messageId, failing.id));
  assert.ok(failed!.failedAt);
  assert.equal(failed!.lastError, "The message is too long for Slack.");
  // Only its author or someone who manages the channel retries: Cy is in
  // the organization but not in the channel.
  const cy = await user("Cy");
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId: f.organizationId,
    userId: cy.id,
    role: "member",
    createdAt: new Date(),
  });
  await rejectsWith(
    retryChannelMirror(db, cy.id, {
      organizationId: f.organizationId,
      channelId: f.channelId,
      messageId: failing.id,
    }),
    "forbidden",
  );
  assert.deepEqual(
    await retryChannelMirror(db, f.bo.id, {
      organizationId: f.organizationId,
      channelId: f.channelId,
      messageId: failing.id,
    }),
    { retried: 1 },
  );
  await drain(f.fake, f.slack);
  assert.equal(f.fake.messages(f.slackChannel).length, 2);
  // Backoff for transient failures grows with attempts.
  const { backoff } = await import("@lictory/core/channels/slack/outbound");
  assert.ok(backoff(1) < backoff(2) && backoff(2) < backoff(3));
  assert.equal(backoff(30), 10 * 60_000);
});

void test("an agent mention from Slack works only for a mapped person allowed to use the agent", async () => {
  const f = await connected();
  const forge: ChannelAgent = {
    id: crypto.randomUUID(),
    handle: "forge",
    name: "Forge",
    ownerId: f.ada.id,
  };
  agents.push(forge);
  mentions.length = 0;
  mayAddress = undefined;
  // Ada owns Forge: her Slack mention reaches it, as her.
  await f.fake.say({
    channel: f.slackChannel,
    user: "UADA",
    text: "@forge please draft the refund spec",
  });
  // Bo is a member but Forge is Ada's private agent: text only.
  await f.fake.say({
    channel: f.slackChannel,
    user: "UBO",
    text: "@forge do it anyway",
  });
  // A guest, even typing Lictory's own token, addresses nobody.
  await f.fake.say({
    channel: f.slackChannel,
    user: "UGUEST",
    text: `@[forge](agent:${forge.id}) ship to prod`,
  });
  await drain(f.fake, f.slack);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0]!.mentionedById, f.ada.id);
  assert.deepEqual(mentions[0]!.agentIds, [forge.id]);
  const [byAda, byBo, byGuest] = await messagesOf(f.channelId);
  assert.equal(
    byAda!.body,
    `@[forge](agent:${forge.id}) please draft the refund spec`,
  );
  assert.equal(byBo!.body, "@forge do it anyway");
  assert.equal(byGuest!.body, `@\\[forge](agent:${forge.id}) ship to prod`);
  assert.equal(
    (
      await db
        .select()
        .from(s.channelMention)
        .where(eq(s.channelMention.messageId, byGuest!.id))
    ).length,
    0,
  );
  // The Factory's rule (shared agents) widens it through the port.
  mayAddress = async (_tx, _org, userId, agent) =>
    agent.ownerId === userId || userId === f.bo.id;
  await f.fake.say({
    channel: f.slackChannel,
    user: "UBO",
    text: "@forge now with permission",
  });
  await drain(f.fake, f.slack);
  assert.equal(mentions.length, 2);
  assert.equal(mentions[1]!.mentionedById, f.bo.id);
  mayAddress = undefined;
  agents.length = 0;
});

void test("Slack messages are withheld from Lictory Intelligence unless an administrator allows it", async () => {
  const f = await connected();
  await f.fake.say({
    channel: f.slackChannel,
    user: "UGUEST",
    text: "Confidential customer detail",
  });
  await drain(f.fake, f.slack);
  const read = async (surface: "agent" | "mcp") =>
    (await invoke(
      { db, principal: { userId: f.ada.id, surface }, effects: noEffects },
      "readChannel",
      { organizationId: f.organizationId, channelId: f.channelId },
    )) as {
      messages: { body: string; author: { kind: string; name: string } }[];
    };
  const litto = await read("agent");
  const slackMessage = litto.messages.find(
    (m) => m.author.kind === "external",
  )!;
  assert.match(slackMessage.body, /withheld from Lictory Intelligence/);
  assert.equal(slackMessage.author.name, "Ines (Slack)");
  // A person's own MCP client reads what the person reads.
  const mcp = await read("mcp");
  assert.equal(
    mcp.messages.find((m) => m.author.kind === "external")!.body,
    "Confidential customer detail",
  );
  // Allowed, but the AI policy is off: still withheld.
  await setSlackIntelligenceReads(db, f.owner.id, {
    organizationId: f.organizationId,
    allowed: true,
  });
  assert.match(
    (await read("agent")).messages.find((m) => m.author.kind === "external")!
      .body,
    /withheld/,
  );
  await f.run(f.owner.id, { type: "setAiPolicy", enabled: true });
  assert.equal(
    (await read("agent")).messages.find((m) => m.author.kind === "external")!
      .body,
    "Confidential customer detail",
  );
  await rejectsWith(
    setSlackIntelligenceReads(db, f.ada.id, {
      organizationId: f.organizationId,
      allowed: false,
    }),
    "forbidden",
  );
});

void test("connecting and linking are guarded: administrators, matching privacy, the bot in the channel", async () => {
  const f = await connected();
  await rejectsWith(
    saveSlackApp(db, f.ada.id, {
      organizationId: f.organizationId,
      appId: "A0OTHER01",
      clientId: "1.2",
      clientSecret: "x",
      signingSecret: "y",
    }),
    "validation",
  );
  await rejectsWith(
    saveSlackApp(db, f.ada.id, {
      organizationId: f.organizationId,
      appId: "A0OTHER01",
      clientId: "1234567.7654321",
      clientSecret: "0123456789abcdef0123456789abcdef",
      signingSecret: "0123456789abcdef0123456789abcdef",
    }),
    "forbidden",
  );
  // Slack checks the Client ID and Secret on save; a wrong one is named.
  const wrong = (input: { clientId?: string; clientSecret?: string }) =>
    saveSlackApp(
      db,
      f.owner.id,
      {
        organizationId: f.organizationId,
        appId: f.fake.app.appId,
        clientId: input.clientId ?? f.fake.app.clientId,
        clientSecret: input.clientSecret ?? f.fake.app.clientSecret,
        signingSecret: f.fake.app.signingSecret,
      },
      { client: f.slack },
    );
  await assert.rejects(wrong({ clientId: "1234567.7654321" }), {
    category: "validation",
    message: /Slack does not know this Client ID/,
  });
  await assert.rejects(
    wrong({ clientSecret: "0123456789abcdef0123456789abcdef" }),
    { category: "validation", message: /Slack refused the Client Secret/ },
  );
  await assert.rejects(
    saveSlackApp(
      db,
      f.owner.id,
      {
        organizationId: f.organizationId,
        appId: f.fake.app.appId,
        clientId: f.fake.app.clientId,
        clientSecret: f.fake.app.clientSecret,
        signingSecret: "not-hex",
      },
      { client: f.slack },
    ),
    {
      category: "validation",
      message: /The Signing Secret is not in Slack's format/,
    },
  );
  await rejectsWith(
    startSlackInstall(db, f.ada.id, f.organizationId),
    "forbidden",
  );
  // A state from another person or a replayed one is refused.
  const { url: started } = await startSlackInstall(
    db,
    f.owner.id,
    f.organizationId,
  );
  const state = new URL(started).searchParams.get("state")!;
  await rejectsWith(
    completeSlackInstall(db, f.slack, { userId: f.ada.id, state, code: "x" }),
    "validation",
  );
  const manifest = slackAppManifest(f.organizationId, "Workspace");
  assert.equal(
    manifest.settings.event_subscriptions.request_url.endsWith(
      `/api/slack/events/${f.organizationId}`,
    ),
    true,
  );
  assert.ok(manifest.oauth_config.scopes.bot.includes("chat:write.customize"));
  assert.ok(
    manifest.oauth_config.redirect_urls[0]!.endsWith(
      "/api/slack/oauth/callback",
    ),
  );

  // Only channels the bot is in are offered and linkable.
  f.fake.addChannel({ id: "C0NOBOT", name: "random", botMember: false });
  f.fake.addChannel({ id: "G0SECRET", name: "leadership", isPrivate: true });
  const listed = await listSlackChannels(
    db,
    f.slack,
    f.ada.id,
    f.organizationId,
  );
  assert.deepEqual(
    listed.channels.map((c) => [c.name, c.linked]),
    [
      ["general", true],
      ["leadership", false],
    ],
  );
  const channelId = crypto.randomUUID();
  await f.run(f.ada.id, {
    type: "createChannel",
    channelId,
    kind: "public",
    name: "payments",
    memberIds: [],
  });
  await rejectsWith(
    linkSlackChannel(db, f.slack, f.ada.id, {
      organizationId: f.organizationId,
      channelId,
      slackChannelId: "C0NOBOT",
    }),
    "validation",
  );
  // Public in Lictory, private in Slack: refused both ways.
  await rejectsWith(
    linkSlackChannel(db, f.slack, f.ada.id, {
      organizationId: f.organizationId,
      channelId,
      slackChannelId: "G0SECRET",
    }),
    "validation",
  );
  // Already linked elsewhere.
  await assert.rejects(
    linkSlackChannel(db, f.slack, f.ada.id, {
      organizationId: f.organizationId,
      channelId,
      slackChannelId: f.slackChannel,
    }),
    /already linked/,
  );
  // Bo is not a member of #payments and is no administrator.
  f.fake.addChannel({ id: "C0PAY", name: "payments" });
  await rejectsWith(
    linkSlackChannel(db, f.slack, f.bo.id, {
      organizationId: f.organizationId,
      channelId,
      slackChannelId: "C0PAY",
    }),
    "forbidden",
  );
  await linkSlackChannel(db, f.slack, f.ada.id, {
    organizationId: f.organizationId,
    channelId,
    slackChannelId: "C0PAY",
  });
  const audit = await db
    .select()
    .from(s.auditEvent)
    .where(eq(s.auditEvent.organizationId, f.organizationId));
  assert.ok(
    audit.some(
      (a) => a.action === "slack.channel_linked" && a.targetId === channelId,
    ),
  );
  assert.ok(audit.some((a) => a.action === "slack.installed"));
});

void test("unlinking and disconnecting stop the sync and keep both histories", async () => {
  const f = await connected();
  await f.fake.say({
    channel: f.slackChannel,
    user: "UADA",
    text: "Before unlinking",
  });
  await drain(f.fake, f.slack);
  await unlinkSlackChannel(db, f.ada.id, {
    organizationId: f.organizationId,
    channelId: f.channelId,
  });
  const [channel] = await db
    .select()
    .from(s.channel)
    .where(eq(s.channel.id, f.channelId));
  assert.equal(channel!.externalSource, null);
  const links = await db
    .select()
    .from(s.channelExternalLink)
    .where(eq(s.channelExternalLink.channelId, f.channelId));
  assert.ok(links[0]!.unlinkedAt);
  await db.transaction((tx) =>
    postMessage(
      tx,
      { userId: f.ada.id },
      {
        organizationId: f.organizationId,
        channelId: f.channelId,
        body: "Stays in Lictory",
      },
    ),
  );
  await f.fake.say({
    channel: f.slackChannel,
    user: "UADA",
    text: "Stays in Slack",
  });
  await drain(f.fake, f.slack);
  assert.deepEqual(
    (await messagesOf(f.channelId)).map((m) => m.body),
    ["Before unlinking", "Stays in Lictory"],
  );
  assert.ok(
    !f.fake.messages(f.slackChannel).some((m) => m.text === "Stays in Lictory"),
  );
  // The Slack-written message keeps its owner after the link is gone.
  const [old] = await messagesOf(f.channelId);
  assert.equal(old!.externalSource, "slack");

  // Relink, then disconnect: links end, the token is revoked and forgotten.
  await linkSlackChannel(db, f.slack, f.owner.id, {
    organizationId: f.organizationId,
    channelId: f.channelId,
    slackChannelId: f.slackChannel,
  });
  await disconnectSlack(db, f.slack, f.owner.id, f.organizationId);
  const [installation] = await db
    .select()
    .from(s.slackInstallation)
    .where(eq(s.slackInstallation.organizationId, f.organizationId));
  assert.equal(installation!.status, "disconnected");
  assert.equal(installation!.encryptedBotToken, null);
  assert.ok(f.fake.calls.some((c) => c.method === "auth.revoke"));
  assert.equal(
    (
      await db
        .select()
        .from(s.channelExternalLink)
        .where(
          and(
            eq(s.channelExternalLink.organizationId, f.organizationId),
            isNull(s.channelExternalLink.unlinkedAt),
          ),
        )
    ).length,
    0,
  );
  // Events after disconnecting are acknowledged and dropped.
  const late = await f.fake.say({
    channel: f.slackChannel,
    user: "UADA",
    text: "after disconnect",
  });
  assert.equal(late.event?.status, 200);
  assert.equal(
    (
      await db
        .select()
        .from(s.slackEvent)
        .where(
          and(
            eq(s.slackEvent.organizationId, f.organizationId),
            eq(s.slackEvent.eventId, late.event.eventId),
          ),
        )
    ).length,
    0,
  );
});

void test("a link can import a bounded number of earlier Slack messages once", async () => {
  const f = await connected();
  const slackChannel = "C0HISTORY";
  f.fake.addChannel({ id: slackChannel, name: "history" });
  // Earlier messages, before any link (no events reach Lictory for them).
  f.fake.setEventsUrl("https://lictory.test/api/slack/events/nowhere");
  for (const text of ["one", "two", "three"])
    await f.fake.say({ channel: slackChannel, user: "UADA", text });
  const thread = (
    f.fake.messages(slackChannel) as { ts: string; text: string }[]
  ).find((m) => m.text === "three")!;
  await f.fake.say({
    channel: slackChannel,
    user: "UGUEST",
    text: "reply to three",
    threadTs: thread.ts,
  });
  f.fake.setEventsUrl(eventsUrl(f.organizationId));
  const channelId = crypto.randomUUID();
  await f.run(f.ada.id, {
    type: "createChannel",
    channelId,
    kind: "public",
    name: "history",
    memberIds: [],
  });
  await linkSlackChannel(db, f.slack, f.ada.id, {
    organizationId: f.organizationId,
    channelId,
    slackChannelId: slackChannel,
    backfill: 2,
  });
  const first = await processSlackBackfills(db, f.slack);
  assert.equal(first.imported, 3);
  assert.deepEqual(
    (await messagesOf(channelId)).map((m) => m.body),
    ["two", "three", "reply to three"],
  );
  const again = await processSlackBackfills(db, f.slack);
  assert.equal(again.imported, 0);
  // Imported messages never echo back.
  await drain(f.fake, f.slack);
  assert.equal(f.fake.messages(slackChannel).length, 4);
});

void test("mrkdwn and Markdown convert both ways without carrying tokens", () => {
  const people = new Map([["U1", { userId: "lictory-1", name: "Ada" }]]);
  const md = slackToMarkdown(
    "Hi <@U1> and <@U2|bo>, see <https://example.com|the doc> in <#C1|general> ~old~ `<@U1> stays`",
    {
      user: (id) => people.get(id) ?? { userId: null, name: id },
      agent: () => null,
    },
  );
  assert.equal(
    md,
    "Hi @[Ada](mention:lictory-1) and @U2, see [the doc](https://example.com) in #general ~~old~~ `<@U1> stays`",
  );
  assert.equal(
    markdownToSlack(
      "**Bold** and *it* [link](https://x.test) @[Ada](mention:lictory-1) `**code**` 1 < 2",
      {
        slackUser: (id) => (id === "lictory-1" ? "U1" : null),
      },
    ),
    "*Bold* and _it_ <https://x.test|link> <@U1> `**code**` 1 &lt; 2",
  );
});
