import type { ChildProcess } from "node:child_process";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { HarnessId } from "@lictory/core/factory/protocol";
import type { EventType } from "@lictory/runner/events";
import type { RunnerConfig } from "@lictory/runner/config";

// A coding harness (Claude Code, Codex, the built-in loop…) behind one
// interface, so a session runs the same way whichever agent it is. The
// domain never sees a harness's own stream format: adapters translate it
// into session events.

export type SpawnOptions = {
  env?: Record<string, string>;
  stdin?: "pipe" | "ignore";
};

// Starts processes for the session: on the host in the worktree, or inside
// the session's container (`cwd` is then the path inside it).
export type Exec = {
  cwd: string;
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess;
};

export type HarnessResult = {
  outcome: "completed" | "failed";
  summary?: string;
  error?: string;
};

export type HarnessContext = {
  sessionId: string;
  prompt: string;
  instructions: string;
  model: string | null;
  // The worktree on this machine (file tools of the built-in harness).
  worktree: string;
  exec: Exec;
  config: RunnerConfig;
  // Lictory's MCP endpoint and the session's token, for the harness's
  // Lictory tools.
  lictory: { mcpUrl: string; token: string; organizationId: string };
  // A private directory for the session's files (MCP configuration…),
  // inside the worktree and ignored by git: its path on this machine and
  // as the harness sees it.
  scratch: { host: string; exec: string };
  emit(type: EventType, data: Record<string, unknown>): void;
  emitText(type: "message" | "reasoning", delta: string): void;
  // The next steering message, or null after `waitMs` without one (or
  // when `signal` aborts, leaving queued messages in place).
  nextMessage(waitMs: number, signal?: AbortSignal): Promise<string | null>;
  // The model proxy, for the built-in harness (null when unavailable).
  languageModel: LanguageModelV4 | null;
  signal: AbortSignal;
  log(message: string): void;
};

export type HarnessRun = {
  // Stops the current turn; the harness then waits for the next message.
  interrupt(): void;
  answer(
    requestId: string,
    decision: "approve" | "deny",
    note: string | null,
  ): void;
  // Ends the run now (cancel, lost lease, shutdown).
  stop(): void;
  done: Promise<HarnessResult>;
};

export type AgentHarness = {
  id: HarnessId;
  // The installed version, or null when it is not available.
  detect(config: RunnerConfig): Promise<string | null>;
  start(context: HarnessContext): HarnessRun;
};

// After a turn ends, how long the session waits for another message before
// it completes; after an interrupt, how long it waits for the person.
export const IDLE_GRACE_MS = 4_000;
export const INTERRUPTED_WAIT_MS = 30 * 60_000;
