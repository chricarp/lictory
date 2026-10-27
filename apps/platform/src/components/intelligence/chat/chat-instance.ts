import { isToolUIPart } from "ai";
import type {
  ChatMessage,
  ChatResponse,
  ChatRunSummary,
  ChatSnapshot,
  ChatSummary,
} from "@lictory/core/intelligence/chat/shared";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
} from "@lictory/core/intelligence/chat/shared";

// Saved transcripts are authoritative. The browser submits one new message,
// one answer, or one retry, then renders the snapshot the server stores.
// `requestId` is the idempotency key: an uncertain network outcome retries
// that same submission, and for a new message it is also the run id.

export const CHAT_POLL_MS = 2_000;
const CHAT_POLL_MAX_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

const ACTIVE = new Set(["queued", "running", "waiting"]);
// A turn the model is producing. Waiting is settled: the person has the next move.
const PRODUCING = new Set(["queued", "running"]);
const SETTLED = new Set(["completed", "canceled", "failed", "waiting"]);

export class ConnectivityError extends Error {
  constructor(message = "The connection dropped. Litto will try again.") {
    super(message);
    this.name = "ConnectivityError";
  }
}

export function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export function isAbortError(error: unknown) {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

export async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string } | string;
  } | null;
  if (typeof body?.error === "string" && body.error) return body.error;
  if (body?.error && typeof body.error === "object" && body.error.message)
    return body.error.message;
  return `Request failed (${response.status}).`;
}

type PollEnv = {
  visible?: () => boolean;
  schedule?: (fn: () => void, ms: number) => () => void;
  listen?: (events: { kick: () => void; pause: () => void }) => () => void;
};

function defaultVisible() {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

function defaultSchedule(fn: () => void, ms: number) {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

function defaultListen(events: { kick: () => void; pause: () => void }) {
  if (typeof window === "undefined" || typeof document === "undefined")
    return () => undefined;
  const onVisibility = () => {
    if (document.visibilityState === "visible") events.kick();
    else events.pause();
  };
  window.addEventListener("focus", events.kick);
  window.addEventListener("online", events.kick);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("focus", events.kick);
    window.removeEventListener("online", events.kick);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

// Polls while the caller is subscribed and the document is visible.
// Connectivity failures wait longer; focus, visibility and reconnect poll now.
// The returned function aborts the in-flight request and clears the timer.
export function startVisiblePolling(
  load: (signal: AbortSignal) => Promise<void>,
  env: PollEnv = {},
) {
  const visible = env.visible ?? defaultVisible;
  const schedule = env.schedule ?? defaultSchedule;
  const listen = env.listen ?? defaultListen;
  let stopped = false;
  let running = false;
  let rerun = false;
  let delay = CHAT_POLL_MS;
  let cancelTimer: (() => void) | undefined;
  let controller: AbortController | undefined;

  const disarm = () => {
    cancelTimer?.();
    cancelTimer = undefined;
  };
  const arm = (ms: number) => {
    disarm();
    cancelTimer = schedule(() => {
      cancelTimer = undefined;
      void tick();
    }, ms);
  };
  const tick = async () => {
    if (stopped || !visible()) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    const ctrl = new AbortController();
    controller = ctrl;
    let reschedule = true;
    try {
      await load(ctrl.signal);
      delay = CHAT_POLL_MS;
    } catch (error) {
      if (stopped || ctrl.signal.aborted || isAbortError(error))
        reschedule = false;
      else if (error instanceof ConnectivityError)
        delay = Math.min(delay * 2, CHAT_POLL_MAX_MS);
      else delay = CHAT_POLL_MS;
    } finally {
      running = false;
      if (controller === ctrl) controller = undefined;
    }
    if (stopped) return;
    if (rerun && visible()) {
      rerun = false;
      void tick();
      return;
    }
    if (reschedule && visible()) arm(delay);
  };
  const kick = () => {
    if (stopped) return;
    delay = CHAT_POLL_MS;
    disarm();
    void tick();
  };
  const pause = () => {
    disarm();
    controller?.abort();
  };
  const unlisten = listen({ kick, pause });
  void tick();
  return () => {
    stopped = true;
    disarm();
    controller?.abort();
    unlisten();
  };
}

export type ChatFinish = {
  message: ChatMessage;
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
};

export type ChatView = {
  messages: ChatMessage[];
  status: "ready" | "submitted" | "streaming" | "error";
  error: Error | undefined;
  canRetry: boolean;
};

type SendInput = { text?: string; parts?: ChatMessage["parts"] };

type Pending = {
  requestId: string;
  phase: "sending" | "uncertain" | "rejected";
  message?: ChatMessage;
  response?: ChatResponse;
  baselineUpdatedAt?: string | null;
  body:
    | { message: { id: string; role: "user"; parts: ChatMessage["parts"] } }
    | { response: ChatResponse }
    | { retry: true; runId: string };
};

const waitingPart = (part: ChatMessage["parts"][number]) =>
  isToolUIPart(part) &&
  (part.state === "approval-requested" ||
    ((part.type === `tool-${ASK_QUESTIONS}` ||
      part.type === `tool-${RECOMMEND_ACTION}` ||
      (part.type === "dynamic-tool" &&
        (part.toolName === ASK_QUESTIONS ||
          part.toolName === RECOMMEND_ACTION))) &&
      part.state === "input-available"));

function textOf(message: ChatMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function responseApplied(messages: ChatMessage[], response: ChatResponse) {
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      if ("toolCallId" in response) {
        if (part.toolCallId !== response.toolCallId) continue;
        return (
          part.state === "output-available" || part.state === "output-error"
        );
      }
      if (part.approval?.id !== response.approvalId) continue;
      return part.state !== "approval-requested";
    }
  }
  return false;
}

function responseTargets(messages: ChatMessage[], response: ChatResponse) {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (!isToolUIPart(part)) return false;
      if ("toolCallId" in response)
        return part.toolCallId === response.toolCallId;
      return part.approval?.id === response.approvalId;
    }),
  );
}

function applyResponse(messages: ChatMessage[], response: ChatResponse) {
  let changed = false;
  const next = messages.map((message) => {
    let partsChanged = false;
    const parts = message.parts.map((part) => {
      if (!isToolUIPart(part)) return part;
      if ("toolCallId" in response) {
        if (
          part.toolCallId !== response.toolCallId ||
          part.state === "output-available"
        )
          return part;
        partsChanged = true;
        changed = true;
        return {
          ...part,
          state: "output-available" as const,
          output: response.output,
        };
      }
      const approval = part.approval;
      if (
        part.state !== "approval-requested" ||
        approval?.id !== response.approvalId
      )
        return part;
      partsChanged = true;
      changed = true;
      return {
        ...part,
        state: "approval-responded" as const,
        approval: { ...approval, approved: response.approved },
      };
    });
    return partsChanged ? { ...message, parts } : message;
  });
  return changed ? (next as ChatMessage[]) : messages;
}

function withPrompt(messages: ChatMessage[], message: ChatMessage) {
  return messages.some((item) => item.id === message.id)
    ? messages
    : [...messages, message];
}

// Sidebar state comes from the list payload, not from loaded transcripts.
export function summaryActivity(
  chat: Pick<ChatSummary, "running" | "awaitingInput" | "run">,
): "working" | "waiting" | "failed" | "completed" | "canceled" | undefined {
  const status = chat.run?.status;
  if (status === "failed") return "failed";
  if (status === "completed") return "completed";
  if (status === "canceled") return "canceled";
  if (chat.awaitingInput || status === "waiting") return "waiting";
  if (chat.running || status === "queued" || status === "running")
    return "working";
  return undefined;
}

const TERMINAL_OUTCOME = new Set(["completed", "failed", "canceled"]);

export type SidebarActivity =
  "working" | "waiting" | "failed" | "completed" | "canceled" | "unread";

// Which icon a conversation row shows.
// Working and waiting are still in progress: hidden on the open conversation,
// shown again from any other one. A finished turn and an unread reply stay
// until that outcome has been seen, then they stay gone.
export function sidebarActivity(input: {
  chat: Pick<ChatSummary, "running" | "awaitingInput" | "run">;
  open: boolean;
  unread: boolean;
  // The finished outcome already seen for this conversation, if any.
  seenRun: { id: string; status: string } | null;
}): SidebarActivity | undefined {
  if (input.open) return undefined;
  const activity = summaryActivity(input.chat);
  const runId = input.chat.run?.id ?? null;
  const seen =
    runId !== null &&
    activity !== undefined &&
    input.seenRun?.id === runId &&
    input.seenRun.status === activity &&
    TERMINAL_OUTCOME.has(activity);
  if (activity === "working" || activity === "waiting") return activity;
  if (seen) return undefined;
  if (activity === "failed" || activity === "canceled") return activity;
  if (activity === "completed") return input.unread ? "unread" : "completed";
  if (input.unread) return "unread";
  return undefined;
}

export type RenderedOutcome = {
  id: string;
  status: "completed" | "failed" | "canceled";
  updatedAt: string;
};

// The finished outcome to remember once this transcript is on screen, or null
// when the transcript is still catching up to a newer listed turn. Status is
// part of the identity: seeing a failure must not hide a later success.
export function seenOutcome(input: {
  rendered: RenderedOutcome | null;
  listed: { id: string; status: string; updatedAt: string } | null;
}): { id: string; status: RenderedOutcome["status"] } | null {
  const rendered = input.rendered;
  if (!rendered) return null;
  const listed = input.listed;
  const outcome = { id: rendered.id, status: rendered.status };
  if (!listed) return outcome;
  if (listed.id === rendered.id) {
    if (!TERMINAL_OUTCOME.has(listed.status)) return outcome;
    return listed.status === rendered.status ? outcome : null;
  }
  const renderedAt = Date.parse(rendered.updatedAt);
  const listedAt = Date.parse(listed.updatedAt);
  return renderedAt > listedAt ? outcome : null;
}

export class LittoChat {
  readonly id: string;
  private readonly organizationId: string;
  private readonly surface: "page" | "dock";
  private readonly fetchImpl: typeof fetch;
  private readonly polling: false | PollEnv;
  private readonly onTitle?: (title: string) => void;
  private readonly onFinish?: (event: ChatFinish) => void;
  private listeners = new Set<() => void>();
  private subscribers = 0;
  private stopPolling: (() => void) | undefined;
  private messages: ChatMessage[];
  private serverRun: ChatRunSummary | null = null;
  private localRun: ChatRunSummary | null = null;
  private localError: Error | undefined;
  private stopError = false;
  private legacyStopId: string | null = null;
  private connectionError: Error | undefined;
  private serverVersion = -1;
  private writeEpoch = 0;
  private canceledRequest: string | null = null;
  private pending: Pending | null = null;
  private flight: Promise<void> | null = null;
  private seen = false;
  private title: string | null = null;
  private observed: ChatRunSummary | null = null;
  private signature = "";
  private view: ChatView;

  constructor(options: {
    id: string;
    organizationId: string;
    surface: "page" | "dock";
    messages?: ChatMessage[];
    onTitle?: (title: string) => void;
    onFinish?: (event: ChatFinish) => void;
    fetch?: typeof fetch;
    polling?: false | PollEnv;
  }) {
    this.id = options.id;
    this.organizationId = options.organizationId;
    this.surface = options.surface;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.polling = options.polling ?? {};
    this.onTitle = options.onTitle;
    this.onFinish = options.onFinish;
    this.messages = options.messages ?? [];
    this.view = this.derive();
    this.signature = this.sign(this.view);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.subscribers += 1;
    if (this.subscribers === 1 && this.polling !== false)
      this.stopPolling = startVisiblePolling(
        (signal) => this.refresh(signal),
        this.polling,
      );
    return () => {
      this.listeners.delete(listener);
      this.subscribers -= 1;
      if (this.subscribers > 0) return;
      this.stopPolling?.();
      this.stopPolling = undefined;
    };
  };

  getSnapshot = () => this.view;

  // The settled turn currently rendered, after a snapshot has been absorbed.
  // Null while a turn is still running or waiting, or before the first snapshot.
  renderedOutcome(): RenderedOutcome | null {
    if (!this.seen || this.messages.length === 0) return null;
    const run = this.localRun ?? this.serverRun;
    if (!run || !TERMINAL_OUTCOME.has(run.status)) return null;
    return {
      id: run.id,
      status: run.status as RenderedOutcome["status"],
      updatedAt: run.updatedAt,
    };
  }

  // The first saved view. A run that is already finished was not watched here,
  // so it does not count as a completion the person missed.
  hydrate(snapshot: ChatSnapshot) {
    this.absorb(snapshot, true);
  }

  refresh = async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const epoch = this.writeEpoch;
    let response: Response;
    try {
      response = await this.fetchImpl(this.snapshotUrl(), {
        cache: "no-store",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      this.connectionError = new ConnectivityError(
        "Cannot refresh this conversation. Showing the last saved state; reconnecting…",
      );
      this.publish();
      throw this.connectionError;
    }
    if (signal?.aborted) return;
    if (!response.ok) {
      const message = await responseError(response);
      const error = retryableStatus(response.status)
        ? new ConnectivityError(message)
        : new Error(message);
      this.connectionError = error;
      if (response.status === 403 || response.status === 401) {
        this.messages = [];
        this.serverRun = null;
      }
      this.publish();
      throw error;
    }
    let snapshot: ChatSnapshot;
    try {
      snapshot = (await response.json()) as ChatSnapshot;
    } catch {
      this.connectionError = new ConnectivityError(
        "Cannot read the saved conversation. Reconnecting…",
      );
      this.publish();
      throw this.connectionError;
    }
    if (signal?.aborted || epoch !== this.writeEpoch) return;
    this.connectionError = undefined;
    if (!snapshot.chat && this.seen && !this.pending) {
      this.messages = [];
      this.serverRun = null;
      this.localRun = null;
      this.localError = new Error("This conversation no longer exists.");
      this.publish();
      return;
    }
    this.absorb(snapshot, false);
  };

  sendMessage = async (input: SendInput) => {
    if (this.pending?.phase === "sending") return;
    // The server accepts one active turn. The composer is already paused.
    if (this.serverRun && ACTIVE.has(this.serverRun.status)) return;
    const message = userMessage(input);
    const requestId = crypto.randomUUID();
    this.pending = {
      requestId,
      phase: "sending",
      message,
      body: {
        message: { id: message.id, role: "user", parts: message.parts },
      },
    };
    this.localError = undefined;
    this.messages = withPrompt(this.messages, message);
    this.localRun = queued(requestId);
    this.publish();
    await this.flush();
  };

  addToolOutput = (input: {
    tool?: string;
    toolCallId: string;
    output: unknown;
  }) => this.respond({ toolCallId: input.toolCallId, output: input.output });

  addToolApprovalResponse = (input: { id: string; approved: boolean }) =>
    this.respond({ approvalId: input.id, approved: input.approved });

  regenerate = async () => {
    const pending = this.pending;
    if (pending?.phase === "sending") return this.flush();
    if (
      pending &&
      (pending.phase === "uncertain" || pending.phase === "rejected")
    ) {
      // A rejected submit never landed. An uncertain one may have, so its id stays.
      if (pending.phase === "rejected") pending.requestId = crypto.randomUUID();
      pending.phase = "sending";
      this.localError = undefined;
      this.localRun = queued(
        "retry" in pending.body
          ? (this.serverRun?.id ?? pending.requestId)
          : pending.response
            ? (this.serverRun?.id ?? pending.requestId)
            : pending.requestId,
      );
      if (pending.message)
        this.messages = withPrompt(this.messages, pending.message);
      this.publish();
      await this.flush();
      return;
    }
    if (
      !this.serverRun ||
      !["failed", "canceled"].includes(this.serverRun.status)
    )
      return;
    const requestId = crypto.randomUUID();
    this.pending = {
      requestId,
      phase: "sending",
      baselineUpdatedAt: this.serverRun.updatedAt,
      body: { retry: true, runId: this.serverRun.id },
    };
    this.localError = undefined;
    this.localRun = queued(this.serverRun.id);
    this.publish();
    await this.flush();
  };

  clearError = () => {
    if (!this.localError) return;
    this.localError = undefined;
    this.publish();
  };

  // Persists the cancel, including when the original submit has not arrived.
  // The run id of a submit still in flight is its request id.
  stop = async () => {
    const runId = this.stopTarget();
    if (!runId) return;
    const requestId =
      this.pending && "retry" in this.pending.body
        ? this.pending.requestId
        : (this.serverRun?.requestId ?? runId);
    let response: Response;
    try {
      response = await this.fetchImpl(this.stopUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ runId, requestId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const wrapped = new ConnectivityError(
        error instanceof Error
          ? error.message
          : "Litto could not be stopped. Try again.",
      );
      this.stopError = true;
      this.localError = wrapped;
      this.publish();
      throw wrapped;
    }
    if (!response.ok) {
      const wrapped = new Error(await responseError(response));
      this.stopError = true;
      this.localError = wrapped;
      this.publish();
      throw wrapped;
    }
    try {
      const snapshot = (await response.json()) as ChatSnapshot;
      this.localError = undefined;
      this.writeEpoch++;
      this.stopError = false;
      this.canceledRequest = requestId;
      this.absorb(snapshot, false);
    } catch {
      const error = new ConnectivityError(
        "Litto's cancellation could not be confirmed. Try Stop again.",
      );
      this.stopError = true;
      this.localError = error;
      this.publish();
      throw error;
    }
  };

  hasUnacceptedPrompt() {
    return !!this.pending?.message;
  }

  promptPreview() {
    const message = this.pending?.message;
    if (!message) return null;
    const text = textOf(message);
    return text ? text.slice(0, 160) : null;
  }

  private stopTarget() {
    if (
      this.pending &&
      "retry" in this.pending.body &&
      this.serverRun?.id.startsWith("legacy:")
    )
      return this.pending.requestId;
    if (this.serverRun && ACTIVE.has(this.serverRun.status))
      return this.serverRun.id;
    if (
      this.pending &&
      (this.pending.phase === "sending" ||
        this.pending.phase === "uncertain") &&
      ("message" in this.pending.body || "retry" in this.pending.body)
    )
      return "message" in this.pending.body
        ? this.pending.requestId
        : (this.serverRun?.id ?? this.localRun?.id ?? null);
    if (this.localRun && ACTIVE.has(this.localRun.status))
      return this.localRun.id;
    if (!this.serverRun && this.messages.some((m) => m.parts.some(waitingPart)))
      return (this.legacyStopId ??= crypto.randomUUID());
    return null;
  }

  private async respond(response: ChatResponse) {
    if (this.pending?.phase === "sending") return;
    const requestId = crypto.randomUUID();
    this.pending = {
      requestId,
      phase: "sending",
      response,
      baselineUpdatedAt: this.serverRun?.updatedAt ?? null,
      body: { response },
    };
    this.localError = undefined;
    this.messages = applyResponse(this.messages, response);
    if (
      this.serverRun &&
      !this.messages.some((message) => message.parts.some(waitingPart))
    )
      this.localRun = queued(this.serverRun.id);
    this.publish();
    await this.flush();
  }

  private async flush() {
    if (this.flight) return this.flight;
    const pending = this.pending;
    if (pending?.phase !== "sending") return;
    this.flight = this.post(pending).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  private async post(pending: Pending) {
    this.writeEpoch++;
    let response: Response;
    try {
      response = await this.fetchImpl("/api/intelligence/chat", {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id: this.id,
          organizationId: this.organizationId,
          surface: this.surface,
          requestId: pending.requestId,
          ...pending.body,
        }),
      });
    } catch (error) {
      this.fail(
        pending,
        new ConnectivityError(
          error instanceof Error
            ? error.message
            : "The message did not reach Litto. Retry to send it again.",
        ),
        true,
      );
      return;
    }
    if (!response.ok) {
      const message = await responseError(response);
      const uncertain = retryableStatus(response.status);
      this.fail(
        pending,
        uncertain ? new ConnectivityError(message) : new Error(message),
        uncertain,
      );
      return;
    }
    try {
      const snapshot = (await response.json()) as ChatSnapshot;
      this.writeEpoch++;
      this.absorb(snapshot, false);
    } catch {
      this.fail(
        pending,
        new ConnectivityError(
          "Litto's response could not be read. Retry to check the same submission.",
        ),
        true,
      );
    }
  }

  private fail(pending: Pending, error: Error, uncertain: boolean) {
    if (this.pending !== pending) return;
    pending.phase = uncertain ? "uncertain" : "rejected";
    this.localRun = null;
    this.localError = error;
    if (pending.message)
      this.messages = withPrompt(this.messages, pending.message);
    this.publish();
  }

  private absorb(snapshot: ChatSnapshot, initial: boolean) {
    if (snapshot.version !== undefined && snapshot.version < this.serverVersion)
      return;
    if (snapshot.version !== undefined) this.serverVersion = snapshot.version;
    const serverMessages = snapshot.messages ?? [];
    const serverRun = snapshot.run ?? null;
    let messages = serverMessages;
    const previousPending = this.pending;
    let pending = previousPending;

    if (pending?.message && "message" in pending.body) {
      if (serverMessages.some((message) => message.id === pending!.message!.id))
        pending = null;
      else messages = withPrompt(serverMessages, pending.message);
    } else if (pending?.response) {
      const advanced =
        !!serverRun &&
        serverRun.updatedAt !== pending.baselineUpdatedAt &&
        serverRun.status !== "waiting";
      if (responseApplied(serverMessages, pending.response) || advanced)
        pending = null;
      else if (responseTargets(serverMessages, pending.response))
        messages = applyResponse(serverMessages, pending.response);
      else pending = null;
    } else if (pending && "retry" in pending.body) {
      if (
        serverRun &&
        (serverRun.requestId === pending.requestId ||
          serverRun.id === pending.requestId ||
          !["failed", "canceled"].includes(serverRun.status))
      )
        pending = null;
    }

    this.pending = pending;
    this.serverRun = serverRun;
    if (
      this.stopError &&
      serverRun &&
      ["completed", "failed", "canceled"].includes(serverRun.status)
    ) {
      this.stopError = false;
      this.localError = undefined;
    }
    this.localRun = this.overlay(serverRun, pending, messages);
    if (previousPending && previousPending !== pending)
      this.localError = undefined;
    this.messages = messages;
    this.observe(snapshot, messages, initial);
    this.publish();
  }

  private overlay(
    server: ChatRunSummary | null,
    pending: Pending | null,
    messages: ChatMessage[],
  ) {
    if (pending?.phase !== "sending") return null;
    if ("message" in pending.body) {
      if (this.canceledRequest === pending.requestId)
        return { ...queued(pending.requestId), status: "canceled" as const };
      if (server?.id === pending.requestId) return null;
      return queued(pending.requestId);
    }
    if ("retry" in pending.body) {
      if (this.canceledRequest === pending.requestId)
        return {
          ...queued(server?.id ?? pending.requestId),
          status: "canceled" as const,
        };
      if (server && !["failed", "canceled"].includes(server.status))
        return null;
      return queued(server?.id ?? pending.requestId);
    }
    if (
      pending.response &&
      server &&
      !messages.some((message) => message.parts.some(waitingPart))
    )
      return queued(server.id);
    return null;
  }

  private observe(
    snapshot: ChatSnapshot,
    messages: ChatMessage[],
    initial: boolean,
  ) {
    const title = snapshot.chat?.title ?? null;
    if (!initial && title && title !== this.title) this.onTitle?.(title);
    this.title = title;
    const run = snapshot.run;
    if (!initial && this.seen && run && this.finished(this.observed, run)) {
      const message = [...messages]
        .reverse()
        .find((item) => item.role === "assistant") ?? {
        id: "assistant",
        role: "assistant" as const,
        parts: [],
      };
      this.onFinish?.({
        message,
        isAbort: run.status === "canceled",
        isDisconnect: false,
        isError: run.status === "failed",
      });
    }
    this.observed = run;
    this.seen = true;
  }

  private finished(previous: ChatRunSummary | null, run: ChatRunSummary) {
    if (!previous || (previous.id === run.id && previous.status === run.status))
      return false;
    if (previous.id === run.id)
      return PRODUCING.has(previous.status) && SETTLED.has(run.status);
    return SETTLED.has(run.status) && !PRODUCING.has(run.status);
  }

  private derive(): ChatView {
    const run = this.localRun ?? this.serverRun;
    const failed =
      !this.localRun && run?.status === "failed"
        ? new Error(run.error ?? "Litto stopped unexpectedly. Try again.")
        : undefined;
    const error = this.localError ?? failed ?? this.connectionError;
    const status =
      run?.status === "queued"
        ? "submitted"
        : run?.status === "running"
          ? "streaming"
          : error
            ? "error"
            : "ready";
    return {
      messages: this.messages,
      status,
      error,
      canRetry: this.canRetry(),
    };
  }

  private canRetry() {
    if (this.stopError) return false;
    if (this.pending && this.pending.phase !== "sending") return true;
    return (
      this.serverRun?.status === "failed" ||
      this.serverRun?.status === "canceled"
    );
  }

  private sign(view: ChatView) {
    const run = this.localRun ?? this.serverRun;
    return JSON.stringify({
      messages: view.messages,
      status: view.status,
      error: view.error?.message ?? null,
      canRetry: view.canRetry,
      // So a turn that settles without changing the text still notifies.
      outcome: run ? [run.id, run.status] : null,
    });
  }

  private publish() {
    const view = this.derive();
    const signature = this.sign(view);
    if (signature === this.signature) return;
    this.signature = signature;
    this.view = view;
    for (const listener of this.listeners) listener();
  }

  private snapshotUrl() {
    return `/api/intelligence/chats/${encodeURIComponent(this.id)}?${this.query()}`;
  }

  private stopUrl() {
    return `/api/intelligence/chats/${encodeURIComponent(this.id)}/stop?${this.query()}`;
  }

  private query() {
    return `organizationId=${encodeURIComponent(this.organizationId)}`;
  }
}

function queued(id: string): ChatRunSummary {
  return {
    id,
    status: "queued",
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

function userMessage(input: SendInput): ChatMessage {
  const parts = input.parts ?? [{ type: "text", text: input.text ?? "" }];
  return { id: crypto.randomUUID(), role: "user", parts };
}

export function createChat(options: {
  id: string;
  organizationId: string;
  surface: "page" | "dock";
  messages?: ChatMessage[];
  onTitle?: (title: string) => void;
  onFinish?: (event: ChatFinish) => void;
  fetch?: typeof fetch;
  polling?: false | PollEnv;
}) {
  return new LittoChat(options);
}
