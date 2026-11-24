import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  ChannelAttachment,
  ChannelExternalFile,
} from "@lictory/core/db/channel-schema";
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
import { queueMirror } from "@lictory/core/channels/mirror";

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

// Repliers on a thread root also include people of a linked external
// system with no Lictory identity (`x:ID`, shown by count only).
type ReplyAuthor = Author | { kind: "external"; externalId: string };

const authorKeyOf = (author: ReplyAuthor) =>
  author.kind === "user"
    ? participantKey("user", author.userId)
    : author.kind === "agent"
      ? participantKey("agent", author.agentId)
      : `x:${author.externalId}`;

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
  const authorKind = author.kind;
  const via = author.kind === "user" ? author.via : null;
  if (root)
    await agentDirectory().replied?.(tx, {
      organizationId,
      channelId,
      messageId: message!.id,
      threadRootId: root.id,
      authorKind,
      authorUserId: actor.userId,
      via,
      body: input.body,
      agentIds: mentions.agentIds,
    });
  if (mentions.agentIds.length)
    await agentDirectory().mentioned?.(tx, {
      organizationId,
      channelId,
      messageId: message!.id,
      threadRootId: root?.id ?? null,
      agentIds: mentions.agentIds,
      mentionedById: actor.userId,
      authorKind,
      via,
      body: input.body,
    });
  await queueMirror(tx, access.channel, message!, { kind: "message" });
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
  author: ReplyAuthor,
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
  await queueMirror(tx, access.channel, edited!, { kind: "message" });
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
  await queueMirror(tx, access.channel, deleted!, { kind: "message" });
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
    if (removed.length)
      await queueMirror(tx, access.channel, message, {
        kind: "reaction",
        emoji: input.emoji,
      });
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
  if (inserted.length)
    await queueMirror(tx, access.channel, message, {
      kind: "reaction",
      emoji: input.emoji,
    });
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
    // A stable id makes the append idempotent: appending the same id again
    // returns the stored message (session cards, approval cards).
    messageId?: string;
  },
): Promise<MessageRow> {
  await lockConversation(tx, input.organizationId, input.channelId);
  if (input.messageId) {
    const [existing] = await tx
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.organizationId, input.organizationId),
          eq(s.channelMessage.id, input.messageId),
        ),
      );
    if (existing) return existing;
  }
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
      externalSource: s.channel.externalSource,
    });
  const [message] = await tx
    .insert(s.channelMessage)
    .values({
      ...(input.messageId ? { id: input.messageId } : {}),
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
  // Cards (promotions, agent sessions) reach a linked external channel as
  // summaries with a link back; system lines stay in Lictory.
  if (input.kind === "card")
    await queueMirror(
      tx,
      {
        id: input.channelId,
        organizationId: input.organizationId,
        externalSource: counter!.externalSource,
      },
      message!,
      { kind: "message" },
    );
  return message!;
}

/**
 * Replaces the live state of a card Lictory wrote (a session's status, an
 * approval's answer). Cards are Lictory's own messages, not anyone's words,
 * so their payload changes in place; their body and place in the
 * conversation do not. Returns null when the card is gone.
 */
export async function updateCardPayload(
  tx: Tx,
  input: {
    organizationId: string;
    channelId: string;
    messageId: string;
    payload: Record<string, unknown>;
    body?: string;
  },
): Promise<MessageRow | null> {
  await lockConversation(tx, input.organizationId, input.channelId);
  const [updated] = await tx
    .update(s.channelMessage)
    .set({
      payload: input.payload,
      ...(input.body !== undefined
        ? { body: input.body.slice(0, CHANNEL_MESSAGE_MAX) }
        : {}),
    })
    .where(
      and(
        eq(s.channelMessage.organizationId, input.organizationId),
        eq(s.channelMessage.channelId, input.channelId),
        eq(s.channelMessage.id, input.messageId),
        eq(s.channelMessage.kind, "card"),
        isNull(s.channelMessage.deletedAt),
      ),
    )
    .returning();
  // A linked external channel shows the card's body (its summary line), so a
  // new body is sent again; payload-only changes stay in Lictory.
  if (updated && input.body !== undefined) {
    const [channel] = await tx
      .select({ externalSource: s.channel.externalSource })
      .from(s.channel)
      .where(
        and(
          eq(s.channel.organizationId, input.organizationId),
          eq(s.channel.id, input.channelId),
        ),
      );
    if (channel?.externalSource)
      await queueMirror(
        tx,
        {
          id: input.channelId,
          organizationId: input.organizationId,
          externalSource: channel.externalSource,
        },
        updated,
        { kind: "message" },
      );
  }
  return updated ?? null;
}

/**
 * Posts what an agent said in a thread for it (its reply to a person, its
 * summary), authored by the agent acting for its owner. The Factory decided
 * this message belongs in the thread (docs/internals/factory.md#threads);
 * the owner's channel access is not required, as for Lictory's own cards,
 * because the session was started from this conversation. Idempotent by
 * `messageId`. Followers of the thread are told as for any reply.
 */
export async function postAgentMessage(
  tx: Tx,
  input: {
    organizationId: string;
    channelId: string;
    threadRootId: string;
    messageId: string;
    agentId: string;
    onBehalfOfUserId: string;
    body: string;
  },
): Promise<PostResult | null> {
  await lockConversation(tx, input.organizationId, input.channelId);
  const [existing] = await tx
    .select()
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.organizationId, input.organizationId),
        eq(s.channelMessage.id, input.messageId),
      ),
    );
  if (existing) return { message: existing, replayed: true };
  const [channel] = await tx
    .select()
    .from(s.channel)
    .where(
      and(
        eq(s.channel.organizationId, input.organizationId),
        eq(s.channel.id, input.channelId),
      ),
    );
  if (!channel || channel.archivedAt) return null;
  let root = await messageIn(
    tx,
    input.organizationId,
    input.channelId,
    input.threadRootId,
  );
  if (root.threadRootId)
    root = await messageIn(
      tx,
      input.organizationId,
      input.channelId,
      root.threadRootId,
    );
  const body = input.body.trim().slice(0, CHANNEL_MESSAGE_MAX);
  if (!body) return null;
  const now = new Date();
  const [counter] = await tx
    .update(s.channel)
    .set({
      lastSequence: sql`${s.channel.lastSequence} + 1`,
      lastMessageAt: now,
    })
    .where(
      and(
        eq(s.channel.organizationId, input.organizationId),
        eq(s.channel.id, input.channelId),
      ),
    )
    .returning({ lastSequence: s.channel.lastSequence });
  const [message] = await tx
    .insert(s.channelMessage)
    .values({
      id: input.messageId,
      organizationId: input.organizationId,
      channelId: input.channelId,
      sequence: counter!.lastSequence,
      threadRootId: root.id,
      rootIndex: null,
      authorKind: "agent",
      authorAgentId: input.agentId,
      onBehalfOfUserId: input.onBehalfOfUserId,
      kind: "message",
      body,
      attachments: [],
      createdAt: now,
    })
    .returning();
  const author: Author = {
    kind: "agent",
    agentId: input.agentId,
    onBehalfOf: input.onBehalfOfUserId,
  };
  const participants = await recordReply(tx, root, message!, author, []);
  await queueChannelNotifications(tx, {
    channel,
    message: message!,
    root,
    actorId: input.onBehalfOfUserId,
    mentionedUserIds: [],
    participantIds: participants,
  });
  await queueMirror(tx, channel, message!, { kind: "message" });
  return { message: message!, replayed: false };
}

// ------------------------------------------------- linked external channels
//
// Messages written in a linked external chat system (Slack) enter through
// these functions, called by the provider's ingest in the worker. There is
// no actor: the authority is the verified delivery of the provider's
// installation and the channel's active link to the external channel it
// names. The same locks and counters as Lictory messages apply. Ownership
// (docs/internals/channels.md#slack): rows written here carry
// `externalSource` and their external id; only these functions change them,
// and they never change a message written in Lictory.

export type ExternalAuthor =
  // A person of the external system mapped to this Lictory person (by
  // verified email); re-checked here as an organization member who can
  // read the channel, or shown with `name` instead.
  | { kind: "user"; userId: string; externalId: string; name: string }
  | { kind: "external"; externalId: string; name: string };

type ExternalRef = {
  organizationId: string;
  channelId: string;
  source: string;
};

type Skipped = { skipped: string };

async function openLinked(
  tx: Tx,
  ref: ExternalRef,
  externalChannelId: string,
): Promise<ChannelRow | Skipped> {
  await lockConversation(tx, ref.organizationId, ref.channelId);
  const [channel] = await tx
    .select()
    .from(s.channel)
    .where(
      and(
        eq(s.channel.organizationId, ref.organizationId),
        eq(s.channel.id, ref.channelId),
      ),
    );
  if (
    channel?.externalSource !== ref.source ||
    channel.externalId !== externalChannelId
  )
    return { skipped: "channel not linked" };
  if (channel.archivedAt) return { skipped: "channel archived in Lictory" };
  return channel;
}

/** The Lictory message an external id names: written there, or mirrored. */
export async function messageByExternalId(
  tx: Tx,
  ref: ExternalRef,
  externalId: string,
): Promise<MessageRow | undefined> {
  const [owned] = await tx
    .select()
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.organizationId, ref.organizationId),
        eq(s.channelMessage.externalSource, ref.source),
        eq(s.channelMessage.externalId, externalId),
      ),
    );
  if (owned) return owned.channelId === ref.channelId ? owned : undefined;
  const [mirrored] = await tx
    .select({ message: s.channelMessage })
    .from(s.channelMirror)
    .innerJoin(
      s.channelMessage,
      and(
        eq(s.channelMessage.organizationId, s.channelMirror.organizationId),
        eq(s.channelMessage.id, s.channelMirror.messageId),
      ),
    )
    .where(
      and(
        eq(s.channelMirror.organizationId, ref.organizationId),
        eq(s.channelMirror.channelId, ref.channelId),
        eq(s.channelMirror.target, "message"),
        eq(s.channelMirror.externalId, externalId),
      ),
    );
  return mirrored?.message;
}

// A mapped author keeps their Lictory identity only while they are an
// organization member who can read the channel.
async function verifiedAuthor(
  tx: Tx,
  channel: ChannelRow,
  author: ExternalAuthor,
): Promise<ExternalAuthor> {
  if (author.kind !== "user") return author;
  const [member] = await tx
    .select({ id: s.member.id })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, channel.organizationId),
        eq(s.member.userId, author.userId),
      ),
    );
  let readable = member !== undefined;
  if (readable && channel.kind !== "public")
    readable = await isChannelMemberRow(tx, channel.id, author.userId);
  return readable
    ? author
    : { kind: "external", externalId: author.externalId, name: author.name };
}

async function isChannelMemberRow(tx: Tx, channelId: string, userId: string) {
  const [row] = await tx
    .select({ id: s.channelMember.id })
    .from(s.channelMember)
    .where(
      and(
        eq(s.channelMember.channelId, channelId),
        eq(s.channelMember.userId, userId),
      ),
    );
  return row !== undefined;
}

/**
 * Appends a message written in the linked external channel. Idempotent by
 * its external id. Agent mentions reach the agent registry only when the
 * author is a mapped Lictory person (`agentMentions` is the adapter's
 * permission check per agent); for anyone else they stay text.
 */
export async function appendExternalMessage(
  tx: Tx,
  input: ExternalRef & {
    externalChannelId: string;
    externalId: string;
    threadExternalId?: string | null;
    author: ExternalAuthor;
    body: string;
    files?: ChannelExternalFile[];
    createdAt: Date;
  },
): Promise<PostResult | Skipped> {
  const channel = await openLinked(tx, input, input.externalChannelId);
  if ("skipped" in channel) return channel;
  const existing = await messageByExternalId(tx, input, input.externalId);
  if (existing) return { message: existing, replayed: true };
  const author = await verifiedAuthor(tx, channel, input.author);
  const files = (input.files ?? []).slice(0, 20);
  const body = input.body.slice(0, CHANNEL_MESSAGE_MAX);
  if (!body.trim() && !files.length) return { skipped: "empty message" };
  let root: MessageRow | undefined;
  if (input.threadExternalId && input.threadExternalId !== input.externalId) {
    root = await messageByExternalId(tx, input, input.threadExternalId);
    // A reply to a message from before the link starts a thread of its own.
    if (root?.threadRootId)
      root = await messageIn(
        tx,
        input.organizationId,
        input.channelId,
        root.threadRootId,
      );
  }
  const now = input.createdAt;
  const [counter] = await tx
    .update(s.channel)
    .set({
      lastSequence: sql`${s.channel.lastSequence} + 1`,
      rootCount: root ? s.channel.rootCount : sql`${s.channel.rootCount} + 1`,
      lastMessageAt: new Date(),
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
      authorKind: author.kind,
      authorUserId: author.kind === "user" ? author.userId : null,
      kind: "message",
      body,
      externalSource: input.source,
      externalId: input.externalId,
      externalAuthorId: author.externalId,
      externalAuthorName:
        author.kind === "external" ? author.name.slice(0, 120) : null,
      externalFiles: files,
      createdAt: now,
    })
    .returning();
  const mentions = await resolveMentions(tx, channel, body);
  // Text is information, never permission: only a mapped person's message
  // can address an agent, and the adapter already kept only agents that
  // person may address.
  if (author.kind !== "user") {
    mentions.agentIds = [];
    mentions.agents = [];
  }
  await recordMentions(tx, message!, channel, mentions);
  const participants = root
    ? await recordReply(
        tx,
        root,
        message!,
        author.kind === "user"
          ? { kind: "user", userId: author.userId, via: null }
          : { kind: "external", externalId: author.externalId },
        mentions.userIds,
      )
    : [];
  if (!root && author.kind === "user")
    await tx
      .update(s.channelMember)
      .set({
        readSequence: counter!.lastSequence,
        readRootCount: counter!.rootCount,
        mentionCount: 0,
      })
      .where(
        and(
          eq(s.channelMember.channelId, channel.id),
          eq(s.channelMember.userId, author.userId),
        ),
      );
  await queueChannelNotifications(tx, {
    channel,
    message: message!,
    root: root ?? null,
    actorId: author.kind === "user" ? author.userId : null,
    mentionedUserIds: mentions.userIds,
    mentionedAgents: mentions.agents,
    participantIds: participants,
  });
  // A mapped person writes as themselves (no `via`), so their replies steer
  // and their mentions address agents exactly as in Lictory.
  if (root && author.kind === "user")
    await agentDirectory().replied?.(tx, {
      organizationId: input.organizationId,
      channelId: input.channelId,
      messageId: message!.id,
      threadRootId: root.id,
      authorKind: "user",
      authorUserId: author.userId,
      via: null,
      body,
      agentIds: mentions.agentIds,
    });
  if (mentions.agentIds.length && author.kind === "user")
    await agentDirectory().mentioned?.(tx, {
      organizationId: input.organizationId,
      channelId: input.channelId,
      messageId: message!.id,
      threadRootId: root?.id ?? null,
      agentIds: mentions.agentIds,
      mentionedById: author.userId,
      authorKind: "user",
      via: null,
      body,
    });
  return { message: message!, replayed: false };
}

/**
 * Applies an edit made in the external system to a message written there.
 * Edits of messages Lictory owns (its own mirrored posts) are ignored.
 */
export async function applyExternalEdit(
  tx: Tx,
  input: ExternalRef & {
    externalChannelId: string;
    externalId: string;
    body: string;
    files?: ChannelExternalFile[];
    editedAt: Date;
  },
): Promise<{ message: MessageRow } | Skipped> {
  const channel = await openLinked(tx, input, input.externalChannelId);
  if ("skipped" in channel) return channel;
  const message = await messageByExternalId(tx, input, input.externalId);
  if (!message) return { skipped: "unknown message" };
  if (message.externalSource !== input.source)
    return { skipped: "owned by Lictory" };
  if (message.deletedAt) return { skipped: "deleted" };
  const body = input.body.slice(0, CHANNEL_MESSAGE_MAX);
  const files = input.files ?? message.externalFiles;
  if (
    body === message.body &&
    JSON.stringify(files) === JSON.stringify(message.externalFiles)
  )
    return { message };
  if (body !== message.body)
    await tx.insert(s.channelMessageRevision).values({
      organizationId: input.organizationId,
      messageId: message.id,
      body: message.body,
      reason: "edited",
      changedById: null,
    });
  const [edited] = await tx
    .update(s.channelMessage)
    .set({ body, externalFiles: files, editedAt: input.editedAt })
    .where(eq(s.channelMessage.id, message.id))
    .returning();
  const mentions = await resolveMentions(tx, channel, body);
  const added = await recordMentions(tx, edited!, channel, {
    userIds: mentions.userIds,
    agentIds: [],
  });
  const addedUsers = added.filter((m) => m.kind === "user").map((m) => m.id);
  if (addedUsers.length)
    await queueChannelNotifications(tx, {
      channel,
      message: edited!,
      root: null,
      actorId: edited!.authorUserId,
      mentionedUserIds: addedUsers,
      participantIds: [],
      mentionsOnly: true,
    });
  return { message: edited! };
}

/** A deletion in the external system: a tombstone, like Lictory's own. */
export async function applyExternalDelete(
  tx: Tx,
  input: ExternalRef & {
    externalChannelId: string;
    externalId: string;
    deletedAt: Date;
  },
): Promise<{ message: MessageRow } | Skipped> {
  const channel = await openLinked(tx, input, input.externalChannelId);
  if ("skipped" in channel) return channel;
  const message = await messageByExternalId(tx, input, input.externalId);
  if (!message) return { skipped: "unknown message" };
  if (message.externalSource !== input.source)
    return { skipped: "owned by Lictory" };
  if (message.deletedAt) return { message };
  if (message.body)
    await tx.insert(s.channelMessageRevision).values({
      organizationId: input.organizationId,
      messageId: message.id,
      body: message.body,
      reason: "deleted",
      changedById: null,
    });
  const [deleted] = await tx
    .update(s.channelMessage)
    .set({
      body: "",
      externalFiles: [],
      deletedAt: input.deletedAt,
    })
    .where(eq(s.channelMessage.id, message.id))
    .returning();
  return { message: deleted! };
}

/**
 * A reaction added or removed in the external system, on any message of
 * the linked channel. A mapped person's reaction is theirs (and is not
 * mirrored back); anyone else's is counted on the message by name.
 */
export async function applyExternalReaction(
  tx: Tx,
  input: ExternalRef & {
    externalChannelId: string;
    messageExternalId: string;
    emoji: string;
    reactor: ExternalAuthor;
    add: boolean;
  },
): Promise<{ changed: boolean } | Skipped> {
  if (!validEmoji(input.emoji)) return { skipped: "unsupported emoji" };
  const channel = await openLinked(tx, input, input.externalChannelId);
  if ("skipped" in channel) return channel;
  const message = await messageByExternalId(tx, input, input.messageExternalId);
  if (!message) return { skipped: "unknown message" };
  const reactor = await verifiedAuthor(tx, channel, input.reactor);
  if (reactor.kind === "user") {
    const id = reactionId(
      message.id,
      participantKey("user", reactor.userId),
      input.emoji,
    );
    if (!input.add) {
      const removed = await tx
        .delete(s.channelReaction)
        .where(
          and(
            eq(s.channelReaction.organizationId, input.organizationId),
            eq(s.channelReaction.id, id),
            eq(s.channelReaction.externalSource, input.source),
          ),
        )
        .returning({ id: s.channelReaction.id });
      return { changed: removed.length > 0 };
    }
    if (message.deletedAt) return { skipped: "deleted" };
    const inserted = await tx
      .insert(s.channelReaction)
      .values({
        id,
        organizationId: input.organizationId,
        channelId: input.channelId,
        messageId: message.id,
        emoji: input.emoji,
        reactorKind: "user",
        userId: reactor.userId,
        externalSource: input.source,
      })
      .onConflictDoNothing()
      .returning({ id: s.channelReaction.id });
    return { changed: inserted.length > 0 };
  }
  const reactions = message.externalReactions.map((r) => ({
    ...r,
    names: [...r.names],
    externalIds: [...r.externalIds],
  }));
  let entry = reactions.find((r) => r.emoji === input.emoji);
  const has = entry?.externalIds.includes(reactor.externalId) ?? false;
  if (input.add === has) return { changed: false };
  if (input.add) {
    if (message.deletedAt) return { skipped: "deleted" };
    if (!entry) {
      if (reactions.length >= 50) return { skipped: "too many reactions" };
      entry = { emoji: input.emoji, names: [], externalIds: [] };
      reactions.push(entry);
    }
    entry.externalIds.push(reactor.externalId);
    entry.names.push(reactor.name.slice(0, 80));
  } else if (entry) {
    const index = entry.externalIds.indexOf(reactor.externalId);
    entry.externalIds.splice(index, 1);
    entry.names.splice(index, 1);
  }
  await tx
    .update(s.channelMessage)
    .set({
      externalReactions: reactions.filter((r) => r.externalIds.length > 0),
    })
    .where(eq(s.channelMessage.id, message.id));
  return { changed: true };
}
