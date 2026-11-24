import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation, type Actor } from "@lictory/core/domain/service";
import type { DomainError } from "@lictory/core/domain/errors";
import { invoke } from "@lictory/core/capabilities/registry";
import {
  noEffects,
  type CapabilityError,
} from "@lictory/core/capabilities/core";
import { drainNotifications } from "@lictory/core/notifications/drain.test-helper";
import { createNotificationService } from "@lictory/core/notifications/service";
import { describeNotification } from "@lictory/core/notifications/format";
import {
  deleteMessage,
  editMessage,
  markChannelRead,
  postMessage,
  reactToMessage,
  updateThreadParticipation,
} from "@lictory/core/channels/writer";
import {
  attentionCounts,
  listChannels,
  readChannel,
  readThread,
  searchMessages,
} from "@lictory/core/channels/reads";
import { promoteMessage } from "@lictory/core/channels/promotion";
import { unreadMessages } from "@lictory/core/channels/shared";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_channels_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

// An organization with an administrator and three members, a project, and a
// second organization with its own member.
async function fixture() {
  const [owner, ada, bo, cy, outsider] = await Promise.all(
    ["Owner", "Ada", "Bo", "Cy", "Outsider"].map(user),
  );
  const organizationId = await organization([
    [owner!, "owner"],
    [ada!, "member"],
    [bo!, "member"],
    [cy!, "member"],
  ]);
  const otherOrganizationId = await organization([[outsider!, "owner"]]);
  const run = (actor: string, command: Command, id = crypto.randomUUID()) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id, organizationId, command },
    );
  const projectId = crypto.randomUUID();
  await run(owner!, {
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  // Ada edits specifications in the project (Product).
  const [product] = await db
    .select({ id: s.discipline.id })
    .from(s.discipline)
    .where(
      and(
        eq(s.discipline.projectId, projectId),
        eq(s.discipline.name, "Product"),
      ),
    );
  await run(owner!, {
    type: "setDisciplineMember",
    projectId,
    disciplineId: product!.id,
    userId: ada!,
    member: true,
  });
  const channel = async (
    actor: string,
    name: string,
    kind: "public" | "private" = "public",
    memberIds: string[] = [],
  ) => {
    const channelId = crypto.randomUUID();
    await run(actor, {
      type: "createChannel",
      channelId,
      kind,
      name,
      memberIds,
    });
    return channelId;
  };
  const post = (
    actor: string,
    channelId: string,
    body: string,
    extra: {
      threadRootId?: string;
      messageId?: string;
      clientMessageId?: string;
    } = {},
  ) =>
    db.transaction((tx) =>
      postMessage(
        tx,
        { userId: actor },
        { organizationId, channelId, body, ...extra },
      ),
    );
  return {
    organizationId,
    otherOrganizationId,
    projectId,
    owner: owner!,
    ada: ada!,
    bo: bo!,
    cy: cy!,
    outsider: outsider!,
    run,
    channel,
    post,
  };
}

async function refused(
  promise: Promise<unknown>,
  category: string,
  pattern?: RegExp,
) {
  await assert.rejects(promise, (error: unknown) => {
    const e = error as DomainError | CapabilityError;
    assert.equal(e.category, category, (e as Error).message);
    if (pattern) assert.match((e as Error).message, pattern);
    return true;
  });
}

const call = (userId: string, name: string, input: unknown) =>
  invoke(
    {
      db,
      principal: { userId, surface: "mcp", access: "write" },
      effects: noEffects,
    },
    name,
    input,
  );

void test("public channels are readable by the organization and writable by members only", async () => {
  const f = await fixture();
  const general = await f.channel(f.ada, "general");
  await refused(
    f.run(f.bo, {
      type: "createChannel",
      channelId: crypto.randomUUID(),
      kind: "public",
      name: "general",
    }),
    "conflict",
    /already exists/,
  );
  await f.post(f.ada, general, "Hello team");
  // Bo is no member: reads, but must join to post.
  const view = await readChannel(db, f.bo, {
    organizationId: f.organizationId,
    channelId: general,
  });
  assert.deepEqual(
    view.messages.map((m) => m.body),
    ["Hello team"],
  );
  assert.equal(view.channel.member, false);
  await refused(f.post(f.bo, general, "Hi"), "forbidden", /Join #general/);
  await f.run(f.bo, { type: "joinChannel", channelId: general });
  const { message } = await f.post(f.bo, general, "Hi");
  assert.equal(message.sequence, 2);
  // Someone joining later starts with everything read.
  await f.run(f.cy, { type: "joinChannel", channelId: general });
  const [cy] = await listChannels(db, f.cy, {
    organizationId: f.organizationId,
    joinedOnly: true,
  });
  assert.equal(cy?.unreadMessages, 0);
  // Another organization's member cannot see it at all.
  await refused(
    readChannel(db, f.outsider, {
      organizationId: f.organizationId,
      channelId: general,
    }),
    "forbidden",
  );
  await refused(
    f
      .run(f.outsider, { type: "joinChannel", channelId: general })
      .catch((e) => {
        throw e;
      }),
    "forbidden",
  );
  // The channel id is useless inside the other organization too.
  await refused(
    readChannel(db, f.outsider, {
      organizationId: f.otherOrganizationId,
      channelId: general,
    }),
    "not_found",
  );
});

void test("private channels and direct conversations do not exist for non-members", async () => {
  const f = await fixture();
  const secret = await f.channel(f.ada, "incident", "private", [f.bo]);
  await f.post(f.ada, secret, "The breach timeline");
  for (const attempt of [
    () =>
      readChannel(db, f.cy, {
        organizationId: f.organizationId,
        channelId: secret,
      }),
    () => f.post(f.cy, secret, "let me in"),
    () => f.run(f.cy, { type: "joinChannel", channelId: secret }),
    () => f.run(f.cy, { type: "updateChannel", channelId: secret, topic: "x" }),
    // Administrators who are not members cannot read a private channel.
    () =>
      readChannel(db, f.owner, {
        organizationId: f.organizationId,
        channelId: secret,
      }),
    () =>
      call(f.cy, "listAttachments", {
        organizationId: f.organizationId,
        channelId: secret,
      }),
  ])
    await refused(attempt(), "not_found");
  const messages = await readChannel(db, f.ada, {
    organizationId: f.organizationId,
    channelId: secret,
  });
  const [first] = messages.messages;
  await refused(
    db.transaction((tx) =>
      reactToMessage(
        tx,
        { userId: f.cy },
        {
          organizationId: f.organizationId,
          channelId: secret,
          messageId: first!.id,
          emoji: "👍",
          add: true,
        },
      ),
    ),
    "not_found",
  );
  const listed = await listChannels(db, f.cy, {
    organizationId: f.organizationId,
  });
  assert.ok(!listed.some((c) => c.id === secret));
  assert.deepEqual(
    (
      await searchMessages(db, f.cy, {
        organizationId: f.organizationId,
        query: "breach",
      })
    ).results,
    [],
  );
  assert.equal(
    (
      await searchMessages(db, f.bo, {
        organizationId: f.organizationId,
        query: "breach",
      })
    ).results.length,
    1,
  );
  // The last person cannot leave a private channel behind.
  await f.run(f.bo, { type: "leaveChannel", channelId: secret });
  await refused(
    f.run(f.ada, { type: "leaveChannel", channelId: secret }),
    "conflict",
    /last person/,
  );
  await refused(
    readChannel(db, f.bo, {
      organizationId: f.organizationId,
      channelId: secret,
    }),
    "not_found",
  );

  // Direct conversations: opening the same members finds the same one.
  const first1 = await call(f.ada, "openDirectConversation", {
    organizationId: f.organizationId,
    userIds: [f.bo],
  });
  const again = await call(f.bo, "openDirectConversation", {
    organizationId: f.organizationId,
    userIds: [f.ada],
  });
  const dm = (first1 as { channelId: string }).channelId;
  assert.equal((again as { channelId: string }).channelId, dm);
  await f.post(f.ada, dm, "Quick question");
  await refused(
    readChannel(db, f.cy, { organizationId: f.organizationId, channelId: dm }),
    "not_found",
  );
  await refused(
    f.run(f.ada, { type: "leaveChannel", channelId: dm }),
    "validation",
  );
  await refused(
    f.run(f.ada, { type: "setChannelArchived", channelId: dm, archived: true }),
    "validation",
  );
  await refused(
    call(f.ada, "openDirectConversation", {
      organizationId: f.organizationId,
      userIds: [f.outsider],
    }),
    "validation",
  );
});

void test("concurrent sends get unique, gap-free sequences in commit order", async () => {
  const f = await fixture();
  const busy = await f.channel(f.ada, "busy");
  for (const person of [f.bo, f.cy])
    await f.run(person, { type: "joinChannel", channelId: busy });
  const people = [f.ada, f.bo, f.cy];
  const sent = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      f.post(people[i % 3]!, busy, `message ${i}`),
    ),
  );
  const sequences = sent.map((r) => r.message.sequence).sort((a, b) => a - b);
  assert.deepEqual(
    sequences,
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  const rows = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.channelId, busy))
    .orderBy(asc(s.channelMessage.sequence));
  // Root positions follow sequences: unread arithmetic counts them.
  assert.deepEqual(
    rows.map((r) => r.rootIndex),
    rows.map((_, i) => i + 1),
  );
  // Created in sequence order: a later sequence never committed earlier.
  for (let i = 1; i < rows.length; i++)
    assert.ok(rows[i]!.createdAt.getTime() >= rows[i - 1]!.createdAt.getTime());
  const [counter] = await db
    .select()
    .from(s.channel)
    .where(eq(s.channel.id, busy));
  assert.equal(counter!.lastSequence, 30);
  assert.equal(counter!.rootCount, 30);
});

void test("sending is idempotent by message id and retry key", async () => {
  const f = await fixture();
  const room = await f.channel(f.ada, "room");
  await f.run(f.bo, { type: "joinChannel", channelId: room });
  const messageId = crypto.randomUUID();
  const first = await f.post(f.ada, room, "Once", { messageId });
  const retry = await f.post(f.ada, room, "Once", { messageId });
  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.message.sequence, first.message.sequence);
  // Someone else cannot claim the id.
  await refused(f.post(f.bo, room, "Mine", { messageId }), "conflict");
  const agentRetry = await call(f.ada, "postChannelMessage", {
    organizationId: f.organizationId,
    channelId: room,
    body: "From an agent",
    clientMessageId: "run-7:step-3",
  });
  const again = await call(f.ada, "postChannelMessage", {
    organizationId: f.organizationId,
    channelId: room,
    body: "From an agent",
    clientMessageId: "run-7:step-3",
  });
  assert.equal(
    (again as { messageId: string }).messageId,
    (agentRetry as { messageId: string }).messageId,
  );
  assert.equal((again as { replayed: boolean }).replayed, true);
  const rows = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.channelId, room));
  assert.equal(rows.length, 2);
  // An MCP call is the person's message, shown with the agent it came via.
  const viaAgent = rows.find((r) => r.clientMessageId === "run-7:step-3");
  assert.equal(viaAgent?.authorUserId, f.ada);
  assert.equal(viaAgent?.via, "mcp");
});

void test("edits keep revisions and deletions leave tombstones with their thread", async () => {
  const f = await fixture();
  const room = await f.channel(f.ada, "design");
  await f.run(f.bo, { type: "joinChannel", channelId: room });
  const { message: root } = await f.post(
    f.ada,
    room,
    "Retries reuse the transaction id",
  );
  const { message: reply } = await f.post(f.bo, room, "Agreed", {
    threadRootId: root.id,
  });
  const scope = { organizationId: f.organizationId, channelId: room };
  await refused(
    db.transaction((tx) =>
      editMessage(
        tx,
        { userId: f.bo },
        { ...scope, messageId: root.id, body: "hijack" },
      ),
    ),
    "forbidden",
  );
  await db.transaction((tx) =>
    editMessage(
      tx,
      { userId: f.ada },
      {
        ...scope,
        messageId: root.id,
        body: "Retries reuse the original transaction id",
      },
    ),
  );
  await refused(
    db.transaction((tx) =>
      deleteMessage(tx, { userId: f.bo }, { ...scope, messageId: root.id }),
    ),
    "forbidden",
  );
  await db.transaction((tx) =>
    reactToMessage(
      tx,
      { userId: f.bo },
      { ...scope, messageId: root.id, emoji: "👍", add: true },
    ),
  );
  await db.transaction((tx) =>
    deleteMessage(tx, { userId: f.ada }, { ...scope, messageId: root.id }),
  );
  const thread = await readThread(db, f.bo, {
    ...scope,
    rootMessageId: root.id,
  });
  assert.equal(thread.root.body, "");
  assert.ok(thread.root.deletedAt);
  assert.equal(thread.root.sequence, root.sequence);
  assert.deepEqual(
    thread.replies.map((r) => r.id),
    [reply.id],
  );
  assert.deepEqual(thread.root.reactions, [
    { emoji: "👍", count: 1, mine: true },
  ]);
  const revisions = await db
    .select()
    .from(s.channelMessageRevision)
    .where(eq(s.channelMessageRevision.messageId, root.id))
    .orderBy(asc(s.channelMessageRevision.createdAt));
  assert.deepEqual(
    revisions.map((r) => [r.reason, r.body]),
    [
      ["edited", "Retries reuse the transaction id"],
      ["deleted", "Retries reuse the original transaction id"],
    ],
  );
  // Deleted text is no longer found; administrators moderate others'.
  assert.equal(
    (
      await searchMessages(db, f.bo, {
        organizationId: f.organizationId,
        query: "transaction",
      })
    ).results.length,
    0,
  );
  await db.transaction((tx) =>
    deleteMessage(tx, { userId: f.owner }, { ...scope, messageId: reply.id }),
  );
  // External messages belong to their system.
  await db
    .update(s.channelMessage)
    .set({ externalSource: "slack", externalId: "1700000000.0001" })
    .where(eq(s.channelMessage.id, reply.id));
  const { message: mine } = await f.post(f.bo, room, "From Slack later");
  await db
    .update(s.channelMessage)
    .set({ externalSource: "slack", externalId: "1700000000.0002" })
    .where(eq(s.channelMessage.id, mine.id));
  await refused(
    db.transaction((tx) =>
      editMessage(
        tx,
        { userId: f.bo },
        { ...scope, messageId: mine.id, body: "x" },
      ),
    ),
    "conflict",
    /written in slack/,
  );
  // Archived channels are read-only but keep everything.
  await f.run(f.ada, {
    type: "setChannelArchived",
    channelId: room,
    archived: true,
  });
  await refused(f.post(f.ada, room, "after"), "conflict", /archived/);
  await f.run(f.ada, {
    type: "setChannelArchived",
    channelId: room,
    archived: false,
  });
  await f.post(f.ada, room, "back");
  const bodies = (await readChannel(db, f.bo, scope)).messages.map((m) => [
    m.kind,
    m.body,
  ]);
  assert.deepEqual(bodies.slice(-3), [
    ["system", "archived the channel"],
    ["system", "restored the channel"],
    ["message", "back"],
  ]);
});

void test("read cursors make unread counts arithmetic, with unread mentions", async () => {
  const f = await fixture();
  const room = await f.channel(f.ada, "eng");
  await f.run(f.bo, { type: "joinChannel", channelId: room });
  const scope = { organizationId: f.organizationId, channelId: room };
  const { message: m1 } = await f.post(f.ada, room, "one");
  await f.post(f.ada, room, `two @[Bo](mention:${f.bo})`);
  // A reply does not count as an unread channel message.
  await f.post(f.ada, room, "reply", { threadRootId: m1.id });
  const { message: m3 } = await f.post(
    f.ada,
    room,
    `three @[Bo](mention:${f.bo})`,
  );
  const counts = async () => {
    const [channel] = await listChannels(db, f.bo, {
      ...scope,
      joinedOnly: true,
    });
    return [channel!.unreadMessages, channel!.unreadMentions];
  };
  assert.deepEqual(await counts(), [3, 2]);
  const markRead = (sequence: number, unread = false) =>
    db.transaction((tx) =>
      markChannelRead(tx, { userId: f.bo }, { ...scope, sequence, unread }),
    );
  await markRead(2);
  assert.deepEqual(await counts(), [1, 1]);
  // A stale tab never marks newer messages unread...
  await markRead(1);
  assert.deepEqual(await counts(), [1, 1]);
  await markRead(m3.sequence);
  assert.deepEqual(await counts(), [0, 0]);
  // ...but "mark unread" moves the cursor back on purpose.
  await markRead(m1.sequence, true);
  assert.deepEqual(await counts(), [2, 2]);
  const [row] = await db
    .select()
    .from(s.channelMember)
    .where(
      and(
        eq(s.channelMember.channelId, room),
        eq(s.channelMember.userId, f.bo),
      ),
    );
  const [channel] = await db
    .select()
    .from(s.channel)
    .where(eq(s.channel.id, room));
  assert.equal(unreadMessages(channel!, row), 2);
  // Posting at the bottom marks the channel read for its author.
  await f.post(f.bo, room, "caught up");
  assert.deepEqual(await counts(), [0, 0]);
  // The badge counts mentions and direct messages, never channel traffic.
  const dm = (
    (await call(f.ada, "openDirectConversation", {
      organizationId: f.organizationId,
      userIds: [f.bo],
    })) as { channelId: string }
  ).channelId;
  await f.post(f.ada, room, "noise");
  await f.post(f.ada, dm, "ping");
  await f.post(f.ada, dm, `ping @[Bo](mention:${f.bo})`);
  const badge = await attentionCounts(db, f.bo);
  assert.deepEqual(
    badge.organizations.map((o) => [o.mentions, o.directMessages]),
    [[0, 2]],
  );
  // Threads: replies after the participant's cursor.
  await db.transaction((tx) =>
    updateThreadParticipation(
      tx,
      { userId: f.bo },
      { ...scope, rootMessageId: m1.id, following: true },
    ),
  );
  await f.post(f.ada, room, "another reply", { threadRootId: m1.id });
  const [participant] = await db
    .select()
    .from(s.channelThreadParticipant)
    .where(
      and(
        eq(s.channelThreadParticipant.rootMessageId, m1.id),
        eq(s.channelThreadParticipant.userId, f.bo),
      ),
    );
  const [root] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, m1.id));
  assert.equal(root!.replyCount - participant!.readReplyCount, 1);
});

void test("notifications go to mentions, direct messages and thread participants, never ordinary traffic", async () => {
  const f = await fixture();
  const inbox = createNotificationService(db);
  const kinds = async (userId: string) =>
    (await inbox.list(userId, { organizationId: f.organizationId })).items.map(
      (n) => n.kind,
    );
  const room = await f.channel(f.ada, "general");
  for (const person of [f.bo, f.cy])
    await f.run(person, { type: "joinChannel", channelId: room });
  const { message: root } = await f.post(f.ada, room, "Plain announcement");
  await drainNotifications(db);
  assert.deepEqual(await kinds(f.bo), []);
  await f.post(f.ada, room, `@[Bo](mention:${f.bo}) can you check?`);
  await f.post(f.bo, room, "On it", { threadRootId: root.id });
  await drainNotifications(db);
  assert.deepEqual(await kinds(f.bo), ["channel_mentioned"]);
  // Ada started the thread: Bo's reply tells her; Cy, not in it, hears nothing.
  assert.deepEqual(await kinds(f.ada), ["channel_thread_reply"]);
  assert.deepEqual(await kinds(f.cy), []);
  // Muting silences everything.
  await f.run(f.bo, {
    type: "setChannelNotificationLevel",
    channelId: room,
    level: "none",
  });
  await f.post(f.ada, room, `@[Bo](mention:${f.bo}) again`);
  // Choosing "all" opts in to channel traffic.
  await f.run(f.cy, {
    type: "setChannelNotificationLevel",
    channelId: room,
    level: "all",
  });
  await f.post(f.ada, room, "Everyone sees this");
  await drainNotifications(db);
  assert.deepEqual(await kinds(f.bo), ["channel_mentioned"]);
  assert.deepEqual(await kinds(f.cy), ["channel_message"]);

  // Mentioning someone who cannot read a private channel tells nobody.
  const secret = await f.channel(f.ada, "secret", "private", [f.bo]);
  await f.post(f.ada, secret, `@[Cy](mention:${f.cy}) look`);
  await f.post(f.ada, secret, `@[Bo](mention:${f.bo}) look`);
  await drainNotifications(db);
  assert.deepEqual(await kinds(f.cy), ["channel_message"]);
  assert.equal((await kinds(f.bo)).length, 2);
  // Leaving the channel hides its notifications (and their excerpts).
  await f.run(f.bo, { type: "leaveChannel", channelId: secret });
  assert.deepEqual(await kinds(f.bo), ["channel_mentioned"]);

  const dm = (
    (await call(f.cy, "openDirectConversation", {
      organizationId: f.organizationId,
      userIds: [f.ada],
    })) as { channelId: string }
  ).channelId;
  await f.post(f.cy, dm, "Lunch?");
  await drainNotifications(db);
  const [latest] = (
    await inbox.list(f.ada, { organizationId: f.organizationId })
  ).items;
  assert.equal(latest?.kind, "direct_message");
  assert.equal(latest?.detail.excerpt, "Lunch?");

  // Conversations digest: unread messages of one conversation are one
  // notification (the latest excerpt, how many); once read, the next starts
  // a new one.
  await f.post(f.cy, dm, "Or coffee?");
  await f.post(f.cy, dm, "Noon works.");
  await drainNotifications(db);
  const dms = async () =>
    (
      await inbox.list(f.ada, { organizationId: f.organizationId })
    ).items.filter((n) => n.kind === "direct_message");
  const [digest, ...others] = await dms();
  assert.equal(others.length, 0);
  assert.equal(digest?.detail.excerpt, "Noon works.");
  assert.equal(digest?.detail.count, 3);
  assert.equal(
    describeNotification(digest, "Cy").headline,
    "3 new messages, the latest from Cy",
  );
  await inbox.act(f.ada, { action: "markRead", ids: [digest.id] });
  await f.post(f.cy, dm, "See you there.");
  await drainNotifications(db);
  assert.equal((await dms()).length, 2);
  // Thread replies digest per thread.
  await f.post(f.bo, room, "Done.", { threadRootId: root.id });
  await drainNotifications(db);
  const replies = (
    await inbox.list(f.ada, { organizationId: f.organizationId })
  ).items.filter((n) => n.kind === "channel_thread_reply");
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.detail.count, 2);
  assert.equal(replies[0]?.detail.excerpt, "Done.");
});

void test("promotion creates the object, links both ways and replays", async () => {
  const f = await fixture();
  const room = await f.channel(f.ada, "payments");
  await f.run(f.bo, { type: "joinChannel", channelId: room });
  const { message } = await f.post(
    f.bo,
    room,
    "Customers want refunds over the API",
  );
  await f.post(f.ada, room, "Partial refunds too", {
    threadRootId: message.id,
  });
  const actor: Actor = { userId: f.ada };
  const mutationId = crypto.randomUUID();
  const source = {
    organizationId: f.organizationId,
    channelId: room,
    messageId: message.id,
    includeThread: true,
    mutationId,
  };
  const proposal = await promoteMessage(db, actor, source, {
    kind: "proposal",
    projectId: f.projectId,
    title: "Refunds over the API",
  });
  const [item] = await db
    .select()
    .from(s.workItem)
    .where(eq(s.workItem.id, proposal.workItemId));
  assert.equal(item?.title, "Refunds over the API");
  const [revision] = await db
    .select()
    .from(s.specificationRevision)
    .where(eq(s.specificationRevision.workItemId, proposal.workItemId));
  assert.match(revision!.content, /> Customers want refunds over the API/);
  assert.match(revision!.content, /> Partial refunds too/);
  assert.match(
    revision!.content,
    new RegExp(`channels/${room}\\?message=${message.id}`),
  );
  // The card sits in the thread and names the item.
  const thread = await readThread(db, f.bo, {
    organizationId: f.organizationId,
    channelId: room,
    rootMessageId: message.id,
  });
  const card = thread.replies.find((r) => r.kind === "card");
  assert.equal(card?.id, proposal.cardMessageId);
  assert.match(
    card?.body ?? "",
    new RegExp(`\\(item:${proposal.workItemId}\\)`),
  );
  assert.equal(card?.payload?.workItemId, proposal.workItemId);
  const [link] = await db
    .select()
    .from(s.channelPromotion)
    .where(eq(s.channelPromotion.workItemId, proposal.workItemId));
  assert.equal(link?.messageId, message.id);
  // A retry returns the first result and creates nothing.
  const retry = await promoteMessage(db, actor, source, {
    kind: "proposal",
    projectId: f.projectId,
    title: "Refunds over the API",
  });
  assert.equal(retry.replayed, true);
  assert.equal(retry.workItemId, proposal.workItemId);
  assert.equal(
    (
      await db
        .select()
        .from(s.workItem)
        .where(eq(s.workItem.projectId, f.projectId))
    ).length,
    1,
  );
  // Decisions and discussions land on the specification.
  const decision = await promoteMessage(
    db,
    actor,
    { ...source, includeThread: false, mutationId: crypto.randomUUID() },
    {
      kind: "decision",
      workItemId: proposal.workItemId,
      title: "Refunds reuse the original payment",
    },
  );
  const [recorded] = await db
    .select()
    .from(s.decision)
    .where(eq(s.decision.id, decision.decisionId!));
  assert.match(recorded!.body, /Customers want refunds/);
  const discussion = await promoteMessage(
    db,
    actor,
    { ...source, includeThread: false, mutationId: crypto.randomUUID() },
    {
      kind: "discussion",
      workItemId: proposal.workItemId,
      section: "",
      blocking: true,
      note: "What about partial refunds?",
    },
  );
  const [opened] = await db
    .select()
    .from(s.thread)
    .where(eq(s.thread.id, discussion.threadId!));
  assert.equal(opened?.blocking, true);
  // The decision capability is marked a person's decision.
  const { capabilities } = await import("@lictory/core/capabilities/registry");
  assert.equal(
    capabilities.find((c) => c.name === "promoteMessageToDecision")?.decision,
    true,
  );
  // People who cannot read the channel cannot promote from it; people
  // without the project's permission cannot create the proposal.
  const secret = await f.channel(f.bo, "secret", "private");
  const { message: hidden } = await f.post(f.bo, secret, "hidden");
  await refused(
    promoteMessage(
      db,
      actor,
      {
        organizationId: f.organizationId,
        channelId: secret,
        messageId: hidden.id,
      },
      { kind: "proposal", projectId: f.projectId, title: "Leak" },
    ),
    "not_found",
  );
  await refused(
    promoteMessage(
      db,
      { userId: f.cy },
      {
        organizationId: f.organizationId,
        channelId: room,
        messageId: message.id,
      },
      { kind: "proposal", projectId: f.projectId, title: "No permission" },
    ),
    "forbidden",
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.channelPromotion)
        .where(eq(s.channelPromotion.channelId, room))
    ).length,
    3,
  );
});

void test("reactions are idempotent and validated", async () => {
  const f = await fixture();
  const room = await f.channel(f.ada, "fun");
  const { message } = await f.post(f.ada, room, "Ship it");
  const scope = {
    organizationId: f.organizationId,
    channelId: room,
    messageId: message.id,
  };
  const react = (userId: string, emoji: string, add = true) =>
    db.transaction((tx) =>
      reactToMessage(tx, { userId }, { ...scope, emoji, add }),
    );
  assert.deepEqual(await react(f.bo, "🚀"), { changed: true });
  assert.deepEqual(await react(f.bo, "🚀"), { changed: false });
  // Reading a public channel is enough to react.
  await react(f.cy, "🚀");
  await refused(react(f.cy, "not an emoji"), "validation");
  const view = await readChannel(db, f.bo, {
    organizationId: f.organizationId,
    channelId: room,
  });
  assert.deepEqual(view.messages[0]?.reactions, [
    { emoji: "🚀", count: 2, mine: true },
  ]);
  assert.deepEqual(await react(f.bo, "🚀", false), { changed: true });
});
