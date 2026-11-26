import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { harnessIds } from "@lictory/core/factory/protocol";
import {
  INTERRUPTED_WAIT_MS,
  type AgentHarness,
  type HarnessContext,
  type HarnessResult,
  type HarnessRun,
} from "@lictory/runner/harness/types";

// A scripted harness for tests (`lictory-runner start --test-harness
// <script.json | default>`). It stands in for every harness, so any runner
// agent runs it, and walks through a script of steps: messages, tool calls,
// commands, file writes, a question for a person and waiting for a
// steering message. It never runs a model or a command.

const baseStep = z.union([
  z.object({ say: z.string() }),
  z.object({
    tool: z.object({
      name: z.string(),
      input: z.record(z.string(), z.unknown()).default({}),
      output: z.string().default(""),
    }),
  }),
  z.object({
    command: z.object({
      command: z.string(),
      output: z.string().default(""),
      exitCode: z.number().int().default(0),
    }),
  }),
  z.object({ writeFile: z.object({ path: z.string(), content: z.string() }) }),
  // An approval request; `action` is the exact tool call it asks for, as a
  // real harness's permission prompt states it.
  z.object({
    ask: z.string(),
    action: z
      .object({
        tool: z.string(),
        input: z.record(z.string(), z.unknown()).default({}),
      })
      .optional(),
    reason: z.string().optional(),
  }),
  z.object({ waitForMessage: z.literal(true) }),
  z.object({ sleep: z.number().int().min(0).max(600_000) }),
  z.object({ fail: z.string() }),
  // A call of one of Lictory's MCP tools with the session's token, as a
  // real harness makes. In string arguments `{{organizationId}}` is the
  // session's organization, `{{claimId}}` the claim it holds (found with
  // listClaims), and `{{pullRequestId}}` and `{{headSha}}` the pull
  // request and head a review session's prompt names; the tool's error
  // fails the session.
  z.object({
    lictory: z.object({
      tool: z.string(),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }),
  }),
  z.object({ summary: z.string() }),
]);
// Steps that depend on what the session was asked (one script for every
// session of a runner): `then` when the prompt matches the pattern, else
// `else`. A reviewer agent's session ("Review pull request …") and an
// implementer's can share a runner this way.
const conditional = z.object({
  ifPrompt: z.object({
    matches: z.string(),
    then: z.array(baseStep).default([]),
    else: z.array(baseStep).default([]),
  }),
});
const step = z.union([baseStep, conditional]);
type BaseStep = z.infer<typeof baseStep>;
export const fakeScript = z.array(step);
export type FakeScript = z.infer<typeof fakeScript>;

// The steps this session runs.
function stepsFor(script: FakeScript, prompt: string): BaseStep[] {
  return script.flatMap((item) =>
    "ifPrompt" in item
      ? new RegExp(item.ifPrompt.matches, "m").test(prompt)
        ? item.ifPrompt.then
        : item.ifPrompt.else
      : [item],
  );
}

export const defaultScript: FakeScript = [
  { say: "Reading the task and the repository." },
  {
    tool: {
      name: "read_file",
      input: { path: "README.md" },
      output: "# Payments\n",
    },
  },
  { command: { command: "npm test", output: "12 passing", exitCode: 0 } },
  { say: "Ready for your instructions." },
  { waitForMessage: true },
  {
    ask: "Run the database migration",
    action: { tool: "Bash", input: { command: "bun run db:migrate" } },
  },
  {
    writeFile: {
      path: "CHANGES.md",
      content: "# Changes\n\n- Refunds over the API.\n",
    },
  },
  { summary: "Added CHANGES.md describing refunds over the API." },
];

export async function loadScript(source: string) {
  if (source === "default") return defaultScript;
  return fakeScript.parse(JSON.parse(await readFile(source, "utf8")));
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const stepText = (text: string | null) =>
  text ? `Got it: ${text}` : "No message arrived.";

export function fakeHarnesses(script: FakeScript): AgentHarness[] {
  return harnessIds.map((id) => ({
    id,
    detect: () => Promise.resolve("test"),
    start: (ctx) => startFake(ctx, script),
  }));
}

function startFake(ctx: HarnessContext, script: FakeScript): HarnessRun {
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, ctx.signal]);
  const answers = new Map<string, (decision: string) => void>();
  // Interrupt stops the current step (a sleep) and, like a real harness,
  // waits for the person's next message before it goes on. While the
  // agent already waits for a message, it keeps waiting.
  let interruptRequested = false;
  let cutStep: (() => void) | null = null;

  const done = (async (): Promise<HarnessResult> => {
    let summary: string | undefined;
    let asked = 0;
    const afterInterrupt = async () => {
      if (!interruptRequested || signal.aborted) return;
      interruptRequested = false;
      ctx.emit("message", {
        text: "Stopped. Waiting for your next message.",
      });
      const text = await ctx.nextMessage(INTERRUPTED_WAIT_MS, signal);
      // It was already waiting: another interrupt meanwhile changes nothing.
      interruptRequested = false;
      if (!signal.aborted) ctx.emit("message", { text: stepText(text) });
    };
    for (const item of stepsFor(script, ctx.prompt)) {
      await afterInterrupt();
      if (signal.aborted) break;
      if ("say" in item) ctx.emit("message", { text: item.say });
      else if ("tool" in item) {
        const callId = `call-${Math.random().toString(36).slice(2, 10)}`;
        ctx.emit("tool_call", {
          callId,
          name: item.tool.name,
          input: item.tool.input,
        });
        ctx.emit("tool_result", { callId, output: item.tool.output });
      } else if ("command" in item) ctx.emit("command", item.command);
      else if ("writeFile" in item) {
        const path = join(ctx.worktree, item.writeFile.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, item.writeFile.content);
        ctx.emit("file_change", {
          changes: [{ path: item.writeFile.path, kind: "add" }],
        });
      } else if ("ask" in item) {
        const requestId = `ask-${++asked}`;
        const decision = new Promise<string>((resolve) =>
          answers.set(requestId, resolve),
        );
        ctx.emit("approval_request", {
          requestId,
          title: item.ask,
          ...(item.action
            ? { tool: item.action.tool, input: item.action.input }
            : {}),
          ...(item.reason ? { reason: item.reason } : {}),
        });
        const answer = await Promise.race([
          decision,
          new Promise<string>((resolve) =>
            signal.addEventListener("abort", () => resolve("stopped")),
          ),
        ]);
        if (answer === "stopped") break;
        ctx.emit("message", {
          text:
            answer === "approve"
              ? `Approved: ${item.ask}.`
              : `Denied: ${item.ask}. Skipping it.`,
        });
      } else if ("waitForMessage" in item) {
        const text = await ctx.nextMessage(30 * 60_000, signal);
        // An interrupt while it waits for a message changes nothing.
        interruptRequested = false;
        if (signal.aborted) break;
        ctx.emit("message", { text: stepText(text) });
      } else if ("lictory" in item) {
        const callId = `call-${Math.random().toString(36).slice(2, 10)}`;
        ctx.emit("tool_call", {
          callId,
          name: item.lictory.tool,
          input: item.lictory.arguments,
        });
        try {
          const output = await callLictory(ctx, item.lictory);
          ctx.emit("tool_result", {
            callId,
            output: JSON.stringify(output).slice(0, 2000),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.emit("tool_result", { callId, output: message, isError: true });
          return { outcome: "failed", error: message };
        }
      } else if ("sleep" in item)
        await Promise.race([
          wait(item.sleep, signal),
          new Promise<void>((resolve) => (cutStep = () => resolve())),
        ]).finally(() => (cutStep = null));
      else if ("fail" in item) return { outcome: "failed", error: item.fail };
      else if ("summary" in item) {
        summary = item.summary;
        ctx.emit("summary", { text: item.summary });
      }
    }
    await afterInterrupt();
    return { outcome: "completed", summary };
  })();

  return {
    interrupt: () => {
      interruptRequested = true;
      cutStep?.();
    },
    answer: (requestId, decision) => answers.get(requestId)?.(decision),
    stop: () => stop.abort(),
    done,
  };
}

type McpResult = {
  result?: {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { text?: string }[];
  };
  error?: { message: string };
};

async function mcp(ctx: HarnessContext, name: string, args: unknown) {
  const response = await fetch(ctx.lictory.mcpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.lictory.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: ctx.signal,
  });
  const body = (await response.json()) as McpResult;
  if (body.error) throw new Error(body.error.message);
  if (body.result?.isError)
    throw new Error(body.result.content?.[0]?.text ?? `${name} failed`);
  return body.result?.structuredContent;
}

async function callLictory(
  ctx: HarnessContext,
  call: { tool: string; arguments: Record<string, unknown> },
) {
  let claimId: string | undefined;
  const fill = async (value: unknown): Promise<unknown> => {
    if (typeof value !== "string") return value;
    // A review session's prompt names the pull request and its head, as a
    // model reads them.
    const named = (pattern: RegExp, what: string) => {
      const found = pattern.exec(ctx.prompt)?.[1];
      if (!found) throw new Error(`The prompt names no ${what}.`);
      return found;
    };
    let text = value.replaceAll(
      "{{organizationId}}",
      ctx.lictory.organizationId,
    );
    if (text.includes("{{pullRequestId}}"))
      text = text.replaceAll(
        "{{pullRequestId}}",
        named(/pull request ([0-9a-f-]{36})/i, "pull request"),
      );
    if (text.includes("{{headSha}}"))
      text = text.replaceAll(
        "{{headSha}}",
        named(/at head ([0-9a-f]{40})/i, "head commit"),
      );
    if (text.includes("{{claimId}}")) {
      if (!claimId) {
        const listed = (await mcp(ctx, "listClaims", {
          organizationId: ctx.lictory.organizationId,
          mine: true,
        })) as { claims?: { id: string }[] } | undefined;
        claimId = listed?.claims?.[0]?.id;
        if (!claimId) throw new Error("This session holds no claim.");
      }
      text = text.replaceAll("{{claimId}}", claimId);
    }
    return text;
  };
  const args = Object.fromEntries(
    await Promise.all(
      Object.entries(call.arguments).map(
        async ([key, value]) => [key, await fill(value)] as const,
      ),
    ),
  );
  return mcp(ctx, call.tool, args);
}
