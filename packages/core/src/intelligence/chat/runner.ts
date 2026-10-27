import { and, eq } from "drizzle-orm";
import { isToolUIPart } from "ai";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import {
  CapabilityError,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { getCapability, invoke } from "@lictory/core/capabilities/registry";
import { serverContext } from "@lictory/core/capabilities/server";
import { directory, type Database } from "@lictory/core/domain/service";
import { aiPolicy } from "@lictory/core/domain/ai";
import {
  chatGenerator,
  type ChatGenerator,
} from "@lictory/core/intelligence/chat/step";
import {
  ChatLeaseLost,
  checkpointChatRun,
  claimChatRun,
  pendingTool,
  renewChatLease,
  toolName,
  waitingTool,
  withChatLease,
  type ClaimedChatRun,
  type ChatToolPart,
} from "@lictory/core/intelligence/chat/runs";
import { getChat, updateChat } from "@lictory/core/intelligence/chat/store";
import { generateTitle } from "@lictory/core/intelligence/chat/assistant";
import type { ChatMessage } from "@lictory/core/intelligence/chat/shared";

const MAX_STEPS = 24;
const ATTEMPT_MS = 5 * 60_000;

// Rejects even if a provider/adapter ignores cancellation. Writes from the
// abandoned computation remain fenced; unsafe tool calls are never replayed.
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Execution aborted."),
      );
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function processChatRuns(
  db: Database,
  options: {
    signal?: AbortSignal;
    generate?: ChatGenerator;
    timeoutMs?: number;
    context?: (run: ClaimedChatRun) => CapabilityContext;
  } = {},
) {
  const claimed = await claimChatRun(db);
  if (!claimed) return { claimed: 0 };
  const run: ClaimedChatRun = claimed;
  if (run.status === "failed") return { claimed: 1 };
  const lost = new AbortController();
  const deadline = AbortSignal.timeout(options.timeoutMs ?? ATTEMPT_MS);
  const signal = AbortSignal.any([
    lost.signal,
    deadline,
    ...(options.signal ? [options.signal] : []),
  ]);
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  const renew = async () => {
    try {
      await renewChatLease(db, run);
      if (!signal.aborted) heartbeat = setTimeout(() => void renew(), 5_000);
    } catch (error) {
      lost.abort(error);
    }
  };
  heartbeat = setTimeout(() => void renew(), 5_000);
  let checkpoint = structuredClone(run.checkpoint) as ChatMessage;
  try {
    await abortable(execute(), signal);
  } catch (error) {
    if (!(error instanceof ChatLeaseLost) && !lost.signal.aborted) {
      if (options.signal?.aborted) {
        await checkpointChatRun(db, run, checkpoint, {
          status: "queued",
        }).catch(ignoreLostLease);
      } else {
        const problem = toCapabilityError(error);
        console.error(
          JSON.stringify({
            event: "chat.run.failed",
            runId: run.id,
            category: problem.category,
          }),
        );
        const message = deadline.aborted
          ? "Litto took too long to finish this step. Your completed steps are saved; retry to continue."
          : error instanceof UnsafeToolRecovery
            ? error.message
            : problem.category !== "server"
              ? problem.message
              : "Litto could not finish this turn. Your completed steps are saved; retry to continue.";
        await checkpointChatRun(db, run, checkpoint, {
          status: "failed",
          error: message,
        }).catch(ignoreLostLease);
      }
    }
  } finally {
    lost.abort(new ChatLeaseLost("This execution has ended."));
    clearTimeout(heartbeat);
  }
  return { claimed: 1 };

  async function execute() {
    const ctx = options.context?.(run) ?? {
      ...serverContext({
        userId: run.userId,
        surface: "agent",
        client: "Litto",
      }),
      db,
    };
    // Never store a session or captured permissions in a job. Resolve current
    // organization membership and policy again on every recovered attempt.
    await directory(db, run.userId, run.organizationId);
    const policy = await aiPolicy(db, run.organizationId);
    if (!policy.enabled || (!policy.available && !options.generate))
      throw new CapabilityError(
        "unavailable",
        "Lictory Intelligence is disabled or unavailable. Ask an administrator to check its settings.",
      );
    let steps = run.steps;
    while (true) {
      signal.throwIfAborted();
      // Domain tools check current capabilities on each execution. Membership
      // and policy are also checked between model steps during a long turn.
      await directory(db, run.userId, run.organizationId);
      const currentPolicy = await aiPolicy(db, run.organizationId);
      if (!currentPolicy.enabled)
        throw new CapabilityError(
          "forbidden",
          "Lictory Intelligence was disabled for this organization.",
        );
      const pending = checkpoint.parts.filter(pendingTool);
      for (const part of pending) {
        signal.throwIfAborted();
        if (waitingTool(part)) continue;
        const output =
          part.state === "approval-responded" && !part.approval.approved
            ? ({ ...part, state: "output-denied" } as ChatToolPart)
            : await abortable(executeTool(db, run, ctx, part, signal), signal);
        checkpoint.parts[checkpoint.parts.indexOf(part)] = output;
        await checkpointChatRun(db, run, checkpoint);
      }
      if (checkpoint.parts.some(waitingTool)) {
        await checkpointChatRun(db, run, checkpoint, { status: "waiting" });
        return;
      }
      if (steps >= MAX_STEPS)
        throw new CapabilityError(
          "validation",
          "Litto reached the step limit for this turn. Review the saved progress and start a new message.",
        );
      const modelRoster = await directory(db, run.userId, run.organizationId);
      if (!(await aiPolicy(db, run.organizationId)).enabled)
        throw new CapabilityError(
          "forbidden",
          "Lictory Intelligence was disabled for this organization.",
        );
      const found = await getChat(db, run, run.chatId);
      if (!found) throw new ChatLeaseLost();
      // Always continue the last committed step, never partial output left by
      // the old model call. A step contains no automatic tool execution.
      const messages = found.messages.map((m) =>
        m.id === checkpoint.id ? checkpoint : m,
      );
      const priorWorked = checkpoint.metadata?.workedMs ?? 0;
      const started = Date.now();
      let partial = structuredClone(checkpoint);
      let savedAt = 0;
      const iterator = (options.generate ?? chatGenerator())({
        messages,
        roster: modelRoster,
        owner: run,
        ctx,
        signal,
      })[Symbol.asyncIterator]();
      while (true) {
        const next = await abortable(iterator.next(), signal);
        if (next.done) break;
        partial = next.value;
        if (Date.now() - savedAt >= 1_000) {
          await checkpointChatRun(db, run, partial, { partial: true });
          savedAt = Date.now();
        }
      }
      signal.throwIfAborted();
      partial.metadata = {
        ...partial.metadata,
        workedMs: priorWorked + Date.now() - started,
      };
      // Approval is bound to this persisted call and its exact arguments.
      partial.parts = partial.parts.map((p) => {
        if (!isToolUIPart(p) || p.state !== "input-available" || waitingTool(p))
          return p;
        const capability = getCapability(toolName(p), "agent");
        return capability?.kind === "command" &&
          (capability.decision || capability.destructive)
          ? {
              ...p,
              state: "approval-requested",
              approval: { id: `${run.id}:${p.toolCallId}` },
            }
          : p;
      });
      const tools = partial.parts.filter(pendingTool);
      const newToolCalls =
        partial.parts.filter(isToolUIPart).length >
        checkpoint.parts.filter(isToolUIPart).length;
      const status = partial.parts.some(waitingTool)
        ? "waiting"
        : tools.length || newToolCalls
          ? "running"
          : "completed";
      await checkpointChatRun(db, run, partial, { status, modelStep: true });
      checkpoint = structuredClone(partial);
      steps++;
      if (status !== "running") {
        // A title is optional metadata, independent of completing the turn.
        if (!found.chat.title) {
          const prompt = found.messages
            .find((m) => m.role === "user")
            ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
            .join("\n");
          if (prompt && !options.generate) {
            const title = await generateTitle(prompt);
            if (title) await updateChat(db, run, run.chatId, { title });
          }
        }
        return;
      }
    }
  }
}

function ignoreLostLease(error: unknown) {
  if (!(error instanceof ChatLeaseLost)) throw error;
}
class UnsafeToolRecovery extends Error {}

async function executeTool(
  db: Database,
  run: ClaimedChatRun,
  ctx: CapabilityContext,
  part: ChatToolPart,
  signal: AbortSignal,
): Promise<ChatToolPart> {
  const name = toolName(part);
  const capability = getCapability(name, "agent");
  const tool = await withChatLease(db, run, async (tx) => {
    const [existing] = await tx
      .select()
      .from(s.intelligenceChatTool)
      .where(
        and(
          eq(s.intelligenceChatTool.runId, run.id),
          eq(s.intelligenceChatTool.toolCallId, part.toolCallId),
        ),
      );
    if (existing) {
      if (!existing.completed && !existing.replayable)
        throw new UnsafeToolRecovery(
          `Litto was interrupted while executing ${name}. Its outcome is uncertain. Inspect the affected work before requesting another action; Litto will not repeat it automatically.`,
        );
      return existing;
    }
    const shape =
      capability?.input instanceof z.ZodObject ? capability.input.shape : {};
    const input = {
      ...(part.input as object),
      ...(shape.organizationId ? { organizationId: run.organizationId } : {}),
      ...(shape.mutationId ? { mutationId: crypto.randomUUID() } : {}),
    };
    const [created] = await tx
      .insert(s.intelligenceChatTool)
      .values({
        runId: run.id,
        toolCallId: part.toolCallId,
        name,
        input,
        replayable:
          capability?.kind === "query" ||
          !!shape.mutationId ||
          (!!capability?.idempotent && !capability.external),
      })
      .returning();
    return created!;
  });
  let output = tool.output;
  if (!tool.completed) {
    signal.throwIfAborted();
    try {
      await directory(db, run.userId, run.organizationId);
      if (!(await aiPolicy(db, run.organizationId)).enabled)
        throw new CapabilityError(
          "forbidden",
          "Lictory Intelligence was disabled for this organization.",
        );
      signal.throwIfAborted();
      output = { ok: true, result: await invoke(ctx, name, tool.input) };
    } catch (error) {
      output = { ok: false, error: toCapabilityError(error).toJSON() };
    }
    // The ledger result is durable even if a checkpoint write subsequently
    // fails. Commands that commit before this use their stable mutation ID.
    await withChatLease(db, run, async (tx) => {
      await tx
        .update(s.intelligenceChatTool)
        .set({ completed: true, output })
        .where(
          and(
            eq(s.intelligenceChatTool.runId, run.id),
            eq(s.intelligenceChatTool.toolCallId, part.toolCallId),
          ),
        );
    });
  }
  // Keep prior approvals and their arguments for the model-message adapter.
  return { ...part, state: "output-available", output } as ChatToolPart;
}
