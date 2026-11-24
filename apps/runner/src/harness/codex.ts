import { onLines, run, tail } from "@lictory/runner/process";
import {
  IDLE_GRACE_MS,
  INTERRUPTED_WAIT_MS,
  type AgentHarness,
  type HarnessContext,
  type HarnessResult,
  type HarnessRun,
} from "@lictory/runner/harness/types";
import { sessionInstructions } from "@lictory/runner/harness/shared";

// Codex through `codex exec --json` (verified against codex-cli 0.171.0):
// each turn is one process printing JSONL events (`thread.started` with
// the thread id, `turn.started`, `item.started`/`item.completed` for
// agent_message, reasoning, command_execution {command, aggregated_output,
// exit_code}, file_change {changes: [{path, kind}]} and mcp_tool_call,
// then `turn.completed` or `turn.failed`). A steering message continues
// the thread with `codex exec resume <thread id> --json <message>`; an
// interrupt stops the turn's process.
//
// `codex exec` asks nobody: commands run within its sandbox
// (`codexSandbox` in the runner configuration), so Codex sessions raise no
// approval requests. The Lictory MCP server is passed with `-c
// mcp_servers.lictory.url` and `bearer_token_env_var` (not verified against
// a live server here).

type Item = {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  changes?: { path: string; kind: string }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: { message?: string } | string;
  message?: string;
};
type Line = {
  type: string;
  thread_id?: string;
  item?: Item;
  error?: { message?: string };
  message?: string;
};

const fileKind = (kind: string) =>
  kind === "add" || kind === "delete"
    ? kind
    : kind === "rename"
      ? "rename"
      : "modify";

export const codex: AgentHarness = {
  id: "codex",
  async detect(config) {
    const command = config.harnesses.codex?.command ?? "codex";
    const result = await run(command, ["--version"], { timeoutMs: 15_000 });
    if (result.code !== 0) return null;
    return /([\d.]+)/.exec(result.stdout)?.[1] ?? result.stdout.trim();
  },
  start(ctx) {
    return startCodex(ctx);
  },
};

function startCodex(ctx: HarnessContext): HarnessRun {
  const settings = ctx.config.harnesses.codex ?? {};
  let threadId: string | null = null;
  let child: ReturnType<HarnessContext["exec"]["spawn"]> | undefined;
  let interrupted = false;
  let stopped = false;
  let lastMessage = "";
  const waiting = new AbortController();

  const common = () => [
    "--json",
    "--skip-git-repo-check",
    "-c",
    `sandbox_mode="${ctx.config.codexSandbox}"`,
    "-c",
    `mcp_servers.lictory.url="${ctx.lictory.mcpUrl}"`,
    "-c",
    `mcp_servers.lictory.bearer_token_env_var="LICTORY_SESSION_TOKEN"`,
    ...(ctx.model ? ["--model", ctx.model] : []),
    ...(settings.args ?? []),
  ];

  // One turn: resolves with the turn's error, or null.
  const turn = (prompt: string) =>
    new Promise<string | null>((resolve) => {
      const args = threadId
        ? ["exec", "resume", threadId, ...common(), prompt]
        : ["exec", ...common(), prompt];
      child = ctx.exec.spawn(settings.command ?? "codex", args, {
        stdin: "ignore",
        env: { LICTORY_SESSION_TOKEN: ctx.lictory.token },
      });
      const stderr = tail(child);
      let error: string | null = null;
      onLines(child, (raw) => {
        let line: Line;
        try {
          line = JSON.parse(raw) as Line;
        } catch {
          return;
        }
        if (line.type === "thread.started" && line.thread_id)
          threadId = line.thread_id;
        else if (line.type === "turn.failed" || line.type === "error")
          error =
            line.error?.message ?? line.message ?? "Codex reported an error.";
        else if (
          line.type === "item.started" &&
          line.item?.type === "command_execution"
        )
          ctx.emit("tool_call", {
            callId: line.item.id ?? "",
            name: "shell",
            input: { command: line.item.command },
            summary: `shell: ${line.item.command ?? ""}`.slice(0, 200),
          });
        else if (line.type === "item.completed" && line.item)
          translate(line.item);
      });
      child.on("error", (e) => {
        error = `Codex could not start: ${e.message}`;
      });
      child.on("close", (code) => {
        child = undefined;
        if (!error && code !== 0 && code !== null && !interrupted && !stopped)
          error = stderr() || `Codex exited with code ${code}.`;
        resolve(error);
      });
    });

  const translate = (item: Item) => {
    switch (item.type) {
      case "agent_message":
        if (item.text) {
          lastMessage = item.text;
          ctx.emit("message", { text: item.text });
        }
        break;
      case "reasoning":
        if (item.text) ctx.emit("reasoning", { text: item.text });
        break;
      case "command_execution":
        ctx.emit("command", {
          callId: item.id,
          command: item.command ?? "",
          output: item.aggregated_output ?? "",
          exitCode: item.exit_code ?? null,
        });
        break;
      case "file_change":
        if (item.status !== "failed" && item.changes?.length)
          ctx.emit("file_change", {
            changes: item.changes.map((c) => ({
              path: c.path.startsWith(ctx.exec.cwd)
                ? c.path.slice(ctx.exec.cwd.length).replace(/^\//, "")
                : c.path,
              kind: fileKind(c.kind),
            })),
          });
        break;
      case "mcp_tool_call":
        ctx.emit("tool_call", {
          callId: item.id ?? "",
          name: `${item.server ?? "mcp"}.${item.tool ?? "tool"}`,
          input: item.arguments ?? {},
        });
        ctx.emit("tool_result", {
          callId: item.id ?? "",
          output:
            typeof item.result === "string"
              ? item.result
              : JSON.stringify(item.result ?? item.error ?? ""),
          isError: item.status === "failed",
        });
        break;
      case "error":
        ctx.emit("error", {
          message:
            typeof item.error === "string"
              ? item.error
              : (item.error?.message ??
                item.message ??
                "Codex reported an error."),
        });
        break;
      default:
        break;
    }
  };

  const done = (async (): Promise<HarnessResult> => {
    let prompt: string | null =
      `${sessionInstructions(ctx)}\n\n---\n\n${ctx.prompt}`;
    while (prompt !== null && !stopped) {
      interrupted = false;
      const error = await turn(prompt);
      if (stopped) break;
      if (error && !interrupted)
        return { outcome: "failed", error, summary: lastMessage || undefined };
      prompt = await ctx.nextMessage(
        interrupted ? INTERRUPTED_WAIT_MS : IDLE_GRACE_MS,
        waiting.signal,
      );
    }
    return { outcome: "completed", summary: lastMessage || undefined };
  })();

  return {
    interrupt() {
      if (!child) return;
      interrupted = true;
      child.kill("SIGINT");
    },
    // `codex exec` raises no approval requests.
    answer: () => undefined,
    stop() {
      stopped = true;
      waiting.abort();
      child?.kill("SIGTERM");
    },
    done,
  };
}
