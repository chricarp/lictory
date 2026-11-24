import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type {
  RunnerCommand,
  RunnerCommandResult,
  RunnerState,
} from "../shared/ipc";
import {
  createRunnerSupervisor,
  stoppedSnapshot,
  type RunnerSupervisor,
  type SpawnRunner,
} from "../shared/runner";
import type { ServersState } from "../shared/servers";

// The personal runner: lictory-runner (apps/runner) started by the desktop
// app for the person's own agents on this computer. Behind the
// LICTORY_DESKTOP_RUNNER=1 flag until the runner ships in the package; see
// "Personal runner" in docs/internals/desktop.md for the command contract.
//
// The app stores no runner credential. `lictory-runner register` receives
// the one-time registration token on its standard input and keeps the
// runner credential in its own configuration directory; the app only knows
// which server the runner works for.

export const runnerFlag = process.env.LICTORY_DESKTOP_RUNNER === "1";

const executable =
  process.platform === "win32" ? "lictory-runner.exe" : "lictory-runner";

function runnerBinary(): string | null {
  if (process.env.LICTORY_RUNNER_PATH) return process.env.LICTORY_RUNNER_PATH;
  // Packaged with electron-builder `extraResources` once apps/runner builds
  // a standalone binary per platform.
  return app.isPackaged
    ? path.join(process.resourcesPath, "runner", executable)
    : null;
}

function configDirectory() {
  return path.join(app.getPath("userData"), "runner");
}

// Apps started from the Dock or a launcher get a minimal PATH, without the
// directories where coding harnesses (claude, codex, opencode, gemini) and
// git are usually installed. The login shell's PATH is read once.
let loginPath: Promise<string> | null = null;
function loginShellPath(): Promise<string> {
  const fallback = process.env.PATH ?? "";
  if (process.platform === "win32") return Promise.resolve(fallback);
  loginPath ??= new Promise((resolve) => {
    const shell =
      process.env.SHELL ??
      (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
    execFile(
      shell,
      ["-ilc", 'printf "__LICTORY_PATH__%s" "$PATH"'],
      { timeout: 5000, encoding: "utf8" },
      (error, stdout) => {
        const found = stdout.split("__LICTORY_PATH__")[1]?.trim();
        resolve(!error && found ? found : fallback);
      },
    );
  });
  return loginPath;
}

// The runner's environment: the person's, without Electron's own variables.
async function runnerEnvironment(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (!key.startsWith("ELECTRON_") && !key.startsWith("CHROME_"))
      env[key] = value;
  env.PATH = await loginShellPath();
  env.LICTORY_RUNNER_MANAGED_BY = "lictory-desktop";
  return env;
}

const spawnRunner: SpawnRunner = (command, args, options) =>
  spawn(command, [...args], {
    env: options.env,
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

export function createPersonalRunner(options: {
  servers: () => ServersState;
  serverId: () => string | null;
  setServerId: (serverId: string | null) => void;
  onChange: () => void;
}) {
  const binary = runnerFlag ? runnerBinary() : null;
  const available = () => !!binary && existsSync(binary);
  let supervisor: RunnerSupervisor | null = null;
  let supervisedOrigin: string | null = null;

  function origin() {
    const id = options.serverId();
    return options.servers().servers.find((s) => s.id === id)?.origin ?? null;
  }

  async function supervisorFor(serverOrigin: string) {
    if (supervisor && supervisedOrigin === serverOrigin) return supervisor;
    await supervisor?.stop();
    const directory = configDirectory();
    mkdirSync(directory, { recursive: true });
    supervisor = createRunnerSupervisor({
      command: binary ?? executable,
      args: ["start", "--server", serverOrigin, "--config-dir", directory],
      env: await runnerEnvironment(),
      cwd: os.homedir(),
      spawn: spawnRunner,
      onChange: () => options.onChange(),
    });
    supervisedOrigin = serverOrigin;
    return supervisor;
  }

  // One-shot `lictory-runner register`: the token goes in on stdin and is
  // never written anywhere by the app.
  async function register(
    serverId: string,
    token: string,
  ): Promise<RunnerCommandResult> {
    const server = options.servers().servers.find((s) => s.id === serverId);
    if (!server) return { ok: false, error: "Choose one of your servers." };
    if (!binary || !available())
      return {
        ok: false,
        error: "This build does not include lictory-runner.",
      };
    if (!token.trim())
      return { ok: false, error: "Paste the registration token from Lictory." };
    const directory = configDirectory();
    mkdirSync(directory, { recursive: true });
    const env = await runnerEnvironment();
    return new Promise((resolve) => {
      const child = spawn(
        binary,
        [
          "register",
          "--server",
          server.origin,
          "--config-dir",
          directory,
          "--name",
          os.hostname(),
          "--token-stdin",
        ],
        { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      let output = "";
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-4000);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error: `lictory-runner could not start: ${error.message}`,
        });
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          options.setServerId(serverId);
          resolve({ ok: true });
        } else
          resolve({
            ok: false,
            error:
              output.trim().split("\n").slice(-3).join("\n") ||
              `lictory-runner register exited with code ${code}.`,
          });
      });
      child.stdin.end(`${token.trim()}\n`);
    });
  }

  return {
    state(): RunnerState {
      return {
        enabled: runnerFlag,
        binary,
        available: available(),
        snapshot: supervisor?.snapshot() ?? stoppedSnapshot,
      };
    },
    logs: () => supervisor?.logs() ?? [],
    async command(input: unknown): Promise<RunnerCommandResult> {
      if (!runnerFlag)
        return { ok: false, error: "The personal runner is not enabled." };
      const command = input as RunnerCommand | null;
      switch (command?.action) {
        case "start": {
          const serverOrigin = origin();
          if (!serverOrigin)
            return {
              ok: false,
              error: "Register this computer with a server first.",
            };
          if (!available())
            return {
              ok: false,
              error: "This build does not include lictory-runner.",
            };
          (await supervisorFor(serverOrigin)).start();
          options.onChange();
          return { ok: true };
        }
        case "stop":
          await supervisor?.stop();
          options.onChange();
          return { ok: true };
        case "register":
          return typeof command.serverId === "string" &&
            typeof command.token === "string"
            ? register(command.serverId, command.token)
            : { ok: false, error: "Choose a server and paste a token." };
        default:
          return { ok: false, error: "Unknown runner command." };
      }
    },
    // The runner's server was removed: stop it and forget the choice.
    serversChanged(state: ServersState) {
      const id = options.serverId();
      if (id && !state.servers.some((s) => s.id === id)) {
        void supervisor?.stop();
        options.setServerId(null);
      }
    },
    async startWithApp(enabled: boolean) {
      if (!runnerFlag || !enabled) return;
      await this.command({ action: "start" });
    },
    stop: () => supervisor?.stop() ?? Promise.resolve(),
  };
}
