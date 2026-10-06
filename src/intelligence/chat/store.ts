import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "~/sync/server/service";
import * as s from "~/db/schema";
import { CapabilityError } from "~/capabilities/core";
import type { ChatMessage, ChatSummary } from "./shared";

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

export async function listChats(
  db: Database,
  owner: Owner,
  limit = 200,
): Promise<ChatSummary[]> {
  const chats = await db
    .select()
    .from(s.intelligenceChat)
    .where(owned(owner))
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
  return chats.map((c) => ({
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    preview: previews.get(c.id) ?? null,
  }));
}

export async function findChat(db: Database, owner: Owner, chatId: string) {
  const [chat] = await db
    .select()
    .from(s.intelligenceChat)
    .where(and(owned(owner), eq(s.intelligenceChat.id, chatId)));
  return chat ?? null;
}

export async function getChat(db: Database, owner: Owner, chatId: string) {
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
export async function openChat(db: Database, owner: Owner, chatId: string) {
  await db
    .insert(s.intelligenceChat)
    .values({ id: chatId, ...owner })
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
      .set({ updatedAt: new Date() })
      .where(eq(s.intelligenceChat.id, chatId));
  });
}

export async function updateChat(
  db: Database,
  owner: Owner,
  chatId: string,
  patch: { title?: string; pinned?: boolean },
) {
  const [chat] = await db
    .update(s.intelligenceChat)
    .set(patch)
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
