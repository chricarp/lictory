import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { chatGenerator } from "@lictory/core/intelligence/chat/step";
import * as s from "@lictory/core/db/schema";
import { noEffects } from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import { seedOrganization } from "@lictory/core/domain/organization";
import { processChatRuns } from "@lictory/core/intelligence/chat/runner";
import {
  cancelChatRun,
  checkpointChatRun,
  claimChatRun,
  ChatLeaseLost,
  submitChatRun,
  type ChatOwner,
} from "@lictory/core/intelligence/chat/runs";
import {
  getChatSnapshot,
  listChats,
  openChat,
  saveMessages,
} from "@lictory/core/intelligence/chat/store";
import type { ChatMessage } from "@lictory/core/intelligence/chat/shared";
import type { ChatGenerator } from "@lictory/core/intelligence/chat/step";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_chat_run_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const client = postgres(url.toString(), { max: 8, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
});

afterEach(async () => {
  await db
    .update(s.intelligenceChatRun)
    .set({ status: "canceled", leaseToken: null, leaseUntil: null })
    .where(
      sql`${s.intelligenceChatRun.status} in ('queued', 'running', 'waiting')`,
    );
});

const text = (value: string): ChatMessage["parts"][number] => ({
  type: "text",
  text: value,
});
const question = {
  title: "Scope",
  questions: [
    {
      id: "scope",
      prompt: "Which flows?",
      description: null,
      kind: "text",
      options: [],
      allowOther: false,
      required: true,
    },
  ],
};
const call = (toolCallId: string, tool: string, input: unknown) =>
  ({
    type: `tool-${tool}`,
    toolCallId,
    state: "input-available",
    input,
  }) as ChatMessage["parts"][number];
const context = (owner: ChatOwner) => ({
  db,
  principal: { userId: owner.userId, surface: "agent" as const },
  effects: noEffects,
});
const generate = (parts: ChatMessage["parts"]): ChatGenerator =>
  async function* ({ messages }) {
    const message = messages.at(-1)!;
    yield {
      ...message,
      parts: [...message.parts, { type: "step-start" }, ...parts],
    };
  };
async function fixture() {
  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const chatId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, email: `${userId}@example.test`, name: "Run owner" });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Run tests",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    userId,
    organizationId,
    role: "owner",
    createdAt: new Date(),
  });
  await seedOrganization(db, organizationId);
  await db
    .insert(s.organizationAiPolicy)
    .values({ organizationId, enabled: true, updatedById: userId })
    .onConflictDoUpdate({
      target: s.organizationAiPolicy.organizationId,
      set: { enabled: true },
    });
  const owner = { organizationId, userId };
  await openChat(db, owner, chatId);
  const requestId = crypto.randomUUID();
  const input = {
    requestId,
    message: {
      id: crypto.randomUUID(),
      role: "user" as const,
      parts: [text("Plan a change")],
    },
  };
  const snapshot = () => getChatSnapshot(db, owner, chatId);
  const work = (step: ChatGenerator = generate([text("Done")])) =>
    processChatRuns(db, { generate: step, context: () => context(owner) });
  return { owner, chatId, requestId, input, snapshot, work };
}

void test("submission survives duplicate requests and only one API can claim an active conversation", async () => {
  const f = await fixture();
  await Promise.all([
    submitChatRun(db, f.owner, f.chatId, f.input),
    submitChatRun(db, f.owner, f.chatId, f.input),
  ]);
  assert.equal(
    (await f.snapshot()).messages.filter((m) => m.role === "user").length,
    1,
  );
  await assert.rejects(
    submitChatRun(db, f.owner, f.chatId, {
      ...f.input,
      message: { ...f.input.message, parts: [text("Different")] },
    }),
    /already used/,
  );
  await assert.rejects(
    submitChatRun(db, f.owner, f.chatId, {
      ...f.input,
      requestId: crypto.randomUUID(),
      message: { ...f.input.message, id: crypto.randomUUID() },
    }),
    /still working/,
  );
  const claims = await Promise.all([claimChatRun(db), claimChatRun(db)]);
  assert.equal(claims.filter(Boolean).length, 1);
  await checkpointChatRun(
    db,
    claims.find(Boolean)!,
    {
      ...(claims.find(Boolean)!.checkpoint as ChatMessage),
      parts: [text("Done")],
    },
    { status: "completed" },
  );
});

void test("waiting questions and responses are durable, scoped and consumed once across devices", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  await f.work(generate([call("q1", "askQuestions", question)]));
  assert.equal((await f.snapshot()).run?.status, "waiting");
  assert.equal((await listChats(db, f.owner))[0]?.awaitingInput, true);
  assert.equal(
    (await processChatRuns(db, { generate: generate([]) })).claimed,
    0,
    "waiting owns no worker",
  );
  const reply = {
    requestId: crypto.randomUUID(),
    response: { toolCallId: "q1", output: { dismissed: true } },
  };
  const replies = [reply, { ...reply, requestId: crypto.randomUUID() }];
  const outcomes = await Promise.allSettled(
    replies.map((r) => submitChatRun(db, f.owner, f.chatId, r)),
  );
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  await submitChatRun(
    db,
    f.owner,
    f.chatId,
    replies[outcomes.findIndex((r) => r.status === "fulfilled")]!,
  );
  await f.work();
  assert.equal((await f.snapshot()).run?.status, "completed");
  const outsider = { ...f.owner, userId: crypto.randomUUID() };
  assert.equal((await getChatSnapshot(db, outsider, f.chatId)).chat, null);
  await assert.rejects(
    cancelChatRun(db, outsider, f.chatId, f.requestId),
    /unavailable/,
  );
});

void test("Stop arriving before submission survives and cannot cancel the next turn", async () => {
  const f = await fixture();
  await cancelChatRun(db, f.owner, f.chatId, f.requestId);
  await submitChatRun(db, f.owner, f.chatId, f.input);
  assert.equal((await f.snapshot()).run?.status, "canceled");
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: crypto.randomUUID(),
    message: { ...f.input.message, id: crypto.randomUUID() },
  });
  await cancelChatRun(db, f.owner, f.chatId, f.requestId);
  assert.equal((await f.snapshot()).run?.status, "queued");
  await f.work();
  assert.equal((await f.snapshot()).run?.status, "completed");
});

void test("expired ownership is fenced and a replacement restores the last checkpoint", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  const first = (await claimChatRun(db))!;
  await checkpointChatRun(
    db,
    first,
    { ...(first.checkpoint as ChatMessage), parts: [text("Unfinished text")] },
    { partial: true },
  );
  await db
    .update(s.intelligenceChatRun)
    .set({ leaseUntil: new Date(0) })
    .where(eq(s.intelligenceChatRun.id, first.id));
  const next = (await claimChatRun(db))!;
  assert.notEqual(next.leaseToken, first.leaseToken);
  assert.deepEqual((await f.snapshot()).messages.at(-1)?.parts, []);
  await assert.rejects(
    checkpointChatRun(db, first, {
      ...(first.checkpoint as ChatMessage),
      parts: [text("Late answer")],
    }),
    ChatLeaseLost,
  );
  await checkpointChatRun(
    db,
    next,
    { ...(next.checkpoint as ChatMessage), parts: [text("Recovered")] },
    { status: "completed" },
  );
});

void test("an actual killed worker loses only partial model output and its replacement completes", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  const source = `import {createJobDatabase} from '@lictory/core/jobs'; import {processChatRuns} from '@lictory/core/intelligence/chat/runner'; const {db}=createJobDatabase(process.env.DATABASE_URL,{max:3}); await processChatRuns(db,{generate:async function*({messages}){yield {...messages.at(-1),parts:[{type:'text',text:'Partial before crash'}]}; console.log('checkpoint-visible'); await new Promise(()=>{});}});`;
  const child = spawn(process.execPath, ["-e", source], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (c: Buffer) => (errors += c.toString()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`worker did not start: ${errors}`)),
        15_000,
      );
      child.stdout.on("data", (c: Buffer) => {
        if (c.toString().includes("checkpoint-visible")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`worker exited: ${errors}`));
      });
    });
    assert.equal(
      (await f.snapshot()).messages
        .at(-1)
        ?.parts.some((p) => p.type === "text" && p.text.includes("Partial")),
      true,
    );
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    await db
      .update(s.intelligenceChatRun)
      .set({ leaseUntil: new Date(0) })
      .where(eq(s.intelligenceChatRun.id, f.requestId));
    await f.work();
    const snapshot = await f.snapshot();
    assert.equal(snapshot.run?.status, "completed");
    assert.equal(
      JSON.stringify(snapshot.messages).includes("Partial before crash"),
      false,
    );
    assert.equal(JSON.stringify(snapshot.messages).includes("Done"), true);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
});

void test("a tool mutation committed before a lost result is replayed with its original identity", async () => {
  const f = await fixture();
  const projectId = crypto.randomUUID();
  await invoke(context(f.owner), "createProject", {
    organizationId: f.owner.organizationId,
    projectId,
    name: "Recovery",
    key: "RCV",
  });
  const [type] = await db
    .select()
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, f.owner.organizationId),
        eq(s.workItemType.name, "Task"),
      ),
    );
  await submitChatRun(db, f.owner, f.chatId, f.input);
  await db.execute(
    sql`create function fail_chat_result() returns trigger language plpgsql as $$ begin raise exception 'result storage unavailable'; end $$`,
  );
  await db.execute(
    sql`create trigger fail_chat_result before update on intelligence_chat_tool for each row execute function fail_chat_result()`,
  );
  let steps = 0;
  const model: ChatGenerator = async function* (input) {
    yield* generate(
      steps++ === 0
        ? [
            call("create-once", "createWorkItem", {
              projectId,
              typeId: type!.id,
              parentId: null,
              title: "Exactly one task",
            }),
          ]
        : [text("Created")],
    )(input);
  };
  try {
    await f.work(model);
  } finally {
    await db.execute(
      sql`drop trigger fail_chat_result on intelligence_chat_tool`,
    );
    await db.execute(sql`drop function fail_chat_result()`);
  }
  assert.equal((await f.snapshot()).run?.status, "failed");
  assert.equal(
    (
      await db
        .select()
        .from(s.workItem)
        .where(eq(s.workItem.projectId, projectId))
    ).length,
    1,
  );
  const [tool] = await db
    .select()
    .from(s.intelligenceChatTool)
    .where(eq(s.intelligenceChatTool.runId, f.requestId));
  assert.equal(tool?.completed, false);
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: crypto.randomUUID(),
    retry: true,
  });
  await f.work(generate([text("Created")]));
  assert.equal((await f.snapshot()).run?.status, "completed");
  assert.equal(
    (
      await db
        .select()
        .from(s.workItem)
        .where(eq(s.workItem.projectId, projectId))
    ).length,
    1,
  );
});

void test("uncertain external actions fail visibly instead of being repeated", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  const run = (await claimChatRun(db))!;
  const message = {
    ...(run.checkpoint as ChatMessage),
    parts: [call("external", "publishDeliveryItems", {})],
  };
  await checkpointChatRun(db, run, message, { status: "queued" });
  await db.insert(s.intelligenceChatTool).values({
    runId: run.id,
    toolCallId: "external",
    name: "publishDeliveryItems",
    input: {},
    replayable: false,
  });
  await f.work();
  const snapshot = await f.snapshot();
  assert.equal(snapshot.run?.status, "failed");
  assert.match(snapshot.run?.error ?? "", /outcome is uncertain/);
});

void test("approval belongs to the saved call; denying it performs no action", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  await f.work(
    generate([
      call("destructive", "mergePullRequest", {
        workItemId: crypto.randomUUID(),
      }),
    ]),
  );
  const snapshot = await f.snapshot();
  assert.equal(snapshot.run?.status, "waiting");
  await assert.rejects(
    submitChatRun(db, f.owner, f.chatId, {
      requestId: crypto.randomUUID(),
      response: { approvalId: "forged", approved: true },
    }),
    /unavailable/,
  );
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: crypto.randomUUID(),
    response: { approvalId: `${f.requestId}:destructive`, approved: false },
  });
  await f.work();
  assert.equal((await f.snapshot()).run?.status, "completed");
  assert.equal(
    (
      await db
        .select()
        .from(s.intelligenceChatTool)
        .where(eq(s.intelligenceChatTool.runId, f.requestId))
    ).length,
    0,
  );
});

void test("a model that ignores cancellation cannot leave a turn working forever", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  await processChatRuns(db, {
    timeoutMs: 30,
    context: () => context(f.owner),
    generate: async function* () {
      await new Promise(() => undefined);
      yield { id: "never", role: "assistant", parts: [] };
    },
  });
  assert.equal((await f.snapshot()).run?.status, "failed");
  assert.match((await f.snapshot()).run?.error ?? "", /too long/);
});

void test("revoking membership before execution prevents model and tool access", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, f.owner.organizationId),
        eq(s.member.userId, f.owner.userId),
      ),
    );
  let called = false;
  await f.work(async function* () {
    called = true;
    yield { id: "never", role: "assistant", parts: [] };
  });
  assert.equal(called, false);
  assert.equal((await f.snapshot()).run?.status, "failed");
});

void test("a failed AI provider call says what failed instead of a generic failure", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  const model = new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({
        message: "Incorrect API key provided",
        url: "https://provider.example.test/v1/responses",
        requestBodyValues: {},
        statusCode: 401,
        isRetryable: false,
      });
    },
  });
  await f.work(chatGenerator(() => model));
  const run = (await f.snapshot()).run;
  assert.equal(run?.status, "failed");
  assert.match(run?.error ?? "", /rejected the configured credentials/);
  assert.match(run?.error ?? "", /completed steps are saved/);
  // The provider's own wording never reaches people.
  assert.doesNotMatch(run?.error ?? "", /Incorrect API key/);
});

void test("the real model adapter persists questions and approvals and continues without duplicate messages", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  let calls = 0;
  // A `config` of its own, as the OpenAI SDK's models have: still a model,
  // not a configured model and provider pair.
  const model = Object.assign(
    new MockLanguageModelV4({
      doStream: async () => {
        const step = calls++;
        const asking = step === 0;
        const approving = step === 1;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              if (asking)
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "real-question",
                  toolName: "askQuestions",
                  input: JSON.stringify(question),
                });
              else if (approving)
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "real-approval",
                  toolName: "setAiPolicy",
                  input: JSON.stringify({ enabled: true }),
                });
              else {
                controller.enqueue({ type: "text-start", id: "answer" });
                controller.enqueue({
                  type: "text-delta",
                  id: "answer",
                  delta: "Thanks, scope recorded.",
                });
                controller.enqueue({ type: "text-end", id: "answer" });
              }
              controller.enqueue({
                type: "finish",
                finishReason: {
                  unified: asking || approving ? "tool-calls" : "stop",
                  raw: undefined,
                },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              });
              controller.close();
            },
          }),
        };
      },
    }),
    { config: { provider: "openai.responses" } },
  );
  await f.work(chatGenerator(() => model));
  assert.equal((await f.snapshot()).run?.status, "waiting");
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: crypto.randomUUID(),
    response: { toolCallId: "real-question", output: { dismissed: true } },
  });
  await f.work(chatGenerator(() => model));
  assert.equal((await f.snapshot()).run?.status, "waiting");
  assert.equal(
    (
      await db
        .select()
        .from(s.intelligenceChatTool)
        .where(eq(s.intelligenceChatTool.runId, f.requestId))
    ).length,
    0,
    "the model cannot execute the action before approval",
  );
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: crypto.randomUUID(),
    response: { approvalId: `${f.requestId}:real-approval`, approved: true },
  });
  await f.work(chatGenerator(() => model));
  const snapshot = await f.snapshot();
  assert.equal(snapshot.run?.status, "completed");
  assert.equal(snapshot.messages.length, 2);
  assert.equal(
    snapshot.messages
      .at(-1)
      ?.parts.filter((p) => p.type === "tool-askQuestions").length,
    1,
  );
  assert.equal(
    snapshot.messages.at(-1)?.parts.filter((p) => p.type === "text").length,
    1,
  );
  assert.equal(model.doStreamCalls.length, 3);
  assert.equal(
    model.doStreamCalls[1]!.prompt.filter((m) => m.role === "tool").length,
    1,
  );
});

void test("shutdown queues the completed checkpoint and another worker finishes it", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  const shutdown = new AbortController();
  await processChatRuns(db, {
    signal: shutdown.signal,
    context: () => context(f.owner),
    generate: async function* ({ messages }) {
      yield {
        ...messages.at(-1)!,
        parts: [text("Incomplete shutdown output")],
      };
      shutdown.abort();
      await new Promise(() => undefined);
    },
  });
  assert.equal((await f.snapshot()).run?.status, "queued");
  await f.work();
  assert.equal((await f.snapshot()).run?.status, "completed");
  assert.equal(
    JSON.stringify((await f.snapshot()).messages).includes(
      "Incomplete shutdown output",
    ),
    false,
  );
});

void test("repeated crashes exhaust the attempt budget instead of leaving a zombie", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  for (let i = 0; i < 3; i++) {
    assert.equal((await claimChatRun(db))?.status, "running");
    await db
      .update(s.intelligenceChatRun)
      .set({ leaseUntil: new Date(0) })
      .where(eq(s.intelligenceChatRun.id, f.requestId));
  }
  assert.equal((await claimChatRun(db))?.status, "failed");
  assert.match((await f.snapshot()).run?.error ?? "", /interrupted repeatedly/);
});

void test("legacy unfinished turns show an interruption and can enter durable execution", async () => {
  const f = await fixture();
  await saveMessages(db, f.owner, f.chatId, [f.input.message]);
  assert.equal((await f.snapshot()).run?.status, "failed");
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: crypto.randomUUID(),
    retry: true,
  });
  await f.work();
  assert.equal((await f.snapshot()).run?.status, "completed");
});

void test("private conversations, run state, input receipts and tool results are excluded from Zero", async () => {
  const published = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_publication_tables where pubname = 'lictory_zero' and tablename like 'intelligence_chat%'`,
  );
  assert.equal(published.length, 0);
});

void test("a question becomes actionable only when its waiting checkpoint commits", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  await f.work(async function* ({ messages }) {
    yield {
      ...messages.at(-1)!,
      parts: [call("only-when-saved", "askQuestions", question)],
    };
    const partial = await f.snapshot();
    assert.equal(partial.run?.status, "running");
    assert.equal(
      partial.messages
        .at(-1)
        ?.parts.some((p) => p.type === "tool-askQuestions"),
      false,
    );
  });
  const waiting = await f.snapshot();
  assert.equal(waiting.run?.status, "waiting");
  assert.equal(
    waiting.messages.at(-1)?.parts.some((p) => p.type === "tool-askQuestions"),
    true,
  );
});

void test("Stop before retry is durable and a delayed Stop cannot cancel a later retry", async () => {
  const f = await fixture();
  await submitChatRun(db, f.owner, f.chatId, f.input);
  await cancelChatRun(db, f.owner, f.chatId, f.requestId);
  const firstRetry = crypto.randomUUID();
  await cancelChatRun(db, f.owner, f.chatId, f.requestId, firstRetry);
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: firstRetry,
    runId: f.requestId,
    retry: true,
  });
  assert.equal((await f.snapshot()).run?.status, "canceled");
  const nextRetry = crypto.randomUUID();
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: nextRetry,
    runId: f.requestId,
    retry: true,
  });
  await cancelChatRun(db, f.owner, f.chatId, f.requestId, firstRetry);
  assert.equal((await f.snapshot()).run?.status, "queued");
  await f.work();
  assert.equal((await f.snapshot()).run?.status, "completed");
  await submitChatRun(db, f.owner, f.chatId, {
    requestId: crypto.randomUUID(),
    message: {
      id: crypto.randomUUID(),
      role: "user",
      parts: [text("Another turn")],
    },
  });
  await assert.rejects(
    submitChatRun(db, f.owner, f.chatId, {
      requestId: crypto.randomUUID(),
      runId: f.requestId,
      retry: true,
    }),
    /superseded/,
  );
});
