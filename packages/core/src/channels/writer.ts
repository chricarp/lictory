import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { ChannelAttachment } from "@lictory/core/db/channel-schema";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  type Actor,
  type Tx,
} from "@lictory/core/domain/service";
import {
  readChannelAccess,
  type ChannelAccess,
  type ChannelRow,
} from "@lictory/core/channels/access";
import { agentDirectory } from "@lictory/core/channels/agents";
import {
  CHANNEL_ATTACHMENTS_MAX,
  CHANNEL_MESSAGE_MAX,
  REPLY_AUTHORS_MAX,
  channelMentions,
  participantKey,
  reactionId,
  validEmoji,
} from "@lictory/core/channels/shared";
import { queueChannelNotifications } from "@lictory/core/channels/notifications";

// The conversation writer (docs/internals/channels.md#write-path): the one
// writer of channel messages, reactions, read cursors and thread
// participation. Messages are high-volume and append-only, so this writer is
// a narrow, documented exception to the domain write rule:
//
// - it takes the organization lock in SHARED mode (it waits for, and blocks,
//   exclusive domain commands of the organization such as archiving the
//   channel or removing a member, never other conversations), then the
//   channel's own transaction lock, and never upgrades to exclusive in the
//   same transaction. A command that holds the exclusive organization lock
//   may call it afterwards (promotion cards, system messages): the order
//   organization lock, then channel lock, is the same everywhere;
// - it checks Better Auth membership (with the two-factor and deletion
//   locks) and channel access inside that transaction;
// - it assigns the channel's next sequence and appends. History is never
//   rewritten: an edit keeps the previous body as a revision and a deletion
//   leaves a tombstone;
// - it writes no `sync_entity` projection: its rows are shaped for
//   synchronization and authorized through channel access by the synced
//   queries.

export type MessageRow = typeof s.channelMessage.$inferSelect;

const channelLockSeed = 1;

/** Shared organization lock, then the channel's own lock. */
async function lockConversation(
  tx: Tx,
  organizationId: string,
  channelId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${organizationId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${channelId}, ${channelLockSeed}))`,
  );
}

type Author =
  | { kind: "user"; userId: string; via: string | null }
  | { kind: "agent"; agentId: string; onBehalfOf: string };

async function authorOf(
  tx: Tx,
  organizationId: string,
  actor: Actor,
): Promise<Author> {
  if (actor.surface && actor.surface !== "web") {
    const agent = await agentDirectory().actingAgent(tx, organizationId, actor);
    // An agent never acts for a different person.
    if (agent?.ownerId === actor.userId)
      return { kind: "agent", agentId: agent.id, onBehalfOf: actor.userId };
    return {
      kind: "user",
      userId: actor.userId,
      via: actor.agentName?.slice(0, 80) ?? actor.surface,
    };
  }
  return { kind: "user", userId: actor.userId, via: null };
}

const authorKeyOf = (author: Author) =>
  author.kind === "user"
    ? participantKey("user", author.userId)
    : participantKey("agent", author.agentId);

function isAuthor(message: MessageRow, author: Author) {
  return author.kind === "user"
    ? message.authorKind === "user" && message.authorUserId === author.userId
    : message.authorKind === "agent" &&
        message.authorAgentId === author.agentId;
}

async function open(
  tx: Tx,
  actor: Actor,
  organizationId: string,
  channelId: string,
): Promise<ChannelAccess & { admin: boolean }> {
  await lockConversation(tx, organizationId, channelId);
  const membership = await authorize(tx, actor.userId, organizationId);
  const admin = isAdmin(membership);
  const access = await readChannelAccess(
    tx,
    organizationId,
    actor.userId,
    channelId,
    admin,
  );
  return { ...access, admin };
}

function requirePost(access: ChannelAccess) {
  if (access.channel.archivedAt)
    throw new DomainError(
      "conflict",
      "This channel is archived. Restore it to post again.",
      undefined,
      "invalid_state",
    );
  if (!access.member)
    throw new DomainError(
      "forbidden",
      `Join #${access.channel.name ?? "this channel"} to post in it.`,
      undefined,
      "not_member",
    );
}

async function messageIn(
  tx: Tx,
  organizationId: string,
  channelId: string,
  messageId: string,
) {
  const [message] = await tx
    .select()
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.organizationId, organizationId),
        eq(s.channelMessage.channelId, channelId),
        eq(s.channelMessage.id, messageId),
      ),
    );
  if (!message)
    throw new DomainError("not_found", "This message is unavailable.");
  return message;
}

function validateBody(body: string, attachments: number) {
  if (body.length > CHANNEL_MESSAGE_MAX)
    throw new DomainError(
      "validation",
      `Messages are at most ${CHANNEL_MESSAGE_MAX.toLocaleString("en-US")} characters. Put longer text in a page or a specification and link it.`,
    );
  if (!body.trim() && !attachments)
    throw new DomainError("validation", "Write a message or attach a file.");
}

// Mentioned people who are organization members and may read the channel,
// and agents the directory knows.
async function resolveMentions(
  tx: Tx,
  channel: ChannelRow,
  body: string,
): Promise<{
  userIds: string[];
  agentIds: string[];
  agents: { id: string; ownerId: string }[];
}> {
  const mentioned = channelMentions(body);
  let userIds: string[] = [];
  if (mentioned.userIds.length) {
    const rows = await tx
      .select({ userId: s.member.userId })
      .from(s.member)
      .where(
        and(
          eq(s.member.organizationId, channel.organizationId),
          inArray(s.member.userId, mentioned.userIds.slice(0, 100)),
        ),
      );
    userIds = rows.map((r) => r.userId);
    if (channel.kind !== "public" && userIds.length) {
      const members = await tx
        .select({ userId: s.channelMember.userId })
        .from(s.channelMember)
        .where(
          and(
            eq(s.channelMember.channelId, channel.id),
            inArray(s.channelMember.userId, userIds),
          ),
        );
      const readers = new Set(members.map((m) => m.userId));
      userIds = userIds.filter((id) => readers.has(id));
    }
  }
  const agents = mentioned.agentIds.length
    ? await agentDirectory().agents(
        tx,
        channel.organizationId,
        mentioned.agentIds.slice(0, 50),
      )
    : [];
  return {
    userIds,
    agentIds: agents.map((a) => a.id),
    agents: agents.map((a) => ({ id: a.id, ownerId: a.ownerId })),
  };
}

async function recordMentions(
  tx: Tx,
  message: MessageRow,
  channel: ChannelRow,
  mentions: { userIds: string[]; agentIds: string[] },
) {
  const rows = [
    ...mentions.userIds.map((id) => ({ kind: "user" as const, id })),
    ...mentions.agentIds.map((id) => ({ kind: "agent" as const, id })),
  ];
  if (!rows.length) return [];
  const inserted = await tx
    .insert(s.channelMention)
    .values(
      rows.map((r) => ({
        organizationId: message.organizationId,
        channelId: message.channelId,
        messageId: message.id,
        sequence: message.sequence,
        mentionedKind: r.kind,
        mentionedId: r.id,
      })),
    )
    .onConflictDoNothing()
    .returning({
      kind: s.channelMention.mentionedKind,
      id: s.channelMention.mentionedId,
    });
  const users = inserted.filter((r) => r.kind === "user").map((r) => r.id);
  // A direct conversation's unread count already covers its mentions.
  if (users.length && channel.kind !== "direct")
    await tx
      .update(s.channelMember)
      .set({ mentionCount: sql`${s.channelMember.mentionCount} + 1` })
      .where(
        and(
          eq(s.channelMember.channelId, message.channelId),
          inArray(s.channelMember.userId, users),
          lte(s.channelMember.readSequence, message.sequence - 1),
        ),
      );
  return inserted;
}

type PostMessageInput = {
  organizationId: string;
  channelId: string;
  // Client-chosen id (a UUID): the browser's prediction and the stored row
  // are the same row, and a retry with the same id stores nothing twice.
  messageId?: string;
  // Agents may name a retry key of their own instead.
  clientMessageId?: string;
  threadRootId?: string | null;
  body: string;
  // Ids of files uploaded to this channel by the author.
  attachmentIds?: readonly string[];
};

type PostResult = { message: MessageRow; replayed: boolean };

/** Posts a message or a thread reply. */
export async function postMessage(
  tx: Tx,
  actor: Actor,
  input: PostMessageInput,
): Promise<PostResult> {
  const { organizationId, channelId } = input;
  const access = await open(tx, actor, organizationId, channelId);
  const author = await authorOf(tx, organizationId, actor);
  const existing = await findExisting(tx, input);
  if (existing) {
    if (!isAuthor(existing, author) || existing.channelId !== channelId)
      throw new DomainError(
        "conflict",
        "This message id is already used by another message.",
      );
    return { message: existing, replayed: true };
  }
  requirePost(access);
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  if (attachmentIds.length > CHANNEL_ATTACHMENTS_MAX)
    throw new DomainError(
      "validation",
      `Attach at most ${CHANNEL_ATTACHMENTS_MAX} files to one message.`,
    );
  validateBody(input.body, attachmentIds.length);
  let root: MessageRow | undefined;
  if (input.threadRootId) {
    root = await messageIn(tx, organizationId, channelId, input.threadRootId);
    if (root.threadRootId)
      throw new DomainError(
        "validation",
        "Threads are one level deep: reply to the thread's first message.",
      );
  }
  const attachments = await channelFiles(
    tx,
    organizationId,
    channelId,
    actor.userId,
    attachmentIds,
  );
  const now = new Date();
  const [counter] = await tx
    .update(s.channel)
    .set({
      lastSequence: sql`${s.channel.lastSequence} + 1`,
      rootCount: root ? s.channel.rootCount : sql`${s.channel.rootCount} + 1`,
      lastMessageAt: now,
    })
    .where(
      and(
        eq(s.channel.organizationId, organizationId),
        eq(s.channel.id, channelId),
      ),
    )
    .returning({
      lastSequence: s.channel.lastSequence,
      rootCount: s.channel.rootCount,
    });
  const sequence = counter!.lastSequence;
  const [message] = await tx
    .insert(s.channelMessage)
    .values({
      id: input.messageId ?? crypto.randomUUID(),
      organizationId,
      channelId,
      sequence,
      threadRootId: root?.id ?? null,
      rootIndex: root ? null : counter!.rootCount,
      authorKind: author.kind,
      authorUserId: author.kind === "user" ? author.userId : null,
      authorAgentId: author.kind === "agent" ? author.agentId : null,
      onBehalfOfUserId: author.kind === "agent" ? author.onBehalfOf : null,
      via: author.kind === "user" ? author.via : null,
      kind: "message",
      body: input.body,
      attachments,
      clientMessageId: input.clientMessageId ?? null,
      createdAt: now,
    })
    .returning();
  const mentions = await resolveMentions(tx, access.channel, input.body);
  await recordMentions(tx, message!, access.channel, mentions);
  const participants = root
    ? await recordReply(tx, root, message!, author, mentions.userIds)
    : [];
  // Posting at the bottom of a channel means its author has read it.
  if (!root && access.member)
    await tx
      .update(s.channelMember)
      .set({
        readSequence: sequence,
        readRootCount: counter!.rootCount,
        mentionCount: 0,
      })
      .where(eq(s.channelMember.id, access.member.id));
  await queueChannelNotifications(tx, {
    channel: access.channel,
    message: message!,
    root: root ?? null,
    actorId: author.kind === "user" ? author.userId : author.onBehalfOf,
    actorAgentId: author.kind === "agent" ? author.agentId : null,
    mentionedUserIds: mentions.userIds,
    mentionedAgents: mentions.agents,
    participantIds: participants,
  });
  if (mentions.agentIds.length)
    await agentDirectory().mentioned?.(tx, {
      organizationId,
      channelId,
      messageId: message!.id,
      threadRootId: root?.id ?? null,
      agentIds: mentions.agentIds,
      mentionedById: actor.userId,
    });
  return { message: message!, replayed: false };
}

async function findExisting(tx: Tx, input: PostMessageInput) {
  if (input.messageId) {
    const [row] = await tx
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.organizationId, input.organizationId),
          eq(s.channelMessage.id, input.messageId),
        ),
      );
    if (row) return row;
  }
  if (input.clientMessageId) {
    const [row] = await tx
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.organizationId, input.organizationId),
          eq(s.channelMessage.channelId, input.channelId),
          eq(s.channelMessage.clientMessageId, input.clientMessageId),
        ),
      );
    return row;
  }
  return undefined;
}

// Files uploaded to this channel by the author and finished, not removed.
async function channelFiles(
  tx: Tx,
  organizationId: string,
  channelId: string,
  userId: string,
  ids: string[],
): Promise<ChannelAttachment[]> {
  if (!ids.length) return [];
  const rows = await tx
    .select({
      id: s.fileObject.id,
      filename: s.fileObject.filename,
      mimeType: s.fileObject.mimeType,
      size: s.fileObject.size,
      readyAt: s.fileObject.readyAt,
      removedAt: s.fileObject.removedAt,
      createdById: s.fileObject.createdById,
    })
    .from(s.fileObject)
    .where(
      and(
        eq(s.fileObject.organizationId, organizationId),
        eq(s.fileObject.channelId, channelId),
        inArray(s.fileObject.id, ids),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const file = byId.get(id);
    if (!file || file.removedAt || file.createdById !== userId)
      throw new DomainError(
        "validation",
        "Attach files uploaded to this channel. Upload the file again.",
      );
    if (!file.readyAt)
      throw new DomainError(
        "conflict",
        "A file is still uploading. Send the message when it has finished.",
      );
    return {
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
    };
  });
}

// A reply updates its root (count, time, repliers) and makes the author,
// the root's author and people mentioned participants of the thread. The
// author has read the thread up to their reply. Returns the participants
// to tell (following, excluding the author).
async function recordReply(
  tx: Tx,
  root: MessageRow,
  reply: MessageRow,
  author: Author,
  mentionedUserIds: string[],
): Promise<string[]> {
  const key = authorKeyOf(author);
  const replyAuthors = [
    key,
    ...root.replyAuthors.filter((k) => k !== key),
  ].slice(0, REPLY_AUTHORS_MAX);
  const [updated] = await tx
    .update(s.channelMessage)
    .set({
      replyCount: sql`${s.channelMessage.replyCount} + 1`,
      lastReplyAt: reply.createdAt,
      replyAuthors,
    })
    .where(eq(s.channelMessage.id, root.id))
    .returning({ replyCount: s.channelMessage.replyCount });
  const replyCount = updated!.replyCount;
  const base = {
    organizationId: root.organizationId,
    channelId: root.channelId,
    rootMessageId: root.id,
  };
  const authorUserId = author.kind === "user" ? author.userId : null;
  const joining = new Set<string>(mentionedUserIds);
  if (root.authorKind === "user" && root.authorUserId)
    joining.add(root.authorUserId);
  if (authorUserId) joining.delete(authorUserId);
  if (joining.size)
    await tx
      .insert(s.channelThreadParticipant)
      .values([...joining].map((userId) => ({ ...base, userId })))
      .onConflictDoNothing();
  if (authorUserId)
    await tx
      .insert(s.channelThreadParticipant)
      .values({ ...base, userId: authorUserId, readReplyCount: replyCount })
      .onConflictDoUpdate({
        target: [
          s.channelThreadParticipant.rootMessageId,
          s.channelThreadParticipant.userId,
        ],
        set: { readReplyCount: replyCount, following: true },
      });
  const following = await tx
    .select({ userId: s.channelThreadParticipant.userId })
    .from(s.channelThreadParticipant)
    .where(
      and(
        eq(s.channelThreadParticipant.rootMessageId, root.id),
        eq(s.channelThreadParticipant.following, true),
      ),
    );
  return following.map((p) => p.userId).filter((id) => id !== authorUserId);
}

/** Edits the author's own message; the previous body is kept as a revision. */
export async function editMessage(
  tx: Tx,
  actor: Actor,
  input: {
    organizationId: string;
    channelId: string;
    messageId: string;
    body: string;
  },
): Promise<MessageRow> {
  const access = await open(tx, actor, input.organizationId, input.channelId);
  const author = await authorOf(tx, input.organizationId, actor);
  const message = await messageIn(
    tx,
    input.organizationId,
    input.channelId,
    input.messageId,
  );
  ownedHere(message);
  if (message.deletedAt)
    throw new DomainError(
      "conflict",
      "This message was deleted.",
      undefined,
      "invalid_state",
    );
  if (!isAuthor(message, author) || message.kind !== "message")
    throw new DomainError("forbidden", "You can only edit your own messages.");
  if (access.channel.archivedAt)
    throw new DomainError(
      "conflict",
      "This channel is archived. Restore it to edit messages.",
      undefined,
      "invalid_state",
    );
  validateBody(input.body, message.attachments.length);
  if (input.body === message.body) return message;
  await tx.insert(s.channelMessageRevision).values({
    organizationId: input.organizationId,
    messageId: message.id,
    body: message.body,
    reason: "edited",
    changedById: actor.userId,
  });
  const [edited] = await tx
    .update(s.channelMessage)
    .set({ body: input.body, editedAt: new Date() })
    .where(eq(s.channelMessage.id, message.id))
    .returning();
  // People newly mentioned by the edit are told once; earlier mentions stay.
  const mentions = await resolveMentions(tx, access.channel, input.body);
  const added = await recordMentions(tx, edited!, access.channel, mentions);
  const addedUsers = added.filter((m) => m.kind === "user").map((m) => m.id);
  const addedAgents = new Set(
    added.filter((m) => m.kind === "agent").map((m) => m.id),
  );
  if (addedUsers.length || addedAgents.size)
    await queueChannelNotifications(tx, {
      channel: access.channel,
      message: edited!,
      root: null,
      actorId: actor.userId,
      actorAgentId: author.kind === "agent" ? author.agentId : null,
      mentionedUserIds: addedUsers,
      mentionedAgents: mentions.agents.filter((a) => addedAgents.has(a.id)),
      participantIds: [],
      mentionsOnly: true,
    });
  return edited!;
}

/**
 * Deletes a message, leaving a tombstone: its place, thread, replies and
 * reactions stay, its body and files go, and the removed body is kept as a
 * revision. Authors delete their own messages; organization administrators
 * any message of a channel they can read (moderation).
 */
export async function deleteMessage(
  tx: Tx,
  actor: Actor,
  input: { organizationId: string; channelId: string; messageId: string },
): Promise<MessageRow> {
  const access = await open(tx, actor, input.organizationId, input.channelId);
  const author = await authorOf(tx, input.organizationId, actor);
  const message = await messageIn(
    tx,
    input.organizationId,
    input.channelId,
    input.messageId,
  );
  ownedHere(message);
  if (message.deletedAt) return message;
  const own = isAuthor(message, author) && message.kind === "message";
  if (!own && !access.admin)
    throw new DomainError(
      "forbidden",
      "You can only delete your own messages. Organization administrators can remove others' messages.",
    );
  if (message.body)
    await tx.insert(s.channelMessageRevision).values({
      organizationId: input.organizationId,
      messageId: message.id,
      body: message.body,
      reason: "deleted",
      changedById: actor.userId,
    });
  const [deleted] = await tx
    .update(s.channelMessage)
    .set({
      body: "",
      attachments: [],
      deletedAt: new Date(),
      deletedById: actor.userId,
    })
    .where(eq(s.channelMessage.id, message.id))
    .returning();
  return deleted!;
}

// Messages written in an external chat system are owned there.
function ownedHere(message: MessageRow) {
  if (message.externalSource)
    throw new DomainError(
      "conflict",
      `This message was written in ${message.externalSource} and can only be changed there.`,
      undefined,
      "external_owner",
    );
}

/** Adds or removes the actor's reaction. Idempotent both ways. */
export async function reactToMessage(
  tx: Tx,
  actor: Actor,
  input: {
    organizationId: string;
    channelId: string;
    messageId: string;
    emoji: string;
    add: boolean;
  },
): Promise<{ changed: boolean }> {
  if (!validEmoji(input.emoji))
    throw new DomainError("validation", "React with one emoji.");
  const access = await open(tx, actor, input.organizationId, input.channelId);
  if (!access.canReact)
    throw new DomainError(
      "conflict",
      "This channel is archived.",
      undefined,
      "invalid_state",
    );
  const author = await authorOf(tx, input.organizationId, actor);
  const message = await messageIn(
    tx,
    input.organizationId,
    input.channelId,
    input.messageId,
  );
  const reactor = authorKeyOf(author);
  const id = reactionId(message.id, reactor, input.emoji);
  if (!input.add) {
    const removed = await tx
      .delete(s.channelReaction)
      .where(
        and(
          eq(s.channelReaction.organizationId, input.organizationId),
          eq(s.channelReaction.id, id),
        ),
      )
      .returning({ id: s.channelReaction.id });
    return { changed: removed.length > 0 };
  }
  if (message.deletedAt)
    throw new DomainError(
      "conflict",
      "This message was deleted.",
      undefined,
      "invalid_state",
    );
  const [{ count }] = (await tx
    .select({
      count: sql<number>`count(distinct ${s.channelReaction.emoji})::int`,
    })
    .from(s.channelReaction)
    .where(eq(s.channelReaction.messageId, message.id))) as [{ count: number }];
  if (count >= 50)
    throw new DomainError(
      "validation",
      "This message has the most reactions it can hold.",
    );
  const inserted = await tx
    .insert(s.channelReaction)
    .values({
      id,
      organizationId: input.organizationId,
      channelId: input.channelId,
      messageId: message.id,
      emoji: input.emoji,
      reactorKind: author.kind,
      userId: author.kind === "user" ? author.userId : null,
      agentId: author.kind === "agent" ? author.agentId : null,
    })
    .onConflictDoNothing()
    .returning({ id: s.channelReaction.id });
  return { changed: inserted.length > 0 };
}

/**
 * Moves the person's read cursor of a channel. Reading only moves forward
 * (a stale tab never marks newer messages unread); `unread` moves it back
 * on purpose ("Mark unread" from a message). The root count and unread
 * mentions are recomputed for the new position.
 */
export async function markChannelRead(
  tx: Tx,
  actor: Actor,
  input: {
    organizationId: string;
    channelId: string;
    sequence: number;
    unread?: boolean;
  },
): Promise<{
  readSequence: number;
  readRootCount: number;
  mentionCount: number;
} | null> {
  const access = await open(tx, actor, input.organizationId, input.channelId);
  if (!access.member) return null;
  const target = Math.max(
    0,
    Math.min(input.sequence, access.channel.lastSequence),
  );
  if (
    input.unread
      ? target >= access.member.readSequence
      : target <= access.member.readSequence
  )
    return {
      readSequence: access.member.readSequence,
      readRootCount: access.member.readRootCount,
      mentionCount: access.member.mentionCount,
    };
  const [roots] = await tx
    .select({
      count: sql<number>`coalesce(max(${s.channelMessage.rootIndex}), 0)::int`,
    })
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.channelId, input.channelId),
        isNull(s.channelMessage.threadRootId),
        lte(s.channelMessage.sequence, target),
      ),
    );
  const [mentions] =
    access.channel.kind === "direct"
      ? [{ count: 0 }]
      : await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(s.channelMention)
          .innerJoin(
            s.channelMessage,
            eq(s.channelMessage.id, s.channelMention.messageId),
          )
          .where(
            and(
              eq(s.channelMention.channelId, input.channelId),
              eq(s.channelMention.mentionedKind, "user"),
              eq(s.channelMention.mentionedId, actor.userId),
              gt(s.channelMention.sequence, target),
              isNull(s.channelMessage.deletedAt),
            ),
          );
  const next = {
    readSequence: target,
    readRootCount: roots?.count ?? 0,
    mentionCount: mentions?.count ?? 0,
  };
  await tx
    .update(s.channelMember)
    .set(next)
    .where(eq(s.channelMember.id, access.member.id));
  return next;
}

/** Marks a thread read for the person, and follows or unfollows it. */
export async function updateThreadParticipation(
  tx: Tx,
  actor: Actor,
  input: {
    organizationId: string;
    channelId: string;
    rootMessageId: string;
    read?: boolean;
    following?: boolean;
  },
) {
  await open(tx, actor, input.organizationId, input.channelId);
  const root = await messageIn(
    tx,
    input.organizationId,
    input.channelId,
    input.rootMessageId,
  );
  if (root.threadRootId)
    throw new DomainError("validation", "Name the thread's first message.");
  const set: Partial<typeof s.channelThreadParticipant.$inferInsert> = {};
  if (input.read) set.readReplyCount = root.replyCount;
  if (input.following !== undefined) set.following = input.following;
  if (!Object.keys(set).length) return;
  // Reading a thread you never took part in does not subscribe you to it.
  if (input.following === undefined) {
    await tx
      .update(s.channelThreadParticipant)
      .set(set)
      .where(
        and(
          eq(s.channelThreadParticipant.rootMessageId, root.id),
          eq(s.channelThreadParticipant.userId, actor.userId),
        ),
      );
    return;
  }
  await tx
    .insert(s.channelThreadParticipant)
    .values({
      organizationId: input.organizationId,
      channelId: input.channelId,
      rootMessageId: root.id,
      userId: actor.userId,
      readReplyCount: root.replyCount,
      following: input.following,
    })
    .onConflictDoUpdate({
      target: [
        s.channelThreadParticipant.rootMessageId,
        s.channelThreadParticipant.userId,
      ],
      set,
    });
}

/**
 * Appends a message written by Lictory: a system line ("Ada archived the
 * channel") or a card (a promotion). The caller has authorized the action
 * that produced it; the person it reports is `actorId`.
 */
export async function appendSystemMessage(
  tx: Tx,
  input: {
    organizationId: string;
    channelId: string;
    actorId: string;
    kind: "system" | "card";
    body: string;
    payload?: Record<string, unknown>;
    threadRootId?: string | null;
  },
): Promise<MessageRow> {
  await lockConversation(tx, input.organizationId, input.channelId);
  const now = new Date();
  const root = input.threadRootId
    ? await messageIn(
        tx,
        input.organizationId,
        input.channelId,
        input.threadRootId,
      )
    : undefined;
  const [counter] = await tx
    .update(s.channel)
    .set({
      lastSequence: sql`${s.channel.lastSequence} + 1`,
      rootCount: root ? s.channel.rootCount : sql`${s.channel.rootCount} + 1`,
      lastMessageAt: now,
    })
    .where(
      and(
        eq(s.channel.organizationId, input.organizationId),
        eq(s.channel.id, input.channelId),
      ),
    )
    .returning({
      lastSequence: s.channel.lastSequence,
      rootCount: s.channel.rootCount,
    });
  const [message] = await tx
    .insert(s.channelMessage)
    .values({
      organizationId: input.organizationId,
      channelId: input.channelId,
      sequence: counter!.lastSequence,
      threadRootId: root?.id ?? null,
      rootIndex: root ? null : counter!.rootCount,
      authorKind: "system",
      authorUserId: input.actorId,
      kind: input.kind,
      body: input.body.slice(0, CHANNEL_MESSAGE_MAX),
      payload: input.payload ?? null,
      createdAt: now,
    })
    .returning();
  if (root)
    await tx
      .update(s.channelMessage)
      .set({
        replyCount: sql`${s.channelMessage.replyCount} + 1`,
        lastReplyAt: now,
      })
      .where(eq(s.channelMessage.id, root.id));
  else
    // The person who caused it has seen it.
    await tx
      .update(s.channelMember)
      .set({
        readSequence: counter!.lastSequence,
        readRootCount: counter!.rootCount,
      })
      .where(
        and(
          eq(s.channelMember.channelId, input.channelId),
          eq(s.channelMember.userId, input.actorId),
          eq(s.channelMember.readRootCount, counter!.rootCount - 1),
        ),
      );
  return message!;
}
