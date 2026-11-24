// Supervision of the personal runner (`lictory-runner`, apps/runner) as a
// child process of the desktop app. Electron-free: the main process passes
// the command, a spawn function and a clock, so restarts and log capture are
// tested without starting anything.
//
// Exit codes (the contract with lictory-runner, docs/internals/desktop.md):
// 0 is a clean stop; 64–78 (sysexits: usage, configuration, not registered)
// is permanent until the person changes something, so it is not retried;
// anything else, and death by a signal we did not send, restarts the runner
// after an exponential backoff.

export type RunnerStatus =
  "stopped" | "starting" | "running" | "backoff" | "stopping" | "failed";

export type LogLine = {
  at: number;
  stream: "stdout" | "stderr" | "supervisor";
  text: string;
};

export type RunnerSnapshot = {
  status: RunnerStatus;
  pid: number | null;
  restarts: number;
  nextRestartAt: number | null;
  lastExit: { code: number | null; signal: string | null } | null;
  message: string | null;
};

export const stoppedSnapshot: RunnerSnapshot = {
  status: "stopped",
  pid: null,
  restarts: 0,
  nextRestartAt: null,
  lastExit: null,
  message: null,
};

type Readable = {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
};
export type RunnerChild = {
  pid?: number | undefined;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "spawn", listener: () => void): unknown;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};
export type SpawnRunner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd?: string },
) => RunnerChild;

export type Clock = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type SupervisorOptions = {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  spawn: SpawnRunner;
  clock?: Clock;
  initialDelayMs?: number;
  maxDelayMs?: number;
  // A run this long resets the backoff.
  stableAfterMs?: number;
  // How long a stop waits for a graceful exit before killing.
  stopGraceMs?: number;
  maxLogLines?: number;
  onChange?: (snapshot: RunnerSnapshot) => void;
};

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

const MAX_LINE = 2000;
// Terminal colour codes.
const ansi = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function backoffDelay(attempt: number, initial: number, max: number) {
  return Math.min(max, initial * 2 ** Math.max(0, attempt));
}

export function isPermanentExit(code: number | null) {
  return code !== null && code >= 64 && code <= 78;
}

export function createRunnerSupervisor(options: SupervisorOptions) {
  const clock = options.clock ?? systemClock;
  const initial = options.initialDelayMs ?? 1000;
  const max = options.maxDelayMs ?? 60_000;
  const stableAfter = options.stableAfterMs ?? 60_000;
  const grace = options.stopGraceMs ?? 10_000;
  const maxLines = options.maxLogLines ?? 1000;

  let wanted = false;
  let child: RunnerChild | null = null;
  let startedAt = 0;
  let attempt = 0;
  let restartTimer: unknown = null;
  let stopping: Promise<void> | null = null;
  const lines: LogLine[] = [];
  const partial = { stdout: "", stderr: "" };
  let snapshot: RunnerSnapshot = stoppedSnapshot;

  function update(patch: Partial<RunnerSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    options.onChange?.(snapshot);
  }

  function push(stream: LogLine["stream"], text: string) {
    const clean = text.replace(ansi, "").replace(/\r$/, "");
    lines.push({
      at: clock.now(),
      stream,
      text: clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE)}…` : clean,
    });
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
  }

  function capture(stream: "stdout" | "stderr", chunk: Buffer | string) {
    const text = partial[stream] + chunk.toString();
    const parts = text.split("\n");
    partial[stream] = parts.pop() ?? "";
    // A line without an end is kept until it ends, up to the line limit.
    if (partial[stream].length > MAX_LINE) {
      push(stream, partial[stream]);
      partial[stream] = "";
    }
    for (const part of parts) push(stream, part);
  }

  function flush() {
    for (const stream of ["stdout", "stderr"] as const)
      if (partial[stream]) {
        push(stream, partial[stream]);
        partial[stream] = "";
      }
  }

  function launch() {
    restartTimer = null;
    update({ status: "starting", nextRestartAt: null, message: null });
    let proc: RunnerChild;
    try {
      proc = options.spawn(options.command, options.args, {
        env: options.env,
        cwd: options.cwd,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    }
    child = proc;
    startedAt = clock.now();
    proc.stdout?.on("data", (chunk) => capture("stdout", chunk));
    proc.stderr?.on("data", (chunk) => capture("stderr", chunk));
    proc.on("spawn", () => {
      if (child !== proc) return;
      push("supervisor", `Started lictory-runner (pid ${proc.pid ?? "?"}).`);
      update({ status: "running", pid: proc.pid ?? null });
    });
    proc.on("error", (error) => {
      if (child !== proc) return;
      child = null;
      fail(`lictory-runner could not start: ${error.message}`);
    });
    proc.on("exit", (code, signal) => {
      if (child !== proc) return;
      child = null;
      flush();
      exited(code, signal);
    });
  }

  function fail(message: string) {
    wanted = false;
    push("supervisor", message);
    update({ status: "failed", pid: null, message, nextRestartAt: null });
  }

  function exited(code: number | null, signal: NodeJS.Signals | null) {
    const lastExit = { code, signal };
    push(
      "supervisor",
      signal
        ? `lictory-runner was stopped by ${signal}.`
        : `lictory-runner exited with code ${code}.`,
    );
    if (!wanted) {
      update({ status: "stopped", pid: null, lastExit, nextRestartAt: null });
      return;
    }
    if (code === 0) {
      wanted = false;
      update({ status: "stopped", pid: null, lastExit, nextRestartAt: null });
      return;
    }
    if (isPermanentExit(code)) {
      wanted = false;
      update({
        status: "failed",
        pid: null,
        lastExit,
        nextRestartAt: null,
        message: `lictory-runner stopped (exit code ${code}) and will not restart until its configuration changes. See the log for its reason.`,
      });
      return;
    }
    if (clock.now() - startedAt >= stableAfter) attempt = 0;
    const delay = backoffDelay(attempt, initial, max);
    attempt++;
    const nextRestartAt = clock.now() + delay;
    push(
      "supervisor",
      `Restarting in ${Math.round(delay / 1000)} s (restart ${snapshot.restarts + 1}).`,
    );
    update({
      status: "backoff",
      pid: null,
      lastExit,
      nextRestartAt,
      restarts: snapshot.restarts + 1,
    });
    restartTimer = clock.setTimeout(launch, delay);
  }

  return {
    start() {
      if (wanted && (child || restartTimer)) return;
      wanted = true;
      attempt = 0;
      if (stopping || child) return;
      launch();
    },
    // Resolves once the process is gone: SIGTERM, then SIGKILL after the
    // grace period.
    stop(): Promise<void> {
      wanted = false;
      if (restartTimer) {
        clock.clearTimeout(restartTimer);
        restartTimer = null;
        update({ status: "stopped", nextRestartAt: null });
      }
      const proc = child;
      if (!proc) return Promise.resolve();
      stopping ??= new Promise<void>((resolve) => {
        update({ status: "stopping" });
        const timer = clock.setTimeout(() => {
          push(
            "supervisor",
            "lictory-runner did not stop in time; killing it.",
          );
          proc.kill("SIGKILL");
        }, grace);
        proc.on("exit", () => {
          clock.clearTimeout(timer);
          stopping = null;
          resolve();
          // Started again while stopping.
          if (wanted && !child) launch();
        });
        proc.kill("SIGTERM");
      });
      return stopping;
    },
    snapshot: () => snapshot,
    logs: (): readonly LogLine[] => lines,
  };
}

export type RunnerSupervisor = ReturnType<typeof createRunnerSupervisor>;
