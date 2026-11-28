import { spawn, type ChildProcess } from "node:child_process";
import type { RunnerConfig } from "@lictory/runner/config";
import type { Exec, SpawnOptions } from "@lictory/runner/harness/types";

// Running commands for a session, on the host or in its container.

export type RunResult = { code: number | null; stdout: string; stderr: string };

// Runs a command to completion, with a timeout, capturing (bounded) output.
export function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    input?: string;
    spawn?: (
      command: string,
      args: string[],
      options?: SpawnOptions,
    ) => ChildProcess;
  } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = options.spawn
      ? options.spawn(command, args, {
          env: options.env as Record<string, string> | undefined,
          stdin: options.input === undefined ? "ignore" : "pipe",
        })
      : spawn(command, args, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stdio: [
            options.input === undefined ? "ignore" : "pipe",
            "pipe",
            "pipe",
          ],
        });
    let stdout = "";
    let stderr = "";
    const cap = 1_000_000;
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < cap) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < cap) stderr += chunk.toString();
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
    const timer = options.timeoutMs
      ? setTimeout(() => {
          stderr += `\n(stopped after ${Math.round(options.timeoutMs! / 1000)} s)`;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : undefined;
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Executes on the host, in the worktree.
export function hostExec(worktree: string): Exec {
  return {
    cwd: worktree,
    spawn: (command, args, options = {}) =>
      spawn(command, args, {
        cwd: worktree,
        env: { ...process.env, ...options.env },
        stdio: [options.stdin ?? "pipe", "pipe", "pipe"],
      }),
  };
}

const CONTAINER_WORKSPACE = "/workspace";

// One container per session with the worktree mounted at /workspace; the
// harness and its commands run inside it. Requires Docker on the runner.
export async function containerExec(
  config: RunnerConfig,
  sessionId: string,
  worktree: string,
): Promise<{ exec: Exec; remove(): Promise<void> }> {
  const name = `lictory-${sessionId.replaceAll("-", "").slice(0, 16)}`;
  if (!config.containerImage)
    throw new Error(
      "Container isolation needs containerImage in the runner's config.json: an image with git and the harnesses.",
    );
  const started = await run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--network",
    config.containerNetwork,
    "--volume",
    `${worktree}:${CONTAINER_WORKSPACE}`,
    "--workdir",
    CONTAINER_WORKSPACE,
    "--label",
    `lictory.session=${sessionId}`,
    config.containerImage,
    "sleep",
    "infinity",
  ]);
  if (started.code !== 0)
    throw new Error(
      `The session container did not start: ${started.stderr.trim() || started.stdout.trim()}`,
    );
  return {
    exec: {
      cwd: CONTAINER_WORKSPACE,
      spawn: (command, args, options = {}) =>
        spawn(
          "docker",
          [
            "exec",
            "--interactive",
            "--workdir",
            CONTAINER_WORKSPACE,
            ...Object.entries(options.env ?? {}).flatMap(([k, v]) => [
              "--env",
              `${k}=${v}`,
            ]),
            name,
            command,
            ...args,
          ],
          { stdio: [options.stdin ?? "pipe", "pipe", "pipe"] },
        ),
    },
    remove: async () => {
      await run("docker", ["rm", "--force", name]);
    },
  };
}

// Lines of a child's stdout, as they arrive.
export function onLines(child: ChildProcess, handle: (line: string) => void) {
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) handle(line);
    }
  });
  child.stdout?.on("end", () => {
    if (buffer.trim()) handle(buffer.trim());
    buffer = "";
  });
}

// Keeps the last part of a stream (stderr) for error messages.
export function tail(child: ChildProcess, max = 4000) {
  let text = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    text = (text + chunk.toString()).slice(-max);
  });
  return () => text.trim();
}
