import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Tx } from "@lictory/core/domain/service";
import * as s from "@lictory/core/db/schema";
import { CapabilityError } from "@lictory/core/capabilities/core";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  type ChatMessage,
  type ChatSummary,
  type ChatSnapshot,
} from "@lictory/core/intelligence/chat/shared";

import {
  latestChatRuns,
  runSummary,
} from "@lictory/core/intelligence/chat/runs";

// Persistence for Intelligence conversations. Every read and write is scoped to
// the organization and to the person who owns the chat; callers must already
// have checked organization membership.

type Owner = { organizationId: string; userId: string };

const owned = (owner: Owner) =>
  and(
    eq(s.intelligenceChat.organizationId, owner.organizationId),
    eq(s.intelligenceChat.userId, owner.userId),
  );

function textOf(parts: unknown) {
  if (!Array.isArray(parts)) return null;
  const text = parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text",
    )
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 160) : null;
}

// A message part that waits for the person: an approval request, or a
// clarification or recommendation without an answer. Mirrors `answerMood` in
// the chat UI, which decides the same from live messages.
const awaitingPath = `$[*] ? (@.state == "approval-requested" || (@.state == "input-available" && (@.type == "tool-${ASK_QUESTIONS}" || @.type == "tool-${RECOMMEND_ACTION}")))`;

async function readChats(
  db: Database | Tx,
  owner: Owner,
  limit = 200,
): Promise<ChatSummary[]> {
  const chats = await db
    .select()
    .from(s.intelligenceChat)
    .where(and(owned(owner), eq(s.intelligenceChat.listed, true)))
    .orderBy(desc(s.intelligenceChat.updatedAt))
    .limit(limit);
  if (!chats.length) return [];
  const first = await db
    .select({
      chatId: s.intelligenceChatMessage.chatId,
      parts: s.intelligenceChatMessage.parts,
    })
    .from(s.intelligenceChatMessage)
    .where(
      and(
        inArray(
          s.intelligenceChatMessage.chatId,
          chats.map((c) => c.id),
        ),
        eq(s.intelligenceChatMessage.position, 0),
      ),
    );
  const previews = new Map(first.map((m) => [m.chatId, textOf(m.parts)]));
  const message = s.intelligenceChatMessage;
  const last = await db
    .selectDistinctOn([message.chatId], {
      chatId: message.chatId,
      role: message.role,
      waiting: sql<boolean>`${message.role} = 'assistant' and jsonb_path_exists(${message.parts}, ${awaitingPath}::jsonpath)`,
    })
    .from(message)
    .where(
      inArray(
        message.chatId,
        chats.map((c) => c.id),
      ),
    )
    .orderBy(message.chatId, desc(message.position));
  const waiting = new Set(last.filter((m) => m.waiting).map((m) => m.chatId));
  const interrupted = new Set(
    last.filter((m) => m.role === "user").map((m) => m.chatId),
  );
  const runs = await latestChatRuns(
    db,
    chats.map((c) => c.id),
  );
  return chats.map((c) => ({
    id: c.id,
    version: c.version,
    title: c.title,
    pinned: c.pinned,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    preview: previews.get(c.id) ?? null,
    awaitingInput: runs.has(c.id)
      ? runs.get(c.id)!.status === "waiting"
      : waiting.has(c.id),
    running: ["queued", "running"].includes(runs.get(c.id)?.status ?? ""),
    run: runs.has(c.id)
      ? runSummary(runs.get(c.id)!)
      : interrupted.has(c.id)
        ? {
            id: `legacy:${c.id}`,
            status: "failed",
            error:
              "This earlier turn was interrupted before its answer was saved. Retry to continue.",
            updatedAt: c.updatedAt.toISOString(),
          }
        : null,
  }));
}

export async function findChat(
  db: Database | Tx,
  owner: Owner,
  chatId: string,
) {
  const [chat] = await db
    .select()
    .from(s.intelligenceChat)
    .where(and(owned(owner), eq(s.intelligenceChat.id, chatId)));
  return chat ?? null;
}

export async function getChat(db: Database | Tx, owner: Owner, chatId: string) {
  const chat = await findChat(db, owner, chatId);
  if (!chat) return null;
  const rows = await db
    .select()
    .from(s.intelligenceChatMessage)
    .where(eq(s.intelligenceChatMessage.chatId, chatId))
    .orderBy(asc(s.intelligenceChatMessage.position));
  return {
    chat,
    messages: rows.map(
      (r) =>
        ({
          id: r.id,
          role: r.role,
          parts: r.parts,
          ...(r.metadata ? { metadata: r.metadata } : {}),
        }) as ChatMessage,
    ),
  };
}

// Creates the chat on first use. Ids come from the browser, so an id that
// already belongs to someone else (or another organization) is refused.
// Conversations started from the dock are created unlisted.
export async function openChat(
  db: Database,
  owner: Owner,
  chatId: string,
  options: { listed?: boolean } = {},
) {
  await db
    .insert(s.intelligenceChat)
    .values({ id: chatId, ...owner, listed: options.listed ?? true })
    .onConflictDoNothing();
  const chat = await findChat(db, owner, chatId);
  if (!chat) throw new CapabilityError("forbidden", "This chat is not yours.");
  return chat;
}

// Replaces the transcript with `messages`, in order. Transcripts are short and
// the whole list is written at the end of each turn.
export async function saveMessages(
  db: Database,
  owner: Owner,
  chatId: string,
  messages: ChatMessage[],
) {
  await db.transaction(async (tx) => {
    const [chat] = await tx
      .select({ id: s.intelligenceChat.id })
      .from(s.intelligenceChat)
      .where(and(owned(owner), eq(s.intelligenceChat.id, chatId)))
      .for("update");
    if (!chat) return;
    await tx
      .delete(s.intelligenceChatMessage)
      .where(eq(s.intelligenceChatMessage.chatId, chatId));
    if (messages.length)
      await tx.insert(s.intelligenceChatMessage).values(
        messages.map((m, position) => ({
          id: m.id,
          chatId,
          position,
          role: m.role,
          parts: m.parts,
          metadata: m.metadata ?? null,
        })),
      );
    await tx
      .update(s.intelligenceChat)
      .set({
        updatedAt: new Date(),
        version: sql`${s.intelligenceChat.version} + 1`,
      })
      .where(eq(s.intelligenceChat.id, chatId));
  });
}

export async function updateChat(
  db: Database,
  owner: Owner,
  chatId: string,
  patch: { title?: string; pinned?: boolean; listed?: boolean },
) {
  const [chat] = await db
    .update(s.intelligenceChat)
    .set({ ...patch, version: sql`${s.intelligenceChat.version} + 1` })
    .where(and(owned(owner), eq(s.intelligenceChat.id, chatId)))
    .returning();
  return chat ?? null;
}

export async function deleteChat(db: Database, owner: Owner, chatId: string) {
  const deleted = await db
    .delete(s.intelligenceChat)
    .where(and(owned(owner), eq(s.intelligenceChat.id, chatId)))
    .returning({ id: s.intelligenceChat.id });
  return deleted.length > 0;
}

// One consistent saved view, served identically by every API instance.
export async function getChatSnapshot(
  db: Database,
  owner: Owner,
  chatId: string,
): Promise<ChatSnapshot> {
  return db.transaction(
    async (tx) => {
      const found = await getChat(tx, owner, chatId);
      if (!found) return { chat: null, messages: [], run: null };
      const run = (await latestChatRuns(tx, [chatId])).get(chatId);
      const last = found.messages.at(-1);
      const legacy =
        !run && last?.role === "user"
          ? {
              id: `legacy:${chatId}`,
              status: "failed" as const,
              error:
                "This earlier turn was interrupted before its answer was saved. Retry to continue.",
              updatedAt: found.chat.updatedAt.toISOString(),
            }
          : null;
      return {
        version: found.chat.version,
        chat: {
          id: found.chat.id,
          title: found.chat.title,
          pinned: found.chat.pinned,
        },
        messages: found.messages,
        run: run ? runSummary(run) : legacy,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export function listChats(db: Database, owner: Owner, limit = 200) {
  return db.transaction((tx) => readChats(tx, owner, limit), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
