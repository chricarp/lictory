import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { harnessIds } from "@lictory/core/factory/protocol";
import type {
  AgentHarness,
  HarnessContext,
  HarnessResult,
  HarnessRun,
} from "@lictory/runner/harness/types";

// A scripted harness for tests (`lictory-runner start --test-harness
// <script.json | default>`). It stands in for every harness, so any runner
// agent runs it, and walks through a script of steps: messages, tool calls,
// commands, file writes, a question for a person and waiting for a
// steering message. It never runs a model or a command.

const step = z.union([
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
  z.object({ ask: z.string() }),
  z.object({ waitForMessage: z.literal(true) }),
  z.object({ sleep: z.number().int().min(0).max(600_000) }),
  z.object({ fail: z.string() }),
  z.object({ summary: z.string() }),
]);
export const fakeScript = z.array(step);
export type FakeScript = z.infer<typeof fakeScript>;

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
  { ask: "Run the database migration" },
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
  let interrupted: (() => void) | null = null;

  const done = (async (): Promise<HarnessResult> => {
    let summary: string | undefined;
    let asked = 0;
    for (const item of script) {
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
        ctx.emit("approval_request", { requestId, title: item.ask });
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
        const text = await Promise.race([
          ctx.nextMessage(30 * 60_000, signal),
          new Promise<null>((resolve) => {
            interrupted = () => resolve(null);
          }),
        ]);
        interrupted = null;
        if (signal.aborted) break;
        ctx.emit("message", {
          text: text ? `Got it: ${text}` : "No message arrived.",
        });
      } else if ("sleep" in item) await wait(item.sleep, signal);
      else if ("fail" in item) return { outcome: "failed", error: item.fail };
      else if ("summary" in item) {
        summary = item.summary;
        ctx.emit("summary", { text: item.summary });
      }
    }
    return { outcome: "completed", summary };
  })();

  return {
    interrupt: () => interrupted?.(),
    answer: (requestId, decision) => answers.get(requestId)?.(decision),
    stop: () => stop.abort(),
    done,
  };
}
