import { constants } from "node:fs";
import { mkdir, open, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isStepCount, streamText, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { run } from "@lictory/runner/process";
import {
  IDLE_GRACE_MS,
  INTERRUPTED_WAIT_MS,
  type AgentHarness,
  type HarnessContext,
  type HarnessResult,
  type HarnessRun,
} from "@lictory/runner/harness/types";
import { sessionInstructions } from "@lictory/runner/harness/shared";

// Lictory's built-in harness: the AI SDK's tool loop on the runner, against
// the organization's model through the server's model proxy. Its tools are
// confined to the session's worktree: paths resolve inside it (symbolic
// links included), commands run there with a timeout.

const MAX_STEPS = 60;
const MAX_FILE = 256 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60_000;
const OUTPUT = 12_000;

export class OutsideWorktree extends Error {}

// Resolves `path` inside `root`, refusing anything that escapes it.
export async function confined(root: string, path: string) {
  const realRoot = await realpath(root);
  const target = resolve(realRoot, path);
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + sep);
  if (!inside(target))
    throw new OutsideWorktree(`${path} is outside the session's worktree.`);
  // The nearest existing ancestor must not be a link leading outside. The
  // path returned has its links resolved, so it is opened without following
  // any (see openExisting).
  let existing = target;
  let resolved = target;
  for (;;) {
    try {
      const real = await realpath(existing);
      if (!inside(real))
        throw new OutsideWorktree(
          `${path} leads outside the session's worktree.`,
        );
      resolved = join(real, relative(existing, target));
      break;
    } catch (error) {
      if (error instanceof OutsideWorktree) throw error;
      const parent = dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
  }
  if (
    [target, resolved].some(
      (p) => relative(realRoot, p).split(sep)[0] === ".git",
    )
  )
    throw new OutsideWorktree("The repository's .git directory is off limits.");
  return resolved;
}

// Files are opened once and used through the handle, never by name again,
// at the path `confined` resolved, whose last component must then not be a
// symbolic link: a link swapped in after the check cannot redirect the read
// or the write
// (O_NOFOLLOW does not exist on Windows, where creating links needs
// privileges).
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

async function openExisting(target: string, flags: number) {
  try {
    return await open(target, flags | NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new OutsideWorktree("Symbolic links cannot be read or written.");
    throw error;
  }
}

// Creates the file, or truncates the existing one; says which.
async function openForWrite(target: string) {
  try {
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    );
    return { handle, existed: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const handle = await openExisting(
      target,
      constants.O_WRONLY | constants.O_TRUNC,
    );
    return { handle, existed: true };
  }
}

const cut = (text: string, max = OUTPUT) =>
  text.length > max
    ? `${text.slice(0, max)}\n… (${text.length - max} more characters)`
    : text;

export function worktreeTools(
  ctx: Pick<HarnessContext, "worktree" | "exec" | "emit">,
) {
  const root = ctx.worktree;
  const git = (args: string[]) =>
    run("git", args, {
      spawn: (...a) => ctx.exec.spawn(...a),
      timeoutMs: 60_000,
    });
  return {
    list_files: tool({
      description:
        "List files and directories under a path of the repository (default: its root).",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path }) => {
        const target = await confined(root, path);
        const entries = await readdir(target, { withFileTypes: true });
        return entries
          .filter((e) => e.name !== ".git" && e.name !== ".lictory")
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join("\n");
      },
    }),
    read_file: tool({
      description: "Read a text file of the repository.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const target = await confined(root, path);
        const handle = await openExisting(target, constants.O_RDONLY);
        try {
          const info = await handle.stat();
          if (info.size > MAX_FILE)
            return `The file is ${info.size} bytes; read a smaller one or search it with run_command.`;
          return cut(await handle.readFile("utf8"), MAX_FILE);
        } finally {
          await handle.close();
        }
      },
    }),
    write_file: tool({
      description:
        "Create or replace a file of the repository with the given content.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string().max(MAX_FILE),
      }),
      execute: async ({ path, content }) => {
        const target = await confined(root, path);
        await mkdir(dirname(target), { recursive: true });
        const { handle, existed } = await openForWrite(target);
        try {
          await handle.writeFile(content);
        } finally {
          await handle.close();
        }
        ctx.emit("file_change", {
          changes: [
            { path: relative(root, target), kind: existed ? "modify" : "add" },
          ],
        });
        return `Wrote ${relative(root, target)}.`;
      },
    }),
    edit_file: tool({
      description:
        "Replace one exact occurrence of `find` with `replace` in a file of the repository.",
      inputSchema: z.object({
        path: z.string(),
        find: z.string().min(1),
        replace: z.string(),
      }),
      execute: async ({ path, find, replace }) => {
        const target = await confined(root, path);
        const handle = await openExisting(target, constants.O_RDWR);
        try {
          const text = await handle.readFile("utf8");
          const first = text.indexOf(find);
          if (first < 0)
            return "The text to replace was not found; read the file again.";
          if (text.slice(first + 1).includes(find))
            return "The text to replace occurs more than once; include more context.";
          const edited = Buffer.from(
            text.slice(0, first) + replace + text.slice(first + find.length),
          );
          await handle.truncate(0);
          await handle.write(edited, 0, edited.length, 0);
        } finally {
          await handle.close();
        }
        ctx.emit("file_change", {
          changes: [{ path: relative(root, target), kind: "modify" }],
        });
        return `Edited ${relative(root, target)}.`;
      },
    }),
    run_command: tool({
      description:
        "Run a shell command in the repository's root (bash -lc), with a timeout of five minutes. Returns its exit code and output.",
      inputSchema: z.object({ command: z.string().min(1).max(4000) }),
      execute: async ({ command }) => {
        const started = Date.now();
        const result = await run("bash", ["-lc", command], {
          spawn: (...a) => ctx.exec.spawn(...a),
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        const output = cut(
          `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim(),
        );
        ctx.emit("command", {
          command,
          output,
          exitCode: result.code,
          durationMs: Date.now() - started,
        });
        return `exit code ${result.code ?? "none"}\n${output}`;
      },
    }),
    git_status: tool({
      description: "Show the repository's git status.",
      inputSchema: z.object({}),
      execute: async () =>
        (await git(["status", "--short", "--branch"])).stdout,
    }),
    git_diff: tool({
      description: "Show uncommitted changes (or the staged ones).",
      inputSchema: z.object({ staged: z.boolean().default(false) }),
      execute: async ({ staged }) =>
        cut(
          (await git(["diff", ...(staged ? ["--staged"] : [])])).stdout ||
            "No changes.",
        ),
    }),
    git_commit: tool({
      description: "Stage every change and commit it with a message.",
      inputSchema: z.object({ message: z.string().min(1).max(2000) }),
      execute: async ({ message }) => {
        await git(["add", "--all"]);
        const result = await git(["commit", "--message", message]);
        return result.code === 0
          ? cut(result.stdout)
          : `Nothing was committed: ${cut(result.stdout + result.stderr, 2000)}`;
      },
    }),
  };
}

export const lictoryHarness: AgentHarness = {
  id: "lictory",
  // Always available: the model runs on the server.
  detect: () => Promise.resolve("built-in"),
  start(ctx) {
    return startBuiltIn(ctx);
  },
};

function startBuiltIn(ctx: HarnessContext): HarnessRun {
  let turn: AbortController | null = null;
  let interrupted = false;
  let stopped = false;
  const waiting = new AbortController();
  const messages: ModelMessage[] = [];
  let lastText = "";

  const runTurn = async (prompt: string) => {
    const model = ctx.languageModel;
    if (!model)
      throw new Error(
        "Lictory Intelligence is not available to this session. An administrator can turn it on in Settings → Intelligence.",
      );
    messages.push({ role: "user", content: prompt });
    turn = new AbortController();
    const signal = AbortSignal.any([turn.signal, ctx.signal]);
    let failure: unknown;
    const result = streamText({
      model,
      system: `You are a careful software engineer.\n\n${sessionInstructions(ctx)}`,
      messages,
      tools: worktreeTools(ctx),
      stopWhen: isStepCount(MAX_STEPS),
      maxRetries: 1,
      abortSignal: signal,
      onError: ({ error }) => {
        failure ??= error;
      },
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        ctx.emitText("message", part.text);
      } else if (part.type === "reasoning-delta")
        ctx.emitText("reasoning", part.text);
      else if (part.type === "tool-call") {
        if (part.toolName === "run_command") continue;
        ctx.emit("tool_call", {
          callId: part.toolCallId,
          name: part.toolName,
          input: part.input,
        });
      } else if (part.type === "tool-result") {
        if (part.toolName === "run_command") continue;
        ctx.emit("tool_result", {
          callId: part.toolCallId,
          output:
            typeof part.output === "string"
              ? part.output
              : JSON.stringify(part.output),
        });
      } else if (part.type === "tool-error")
        ctx.emit("tool_result", {
          callId: part.toolCallId,
          output:
            part.error instanceof Error
              ? part.error.message
              : String(part.error),
          isError: true,
        });
      else if (part.type === "finish-step") text = text ? `${text}\n` : text;
      else if (part.type === "error") failure ??= part.error;
    }
    turn = null;
    if (text.trim()) lastText = text.trim();
    if (signal.aborted) return;
    if (failure)
      throw failure instanceof Error
        ? failure
        : new Error("The model call failed.");
    messages.push(...(await result.response).messages);
  };

  const done = (async (): Promise<HarnessResult> => {
    let prompt: string | null = ctx.prompt;
    try {
      while (prompt !== null && !stopped) {
        interrupted = false;
        await runTurn(prompt);
        if (stopped) break;
        prompt = await ctx.nextMessage(
          interrupted ? INTERRUPTED_WAIT_MS : IDLE_GRACE_MS,
          waiting.signal,
        );
      }
      return { outcome: "completed", summary: lastText || undefined };
    } catch (error) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
        summary: lastText || undefined,
      };
    }
  })();

  return {
    interrupt() {
      interrupted = true;
      turn?.abort();
    },
    answer: () => undefined,
    stop() {
      stopped = true;
      waiting.abort();
      turn?.abort();
    },
    done,
  };
}
