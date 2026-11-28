import {
  runnerPhases,
  type Assignment,
  type SessionInput,
} from "@lictory/core/factory/protocol";
import {
  ProtocolError,
  delay,
  withRetry,
  type RunnerClient,
} from "@lictory/runner/client";
import type { RunnerConfig } from "@lictory/runner/config";
import { EventStream } from "@lictory/runner/events";
import { proxyModel } from "@lictory/runner/harness/model-client";
import {
  IDLE_GRACE_MS,
  type AgentHarness,
  type Exec,
  type HarnessContext,
  type HarnessResult,
  type HarnessRun,
} from "@lictory/runner/harness/types";
import { containerExec, hostExec } from "@lictory/runner/process";
import {
  deliverWorkspace,
  prepareWorkspace,
  removeWorkspace,
  type Workspace,
} from "@lictory/runner/workspace";

// One assignment, from claim to result: prepare the worktree, run the
// harness, relay steering inputs, deliver the branch and report. Every
// write carries the lease; once the server says it is gone (canceled,
// expired, revoked), the session stops without reporting anything more.

export type StopReason = "canceled" | "lost" | "shutdown";
export type SessionState = "preparing" | "running" | "waiting" | "finishing";

// How a session ended on this runner, for its log line.
export type SessionEnd =
  | {
      outcome: "completed";
      // Pushed to; absent when there was nothing to push or no repository.
      branch?: string;
      repository: boolean;
      summary?: string;
    }
  | { outcome: "failed"; error: string; reported: boolean }
  | { outcome: "canceled" }
  // The server took the lease away (expired, reassigned or ended there).
  | { outcome: "lost" }
  // The runner stopped; the session went back to the queue.
  | { outcome: "returned" };
class MessageQueue {
  private items: string[] = [];
  private waiters: ((text: string) => void)[] = [];
  get queued() {
    return this.items.length;
  }
  push(text: string) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(text);
    else this.items.push(text);
  }
  take(waitMs: number, signal?: AbortSignal) {
    const queued = this.items.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise<string | null>((resolve) => {
      const settle = (value: string | null) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        this.waiters = this.waiters.filter((w) => w !== receive);
        resolve(value);
      };
      const receive = (text: string) => settle(text);
      const aborted = () => settle(null);
      const timer = setTimeout(() => settle(null), waitMs);
      signal?.addEventListener("abort", aborted, { once: true });
      this.waiters.push(receive);
    });
  }
}

const ACTIVE = new Set(["assigned", "running", "waiting"]);

// A request's title for one log line.
const firstLine = (text: string) => text.split("\n", 1)[0]!.slice(0, 160);

export class SessionRun {
  private current: SessionState = "preparing";
  // What `lictory-runner status` shows: written to the state file as it
  // changes, not only on the next heartbeat.
  get state() {
    return this.current;
  }
  set state(next: SessionState) {
    if (next === this.current) return;
    this.current = next;
    this.deps.onStateChange?.();
  }
  private readonly abort = new AbortController();
  private reason: StopReason | null = null;
  private readonly messages = new MessageQueue();
  // Open requests, what each asks and whether it is a question (it names
  // no tool: answered in words, never approved), for the log.
  private readonly pendingApprovals = new Map<
    string,
    { title: string; question: boolean }
  >();
  private harnessRun: HarnessRun | null = null;
  private readonly events: EventStream;
  private cursor: number;
  private summary: string | undefined;

  constructor(
    readonly assignment: Assignment,
    private readonly deps: {
      client: RunnerClient;
      config: RunnerConfig;
      harness: AgentHarness;
      workDir: string;
      log: (message: string) => void;
      // The session's status on the server, asked when the lease is gone
      // (the heartbeat answers it): a person's cancel ends the lease too.
      leaseStatus?: (signal: AbortSignal) => Promise<string | null>;
      // Called when `state` changes, so the state file is current.
      onStateChange?: () => void;
    },
  ) {
    const api = deps.client.session(assignment.sessionId);
    this.events = new EventStream(
      async (batch) => {
        const result = await api.events(assignment.leaseToken, batch);
        if (!result)
          throw new Error("The server did not acknowledge the events.");
        return result;
      },
      () => void this.lose(),
    );
    this.cursor = assignment.inputCursor;
  }

  get id() {
    return this.assignment.sessionId;
  }

  // Where a person answers it: the session's page, when the server says.
  private get where() {
    return this.assignment.sessionUrl
      ? ` Open it: ${this.assignment.sessionUrl}`
      : "";
  }

  stop(reason: StopReason) {
    if (this.reason) return;
    this.reason = reason;
    this.deps.log(
      `Session ${this.id}: ${
        reason === "canceled"
          ? "canceled in Lictory; stopping the agent."
          : reason === "lost"
            ? "this runner no longer holds the session (its lease expired or it ended on the server); stopping the agent."
            : "stopping the agent; the session returns to the queue."
      }`,
    );
    this.harnessRun?.stop();
    this.abort.abort();
  }

  // The server refused the lease: canceled by a person, or lost.
  private async lose() {
    if (this.reason) return;
    const status = await this.deps
      .leaseStatus?.(AbortSignal.timeout(5_000))
      .catch(() => null);
    this.stop(status === "canceled" ? "canceled" : "lost");
  }

  private emit: HarnessContext["emit"] = (type, data) => {
    if (type === "approval_request") {
      const title = typeof data.title === "string" ? data.title : "a tool";
      // The server's rule (asksPermission): a request naming no tool is a
      // question, so the log says so, as the UI does.
      const question = !(typeof data.tool === "string" && data.tool.trim());
      this.pendingApprovals.set(String(data.requestId), { title, question });
      this.state = "waiting";
      this.deps.log(
        `Session ${this.id} waits for ${question ? "a person's answer to" : "a person to approve"} “${firstLine(title)}”.${this.where}`,
      );
    }
    if (type === "summary") this.summary = String(data.text);
    this.events.push(type, data);
  };

  private handleInput(input: SessionInput) {
    switch (input.kind) {
      case "message":
        this.deps.log(
          `Session ${this.id}: a steering message arrived from its thread.`,
        );
        this.messages.push(
          typeof input.data.text === "string" ? input.data.text : "",
        );
        break;
      case "interrupt":
        this.deps.log(`Session ${this.id}: a person interrupted the agent.`);
        this.harnessRun?.interrupt();
        break;
      case "cancel":
        this.stop("canceled");
        break;
      case "approval_answer": {
        const requestId =
          typeof input.data.requestId === "string" ? input.data.requestId : "";
        const decision =
          input.data.decision === "approve"
            ? "approve"
            : input.data.decision === "answer"
              ? "answer"
              : "deny";
        const asked = this.pendingApprovals.get(requestId);
        this.deps.log(
          `Session ${this.id}: a person ${decision === "approve" ? "approved" : decision === "answer" ? "answered" : "denied"} ${asked ? `“${firstLine(asked.title)}”` : "a request"}.`,
        );
        this.pendingApprovals.delete(requestId);
        if (!this.pendingApprovals.size && this.state === "waiting")
          this.state = "running";
        this.harnessRun?.answer(
          requestId,
          decision,
          typeof input.data.note === "string" ? input.data.note : null,
        );
        break;
      }
    }
  }

  // The harness waits for a steering message. A wait longer than the short
  // grace after a turn waits on a person (the agent asked something, or a
  // person interrupted it): the server shows the session as waiting on
  // them until a message arrives or the harness stops waiting.
  private async nextMessage(waitMs: number, signal?: AbortSignal) {
    const stop = signal
      ? AbortSignal.any([signal, this.abort.signal])
      : this.abort.signal;
    const onPerson = waitMs > IDLE_GRACE_MS && this.messages.queued === 0;
    if (onPerson) {
      this.deps.log(
        `Session ${this.id} waits for a person's message in its thread.${this.where}`,
      );
      this.events.push("status", {
        phase: runnerPhases.awaitingMessage,
        message: "Waiting for the next message.",
      });
      if (this.state === "running") this.state = "waiting";
    }
    const text = await this.messages.take(waitMs, stop);
    if (onPerson && !this.abort.signal.aborted) {
      this.events.push("status", { phase: runnerPhases.working });
      if (this.state === "waiting" && !this.pendingApprovals.size)
        this.state = "running";
    }
    return text;
  }

  // The steering inbox, long-polled for as long as the session runs.
  private async steer() {
    const api = this.deps.client.session(this.id);
    let failures = 0;
    while (!this.abort.signal.aborted) {
      try {
        const result = await api.inputs(
          this.assignment.leaseToken,
          this.cursor,
          25,
          this.abort.signal,
        );
        failures = 0;
        for (const input of result?.inputs ?? []) {
          this.cursor = Math.max(this.cursor, input.seq);
          this.handleInput(input);
        }
        if (result && !ACTIVE.has(result.status)) this.stop("canceled");
      } catch (error) {
        if (this.abort.signal.aborted) return;
        if (error instanceof ProtocolError && error.fatal)
          return void (await this.lose());
        failures++;
        await delay(Math.min(15_000, 500 * 2 ** failures), this.abort.signal);
      }
    }
  }

  private async exec(
    workspace: Workspace,
  ): Promise<{ exec: Exec; remove(): Promise<void> }> {
    if (this.deps.config.isolation === "container")
      return containerExec(this.deps.config, this.id, workspace.path);
    return { exec: hostExec(workspace.path), remove: async () => undefined };
  }

  async run(): Promise<SessionEnd> {
    const { client, config, harness, workDir, log } = this.deps;
    const { assignment } = this;
    const api = client.session(this.id);
    const lease = assignment.leaseToken;
    this.events.start();
    let workspace: Workspace | null = null;
    let isolation: { remove(): Promise<void> } | null = null;
    let keep = config.keepWorktrees;
    let result: HarnessResult;
    let branch: string | undefined;
    try {
      // The workspace answer names the repository the session works in;
      // the assignment may only know it by the Code module's choice.
      const fetched = await withRetry(() => api.workspace(lease), {
        signal: this.abort.signal,
      });
      const repository = fetched?.repository ?? null;
      this.events.push("status", {
        phase: "preparing",
        message: repository
          ? `Preparing a worktree of ${repository.url} on ${repository.branch}.`
          : "Preparing an empty workspace: no repository is linked to this session.",
      });
      log(
        repository
          ? `Session ${this.id}: preparing a worktree of ${repository.url} on ${repository.branch}.`
          : `Session ${this.id}: no repository is linked; it works in an empty workspace.`,
      );
      workspace = await prepareWorkspace(workDir, this.id, repository);
      const prepared = await this.exec(workspace);
      isolation = prepared;
      if (this.abort.signal.aborted) throw new Error("stopped");
      await withRetry(() => api.start(lease), { signal: this.abort.signal });
      this.state = "running";
      void this.steer();
      const base = config.url.replace(/\/$/, "");
      const context: HarnessContext = {
        sessionId: this.id,
        prompt: assignment.workItem
          ? `${assignment.prompt}\n\nWork item: ${assignment.workItem.key} ${assignment.workItem.title}`
          : assignment.prompt,
        instructions: assignment.agent.instructions,
        model: assignment.agent.model,
        worktree: workspace.path,
        exec: prepared.exec,
        config,
        lictory: {
          mcpUrl: `${base}/api/mcp`,
          token: assignment.lictory.token,
          organizationId: assignment.organizationId,
        },
        scratch: {
          host: workspace.scratch,
          exec: `${prepared.exec.cwd}/.lictory`,
        },
        emit: this.emit,
        emitText: (type, delta) => this.events.pushText(type, delta),
        nextMessage: (waitMs, signal) => this.nextMessage(waitMs, signal),
        languageModel: assignment.modelProxy
          ? proxyModel(
              client,
              this.id,
              lease,
              assignment.agent.model ?? undefined,
            )
          : null,
        signal: this.abort.signal,
        log: (message) => log(`session ${this.id}: ${message}`),
      };
      this.harnessRun = harness.start(context);
      result = await this.harnessRun.done;
      this.events.closeText();
    } catch (error) {
      result = {
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      if (this.reason === "canceled" || this.reason === "lost")
        return { outcome: this.reason };
      if (this.reason === "shutdown") {
        await this.events.close();
        await api.release(lease).catch(() => undefined);
        return { outcome: "returned" };
      }
      this.state = "finishing";
      if (workspace && result.outcome === "completed") {
        try {
          if (workspace.repository)
            this.events.push("status", {
              phase: "delivering",
              message: "Committing and pushing the branch.",
            });
          const fresh = workspace.repository
            ? ((await api.workspace(lease).catch(() => null))?.repository ??
              null)
            : null;
          const delivered = await deliverWorkspace(
            workspace,
            {
              name: assignment.agent.name,
              email: `${assignment.agent.handle}@agents.lictory.invalid`,
            },
            [
              assignment.title,
              "",
              `Lictory agent session ${this.id}${assignment.workItem ? `\nRefs ${assignment.workItem.key}` : ""}`,
            ].join("\n"),
            fresh,
          );
          if (delivered.files.length)
            this.events.push("file_change", {
              changes: delivered.files.slice(0, 200),
            });
          if (delivered.branch) {
            branch = delivered.branch;
            this.events.push("status", {
              phase: "pushed",
              message: `Pushed ${delivered.commits} commit${delivered.commits === 1 ? "" : "s"} to ${delivered.branch}.`,
            });
          } else if (!workspace.repository)
            // Said plainly: the work is not anywhere a person can find it.
            this.events.push("status", {
              phase: "discarded",
              message:
                "No repository is linked to this session, so nothing was pushed: the files it changed are discarded with its workspace.",
            });
        } catch (error) {
          keep = true;
          result = {
            outcome: "failed",
            summary: result.summary,
            error: `The work is done but the branch was not pushed: ${error instanceof Error ? error.message : String(error)} The worktree is kept at ${workspace.path}.`,
          };
        }
      }
      if (result.outcome === "failed" && result.error)
        this.events.push("error", { message: result.error });
      await this.events.close();
      if (this.events.lost)
        return { outcome: this.reason === "canceled" ? "canceled" : "lost" };
      let reported = true;
      await withRetry(() =>
        api.complete({
          leaseToken: lease,
          outcome: result.outcome,
          summary: (result.summary ?? this.summary)?.slice(0, 12_000),
          error: result.error?.slice(0, 4000),
          branch,
          lastSeq: this.events.lastSeq,
        }),
      ).catch((error: unknown) => {
        reported = false;
        log(
          `session ${this.id}: could not report its result: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      if (this.reason === "canceled") return { outcome: "canceled" };
      return result.outcome === "completed"
        ? {
            outcome: "completed",
            branch,
            repository: Boolean(workspace?.repository),
            summary: result.summary ?? this.summary,
          }
        : {
            outcome: "failed",
            error: result.error ?? "The agent stopped without saying why.",
            reported,
          };
    } finally {
      this.abort.abort();
      await this.events.close().catch(() => undefined);
      await isolation?.remove().catch(() => undefined);
      if (workspace && !keep)
        await removeWorkspace(workspace).catch(() => undefined);
    }
  }
}
