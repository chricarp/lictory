// Lictory Channels rules shared by the server, the browser's predictions and
// agents (docs/internals/channels.md). Pure: no database, no React.

export type ChannelKind = "public" | "private" | "direct";
export type ChannelPromotionKind = "proposal" | "decision" | "discussion";

// A message body is Markdown of at most this many characters (Slack's limit
// is 40,000; long text belongs in a page or a specification).
export const CHANNEL_MESSAGE_MAX = 16_000;
// Files one message may carry.
export const CHANNEL_ATTACHMENTS_MAX = 10;
// People (besides the author) in one direct conversation.
export const DIRECT_MEMBERS_MAX = 8;
// Repliers shown on a thread root.
export const REPLY_AUTHORS_MAX = 5;

/** Turns what a person typed ("Payments Releases") into a channel name. */
export function normalizeChannelName(input: string): string {
  return input
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 80);
}

// Who wrote or reacted: `u:USER_ID` for a person, `a:AGENT_ID` for an agent.
type ParticipantKind = "user" | "agent";
export function participantKey(kind: ParticipantKind, id: string): string {
  return `${kind === "user" ? "u" : "a"}:${id}`;
}
export function parseParticipantKey(
  key: string,
): { kind: ParticipantKind; id: string } | undefined {
  const match = /^([ua]):(.+)$/.exec(key);
  if (!match) return undefined;
  return { kind: match[1] === "u" ? "user" : "agent", id: match[2]! };
}

// A direct conversation is identified by its sorted member keys, so opening
// it again finds the existing one.
export function directKey(keys: Iterable<string>): string {
  return [...new Set(keys)].sort().join(",");
}

// A reaction's id is deterministic: a browser's prediction and the stored
// row are the same row, and reacting twice is one reaction.
export function reactionId(
  messageId: string,
  reactor: string,
  emoji: string,
): string {
  return `${messageId}|${reactor}|${emoji}`;
}

// Emoji reactions are short: one emoji (with modifiers) or a `:name:`.
export function validEmoji(emoji: string): boolean {
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 64 || trimmed !== emoji) return false;
  if (/^:[a-z0-9_+-]{1,60}:$/.test(trimmed)) return true;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed) &&
    !/[\s<>[\]()]/.test(trimmed)
    ? [...trimmed].length <= 12
    : false;
}

// Mentions are Markdown links, like specification discussions:
// `@[ada](mention:USER_ID)` for people and `@[forge](agent:AGENT_ID)` for
// agents. The server trusts only the id, after checking who it names.
const mentionPattern =
  /@\[([^\]\n]{1,120})\]\((mention|agent):([A-Za-z0-9_-]{1,160})\)/g;

function withoutCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/** People and agents a message mentions (code spans and blocks excluded). */
export function channelMentions(body: string): {
  userIds: string[];
  agentIds: string[];
} {
  const userIds = new Set<string>();
  const agentIds = new Set<string>();
  for (const match of withoutCode(body).matchAll(mentionPattern))
    (match[2] === "mention" ? userIds : agentIds).add(match[3]!);
  return { userIds: [...userIds], agentIds: [...agentIds] };
}

/** Plain text for excerpts: mentions become `@label`, links their label. */
export function plainExcerpt(body: string, max = 280): string {
  const text = body
    .replace(mentionPattern, (_, label: string) => `@${label}`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => alt || "image")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Unread state is arithmetic over counters (no row per unread message):
// top-level messages after the member's cursor and unread mentions (a
// followed thread's unread replies are `replyCount - readReplyCount`).
export function unreadMessages(
  channel: { rootCount: number },
  member: { readRootCount: number } | null | undefined,
): number {
  if (!member) return 0;
  return Math.max(0, channel.rootCount - member.readRootCount);
}

/**
 * What the desktop badge and the sidebar count: unread mentions everywhere
 * plus unread messages of direct conversations. Muted channels count only
 * their mentions; ordinary channel traffic never counts.
 */
export function attentionCount<
  C extends { kind: ChannelKind; rootCount: number },
>(
  channels: readonly C[],
  members: ReadonlyMap<
    string,
    {
      readRootCount: number;
      mentionCount: number;
      notificationLevel: string;
    }
  >,
  idOf: (channel: C) => string,
): { mentions: number; directMessages: number; total: number } {
  let mentions = 0;
  let directMessages = 0;
  for (const channel of channels) {
    const member = members.get(idOf(channel));
    if (!member) continue;
    mentions += member.mentionCount;
    if (channel.kind === "direct" && member.notificationLevel !== "none")
      directMessages += unreadMessages(channel, member);
  }
  return { mentions, directMessages, total: mentions + directMessages };
}
