import {
  parseParticipantKey,
  unreadMessages,
  type ChannelKind,
} from "@lictory/core/channels/shared";

// Lictory Channels as the browser sees them: synchronized rows of the
// `channels`, `myChannelMemberships`, `directConversationMembers` and
// message queries (packages/zero/src/queries.ts). Everything here is pure,
// so ordering, grouping and naming are tested without a browser.

export type ChannelRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: string;
  readonly name: string | null;
  readonly topic: string;
  readonly projectId: string | null;
  readonly teamId: string | null;
  readonly lastSequence: number;
  readonly rootCount: number;
  readonly lastMessageAt: number | null;
  readonly createdById: string;
  readonly archivedAt: number | null;
  readonly externalSource: string | null;
  readonly createdAt: number;
};
export type MemberRow = {
  readonly id: string;
  readonly channelId: string;
  readonly memberKind: string;
  readonly userId: string | null;
  readonly agentId: string | null;
  readonly readSequence: number;
  readonly readRootCount: number;
  readonly mentionCount: number;
  readonly notificationLevel: string;
  readonly joinedAt: number;
};
type ReactionRow = {
  readonly id: string;
  readonly messageId: string;
  readonly emoji: string;
  readonly userId: string | null;
  readonly agentId: string | null;
  readonly externalSource?: string | null;
  readonly createdAt: number;
};
export type MessageRow = {
  readonly id: string;
  readonly channelId: string;
  readonly sequence: number;
  readonly threadRootId: string | null;
  readonly authorKind: string;
  readonly authorUserId: string | null;
  readonly authorAgentId: string | null;
  readonly onBehalfOfUserId: string | null;
  readonly via: string | null;
  readonly kind: string;
  readonly body: string;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly attachments: readonly {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }[];
  readonly replyCount: number;
  readonly lastReplyAt: number | null;
  readonly replyAuthors: readonly string[];
  readonly editedAt: number | null;
  readonly deletedAt: number | null;
  readonly externalSource: string | null;
  // Messages written in a linked Slack channel: the author's name when they
  // have no Lictory identity, file links and reactions from people there.
  readonly externalAuthorName?: string | null;
  readonly externalFiles?: readonly {
    name: string;
    mimeType: string;
    size: number;
    url: string;
  }[];
  readonly externalReactions?: readonly {
    emoji: string;
    names: readonly string[];
    externalIds: readonly string[];
  }[];
  readonly createdAt: number;
  readonly reactions?: readonly ReactionRow[];
};

export type Channel = ChannelRow & {
  kind: ChannelKind;
  member: MemberRow | undefined;
  unread: number;
  mentions: number;
  // Direct conversations: the other members (people by id, agents by id).
  others: { kind: "user" | "agent"; id: string }[];
};

export function indexChannels(
  channels: readonly ChannelRow[],
  memberships: readonly MemberRow[],
  directMembers: readonly MemberRow[],
  userId: string,
) {
  const mine = new Map(memberships.map((m) => [m.channelId, m]));
  const others = new Map<string, Channel["others"]>();
  for (const m of directMembers) {
    if (m.memberKind === "user" && m.userId === userId) continue;
    const list = others.get(m.channelId) ?? [];
    list.push(
      m.memberKind === "agent"
        ? { kind: "agent", id: m.agentId! }
        : { kind: "user", id: m.userId! },
    );
    others.set(m.channelId, list);
  }
  const list: Channel[] = channels.map((c) => {
    const member = mine.get(c.id);
    return {
      ...c,
      kind: c.kind as ChannelKind,
      member,
      unread: unreadMessages(c, member),
      mentions: member?.mentionCount ?? 0,
      others: others.get(c.id) ?? [],
    };
  });
  return { list, byId: new Map(list.map((c) => [c.id, c])) };
}

const recency = (c: Channel) => c.lastMessageAt ?? c.createdAt;

/** Joined, active channels for the sidebar, by name. */
export function sidebarChannels(channels: readonly Channel[]) {
  return channels
    .filter((c) => c.kind !== "direct" && c.member && !c.archivedAt)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Direct conversations, most recent first (those with messages). */
export function sidebarDirect(channels: readonly Channel[], limit = 12) {
  return channels
    .filter((c) => c.kind === "direct" && c.member)
    .filter((c) => c.lastSequence > 0 || c.unread > 0)
    .sort((a, b) => recency(b) - recency(a))
    .slice(0, limit);
}

export type Person = { id: string; name: string; handle?: string | null };

/** "#payments", or the other members' names of a direct conversation. */
export function channelLabel(
  channel: Pick<Channel, "kind" | "name" | "others">,
  nameOf: (id: string) => string,
  agentName: (id: string) => string = () => "agent",
): string {
  if (channel.kind !== "direct") return channel.name ?? "channel";
  if (!channel.others.length) return "You";
  return channel.others
    .map((o) => (o.kind === "user" ? nameOf(o.id) : agentName(o.id)))
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

export type ListEntry =
  | { type: "day"; key: string; label: string }
  | { type: "unread"; key: string }
  | {
      type: "message";
      key: string;
      message: MessageRow;
      // A follow-up from the same author within a few minutes: no avatar
      // or name line.
      grouped: boolean;
    };

const GROUP_WINDOW_MS = 5 * 60_000;

function dayKey(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(at: number, now = Date.now()) {
  const key = dayKey(at);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(now - 86_400_000)) return "Yesterday";
  const date = new Date(at);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

const authorOf = (m: MessageRow) =>
  m.authorKind === "agent"
    ? `a:${m.authorAgentId}`
    : m.authorKind === "system"
      ? "system"
      : m.authorKind === "external"
        ? `x:${m.externalAuthorName}`
        : `u:${m.authorUserId}`;

/**
 * Messages in reading order with day dividers, a "new" divider before the
 * first unread message (after `readSequence`) and grouping of consecutive
 * messages by the same author.
 */
export function listEntries(
  messages: readonly MessageRow[],
  options: { readSequence?: number | null; userId?: string; now?: number } = {},
): ListEntry[] {
  const entries: ListEntry[] = [];
  let previous: MessageRow | undefined;
  let unreadPlaced = false;
  for (const message of messages) {
    const day = dayKey(message.createdAt);
    const newDay = !previous || dayKey(previous.createdAt) !== day;
    if (newDay)
      entries.push({
        type: "day",
        key: `day:${day}`,
        label: dayLabel(message.createdAt, options.now),
      });
    let unreadHere = false;
    if (
      !unreadPlaced &&
      options.readSequence != null &&
      message.sequence > options.readSequence &&
      message.authorUserId !== options.userId &&
      previous !== undefined
    ) {
      entries.push({ type: "unread", key: "unread" });
      unreadPlaced = true;
      unreadHere = true;
    }
    const grouped =
      !newDay &&
      !unreadHere &&
      previous !== undefined &&
      message.kind === "message" &&
      previous.kind === "message" &&
      !previous.deletedAt &&
      authorOf(previous) === authorOf(message) &&
      message.createdAt - previous.createdAt < GROUP_WINDOW_MS;
    entries.push({
      type: "message",
      key: message.id,
      message,
      grouped,
    });
    previous = message;
  }
  return entries;
}

/**
 * Reactions of a message grouped by emoji, in first-reacted order; people
 * of a linked Slack channel with no Lictory identity count by name.
 */
export function groupReactions(
  reactions: readonly ReactionRow[] | undefined,
  userId: string,
  external: MessageRow["externalReactions"] = [],
) {
  const groups = new Map<
    string,
    {
      emoji: string;
      count: number;
      mine: boolean;
      userIds: string[];
      names: string[];
    }
  >();
  for (const r of [...(reactions ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  )) {
    const group = groups.get(r.emoji) ?? {
      emoji: r.emoji,
      count: 0,
      mine: false,
      userIds: [],
      names: [],
    };
    group.count++;
    if (r.userId) group.userIds.push(r.userId);
    if (r.userId === userId) group.mine = true;
    groups.set(r.emoji, group);
  }
  for (const r of external ?? []) {
    const group = groups.get(r.emoji) ?? {
      emoji: r.emoji,
      count: 0,
      mine: false,
      userIds: [],
      names: [],
    };
    group.count += r.externalIds.length;
    group.names.push(...r.names.map((n) => `${n} (Slack)`));
    groups.set(r.emoji, group);
  }
  return [...groups.values()].filter((g) => g.count > 0);
}

/**
 * The repliers shown on a thread root, most recent first: people and agents
 * (an agent's replies show its avatar like a person's). Slack people have no
 * avatar here and are left out.
 */
export function replyAuthors(
  message: Pick<MessageRow, "replyAuthors">,
): { kind: "user" | "agent"; id: string }[] {
  return message.replyAuthors.flatMap((key) => {
    const parsed = parseParticipantKey(key);
    return parsed ? [parsed] : [];
  });
}

/**
 * The agent session each thread of a channel holds, by thread root: the
 * latest one, when several ran in it. The channel shows its state beside the
 * thread's reply count, so a mention that started an agent says whether it
 * runs, waits on someone or finished without opening the thread.
 */
export function threadSessions<
  S extends {
    channelId: string | null;
    threadRootMessageId: string | null;
    createdAt: string;
  },
>(sessions: readonly S[], channelId: string): Map<string, S> {
  const latest = new Map<string, S>();
  for (const s of sessions) {
    if (s.channelId !== channelId || !s.threadRootMessageId) continue;
    const known = latest.get(s.threadRootMessageId);
    if (!known || known.createdAt < s.createdAt)
      latest.set(s.threadRootMessageId, s);
  }
  return latest;
}

/**
 * A session card's title only repeats its item when the session is named
 * after it ("PAY-10: Refund button…" under the PAY-10 chip).
 */
export function titledByItem(
  card: { workItemId: string | null; workItemKey: string | null },
  title: string,
): boolean {
  return Boolean(
    card.workItemId &&
    card.workItemKey &&
    title.trim().startsWith(card.workItemKey),
  );
}

/** The last message the person wrote in the list, for ↑ to edit it. */
export function lastOwnMessage(
  messages: readonly MessageRow[],
  userId: string,
) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (
      m.kind === "message" &&
      m.authorKind === "user" &&
      m.authorUserId === userId &&
      !m.deletedAt &&
      !m.externalSource
    )
      return m;
  }
  return undefined;
}

export function formatTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
