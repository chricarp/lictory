import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { onLines, run, tail } from "@lictory/runner/process";
import {
  IDLE_GRACE_MS,
  INTERRUPTED_WAIT_MS,
  type AgentHarness,
  type Readiness,
  type HarnessContext,
  type HarnessResult,
  type HarnessRun,
} from "@lictory/runner/harness/types";
import { sessionInstructions, summarize } from "@lictory/runner/harness/shared";

// Claude Code through its streaming JSON mode (verified against
// `claude` 2.1.331):
//
//   claude -p --input-format stream-json --output-format stream-json
//     --verbose --permission-prompt-tool stdio
//
// Each line on stdin is a user message ({"type":"user","message":…}) or a
// control request ({"type":"control_request","request":{"subtype":
// "interrupt"}}); stdout carries `system`, `assistant`, `user` (tool
// results) and `result` messages, and `control_request` messages with
// subtype `can_use_tool` when a tool needs permission. Those become
// approval requests; the person's answer goes back as a
// `control_response` ({behavior: "allow" | "deny"}). An interrupt ends the
// turn with a `result` of subtype `error_during_execution`; the
// conversation continues with the next user message.

type Block = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};
type Message = {
  type: string;
  subtype?: string;
  message?: { content?: Block[] | string };
  result?: string;
  is_error?: boolean;
  request_id?: string;
  request?: {
    subtype?: string;
    tool_name?: string;
    display_name?: string;
    description?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
  };
};

const editTools = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part: { type?: string; text?: string }) =>
        part.type === "text" ? (part.text ?? "") : `[${part.type}]`,
      )
      .join("\n");
  return content === undefined ? "" : JSON.stringify(content);
}

export const claudeCode: AgentHarness = {
  id: "claude-code",
  async detect(config) {
    const command = config.harnesses["claude-code"]?.command ?? "claude";
    const result = await run(command, ["--version"], { timeoutMs: 15_000 });
    if (result.code !== 0) return null;
    return /([\d.]+)/.exec(result.stdout)?.[1] ?? result.stdout.trim();
  },
  ready(config) {
    return claudeReadiness(
      config.harnesses["claude-code"]?.command ?? "claude",
    );
  },
  start(ctx) {
    return startClaude(ctx);
  },
};

const authMethods: Record<string, string> = {
  "claude.ai": "Claude account",
  api_key: "API key",
};

// `claude auth status --json` reports whether Claude Code can authenticate
// (exit 0 when signed in). Only `loggedIn` and `authMethod` are read: the
// rest names the account, which doctor's output must not repeat.
export async function claudeReadiness(command: string): Promise<Readiness> {
  const result = await run(command, ["auth", "status", "--json"], {
    timeoutMs: 15_000,
  });
  type Status = { loggedIn?: unknown; authMethod?: unknown };
  let status: Status | null;
  try {
    status = JSON.parse(result.stdout) as Status | null;
  } catch {
    status = null;
  }
  if (status?.loggedIn === true) {
    const method =
      typeof status.authMethod === "string"
        ? (authMethods[status.authMethod] ?? status.authMethod)
        : null;
    return {
      state: "ready",
      detail: method ? `signed in (${method})` : "signed in",
    };
  }
  if (status?.loggedIn === false)
    return {
      state: "not-ready",
      detail: "is installed but not signed in, so its sessions would fail",
      fix: "Sign in as the account the runner runs as with `claude auth login`, or give the runner ANTHROPIC_API_KEY (a service does not read your shell profile). Then run `lictory-runner doctor` again.",
    };
  return {
    state: "unknown",
    detail: "did not say whether it is signed in",
    fix: "Run `claude auth status` as the account the runner runs as; Claude Code 2 or newer answers it.",
  };
}

function startClaude(ctx: HarnessContext): HarnessRun {
  const settings = ctx.config.harnesses["claude-code"] ?? {};
  const mcpFile = join(ctx.scratch.host, "mcp.json");
  const tools = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >();
  const approvals = new Map<string, Message["request"]>();
  let child: ReturnType<HarnessContext["exec"]["spawn"]> | undefined;
  let sent = 0;
  let results = 0;
  let interrupted = false;
  let finished = false;
  let lastResult = "";
  let failure: string | null = null;
  let resolveDone: (result: HarnessResult) => void = () => undefined;
  const done = new Promise<HarnessResult>((resolve) => {
    resolveDone = resolve;
  });
  const pump = new AbortController();

  const write = (message: unknown) => {
    if (!child?.stdin?.writable) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const say = (text: string) => {
    sent++;
    write({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: "",
    });
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    pump.abort();
    child?.stdin?.end();
  };
  // Messages sent during a turn wait for it to end, so every message gets
  // its own turn and its own result. An interrupted agent waits for the
  // person; otherwise a short grace for a message already on its way.
  const turnEnded = async () => {
    if (sent !== results || finished) return;
    const text = await ctx.nextMessage(
      interrupted ? INTERRUPTED_WAIT_MS : IDLE_GRACE_MS,
      pump.signal,
    );
    if (finished) return;
    if (text === null) return finish();
    interrupted = false;
    say(text);
  };

  const handle = (line: string) => {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return;
    }
    switch (message.type) {
      case "assistant": {
        const content = message.message?.content;
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === "text" && block.text)
            ctx.emit("message", { text: block.text });
          else if (block.type === "thinking" && block.thinking)
            ctx.emit("reasoning", { text: block.thinking });
          else if (block.type === "tool_use" && block.id) {
            tools.set(block.id, {
              name: block.name ?? "tool",
              input: block.input ?? {},
            });
            ctx.emit("tool_call", {
              callId: block.id,
              name: block.name ?? "tool",
              input: block.input ?? {},
              summary: summarize(block.name ?? "", block.input ?? {}),
            });
          }
        }
        break;
      }
      case "user": {
        const content = message.message?.content;
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type !== "tool_result" || !block.tool_use_id) continue;
          const tool = tools.get(block.tool_use_id);
          const output = resultText(block.content);
          if (tool?.name === "Bash")
            ctx.emit("command", {
              callId: block.tool_use_id,
              command:
                typeof tool.input.command === "string"
                  ? tool.input.command
                  : "",
              output,
              exitCode: block.is_error ? 1 : 0,
            });
          else
            ctx.emit("tool_result", {
              callId: block.tool_use_id,
              output,
              isError: Boolean(block.is_error),
            });
          const path = tool?.input.file_path ?? tool?.input.notebook_path;
          if (
            tool &&
            editTools.has(tool.name) &&
            !block.is_error &&
            typeof path === "string"
          )
            ctx.emit("file_change", {
              changes: [
                {
                  path: path.startsWith(ctx.exec.cwd)
                    ? path.slice(ctx.exec.cwd.length).replace(/^\//, "")
                    : path,
                  kind: tool.name === "Write" ? "add" : "modify",
                },
              ],
            });
        }
        break;
      }
      case "result": {
        results++;
        if (message.subtype === "success")
          lastResult = message.result ?? lastResult;
        else if (message.subtype !== "error_during_execution" || !interrupted)
          ctx.emit("error", {
            message:
              message.result ??
              `Claude Code ended the turn: ${message.subtype}.`,
          });
        void turnEnded();
        break;
      }
      case "control_request": {
        const request = message.request;
        if (request?.subtype !== "can_use_tool" || !message.request_id) break;
        approvals.set(message.request_id, request);
        ctx.emit("approval_request", {
          requestId: message.request_id,
          title: request.description
            ? `${request.display_name ?? request.tool_name}: ${request.description}`.slice(
                0,
                300,
              )
            : `Use ${request.display_name ?? request.tool_name ?? "a tool"}`,
          tool: request.tool_name,
          input: request.input,
          reason: summarize(request.tool_name ?? "", request.input ?? {}),
        });
        break;
      }
      default:
        break;
    }
  };

  void (async () => {
    try {
      await writeFile(
        mcpFile,
        JSON.stringify({
          mcpServers: {
            lictory: {
              type: "http",
              url: ctx.lictory.mcpUrl,
              headers: { Authorization: `Bearer ${ctx.lictory.token}` },
            },
          },
        }),
        { mode: 0o600 },
      );
      const args = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-prompt-tool",
        "stdio",
        "--permission-mode",
        ctx.config.claudePermissionMode,
        "--mcp-config",
        join(ctx.scratch.exec, "mcp.json"),
        "--append-system-prompt",
        sessionInstructions(ctx),
        ...(ctx.model ? ["--model", ctx.model] : []),
        ...(settings.args ?? []),
      ];
      child = ctx.exec.spawn(settings.command ?? "claude", args, {
        stdin: "pipe",
      });
      const stderr = tail(child);
      onLines(child, handle);
      child.on("error", (error) => {
        failure = `Claude Code could not start: ${error.message}`;
      });
      child.on("close", (code) => {
        finished = true;
        pump.abort();
        if (failure || (code !== 0 && code !== null && !ctx.signal.aborted))
          resolveDone({
            outcome: "failed",
            error:
              failure ?? (stderr() || `Claude Code exited with code ${code}.`),
            summary: lastResult || undefined,
          });
        else
          resolveDone({
            outcome: "completed",
            summary: lastResult || undefined,
          });
      });
      say(ctx.prompt);
    } catch (error) {
      resolveDone({
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return {
    interrupt() {
      if (finished) return;
      interrupted = true;
      write({
        type: "control_request",
        request_id: `interrupt-${Date.now()}`,
        request: { subtype: "interrupt" },
      });
    },
    answer(requestId, decision, note) {
      const request = approvals.get(requestId);
      if (!request) return;
      approvals.delete(requestId);
      write({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response:
            decision === "approve"
              ? { behavior: "allow", updatedInput: request.input ?? {} }
              : {
                  behavior: "deny",
                  message:
                    decision === "answer" && note
                      ? `A person answered instead of approving: ${note}`
                      : (note ??
                        "A person denied this. Continue without it or ask how to proceed."),
                },
        },
      });
    },
    stop() {
      finish();
      child?.kill("SIGTERM");
      setTimeout(() => child?.kill("SIGKILL"), 5_000).unref();
    },
    done,
  };
}
