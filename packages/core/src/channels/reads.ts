import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { readChannelAccess } from "@lictory/core/channels/access";
import { agentDirectory } from "@lictory/core/channels/agents";
import {
  attentionCount,
  unreadMessages,
  type ChannelKind,
} from "@lictory/core/channels/shared";

// Capability reads of Lictory Channels for agents and the API (the browser
// reads the same rows through Zero). Every read is one repeatable-read
// transaction that checks organization membership and channel access; rows
// of channels the person cannot read are never selected.

type Message = typeof s.channelMessage.$inferSelect;

const read = <T>(db: Database, run: (tx: Tx) => Promise<T>) =>
  db.transaction(run, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });

type ChannelSummary = {
  id: string;
  kind: ChannelKind;
  name: string | null;
  topic: string;
  projectId: string | null;
  teamId: string | null;
  archived: boolean;
  member: boolean;
  lastSequence: number;
  lastMessageAt: string | null;
  // Only for channels you are a member of.
  readSequence: number | null;
  unreadMessages: number;
  unreadMentions: number;
  notificationLevel: string | null;
  // Direct conversations: the other members.
  members?: { kind: "user" | "agent"; id: string; name: string }[];
};

/** Channels the person can read: public ones and those they belong to. */
export async function listChannels(
  db: Database,
  userId: string,
  input: {
    organizationId: string;
    joinedOnly?: boolean;
    includeArchived?: boolean;
    query?: string;
  },
): Promise<ChannelSummary[]> {
  return read(db, async (tx) => {
    await authorize(tx, userId, input.organizationId);
    const rows = await tx
      .select({ channel: s.channel, member: s.channelMember })
      .from(s.channel)
      .leftJoin(
        s.channelMember,
        and(
          eq(s.channelMember.channelId, s.channel.id),
          eq(s.channelMember.userId, userId),
        ),
      )
      .where(
        and(
          eq(s.channel.organizationId, input.organizationId),
          input.joinedOnly
            ? sql`${s.channelMember.id} is not null`
            : or(
                eq(s.channel.kind, "public"),
                sql`${s.channelMember.id} is not null`,
              ),
          input.includeArchived ? undefined : isNull(s.channel.archivedAt),
          input.query
            ? sql`${s.channel.name} ilike ${`%${input.query.replace(/[%_\\]/g, "\\$&")}%`}`
            : undefined,
        ),
      )
      .orderBy(desc(s.channel.lastMessageAt), asc(s.channel.name))
      .limit(500);
    const direct = rows
      .filter((r) => r.channel.kind === "direct")
      .map((r) => r.channel.id);
    const directMembers = await membersOf(tx, input.organizationId, direct);
    return rows.map(({ channel, member }) => ({
      id: channel.id,
      kind: channel.kind,
      name: channel.name,
      topic: channel.topic,
      projectId: channel.projectId,
      teamId: channel.teamId,
      archived: Boolean(channel.archivedAt),
      member: Boolean(member),
      lastSequence: channel.lastSequence,
      lastMessageAt: channel.lastMessageAt?.toISOString() ?? null,
      readSequence: member?.readSequence ?? null,
      unreadMessages: unreadMessages(channel, member),
      unreadMentions: member?.mentionCount ?? 0,
      notificationLevel: member?.notificationLevel ?? null,
      ...(channel.kind === "direct"
        ? {
            members: (directMembers.get(channel.id) ?? []).filter(
              (m) => !(m.kind === "user" && m.id === userId),
            ),
          }
        : {}),
    }));
  });
}

async function membersOf(tx: Tx, organizationId: string, channelIds: string[]) {
  const byChannel = new Map<
    string,
    { kind: "user" | "agent"; id: string; name: string }[]
  >();
  if (!channelIds.length) return byChannel;
  const rows = await tx
    .select({
      channelId: s.channelMember.channelId,
      kind: s.channelMember.memberKind,
      userId: s.channelMember.userId,
      agentId: s.channelMember.agentId,
      name: s.user.name,
    })
    .from(s.channelMember)
    .leftJoin(s.user, eq(s.user.id, s.channelMember.userId))
    .where(
      and(
        eq(s.channelMember.organizationId, organizationId),
        inArray(s.channelMember.channelId, channelIds),
      ),
    );
  const agents = new Map(
    (
      await agentDirectory().agents(
        tx,
        organizationId,
        rows.flatMap((r) => (r.agentId ? [r.agentId] : [])),
      )
    ).map((a) => [a.id, a]),
  );
  for (const r of rows) {
    const list = byChannel.get(r.channelId) ?? [];
    list.push(
      r.kind === "user"
        ? { kind: "user", id: r.userId!, name: r.name ?? "Former member" }
        : {
            kind: "agent",
            id: r.agentId!,
            name: agents.get(r.agentId!)?.handle ?? "agent",
          },
    );
    byChannel.set(r.channelId, list);
  }
  return byChannel;
}

export type MessageView = {
  id: string;
  sequence: number;
  threadRootId: string | null;
  kind: "message" | "system" | "card";
  author: {
    kind: "user" | "agent" | "system";
    userId: string | null;
    agentId: string | null;
    name: string;
    onBehalfOfUserId: string | null;
    via: string | null;
  };
  body: string;
  payload: Record<string, unknown> | null;
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    url: string;
  }[];
  reactions: { emoji: string; count: number; mine: boolean }[];
  replyCount: number;
  lastReplyAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  external: string | null;
  createdAt: string;
};

async function views(
  tx: Tx,
  organizationId: string,
  userId: string,
  messages: Message[],
): Promise<MessageView[]> {
  if (!messages.length) return [];
  const ids = messages.map((m) => m.id);
  const people = [
    ...new Set(
      messages.flatMap((m) =>
        [m.authorUserId, m.onBehalfOfUserId].filter((v): v is string => !!v),
      ),
    ),
  ];
  const [names, reactions, agents] = await Promise.all([
    people.length
      ? tx
          .select({ id: s.user.id, name: s.user.name })
          .from(s.user)
          .where(inArray(s.user.id, people))
      : Promise.resolve([]),
    tx
      .select()
      .from(s.channelReaction)
      .where(
        and(
          eq(s.channelReaction.organizationId, organizationId),
          inArray(s.channelReaction.messageId, ids),
        ),
      ),
    agentDirectory().agents(
      tx,
      organizationId,
      messages.flatMap((m) => (m.authorAgentId ? [m.authorAgentId] : [])),
    ),
  ]);
  const nameOf = (id: string | null) =>
    (id ? names.find((n) => n.id === id)?.name : undefined) ?? "Former member";
  return messages.map((m) => {
    const grouped = new Map<string, { count: number; mine: boolean }>();
    for (const r of reactions.filter((r) => r.messageId === m.id)) {
      const entry = grouped.get(r.emoji) ?? { count: 0, mine: false };
      entry.count++;
      if (r.userId === userId) entry.mine = true;
      grouped.set(r.emoji, entry);
    }
    return {
      id: m.id,
      sequence: m.sequence,
      threadRootId: m.threadRootId,
      kind: m.kind,
      author: {
        kind: m.authorKind,
        userId: m.authorUserId,
        agentId: m.authorAgentId,
        name:
          m.authorKind === "agent"
            ? (agents.find((a) => a.id === m.authorAgentId)?.handle ?? "agent")
            : m.authorKind === "system" && !m.authorUserId
              ? "Lictory"
              : nameOf(m.authorUserId),
        onBehalfOfUserId: m.onBehalfOfUserId,
        via: m.via,
      },
      body: m.body,
      payload: m.payload ?? null,
      attachments: m.attachments.map((a) => ({
        ...a,
        url: `/api/files/${a.id}`,
      })),
      reactions: [...grouped].map(([emoji, r]) => ({ emoji, ...r })),
      replyCount: m.replyCount,
      lastReplyAt: m.lastReplyAt?.toISOString() ?? null,
      editedAt: m.editedAt?.toISOString() ?? null,
      deletedAt: m.deletedAt?.toISOString() ?? null,
      external: m.externalSource,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

/**
 * Messages of a channel (top-level by default, with `threads: true` every
 * reply too) after `afterSequence`, oldest first; without a cursor, the
 * latest `limit` messages. `nextCursor` continues from the last one returned.
 */
export async function readChannel(
  db: Database,
  userId: string,
  input: {
    organizationId: string;
    channelId: string;
    afterSequence?: number;
    beforeSequence?: number;
    limit?: number;
    threads?: boolean;
  },
) {
  return read(db, async (tx) => {
    const membership = await authorize(tx, userId, input.organizationId);
    const access = await readChannelAccess(
      tx,
      input.organizationId,
      userId,
      input.channelId,
      isAdmin(membership),
    );
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const where = and(
      eq(s.channelMessage.organizationId, input.organizationId),
      eq(s.channelMessage.channelId, input.channelId),
      input.threads ? undefined : isNull(s.channelMessage.threadRootId),
      input.afterSequence !== undefined
        ? gt(s.channelMessage.sequence, input.afterSequence)
        : undefined,
      input.beforeSequence !== undefined
        ? lt(s.channelMessage.sequence, input.beforeSequence)
        : undefined,
    );
    const forward = input.afterSequence !== undefined;
    const rows = await tx
      .select()
      .from(s.channelMessage)
      .where(where)
      .orderBy(
        forward
          ? asc(s.channelMessage.sequence)
          : desc(s.channelMessage.sequence),
      )
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (!forward) page.reverse();
    const { channel, member } = access;
    return {
      channel: {
        id: channel.id,
        kind: channel.kind,
        name: channel.name,
        topic: channel.topic,
        archived: Boolean(channel.archivedAt),
        lastSequence: channel.lastSequence,
        member: Boolean(member),
        readSequence: member?.readSequence ?? null,
        unreadMessages: unreadMessages(channel, member),
      },
      messages: await views(tx, input.organizationId, userId, page),
      hasMore,
      nextCursor: page.at(-1)?.sequence ?? input.afterSequence ?? null,
    };
  });
}

/** A thread: its first message and the replies after `afterSequence`. */
export async function readThread(
  db: Database,
  userId: string,
  input: {
    organizationId: string;
    channelId: string;
    rootMessageId: string;
    afterSequence?: number;
    limit?: number;
  },
) {
  return read(db, async (tx) => {
    const membership = await authorize(tx, userId, input.organizationId);
    await readChannelAccess(
      tx,
      input.organizationId,
      userId,
      input.channelId,
      isAdmin(membership),
    );
    const [root] = await tx
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.organizationId, input.organizationId),
          eq(s.channelMessage.channelId, input.channelId),
          eq(s.channelMessage.id, input.rootMessageId),
          isNull(s.channelMessage.threadRootId),
        ),
      );
    if (!root)
      throw new DomainError("not_found", "This thread is unavailable.");
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const replies = await tx
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.threadRootId, root.id),
          input.afterSequence !== undefined
            ? gt(s.channelMessage.sequence, input.afterSequence)
            : undefined,
        ),
      )
      .orderBy(asc(s.channelMessage.sequence))
      .limit(limit + 1);
    const page = replies.slice(0, limit);
    const [view, ...rest] = await views(tx, input.organizationId, userId, [
      root,
      ...page,
    ]);
    return {
      root: view!,
      replies: rest,
      hasMore: replies.length > limit,
      nextCursor: page.at(-1)?.sequence ?? input.afterSequence ?? null,
    };
  });
}

/**
 * Full-text search over messages of channels the person can read (public
 * channels of the organization and channels they belong to). PostgreSQL
 * `websearch_to_tsquery` syntax: words, "quoted phrases", -excluded.
 */
export async function searchMessages(
  db: Database,
  userId: string,
  input: {
    organizationId: string;
    query: string;
    channelId?: string;
    limit?: number;
  },
) {
  return read(db, async (tx) => {
    await authorize(tx, userId, input.organizationId);
    const query = input.query.trim();
    if (!query) return { results: [] };
    const tsquery = sql`websearch_to_tsquery('simple', ${query})`;
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const rows = await tx
      .select({
        message: s.channelMessage,
        channelName: s.channel.name,
        channelKind: s.channel.kind,
        snippet: sql<string>`ts_headline('simple', ${s.channelMessage.body}, ${tsquery}, 'MaxFragments=1,MaxWords=24,MinWords=8,StartSel=«,StopSel=»')`,
      })
      .from(s.channelMessage)
      .innerJoin(
        s.channel,
        and(
          eq(s.channel.organizationId, s.channelMessage.organizationId),
          eq(s.channel.id, s.channelMessage.channelId),
        ),
      )
      .where(
        and(
          eq(s.channelMessage.organizationId, input.organizationId),
          input.channelId
            ? eq(s.channelMessage.channelId, input.channelId)
            : undefined,
          isNull(s.channelMessage.deletedAt),
          sql`to_tsvector('simple', ${s.channelMessage.body}) @@ ${tsquery}`,
          or(
            eq(s.channel.kind, "public"),
            sql`exists (select 1 from ${s.channelMember} cm where cm.channel_id = ${s.channel.id} and cm.user_id = ${userId})`,
          ),
        ),
      )
      .orderBy(
        desc(
          sql`ts_rank(to_tsvector('simple', ${s.channelMessage.body}), ${tsquery})`,
        ),
        desc(s.channelMessage.createdAt),
      )
      .limit(limit);
    const messageViews = await views(
      tx,
      input.organizationId,
      userId,
      rows.map((r) => r.message),
    );
    return {
      results: rows.map((r, i) => ({
        channelId: r.message.channelId,
        channelName: r.channelName,
        channelKind: r.channelKind,
        snippet: r.snippet,
        message: messageViews[i]!,
      })),
    };
  });
}

/**
 * Unread mentions and unread direct messages, per organization the person
 * belongs to: what the desktop badge shows. Ordinary channel traffic is not
 * counted.
 */
export async function attentionCounts(db: Database, userId: string) {
  return read(db, async (tx) => {
    const rows = await tx
      .select({
        organizationId: s.channel.organizationId,
        id: s.channel.id,
        kind: s.channel.kind,
        rootCount: s.channel.rootCount,
        readRootCount: s.channelMember.readRootCount,
        mentionCount: s.channelMember.mentionCount,
        notificationLevel: s.channelMember.notificationLevel,
      })
      .from(s.channelMember)
      .innerJoin(
        s.channel,
        and(
          eq(s.channel.organizationId, s.channelMember.organizationId),
          eq(s.channel.id, s.channelMember.channelId),
        ),
      )
      .innerJoin(
        s.member,
        and(
          eq(s.member.organizationId, s.channel.organizationId),
          eq(s.member.userId, userId),
        ),
      )
      .where(
        and(eq(s.channelMember.userId, userId), isNull(s.channel.archivedAt)),
      );
    const byOrg = new Map<string, typeof rows>();
    for (const r of rows)
      byOrg.set(r.organizationId, [...(byOrg.get(r.organizationId) ?? []), r]);
    const organizations = [...byOrg].map(([organizationId, list]) => ({
      organizationId,
      ...attentionCount(list, new Map(list.map((r) => [r.id, r])), (c) => c.id),
    }));
    return {
      organizations,
      total: organizations.reduce((sum, o) => sum + o.total, 0),
    };
  });
}
