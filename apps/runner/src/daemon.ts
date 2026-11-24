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
import { SessionRun } from "@lictory/runner/session";

// `lictory-runner start`: heartbeats, claims assignments while it has
// capacity and runs each in a SessionRun. Everything is outbound: the
// runner needs no open port. SIGINT/SIGTERM stop claiming, hand running
// sessions back to the queue and exit.

export function machineReport(
  config: RunnerConfig,
  detected: Detected,
): MachineReport {
  return {
    os: platform(),
    arch: arch(),
    version: RUNNER_VERSION,
    hostname: hostname().slice(0, 200),
    harnesses: detected.map((d) => ({ id: d.id, version: d.version })),
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
    ((message: string) =>
      console.log(`${new Date().toISOString()} ${message}`));
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
  };
  const saveState = () =>
    writeState(
      {
        ...state,
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
  const beat = async () => {
    try {
      const result = await client.heartbeat({
        ...report,
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
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      if (error instanceof ProtocolError && error.status === 401) {
        revoked = true;
        log(
          "The server refused this runner's credential: it was revoked. Register the runner again.",
        );
        stopping.abort();
      } else log(`Heartbeat failed: ${state.lastError}`);
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
  while (!stopped.aborted) {
    if (busy() >= config.maxSessions) {
      await delay(1_000, stopped);
      continue;
    }
    try {
      const assignment = await client.claim(MAX_POLL_SECONDS, stopped);
      failures = 0;
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
        `Session ${assignment.sessionId}: ${assignment.title} (${assignment.agent.name}, ${assignment.agent.harness})`,
      );
      const run = new SessionRun(assignment, {
        client,
        config,
        harness,
        workDir,
        log,
      });
      sessions.set(run.id, run);
      void saveState();
      void run
        .run()
        .catch((error: unknown) =>
          log(
            `Session ${run.id} crashed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => {
          sessions.delete(run.id);
          log(`Session ${run.id} ended.`);
          void saveState();
        });
    } catch (error) {
      if (stopped.aborted) break;
      if (error instanceof ProtocolError && error.status === 401) {
        revoked = true;
        log(
          "The server refused this runner's credential: it was revoked. Register the runner again.",
        );
        break;
      }
      failures++;
      state.lastError = error instanceof Error ? error.message : String(error);
      log(`Claim failed: ${state.lastError}`);
      await delay(Math.min(60_000, 1_000 * 2 ** failures), stopped);
    }
  }

  clearInterval(heartbeat);
  for (const run of sessions.values()) run.stop("shutdown");
  const deadline = Date.now() + 20_000;
  while (sessions.size && Date.now() < deadline) await delay(250);
  await saveState();
  process.off("SIGINT", shutdown);
  process.off("SIGTERM", shutdown);
  log("Stopped.");
  return { revoked };
}
