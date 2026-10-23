import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import type { ChatMessage } from "@lictory/core/intelligence/chat/shared";
import {
  deleteChat,
  getChat,
  listChats,
  openChat,
  saveMessages,
  updateChat,
} from "@lictory/core/intelligence/chat/store";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_chat_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
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
async function organization() {
  const id = crypto.randomUUID();
  await db
    .insert(s.organization)
    .values({ id, name: "Org", slug: id, createdAt: new Date() });
  return id;
}
const text = (id: string, role: "user" | "assistant", value: string) =>
  ({ id, role, parts: [{ type: "text", text: value }] }) as ChatMessage;

void test("a conversation belongs to one person in one organization", async () => {
  const [alice, bob, orgA, orgB] = [
    await user("Alice"),
    await user("Bob"),
    await organization(),
    await organization(),
  ];
  const owner = { organizationId: orgA, userId: alice };
  const chatId = crypto.randomUUID();
  await openChat(db, owner, chatId);
  await saveMessages(db, owner, chatId, [text("m1", "user", "Draft PAY-1")]);

  for (const other of [
    { organizationId: orgA, userId: bob },
    { organizationId: orgB, userId: alice },
  ]) {
    // Reusing someone else's id never opens or reveals their chat.
    await assert.rejects(openChat(db, other, chatId), /not yours/);
    assert.equal(await getChat(db, other, chatId), null);
    assert.deepEqual(await listChats(db, other), []);
    assert.equal(await updateChat(db, other, chatId, { title: "x" }), null);
    assert.equal(await deleteChat(db, other, chatId), false);
    await saveMessages(db, other, chatId, []);
  }
  const mine = await getChat(db, owner, chatId);
  assert.equal(mine?.messages.length, 1);
  assert.equal((await listChats(db, owner))[0]?.preview, "Draft PAY-1");
});

void test("saving a turn replaces the transcript in order; delete removes it", async () => {
  const owner = {
    organizationId: await organization(),
    userId: await user("A"),
  };
  const chatId = crypto.randomUUID();
  await openChat(db, owner, chatId);
  await saveMessages(db, owner, chatId, [text("u1", "user", "Hi")]);
  await saveMessages(db, owner, chatId, [
    text("u1", "user", "Hi"),
    text("a1", "assistant", "Hello"),
    text("u2", "user", "Pin this"),
  ]);
  await updateChat(db, owner, chatId, { title: "Greeting", pinned: true });
  const found = await getChat(db, owner, chatId);
  assert.deepEqual(
    found?.messages.map((m) => m.id),
    ["u1", "a1", "u2"],
  );
  const [summary] = await listChats(db, owner);
  assert.equal(summary?.title, "Greeting");
  assert.equal(summary?.pinned, true);
  assert.equal(await deleteChat(db, owner, chatId), true);
  assert.equal(await getChat(db, owner, chatId), null);
});

void test("a dock conversation stays out of the history until it is continued on the page", async () => {
  const owner = {
    organizationId: await organization(),
    userId: await user("A"),
  };
  const chatId = crypto.randomUUID();
  await openChat(db, owner, chatId, { listed: false });
  await saveMessages(db, owner, chatId, [text("u1", "user", "Explain this")]);
  assert.deepEqual(await listChats(db, owner), []);
  // Opening the chat again never changes how it was created.
  await openChat(db, owner, chatId);
  assert.deepEqual(await listChats(db, owner), []);
  assert.equal((await getChat(db, owner, chatId))?.messages.length, 1);

  await updateChat(db, owner, chatId, { listed: true });
  assert.deepEqual(
    (await listChats(db, owner)).map((c) => c.id),
    [chatId],
  );
});

void test("the history shows which conversations wait for the person", async () => {
  const owner = {
    organizationId: await organization(),
    userId: await user("A"),
  };
  const question = (state: string) =>
    ({
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Which project?" },
        {
          type: "tool-askQuestions",
          toolCallId: "c1",
          state,
          input: { title: "Where?", questions: [] },
          ...(state === "output-available" ? { output: { answers: [] } } : {}),
        },
      ],
    }) as unknown as ChatMessage;
  const approval = {
    id: "a1",
    role: "assistant",
    parts: [
      {
        type: "tool-createWorkItem",
        toolCallId: "c2",
        state: "approval-requested",
        input: {},
        approval: { id: "ap1" },
      },
    ],
  } as unknown as ChatMessage;
  const [asking, approving, answered, replied] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  for (const id of [asking, approving, answered, replied])
    await openChat(db, owner, id);
  await saveMessages(db, owner, asking, [
    text("u1", "user", "Draft a story"),
    question("input-available"),
  ]);
  await saveMessages(db, owner, approving, [
    text("u1", "user", "Create it"),
    approval,
  ]);
  await saveMessages(db, owner, answered, [
    text("u1", "user", "Draft a story"),
    question("output-available"),
  ]);
  // Only the latest message counts: a newer message from the person moves on.
  await saveMessages(db, owner, replied, [
    text("u1", "user", "Draft a story"),
    question("input-available"),
    text("u2", "user", "Never mind"),
  ]);
  const waiting = new Map(
    (await listChats(db, owner)).map((c) => [c.id, c.awaitingInput]),
  );
  assert.equal(waiting.get(asking), true);
  assert.equal(waiting.get(approving), true);
  assert.equal(waiting.get(answered), false);
  assert.equal(waiting.get(replied), false);
});
