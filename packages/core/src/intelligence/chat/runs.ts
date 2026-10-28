import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { isToolUIPart } from "ai";
import * as s from "@lictory/core/db/schema";
import { CapabilityError } from "@lictory/core/capabilities/core";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import { signalWork } from "@lictory/core/jobs/signal";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  askQuestionsInput,
  askQuestionsOutput,
  recommendActionOutput,
  type ChatMessage,
  type ChatResponse,
  type ChatRunState,
  type ChatRunSummary,
} from "@lictory/core/intelligence/chat/shared";

export type ChatOwner = { organizationId: string; userId: string };
export type ChatRun = typeof s.intelligenceChatRun.$inferSelect;
export type ClaimedChatRun = ChatRun & ChatOwner;
export type ChatToolPart = Extract<
  ChatMessage["parts"][number],
  { toolCallId: string }
>;
const MAX_ATTEMPTS = 3;
const active = ["queued", "running", "waiting"];

export const runSummary = (run: ChatRun): ChatRunSummary => ({
  id: run.id,
  requestId: run.requestId ?? run.id,
  status: run.status as ChatRunState,
  error: run.error,
  updatedAt: run.updatedAt.toISOString(),
});
export const toolName = (part: ChatToolPart) =>
  part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
export const pendingTool = (
  part: ChatMessage["parts"][number],
): part is ChatToolPart =>
  isToolUIPart(part) &&
  ["input-available", "approval-requested", "approval-responded"].includes(
    part.state,
  );
export const waitingTool = (part: ChatMessage["parts"][number]) =>
  pendingTool(part) &&
  (part.state === "approval-requested" ||
    (part.state === "input-available" &&
      [ASK_QUESTIONS, RECOMMEND_ACTION].includes(toolName(part))));

export async function latestChatRuns(db: Database | Tx, chatIds: string[]) {
  if (!chatIds.length) return new Map<string, ChatRun>();
  const rows = await db
    .selectDistinctOn([s.intelligenceChatRun.chatId])
    .from(s.intelligenceChatRun)
    .where(inArray(s.intelligenceChatRun.chatId, chatIds))
    .orderBy(
      s.intelligenceChatRun.chatId,
      desc(s.intelligenceChatRun.createdAt),
      desc(s.intelligenceChatRun.id),
    );
  return new Map(rows.map((r) => [r.chatId, r]));
}

// Private chat writes share the organization lock with membership changes.
async function ownedChat(tx: Tx, owner: ChatOwner, chatId: string) {
  await lock(tx, owner.organizationId);
  const [membership] = await tx
    .select({ id: s.member.id })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, owner.organizationId),
        eq(s.member.userId, owner.userId),
      ),
    );
  const [chat] = await tx
    .select()
    .from(s.intelligenceChat)
    .where(
      and(
        eq(s.intelligenceChat.id, chatId),
        eq(s.intelligenceChat.organizationId, owner.organizationId),
        eq(s.intelligenceChat.userId, owner.userId),
      ),
    )
    .for("update");
  if (!membership || !chat)
    throw new CapabilityError("forbidden", "This conversation is unavailable.");
  return chat;
}

export async function writeChatMessage(
  tx: Tx,
  chatId: string,
  position: number,
  message: ChatMessage,
) {
  await tx
    .insert(s.intelligenceChatMessage)
    .values({
      chatId,
      position,
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: [s.intelligenceChatMessage.chatId, s.intelligenceChatMessage.id],
      set: { parts: message.parts, metadata: message.metadata ?? null },
    });
  await tx
    .update(s.intelligenceChat)
    .set({
      updatedAt: new Date(),
      version: sql`${s.intelligenceChat.version} + 1`,
    })
    .where(eq(s.intelligenceChat.id, chatId));
}

export async function submitChatRun(
  db: Database,
  owner: ChatOwner,
  chatId: string,
  input: {
    requestId: string;
    message?: ChatMessage;
    response?: ChatResponse;
    retry?: boolean;
    runId?: string;
  },
) {
  if (
    Number(!!input.message) +
      Number(!!input.response) +
      Number(!!input.retry) !==
    1
  )
    throw new CapabilityError(
      "validation",
      "Submit one message, answer or retry.",
    );
  await db.transaction(async (tx) => {
    await ownedChat(tx, owner, chatId);
    const [receipt] = await tx
      .select()
      .from(s.intelligenceChatRequest)
      .where(
        and(
          eq(s.intelligenceChatRequest.chatId, chatId),
          eq(s.intelligenceChatRequest.id, input.requestId),
        ),
      );
    if (receipt) {
      if (!isDeepStrictEqual(receipt.payload, input))
        throw new CapabilityError(
          "conflict",
          "This request ID was already used for a different message.",
        );
      return;
    }
    const [cancellation] = await tx
      .select()
      .from(s.intelligenceChatRequest)
      .where(
        and(
          eq(s.intelligenceChatRequest.chatId, chatId),
          eq(s.intelligenceChatRequest.id, `cancel:${input.requestId}`),
        ),
      );
    const [previous] = await tx
      .select()
      .from(s.intelligenceChatRun)
      .where(eq(s.intelligenceChatRun.chatId, chatId))
      .orderBy(
        desc(s.intelligenceChatRun.createdAt),
        desc(s.intelligenceChatRun.id),
      )
      .limit(1);
    if (input.message) {
      if (previous && active.includes(previous.status))
        throw new CapabilityError(
          "conflict",
          "Litto is still working or waiting for your input. Answer or stop this turn first.",
        );
      const [last] = await tx
        .select({ position: s.intelligenceChatMessage.position })
        .from(s.intelligenceChatMessage)
        .where(eq(s.intelligenceChatMessage.chatId, chatId))
        .orderBy(desc(s.intelligenceChatMessage.position))
        .limit(1);
      const [duplicate] = await tx
        .select({ id: s.intelligenceChatMessage.id })
        .from(s.intelligenceChatMessage)
        .where(
          and(
            eq(s.intelligenceChatMessage.chatId, chatId),
            eq(s.intelligenceChatMessage.id, input.message.id),
          ),
        );
      if (duplicate)
        throw new CapabilityError(
          "conflict",
          "This message was already submitted.",
        );
      const position = (last?.position ?? -1) + 1;
      await writeChatMessage(tx, chatId, position, input.message);
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [],
      };
      await writeChatMessage(tx, chatId, position + 1, assistant);
      await tx.insert(s.intelligenceChatRun).values({
        id: input.requestId,
        chatId,
        assistantId: assistant.id,
        position: position + 1,
        checkpoint: assistant,
        status: cancellation ? "canceled" : "queued",
        cancelRequested: !!cancellation,
      });
    } else if (input.response) {
      const response = input.response;
      // Legacy transcripts waiting for input become durable on their first response.
      let run = previous;
      if (!run) {
        const [last] = await tx
          .select()
          .from(s.intelligenceChatMessage)
          .where(eq(s.intelligenceChatMessage.chatId, chatId))
          .orderBy(desc(s.intelligenceChatMessage.position))
          .limit(1);
        if (last?.role !== "assistant")
          throw new CapabilityError(
            "conflict",
            "This conversation is not waiting for an answer.",
          );
        const checkpoint = {
          id: last.id,
          role: "assistant",
          parts: last.parts,
          metadata: last.metadata ?? undefined,
        } as ChatMessage;
        [run] = await tx
          .insert(s.intelligenceChatRun)
          .values({
            id: input.requestId,
            chatId,
            assistantId: last.id,
            position: last.position,
            checkpoint,
            status: "waiting",
          })
          .returning();
      }
      if (run!.status !== "waiting")
        throw new CapabilityError(
          "conflict",
          "This question has already been answered or this turn has stopped. Refresh the conversation.",
        );
      const message = structuredClone(run!.checkpoint) as ChatMessage;
      const part = message.parts.find(
        (p): p is ChatToolPart =>
          isToolUIPart(p) &&
          ("toolCallId" in response
            ? p.toolCallId === response.toolCallId
            : p.state === "approval-requested" &&
              p.approval.id === response.approvalId),
      );
      if (!part || !waitingTool(part))
        throw new CapabilityError(
          "conflict",
          "This question has already been answered or is unavailable.",
        );
      let next: ChatToolPart;
      if ("approvalId" in response) {
        if (part.state !== "approval-requested")
          throw new CapabilityError(
            "validation",
            "This action is not awaiting approval.",
          );
        next = {
          ...part,
          state: "approval-responded",
          approval: { ...part.approval, approved: response.approved },
        };
      } else {
        const schema =
          toolName(part) === ASK_QUESTIONS
            ? askQuestionsOutput
            : recommendActionOutput;
        const output = schema.parse(response.output);
        if (toolName(part) === ASK_QUESTIONS && "answers" in output) {
          const questions = askQuestionsInput.parse(part.input).questions;
          const answers = askQuestionsOutput.parse(output);
          if (
            !("answers" in answers) ||
            answers.answers.length !== questions.length ||
            new Set(answers.answers.map((a) => a.id)).size !== questions.length
          )
            throw new CapabilityError(
              "validation",
              "Answer each question once, or dismiss the questions.",
            );
          for (const q of questions) {
            const answer = answers.answers.find((a) => a.id === q.id);
            if (
              !answer ||
              (q.required &&
                (answer.skipped ||
                  (!answer.values.length && !answer.text?.trim()))) ||
              answer.values.some(
                (v) => !q.options.some((o) => o.value === v),
              ) ||
              (q.kind === "single" && answer.values.length > 1)
            )
              throw new CapabilityError(
                "validation",
                `Check the answer to “${q.prompt}”.`,
              );
          }
        }
        next = { ...part, state: "output-available", output } as ChatToolPart;
      }
      message.parts[message.parts.indexOf(part)] = next;
      const status = message.parts.some(waitingTool) ? "waiting" : "queued";
      await writeChatMessage(tx, chatId, run!.position, message);
      await tx
        .update(s.intelligenceChatRun)
        .set({
          checkpoint: message,
          status,
          attempts: 0,
          updatedAt: new Date(),
        })
        .where(eq(s.intelligenceChatRun.id, run!.id));
    } else if (input.retry) {
      if (input.runId && input.runId !== (previous?.id ?? `legacy:${chatId}`))
        throw new CapabilityError(
          "conflict",
          "This turn has been superseded. Refresh the conversation before retrying.",
        );
      if (!previous) {
        const [last] = await tx
          .select()
          .from(s.intelligenceChatMessage)
          .where(eq(s.intelligenceChatMessage.chatId, chatId))
          .orderBy(desc(s.intelligenceChatMessage.position))
          .limit(1);
        if (last?.role !== "user")
          throw new CapabilityError("conflict", "This turn cannot be retried.");
        const checkpoint: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [],
        };
        await writeChatMessage(tx, chatId, last.position + 1, checkpoint);
        await tx.insert(s.intelligenceChatRun).values({
          id: input.requestId,
          chatId,
          assistantId: checkpoint.id,
          checkpoint,
          position: last.position + 1,
          status: cancellation ? "canceled" : "queued",
          cancelRequested: !!cancellation,
        });
        await tx
          .insert(s.intelligenceChatRequest)
          .values({ chatId, id: input.requestId, payload: input });
        await signalWork(tx, "chat");
        return;
      }
      if (!["failed", "canceled"].includes(previous.status))
        throw new CapabilityError("conflict", "This turn cannot be retried.");
      const other = await tx
        .select({ id: s.intelligenceChatRun.id })
        .from(s.intelligenceChatRun)
        .where(
          and(
            eq(s.intelligenceChatRun.chatId, chatId),
            inArray(s.intelligenceChatRun.status, active),
          ),
        );
      if (other.length)
        throw new CapabilityError(
          "conflict",
          "Another turn is already active.",
        );
      await writeChatMessage(
        tx,
        chatId,
        previous.position,
        cancellation
          ? closePending(previous.checkpoint as ChatMessage)
          : (previous.checkpoint as ChatMessage),
      );
      await tx
        .update(s.intelligenceChatRun)
        .set({
          status: cancellation ? "canceled" : "queued",
          requestId: input.requestId,
          cancelRequested: !!cancellation,
          attempts: 0,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(s.intelligenceChatRun.id, previous.id));
    } else
      throw new CapabilityError(
        "validation",
        "A message, answer or retry is required.",
      );
    await tx
      .insert(s.intelligenceChatRequest)
      .values({ chatId, id: input.requestId, payload: input });
    await signalWork(tx, "chat");
  });
}

export async function cancelChatRun(
  db: Database,
  owner: ChatOwner,
  chatId: string,
  runId: string,
  requestId = runId,
) {
  await db.transaction(async (tx) => {
    await ownedChat(tx, owner, chatId);
    await tx
      .insert(s.intelligenceChatRequest)
      .values({
        chatId,
        id: `cancel:${requestId}`,
        payload: { runId, requestId },
      })
      .onConflictDoNothing();
    const [run] = await tx
      .select()
      .from(s.intelligenceChatRun)
      .where(
        and(
          eq(s.intelligenceChatRun.chatId, chatId),
          eq(s.intelligenceChatRun.id, runId),
        ),
      );
    if (!run) {
      const [anyRun] = await tx
        .select({ id: s.intelligenceChatRun.id })
        .from(s.intelligenceChatRun)
        .where(eq(s.intelligenceChatRun.chatId, chatId))
        .limit(1);
      const [last] = await tx
        .select()
        .from(s.intelligenceChatMessage)
        .where(eq(s.intelligenceChatMessage.chatId, chatId))
        .orderBy(desc(s.intelligenceChatMessage.position))
        .limit(1);
      if (!anyRun && last?.role === "assistant") {
        const checkpoint = {
          id: last.id,
          role: "assistant",
          parts: last.parts,
        } as ChatMessage;
        if (checkpoint.parts.some(waitingTool)) {
          await tx.insert(s.intelligenceChatRun).values({
            id: runId,
            chatId,
            assistantId: last.id,
            position: last.position,
            checkpoint,
            status: "canceled",
            cancelRequested: true,
          });
          await writeChatMessage(
            tx,
            chatId,
            last.position,
            closePending(checkpoint),
          );
        }
      }
      return;
    }
    if (!active.includes(run.status) || (run.requestId ?? run.id) !== requestId)
      return;
    const [stored] = await tx
      .select()
      .from(s.intelligenceChatMessage)
      .where(
        and(
          eq(s.intelligenceChatMessage.chatId, chatId),
          eq(s.intelligenceChatMessage.id, run.assistantId),
        ),
      );
    if (stored)
      await writeChatMessage(
        tx,
        chatId,
        run.position,
        closePending({
          id: stored.id,
          role: "assistant",
          parts: stored.parts,
        } as ChatMessage),
      );
    await tx
      .update(s.intelligenceChatRun)
      .set({
        status: "canceled",
        cancelRequested: true,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(s.intelligenceChatRun.id, run.id));
  });
}

export function closePending(message: ChatMessage): ChatMessage {
  return {
    ...message,
    parts: message.parts
      .filter((p) => !isToolUIPart(p) || p.state !== "input-streaming")
      .map((p) =>
        pendingTool(p)
          ? ({
              ...p,
              state: "output-error",
              errorText:
                "This step did not finish. Inspect any action already started before asking Litto to continue.",
            } as ChatToolPart)
          : p.type === "text" || p.type === "reasoning"
            ? { ...p, state: "done" as const }
            : p,
      ),
  };
}

export async function claimChatRun(
  db: Database,
): Promise<ClaimedChatRun | undefined> {
  const eligible = or(
    eq(s.intelligenceChatRun.status, "queued"),
    and(
      eq(s.intelligenceChatRun.status, "running"),
      lt(s.intelligenceChatRun.leaseUntil, sql`now()`),
    ),
  );
  const candidates = await db
    .select({
      id: s.intelligenceChatRun.id,
      chatId: s.intelligenceChat.id,
      organizationId: s.intelligenceChat.organizationId,
      userId: s.intelligenceChat.userId,
    })
    .from(s.intelligenceChatRun)
    .innerJoin(
      s.intelligenceChat,
      eq(s.intelligenceChatRun.chatId, s.intelligenceChat.id),
    )
    .where(eligible)
    .orderBy(asc(s.intelligenceChatRun.createdAt))
    .limit(5);
  for (const candidate of candidates) {
    const claimed = await db.transaction(async (tx) => {
      // Same lock order as submissions and checkpoint writes.
      await lock(tx, candidate.organizationId);
      const [chat] = await tx
        .select()
        .from(s.intelligenceChat)
        .where(eq(s.intelligenceChat.id, candidate.chatId))
        .for("update");
      if (!chat) return;
      const [row] = await tx
        .select()
        .from(s.intelligenceChatRun)
        .where(and(eq(s.intelligenceChatRun.id, candidate.id), eligible))
        .for("update", { skipLocked: true });
      if (!row) return;
      const exhausted = row.attempts >= MAX_ATTEMPTS;
      const [run] = await tx
        .update(s.intelligenceChatRun)
        .set({
          status: exhausted ? "failed" : "running",
          attempts: row.attempts + 1,
          leaseToken: exhausted ? null : crypto.randomUUID(),
          leaseUntil: exhausted ? null : sql`now() + interval '60 seconds'`,
          error: exhausted
            ? "Litto was interrupted repeatedly. Your saved progress is available; retry this turn."
            : null,
          updatedAt: new Date(),
        })
        .where(eq(s.intelligenceChatRun.id, row.id))
        .returning();
      await writeChatMessage(
        tx,
        row.chatId,
        row.position,
        exhausted
          ? closePending(row.checkpoint as ChatMessage)
          : (row.checkpoint as ChatMessage),
      );
      return {
        ...run!,
        organizationId: chat.organizationId,
        userId: chat.userId,
      };
    });
    if (claimed) return claimed;
  }
}

export class ChatLeaseLost extends Error {}
export async function withChatLease<T>(
  db: Database,
  run: ClaimedChatRun,
  action: (tx: Tx, current: ChatRun) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lock(tx, run.organizationId);
    const [current] = await tx
      .select()
      .from(s.intelligenceChatRun)
      .where(
        and(
          eq(s.intelligenceChatRun.id, run.id),
          eq(s.intelligenceChatRun.status, "running"),
          eq(s.intelligenceChatRun.leaseToken, run.leaseToken!),
          sql`${s.intelligenceChatRun.leaseUntil} > now()`,
        ),
      )
      .for("update");
    if (!current || current.cancelRequested)
      throw new ChatLeaseLost("This worker no longer owns the turn.");
    return action(tx, current);
  });
}

export async function checkpointChatRun(
  db: Database,
  run: ClaimedChatRun,
  message: ChatMessage,
  options: {
    status?: ChatRunState;
    error?: string | null;
    partial?: boolean;
    modelStep?: boolean;
  } = {},
) {
  await withChatLease(db, run, async (tx, current) => {
    // Human input is actionable only once its waiting checkpoint commits.
    const visible = options.partial
      ? { ...message, parts: message.parts.filter((p) => !waitingTool(p)) }
      : message;
    await writeChatMessage(
      tx,
      run.chatId,
      run.position,
      options.status === "failed" ? closePending(message) : visible,
    );
    const status = options.status ?? "running";
    await tx
      .update(s.intelligenceChatRun)
      .set({
        ...(!options.partial ? { checkpoint: message } : {}),
        status,
        error: options.error ?? null,
        steps: current.steps + (options.modelStep ? 1 : 0),
        ...(status !== "running" ? { leaseToken: null, leaseUntil: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.intelligenceChatRun.id, run.id));
  });
}

export async function renewChatLease(db: Database, run: ClaimedChatRun) {
  await withChatLease(db, run, async (tx) => {
    await tx
      .update(s.intelligenceChatRun)
      .set({ leaseUntil: sql`now() + interval '60 seconds'` })
      .where(eq(s.intelligenceChatRun.id, run.id));
  });
}
