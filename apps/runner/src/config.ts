import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { harnessIds, isolationModes } from "@lictory/core/factory/protocol";
// The product version, which release builds set in the root package.json
// (scripts/inject-release-version.ts) before compiling the binaries.
import { version } from "../../../package.json" with { type: "json" };

// The runner's configuration and its credential, in one file readable only
// by the account running it. The credential is the only secret the runner
// keeps; per-session credentials are fetched and never written to disk.

export const RUNNER_VERSION: string = version;

export function homeDirectory(env = process.env) {
  if (env.LICTORY_RUNNER_HOME) return env.LICTORY_RUNNER_HOME;
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "lictory-runner");
    case "win32":
      return join(
        env.APPDATA ?? join(home, "AppData", "Roaming"),
        "lictory-runner",
      );
    default:
      return join(
        env.XDG_CONFIG_HOME ?? join(home, ".config"),
        "lictory-runner",
      );
  }
}

const harnessSettings = z.object({
  // The executable, when it is not on PATH.
  command: z.string().optional(),
  // Extra arguments passed to every run.
  args: z.array(z.string()).optional(),
});

export const configSchema = z.object({
  url: z.url(),
  runnerId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  personal: z.boolean(),
  credential: z.string(),
  maxSessions: z.number().int().min(1).max(64).default(2),
  isolation: z.enum(isolationModes).default("host"),
  // Image for container isolation, chosen by the operator: it must contain
  // git and the harnesses. Lictory publishes none, so there is no default;
  // pin it by digest (image@sha256:…) so a moved tag cannot change it.
  containerImage: z.string().min(1).optional(),
  // Docker network for containers ("none" cuts them off entirely).
  containerNetwork: z.string().default("bridge"),
  labels: z.array(z.string()).default([]),
  // Repositories are cached and worktrees created here.
  workDir: z.string().optional(),
  // Claude Code's permission mode: what it may do without asking a person.
  claudePermissionMode: z
    .enum(["default", "acceptEdits", "plan", "bypassPermissions"])
    .default("acceptEdits"),
  // Codex's sandbox for commands it runs.
  codexSandbox: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .default("workspace-write"),
  // Keep a session's worktree after it ends (for inspection).
  keepWorktrees: z.boolean().default(false),
  harnesses: z.partialRecord(z.enum(harnessIds), harnessSettings).default({}),
});
export type RunnerConfig = z.infer<typeof configSchema>;

export const configPath = (home = homeDirectory()) => join(home, "config.json");
export const statePath = (home = homeDirectory()) => join(home, "state.json");

export function workDirectory(config: RunnerConfig, home = homeDirectory()) {
  return config.workDir ?? join(home, "work");
}

export async function readConfig(home = homeDirectory()) {
  let raw: string;
  try {
    raw = await readFile(configPath(home), "utf8");
  } catch {
    return null;
  }
  return configSchema.parse(JSON.parse(raw));
}

// Written atomically and readable only by this account.
export async function writeConfig(
  config: RunnerConfig,
  home = homeDirectory(),
) {
  const path = configPath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}

// What `status` reads: written by the running daemon at start, on every
// heartbeat (whether or not the server answered) and when it stops.
export type RunnerState = {
  pid: number;
  startedAt: string;
  // When the daemon last wrote this file; null once it has stopped.
  updatedAt?: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  // The server refused the credential and the runner stopped: a person
  // must register it again (status says so instead of "start it").
  revoked?: boolean;
  sessions: { id: string; title: string; harness: string; state: string }[];
};

export async function writeState(state: RunnerState, home = homeDirectory()) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = statePath(home);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

export async function readState(home = homeDirectory()) {
  try {
    return JSON.parse(await readFile(statePath(home), "utf8")) as RunnerState;
  } catch {
    return null;
  }
}

// Whether the runner that wrote `state` is still running: its process
// exists and it wrote the file recently. The age check keeps a stale file
// from claiming a running runner when the PID was reused after a crash or
// a reboot.
export function runnerLiveness(
  state: RunnerState | null,
  options: { now?: number; staleAfterMs: number },
): "running" | "unresponsive" | "stopped" {
  if (!state || state.updatedAt === null) return "stopped";
  try {
    process.kill(state.pid, 0);
  } catch (error) {
    // EPERM: the process exists but belongs to another account.
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return "stopped";
  }
  const updated = Date.parse(state.updatedAt ?? state.startedAt);
  if (Number.isNaN(updated)) return "stopped";
  const age = (options.now ?? Date.now()) - updated;
  return age <= options.staleAfterMs ? "running" : "unresponsive";
}

// Why a configuration cannot isolate sessions in containers, or null.
export function containerImageProblem(config: {
  isolation: string;
  containerImage?: string;
}): string | null {
  if (config.isolation !== "container") return null;
  if (!config.containerImage)
    return "Container isolation needs an image that contains git and the harnesses: set containerImage in config.json, or register with --container-image <image@sha256:digest>.";
  return null;
}

// A container image reference that a moved tag cannot change.
export const pinnedImage = (image: string) =>
  /@sha256:[a-f0-9]{64}$/.test(image);
