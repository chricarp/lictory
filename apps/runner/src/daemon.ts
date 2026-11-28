import { arch, hostname, platform } from "node:os";
import {
  HEARTBEAT_SECONDS,
  MAX_POLL_SECONDS,
  type MachineReport,
} from "@lictory/core/factory/protocol";
import { ProtocolError, RunnerClient, delay } from "@lictory/runner/client";
import {
  RUNNER_VERSION,
  homeDirectory,
  readState,
  runnerLiveness,
  workDirectory,
  writeState,
  type RunnerConfig,
} from "@lictory/runner/config";
import {
  detectHarnesses,
  harnessFor,
  type Detected,
} from "@lictory/runner/harness/index";
import type { AgentHarness } from "@lictory/runner/harness/types";
import { CliError, EXIT, duration, stamp } from "@lictory/runner/output";
import { SessionRun, type SessionEnd } from "@lictory/runner/session";

// A daemon writes its state at least this often; older state is not a
// running runner (see runnerLiveness).
export const STATE_STALE_MS = 3 * HEARTBEAT_SECONDS * 1000;

export const REVOKED_MESSAGE = (config: RunnerConfig) =>
  `The server refused this runner's credential: ${config.name} was removed or revoked in Factory → Runners. ` +
  `Create a registration token there, run \`lictory-runner register --url ${config.url} --token <token> --force\`, then start the runner again. ` +
  `It exits with code ${EXIT.needsPerson}, which the service does not restart on.`;

// One runner per configuration: two would share one credential and one
// state file, and `status` could describe only one of them.
export async function refuseIfRunning(home = homeDirectory()) {
  const state = await readState(home);
  const liveness = runnerLiveness(state, { staleAfterMs: STATE_STALE_MS });
  if (state && liveness === "running" && state.pid !== process.pid)
    throw new CliError(
      `A runner already runs with this configuration (pid ${state.pid}, ${home}). ` +
        "Stop it first (Ctrl-C in its terminal, or systemctl --user stop lictory-runner for the service). " +
        "To run a second runner on this machine, register it with its own LICTORY_RUNNER_HOME.",
    );
}

// The line a session's end leaves in the log.
export function endLine(
  id: string,
  end: SessionEnd,
  elapsedMs: number,
): string {
  const after = `after ${duration(elapsedMs)}`;
  switch (end.outcome) {
    case "completed":
      return `Session ${id} completed ${after}${
        end.branch
          ? `; pushed branch ${end.branch}, which Lictory opens or updates a pull request for`
          : end.repository
            ? "; nothing to push"
            : " (no repository linked: nothing pushed)"
      }.`;
    case "failed":
      return `Session ${id} failed ${after}: ${end.error.split("\n", 1)[0]!.slice(0, 300)}${end.reported ? "" : " The result could not be reported to the server."}`;
    case "canceled":
      return `Session ${id} was canceled in Lictory ${after}.`;
    case "lost":
      return `Session ${id} stopped ${after}: this runner no longer held it. The server puts it back in the queue or has ended it.`;
    case "returned":
      return `Session ${id} returned to the queue ${after}.`;
  }
}

// `lictory-runner start`: heartbeats, claims assignments while it has
// capacity and runs each in a SessionRun. Everything is outbound: the
// runner needs no open port. SIGINT/SIGTERM stop claiming, hand running
// sessions back to the queue and exit.

// What each harness may do without asking, from the runner's own
// configuration, so the agent page can tell people before they rely on it.
function harnessPermissions(id: string, config: RunnerConfig) {
  if (id === "claude-code") return { permissions: config.claudePermissionMode };
  if (id === "codex") return { permissions: config.codexSandbox };
  return {};
}

export function machineReport(
  config: RunnerConfig,
  detected: Detected,
): MachineReport {
  return {
    os: platform(),
    arch: arch(),
    version: RUNNER_VERSION,
    hostname: hostname().slice(0, 200),
    harnesses: detected.map((d) => ({
      id: d.id,
      version: d.version,
      ...harnessPermissions(d.id, config),
    })),
    labels: config.labels,
    maxSessions: config.maxSessions,
    isolation: config.isolation,
  };
}

export async function startDaemon(
  config: RunnerConfig,
  options: {
    harnesses: AgentHarness[];
    log?: (message: string) => void;
    signal?: AbortSignal;
    home?: string;
  },
) {
  const log =
    options.log ??
    ((message: string) => void process.stdout.write(`${stamp()} ${message}\n`));
  const home = options.home ?? homeDirectory();
  const client = new RunnerClient(config.url, config.credential);
  const detected = await detectHarnesses(options.harnesses, config);
  if (!detected.length)
    log(
      "No harness was found on this machine; agents cannot run here until one is installed (lictory-runner doctor).",
    );
  else
    log(
      `Harnesses: ${detected.map((d) => `${d.id} ${d.version ?? ""}`.trim()).join(", ")}`,
    );
  const report = machineReport(config, detected);
  const sessions = new Map<string, SessionRun>();
  const stopping = new AbortController();
  const stopped = options.signal
    ? AbortSignal.any([options.signal, stopping.signal])
    : stopping.signal;
  const state = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: null as string | null,
    lastError: null as string | null,
    revoked: false,
  };
  let running = true;
  const saveState = () =>
    writeState(
      {
        ...state,
        updatedAt: running ? new Date().toISOString() : null,
        sessions: [...sessions.values()].map((s) => ({
          id: s.id,
          title: s.assignment.title,
          harness: s.assignment.agent.harness,
          state: s.state,
        })),
      },
      home,
    ).catch(() => undefined);

  let revoked = false;
  // The last problem met while running, sent with every heartbeat so the
  // runner's page in Lictory says what failed (and when), not only that
  // the runner went offline. Kept after recovery: its time says how old it
  // is.
  let problem: { message: string; at: string } | null = null;
  const met = (message: string) => {
    problem = { message: message.slice(0, 500), at: new Date().toISOString() };
  };
  const heartbeatFailures = failureLog(log, "Heartbeat");
  const beat = async () => {
    // Written before the request too, so a slow server never makes a
    // running runner look stopped.
    await saveState();
    try {
      const result = await client.heartbeat({
        ...report,
        lastError: problem,
        sessions: [...sessions.values()].map((s) => ({
          sessionId: s.id,
          leaseToken: s.assignment.leaseToken,
        })),
      });
      state.lastHeartbeatAt = new Date().toISOString();
      state.lastError = null;
      for (const lease of result?.leases ?? [])
        if (!lease.held)
          sessions
            .get(lease.sessionId)
            ?.stop(lease.status === "canceled" ? "canceled" : "lost");
      heartbeatFailures.ok();
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      if (error instanceof ProtocolError && error.status === 401) {
        revoked = true;
        state.revoked = true;
        log(REVOKED_MESSAGE(config));
        stopping.abort();
      } else {
        met(`Heartbeat failed: ${state.lastError}`);
        heartbeatFailures.fail(state.lastError);
      }
    }
    await saveState();
  };

  const shutdown = () => {
    if (stopping.signal.aborted) return;
    log("Stopping: no new sessions; running sessions return to the queue.");
    stopping.abort();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await beat();
  const heartbeat = setInterval(() => void beat(), HEARTBEAT_SECONDS * 1000);
  const workDir = workDirectory(config, home);
  // Waiting sessions keep their lease without taking a slot.
  const busy = () =>
    [...sessions.values()].filter((s) => s.state !== "waiting").length;

  let failures = 0;
  const claimFailures = failureLog(log, "Asking for work");
  while (!stopped.aborted) {
    if (busy() >= config.maxSessions) {
      await delay(1_000, stopped);
      continue;
    }
    try {
      const assignment = await client.claim(MAX_POLL_SECONDS, stopped);
      failures = 0;
      claimFailures.ok();
      if (!assignment) continue;
      const harness = harnessFor(detected, assignment.agent.harness);
      if (!harness) {
        log(
          `Claimed ${assignment.sessionId} but ${assignment.agent.harness} is not installed; handing it back.`,
        );
        await client
          .session(assignment.sessionId)
          .release(assignment.leaseToken)
          .catch(() => undefined);
        await delay(5_000, stopped);
        continue;
      }
      log(
        `Session ${assignment.sessionId}: ${assignment.title} (${assignment.agent.name}, ${assignment.agent.harness})${assignment.sessionUrl ? ` ${assignment.sessionUrl}` : ""}`,
      );
      const run = new SessionRun(assignment, {
        client,
        config,
        harness,
        workDir,
        log,
        // `status` reads the state file: a session that starts waiting on
        // a person says so at once, not a heartbeat later.
        onStateChange: () => void saveState(),
        leaseStatus: async (signal) => {
          const answer = await client.heartbeat(
            {
              ...report,
              sessions: [
                {
                  sessionId: assignment.sessionId,
                  leaseToken: assignment.leaseToken,
                },
              ],
            },
            signal,
          );
          return answer?.leases[0]?.status ?? null;
        },
      });
      sessions.set(run.id, run);
      void saveState();
      const began = Date.now();
      void run
        .run()
        .then(
          (end) => log(endLine(run.id, end, Date.now() - began)),
          (error: unknown) =>
            log(
              `Session ${run.id} crashed after ${duration(Date.now() - began)}: ${error instanceof Error ? error.message : String(error)}`,
            ),
        )
        .finally(() => {
          sessions.delete(run.id);
          void saveState();
        });
    } catch (error) {
      if (stopped.aborted) break;
      if (error instanceof ProtocolError && error.status === 401) {
        if (!revoked) log(REVOKED_MESSAGE(config));
        revoked = true;
        state.revoked = true;
        break;
      }
      failures++;
      state.lastError = error instanceof Error ? error.message : String(error);
      met(`Asking for work failed: ${state.lastError}`);
      const wait = Math.min(60_000, 1_000 * 2 ** failures);
      claimFailures.fail(state.lastError, ` Next try in ${wait / 1000} s.`);
      await delay(wait, stopped);
    }
  }

  clearInterval(heartbeat);
  for (const run of sessions.values()) run.stop("shutdown");
  const deadline = Date.now() + 20_000;
  while (sessions.size && Date.now() < deadline) await delay(250);
  running = false;
  await saveState();
  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);
  log("Stopped.");
  return { revoked };
}

// A failure that repeats (an unreachable server) is logged once in full,
// then as a short reminder every five minutes, and recovery is logged, so a
// service journal does not fill with the same sentence.
export function failureLog(
  log: (line: string) => void,
  what: string,
  remindEveryMs = 5 * 60_000,
  now = () => Date.now(),
) {
  let last: string | null = null;
  let count = 0;
  let since = 0;
  let reminded = 0;
  return {
    fail(message: string, next = "") {
      const at = now();
      if (message !== last) {
        last = message;
        count = 1;
        since = at;
        reminded = at;
        log(
          `${what} failed: ${message}${next} The runner keeps retrying and says so every ${duration(remindEveryMs)}.`,
        );
        return;
      }
      count++;
      if (at - reminded < remindEveryMs) return;
      reminded = at;
      log(
        `${what} still failing: ${count} attempts since ${new Date(since).toISOString()}.${next}`,
      );
    },
    ok() {
      if (last)
        log(
          `${what} works again after ${count} failed ${count === 1 ? "attempt" : "attempts"}.`,
        );
      last = null;
      count = 0;
    },
  };
}
