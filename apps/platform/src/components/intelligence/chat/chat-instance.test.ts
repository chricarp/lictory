import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ChatMessage,
  ChatSnapshot,
} from "@lictory/core/intelligence/chat/shared";
import {
  CHAT_POLL_MS,
  ConnectivityError,
  createChat,
  seenOutcome,
  sidebarActivity,
  startVisiblePolling,
  summaryActivity,
  type LittoChat,
} from "@lictory/platform/components/intelligence/chat/chat-instance";

const org = "org-1";

function text(
  id: string,
  value: string,
  role: "user" | "assistant" = "user",
): ChatMessage {
  return { id, role, parts: [{ type: "text", text: value }] };
}

function snapshot(
  messages: ChatMessage[],
  run: ChatSnapshot["run"] = null,
  title: string | null = null,
): ChatSnapshot {
  return {
    chat: { id: "chat-1", title, pinned: false },
    messages,
    run,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { url: string; body?: Record<string, unknown> };

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return undefined;
  return JSON.parse(body) as Record<string, unknown>;
}

function client(options: { messages?: ChatMessage[] } = {}) {
  const calls: Call[] = [];
  const waiters: Array<(value: Response | Error) => void> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: requestUrl(input),
      body: requestBody(init?.body),
    });
    return new Promise((resolve, reject) => {
      waiters.push((value) => {
        if (value instanceof Error) reject(value);
        else resolve(value);
      });
    });
  };
  const chat = createChat({
    id: "chat-1",
    organizationId: org,
    surface: "page",
    messages: options.messages,
    fetch: fetchImpl,
    polling: false,
  });
  return {
    chat,
    calls,
    settle: (index: number, value: Response | Error) => {
      const waiter = waiters[index];
      if (!waiter) throw new Error(`No request ${index}.`);
      waiter(value);
    },
  };
}

function sent(chat: LittoChat, value = "Hello") {
  return chat.sendMessage({ text: value });
}

void test("a submit sends only the new message and its request id", async () => {
  const { chat, calls, settle } = client();
  const pending = sent(chat, "Draft the story");
  await Promise.resolve();
  const body = calls[0]?.body;
  assert.equal(calls[0]?.url, "/api/intelligence/chat");
  assert.equal(body?.id, "chat-1");
  assert.equal(body?.organizationId, org);
  assert.equal(body?.surface, "page");
  assert.equal(typeof body?.requestId, "string");
  assert.equal("response" in (body ?? {}), false);
  assert.equal("retry" in (body ?? {}), false);
  const message = body?.message as {
    id: string;
    role: string;
    parts: { text: string }[];
  };
  assert.equal(message.role, "user");
  assert.deepEqual(message.parts, [{ type: "text", text: "Draft the story" }]);
  assert.equal(chat.getSnapshot().messages.at(-1)?.id, message.id);
  assert.equal(chat.getSnapshot().status, "submitted");

  settle(
    0,
    json(
      snapshot(
        [text(message.id, "Draft the story"), text("a1", "", "assistant")],
        {
          id: String(body?.requestId),
          status: "queued",
          error: null,
          updatedAt: "t1",
        },
      ),
      202,
    ),
  );
  await pending;
  assert.equal(chat.getSnapshot().messages.length, 2);
  assert.equal(chat.hasUnacceptedPrompt(), false);
});

void test("an uncertain submit keeps the prompt and retries the same request id", async () => {
  const { chat, calls, settle } = client({
    messages: [text("earlier", "Before")],
  });
  const pending = sent(chat, "Keep me");
  await Promise.resolve();
  const requestId = calls[0]?.body?.requestId;
  const messageId = (calls[0]?.body?.message as { id: string }).id;
  settle(0, new TypeError("Failed to fetch"));
  await pending;

  const view = chat.getSnapshot();
  assert.equal(view.status, "error");
  assert.equal(view.canRetry, true);
  assert.equal(view.messages.at(-1)?.id, messageId);
  assert.equal(chat.hasUnacceptedPrompt(), true);

  chat.hydrate(snapshot([text("earlier", "Before")]));
  assert.equal(chat.getSnapshot().messages.at(-1)?.id, messageId);

  const again = chat.regenerate();
  await Promise.resolve();
  assert.equal(calls[1]?.body?.requestId, requestId);
  assert.equal((calls[1]?.body?.message as { id: string }).id, messageId);
  settle(
    1,
    json(
      snapshot([text("earlier", "Before"), text(messageId, "Keep me")], {
        id: String(requestId),
        status: "queued",
        error: null,
        updatedAt: "t2",
      }),
      202,
    ),
  );
  await again;
  assert.equal(chat.hasUnacceptedPrompt(), false);
  assert.equal(chat.getSnapshot().error, undefined);
});

void test("a rejected submit retries with a new request id", async () => {
  const { chat, calls, settle } = client();
  const pending = sent(chat);
  await Promise.resolve();
  const first = calls[0]?.body?.requestId;
  settle(0, json({ error: { message: "Litto is still working." } }, 409));
  await pending;
  assert.equal(chat.getSnapshot().messages.length, 1);

  const again = chat.regenerate();
  await Promise.resolve();
  assert.notEqual(calls[1]?.body?.requestId, first);
  assert.equal(
    (calls[1]?.body?.message as { id: string }).id,
    (calls[0]?.body?.message as { id: string }).id,
  );
  settle(1, json({ error: { message: "No." } }, 409));
  await again;
});

void test("loading history does not announce a title or a missed finish", () => {
  const finishes: string[] = [];
  const titles: string[] = [];
  const chat = createChat({
    id: "chat-1",
    organizationId: org,
    surface: "page",
    polling: false,
    onFinish: () => finishes.push("finish"),
    onTitle: (title) => titles.push(title),
  });
  chat.hydrate(
    snapshot(
      [text("u", "Old"), text("a", "Done", "assistant")],
      {
        id: "run-1",
        status: "completed",
        error: null,
        updatedAt: "t0",
      },
      "Already named",
    ),
  );
  assert.deepEqual(finishes, []);
  assert.deepEqual(titles, []);
  assert.equal(chat.getSnapshot().messages.at(-1)?.id, "a");
});

void test("a later snapshot of a new run updates the open conversation once", async () => {
  const finishes: string[] = [];
  const titles: string[] = [];
  let body: ChatSnapshot = snapshot(
    [text("u", "Old"), text("a", "Done", "assistant")],
    { id: "run-1", status: "completed", error: null, updatedAt: "t0" },
    "Old title",
  );
  const chat = createChat({
    id: "chat-1",
    organizationId: org,
    surface: "dock",
    fetch: async () => json(body),
    polling: false,
    onFinish: (event) =>
      finishes.push(`${event.isError}:${event.isAbort}:${event.message.id}`),
    onTitle: (title) => titles.push(title),
  });
  chat.hydrate(body);
  body = snapshot(
    [
      text("u", "Old"),
      text("a", "Done", "assistant"),
      text("u2", "Remote"),
      text("a2", "Partial", "assistant"),
    ],
    { id: "run-2", status: "running", error: null, updatedAt: "t1" },
    "Remote title",
  );
  await chat.refresh();
  assert.equal(chat.getSnapshot().messages.at(-1)?.id, "a2");
  assert.equal(chat.getSnapshot().status, "streaming");
  assert.deepEqual(finishes, []);
  assert.deepEqual(titles, ["Remote title"]);

  body = snapshot(
    body.messages,
    {
      id: "run-2",
      status: "completed",
      error: null,
      updatedAt: "t2",
    },
    "Remote title",
  );
  await chat.refresh();
  await chat.refresh();
  assert.deepEqual(finishes, ["false:false:a2"]);
  assert.equal(chat.getSnapshot().status, "ready");
});

void test("a failed run retries the same checkpoint and reuses an uncertain request id", async () => {
  const { chat, calls, settle } = client();
  chat.hydrate(
    snapshot([text("u", "Hello"), text("a", "Partial", "assistant")], {
      id: "run-failed",
      status: "failed",
      error: "The model stopped.",
      updatedAt: "t0",
    }),
  );
  assert.equal(chat.getSnapshot().status, "error");
  assert.equal(chat.getSnapshot().error?.message, "The model stopped.");
  assert.equal(chat.getSnapshot().canRetry, true);

  const pending = chat.regenerate();
  await Promise.resolve();
  assert.deepEqual(calls[0]?.body, {
    id: "chat-1",
    organizationId: org,
    surface: "page",
    requestId: calls[0]?.body?.requestId,
    retry: true,
    runId: "run-failed",
  });
  assert.equal("message" in (calls[0]?.body ?? {}), false);
  settle(0, new TypeError("Failed to fetch"));
  await pending;

  const again = chat.regenerate();
  await Promise.resolve();
  assert.equal(calls[1]?.body?.requestId, calls[0]?.body?.requestId);
  assert.equal(calls[1]?.body?.retry, true);
  settle(
    1,
    json(
      snapshot([text("u", "Hello"), text("a", "Partial", "assistant")], {
        id: "run-failed",
        status: "queued",
        error: null,
        updatedAt: "t1",
      }),
      202,
    ),
  );
  await again;
  assert.equal(chat.getSnapshot().status, "submitted");
  assert.equal(chat.getSnapshot().messages[1]?.id, "a");
});

void test("an answer posts only that answer", async () => {
  const assistant: ChatMessage = {
    id: "a",
    role: "assistant",
    parts: [
      {
        type: "tool-askQuestions",
        toolCallId: "call-1",
        state: "input-available",
        input: { title: "Where?", questions: [] },
      },
    ],
  };
  const { chat, calls, settle } = client();
  chat.hydrate(
    snapshot([text("u", "Hello"), assistant], {
      id: "run-wait",
      status: "waiting",
      error: null,
      updatedAt: "t0",
    }),
  );
  const pending = chat.addToolOutput({
    toolCallId: "call-1",
    output: { dismissed: true },
  });
  await Promise.resolve();
  const part = chat.getSnapshot().messages[1]?.parts[0];
  assert.equal(
    part && "state" in part ? part.state : undefined,
    "output-available",
  );
  assert.equal("message" in (calls[0]?.body ?? {}), false);
  assert.equal("retry" in (calls[0]?.body ?? {}), false);
  assert.deepEqual(calls[0]?.body?.response, {
    toolCallId: "call-1",
    output: { dismissed: true },
  });

  const stale = snapshot([text("u", "Hello"), assistant], {
    id: "run-wait",
    status: "waiting",
    error: null,
    updatedAt: "t0",
  });
  settle(0, json(stale, 202));
  await pending;
  const kept = chat.getSnapshot().messages[1]?.parts[0];
  assert.equal(
    kept && "state" in kept ? kept.state : undefined,
    "output-available",
  );
});

void test("stop uses the in-flight request id and reports a failed ack", async () => {
  const { chat, calls, settle } = client();
  const pending = sent(chat, "Stop this");
  await Promise.resolve();
  const requestId = String(calls[0]?.body?.requestId);
  const stopping = chat.stop();
  await Promise.resolve();
  assert.equal(
    calls[1]?.url,
    `/api/intelligence/chats/chat-1/stop?organizationId=${org}`,
  );
  assert.deepEqual(calls[1]?.body, { runId: requestId, requestId });
  settle(1, json({ error: { message: "The cancel was not saved." } }, 500));
  await assert.rejects(stopping, /The cancel was not saved/);
  assert.match(chat.getSnapshot().error?.message ?? "", /cancel was not saved/);
  assert.equal(
    chat.getSnapshot().messages.at(-1)?.id,
    (calls[0]?.body?.message as { id: string }).id,
  );
  settle(0, new TypeError("Failed to fetch"));
  await pending;
  assert.equal(chat.hasUnacceptedPrompt(), true);
});

void test("polling backs off and stops when unsubscribed", async () => {
  const timers: {
    ms: number;
    fn: () => void;
    cancel: () => void;
    cancelled: boolean;
  }[] = [];
  let calls = 0;
  let listening = 0;
  const stop = startVisiblePolling(
    async () => {
      calls += 1;
      throw new ConnectivityError("offline");
    },
    {
      visible: () => true,
      schedule: (fn, ms) => {
        const timer = {
          ms,
          fn,
          cancelled: false,
          cancel: () => {
            timer.cancelled = true;
          },
        };
        timers.push(timer);
        return timer.cancel;
      },
      listen: () => {
        listening += 1;
        return () => {
          listening -= 1;
        };
      },
    },
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(timers[0]?.ms, CHAT_POLL_MS * 2);
  assert.equal(listening, 1);
  stop();
  assert.equal(timers[0]?.cancelled, true);
  assert.equal(listening, 0);
  timers[0]?.fn();
  await Promise.resolve();
  assert.equal(calls, 1);
});

void test("a chat subscription stops its poller when the last listener leaves", () => {
  let listening = 0;
  const chat = createChat({
    id: "chat-1",
    organizationId: org,
    surface: "dock",
    polling: {
      visible: () => false,
      schedule: () => () => undefined,
      listen: () => {
        listening += 1;
        return () => {
          listening -= 1;
        };
      },
    },
  });
  const first = chat.subscribe(() => undefined);
  const second = chat.subscribe(() => undefined);
  assert.equal(listening, 1);
  first();
  assert.equal(listening, 1);
  second();
  assert.equal(listening, 0);
});

void test("sidebar activity comes from the summary", () => {
  assert.equal(
    summaryActivity({ running: true, awaitingInput: false, run: null }),
    "working",
  );
  assert.equal(
    summaryActivity({
      running: false,
      awaitingInput: true,
      run: { id: "r", status: "waiting", error: null, updatedAt: "t" },
    }),
    "waiting",
  );
  assert.equal(
    summaryActivity({
      running: true,
      awaitingInput: true,
      run: { id: "r", status: "failed", error: "nope", updatedAt: "t" },
    }),
    "failed",
  );
  assert.equal(
    summaryActivity({ running: false, awaitingInput: false }),
    undefined,
  );
});

const icon = (
  run: {
    id: string;
    status:
      "queued" | "running" | "waiting" | "completed" | "failed" | "canceled";
  } | null,
  flags: {
    open?: boolean;
    unread?: boolean;
    seenRun?: { id: string; status: string } | null;
    running?: boolean;
    awaitingInput?: boolean;
  } = {},
) =>
  sidebarActivity({
    chat: {
      running: flags.running ?? false,
      awaitingInput: flags.awaitingInput ?? false,
      run: run
        ? { ...run, error: null, updatedAt: "2026-10-27T12:00:00.000Z" }
        : null,
    },
    open: flags.open ?? false,
    unread: flags.unread ?? false,
    seenRun: flags.seenRun ?? null,
  });

void test("sidebar icons follow whether the conversation is open and seen", () => {
  const working = { id: "run-1", status: "running" as const };
  const waiting = { id: "run-1", status: "waiting" as const };
  const done = { id: "run-1", status: "completed" as const };
  const failed = { id: "run-1", status: "failed" as const };

  assert.equal(icon(working, { running: true }), "working");
  assert.equal(icon(working, { running: true, open: true }), undefined);
  assert.equal(icon(waiting, { awaitingInput: true }), "waiting");
  assert.equal(icon(waiting, { awaitingInput: true, open: true }), undefined);
  // In progress comes back on the next conversation; seeing it does not retire it.
  assert.equal(
    icon(waiting, {
      awaitingInput: true,
      seenRun: { id: "run-1", status: "waiting" },
    }),
    "waiting",
  );

  assert.equal(icon(done), "completed");
  assert.equal(icon(done, { unread: true }), "unread");
  assert.equal(icon(done, { open: true }), undefined);
  assert.equal(
    icon(done, { seenRun: { id: "run-1", status: "completed" } }),
    undefined,
  );
  assert.equal(
    icon(done, {
      unread: true,
      seenRun: { id: "run-1", status: "completed" },
    }),
    undefined,
  );
  // Seeing the failure does not hide the later success of the same turn.
  assert.equal(
    icon(done, { seenRun: { id: "run-1", status: "failed" } }),
    "completed",
  );
  // A later turn is a new outcome.
  assert.equal(
    icon(
      { id: "run-2", status: "completed" },
      { seenRun: { id: "run-1", status: "completed" }, unread: true },
    ),
    "unread",
  );

  assert.equal(icon(failed), "failed");
  assert.equal(icon(failed, { open: true }), undefined);
  assert.equal(
    icon(failed, { seenRun: { id: "run-1", status: "failed" } }),
    undefined,
  );
  assert.equal(
    icon(
      { id: "run-2", status: "failed" },
      { seenRun: { id: "run-1", status: "failed" } },
    ),
    "failed",
  );
  assert.equal(
    icon(
      { id: "run-1", status: "canceled" },
      { seenRun: { id: "run-1", status: "canceled" } },
    ),
    undefined,
  );

  assert.equal(icon(null, { unread: true }), "unread");
  assert.equal(icon(null, { unread: true, open: true }), undefined);
});

void test("a seen outcome is the finished turn actually on screen", () => {
  const done = {
    id: "run-2",
    status: "completed" as const,
    updatedAt: "2026-10-27T12:02:00.000Z",
  };
  const outcome = { id: "run-2", status: "completed" as const };
  assert.deepEqual(seenOutcome({ rendered: done, listed: null }), outcome);
  assert.deepEqual(
    seenOutcome({
      rendered: done,
      listed: {
        id: "run-2",
        status: "running",
        updatedAt: "2026-10-27T12:01:00.000Z",
      },
    }),
    outcome,
  );
  assert.deepEqual(
    seenOutcome({ rendered: done, listed: { ...done } }),
    outcome,
  );
  // The list already settled this turn differently than the transcript.
  assert.equal(
    seenOutcome({
      rendered: done,
      listed: { id: "run-2", status: "failed", updatedAt: done.updatedAt },
    }),
    null,
  );
  // The transcript is older than the listed turn.
  assert.equal(
    seenOutcome({
      rendered: {
        id: "run-1",
        status: "completed",
        updatedAt: "2026-10-27T12:00:00.000Z",
      },
      listed: done,
    }),
    null,
  );
  // The transcript already shows a later turn than the list.
  assert.deepEqual(
    seenOutcome({
      rendered: done,
      listed: {
        id: "run-1",
        status: "completed",
        updatedAt: "2026-10-27T12:00:00.000Z",
      },
    }),
    outcome,
  );
  assert.equal(seenOutcome({ rendered: null, listed: done }), null);
});

void test("rendered outcome follows the absorbed terminal run", () => {
  const { chat } = client();
  assert.equal(chat.renderedOutcome(), null);
  chat.hydrate(
    snapshot([text("u", "Hi"), text("a", "Done", "assistant")], {
      id: "run-1",
      status: "completed",
      error: null,
      updatedAt: "2026-10-27T12:00:00.000Z",
    }),
  );
  assert.deepEqual(chat.renderedOutcome(), {
    id: "run-1",
    status: "completed",
    updatedAt: "2026-10-27T12:00:00.000Z",
  });
  chat.hydrate(
    snapshot([text("u", "Hi"), text("a", "Done", "assistant")], {
      id: "run-1",
      status: "running",
      error: null,
      updatedAt: "2026-10-27T12:01:00.000Z",
    }),
  );
  assert.equal(chat.renderedOutcome(), null);
  chat.hydrate(
    snapshot([], { id: "run-2", status: "failed", error: "x", updatedAt: "t" }),
  );
  assert.equal(chat.renderedOutcome(), null);
});

void test("older saved snapshots cannot replace a newer accepted turn", () => {
  const { chat } = client();
  chat.hydrate({
    ...snapshot([text("u", "New"), text("a", "New answer", "assistant")], {
      id: "new",
      status: "completed",
      error: null,
      updatedAt: "t2",
    }),
    version: 3,
  });
  chat.hydrate({
    ...snapshot([text("u", "Old")], {
      id: "old",
      status: "running",
      error: null,
      updatedAt: "t1",
    }),
    version: 2,
  });
  assert.equal(chat.getSnapshot().messages.at(-1)?.id, "a");
  assert.equal(chat.getSnapshot().status, "ready");
});

void test("a GET begun before submission cannot erase its accepted snapshot", async () => {
  const { chat, calls, settle } = client();
  const reading = chat.refresh();
  const sending = sent(chat);
  const message = calls[1]?.body?.message as ChatMessage;
  settle(
    1,
    json(
      snapshot([message, text("a", "Accepted", "assistant")], {
        id: String(calls[1]?.body?.requestId),
        status: "running",
        error: null,
        updatedAt: "t1",
      }),
      202,
    ),
  );
  await sending;
  settle(0, json(snapshot([])));
  await reading;
  assert.equal(chat.getSnapshot().messages.at(-1)?.id, "a");
  assert.equal(chat.getSnapshot().status, "streaming");
});

void test("Stop acknowledged before submit stops the spinner without discarding the prompt", async () => {
  const { chat, calls, settle } = client();
  const sending = sent(chat);
  const requestId = String(calls[0]?.body?.requestId);
  const stopping = chat.stop();
  settle(1, json(snapshot([])));
  await stopping;
  assert.equal(chat.getSnapshot().status, "ready");
  assert.equal(chat.getSnapshot().messages.length, 1);
  const message = calls[0]?.body?.message as ChatMessage;
  settle(
    0,
    json(
      snapshot([message], {
        id: requestId,
        status: "canceled",
        error: null,
        updatedAt: "t1",
      }),
      202,
    ),
  );
  await sending;
  assert.equal(chat.getSnapshot().status, "ready");
});

void test("a quick hide and show restarts polling after its aborted read settles", async () => {
  let visible = true;
  let events: { kick: () => void; pause: () => void } | undefined;
  let calls = 0;
  let rejectRead: ((error: Error) => void) | undefined;
  const stop = startVisiblePolling(
    async () => {
      calls++;
      if (calls === 1)
        await new Promise<void>((_resolve, reject) => {
          rejectRead = reject;
        });
    },
    {
      visible: () => visible,
      listen: (handlers) => {
        events = handlers;
        return () => undefined;
      },
      schedule: () => () => undefined,
    },
  );
  visible = false;
  events!.pause();
  visible = true;
  events!.kick();
  rejectRead!(new DOMException("Hidden", "AbortError"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  stop();
});

void test("a failed Stop never offers a Retry that would restart a canceled turn", async () => {
  const { chat, settle } = client();
  chat.hydrate(
    snapshot([text("a", "Working", "assistant")], {
      id: "run",
      status: "running",
      error: null,
      updatedAt: "t1",
    }),
  );
  const stopping = chat.stop();
  settle(0, json({ error: { message: "Cancel response lost" } }, 500));
  await assert.rejects(stopping);
  assert.equal(chat.getSnapshot().canRetry, false);
  chat.hydrate(
    snapshot([text("a", "Stopped", "assistant")], {
      id: "run",
      status: "canceled",
      error: null,
      updatedAt: "t2",
    }),
  );
  assert.equal(chat.getSnapshot().error, undefined);
});

void test("Stop can precede a retry and targets that exact retry request", async () => {
  const { chat, calls, settle } = client();
  const failed = snapshot(
    [text("u", "Work"), text("a", "Partial", "assistant")],
    {
      id: "run",
      requestId: "original",
      status: "failed",
      error: "Interrupted",
      updatedAt: "t0",
    },
  );
  chat.hydrate(failed);
  const retrying = chat.regenerate();
  const requestId = String(calls[0]?.body?.requestId);
  const stopping = chat.stop();
  assert.deepEqual(calls[1]?.body, { runId: "run", requestId });
  settle(1, json(failed));
  await stopping;
  assert.equal(chat.getSnapshot().status, "ready");
  settle(
    0,
    json(
      snapshot(failed.messages, {
        id: "run",
        requestId,
        status: "canceled",
        error: null,
        updatedAt: "t1",
      }),
      202,
    ),
  );
  await retrying;
  assert.equal(chat.getSnapshot().status, "ready");
  assert.equal(chat.getSnapshot().canRetry, true);
});
