// The Inbox's Updates digest conversation traffic: messages in one channel
// or direct conversation become one row ("Ben Ortiz · 2 messages") instead
// of one row per message, so a chatty conversation never buries a review
// request or a blocking discussion. Mentions stay their own rows: they are
// addressed to the person. Pure, so the browser groups what it loaded and
// tests can pin the rule.

// Conversation activity that is digested per conversation.
const conversationKinds = new Set([
  "direct_message",
  "channel_message",
  "channel_thread_reply",
]);

type Groupable = {
  id: string;
  organizationId: string;
  kind: string;
  actorName: string | null;
  readAt: string | null;
  detail: Record<string, unknown>;
};

// One row of the feed: a single notification, or several messages of one
// conversation, newest first (`latest` is the first of `items`).
export type FeedRow<N> = { key: string; latest: N; items: N[] };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function digestConversations<N extends Groupable>(
  items: readonly N[],
): FeedRow<N>[] {
  const rows: FeedRow<N>[] = [];
  const byConversation = new Map<string, FeedRow<N>>();
  for (const n of items) {
    const channelId = str(n.detail.channelId);
    if (!conversationKinds.has(n.kind) || !channelId) {
      rows.push({ key: n.id, latest: n, items: [n] });
      continue;
    }
    const key = `${n.organizationId}:${channelId}`;
    const row = byConversation.get(key);
    if (row) {
      row.items.push(n);
      continue;
    }
    const created = { key: `conversation:${key}`, latest: n, items: [n] };
    byConversation.set(key, created);
    rows.push(created);
  }
  return rows;
}

// "Ada Lovelace", "Ada Lovelace and Ben Ortiz", "Ada Lovelace, Ben Ortiz
// and 2 others", most recent first.
function people(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} other${names.length > 3 ? "s" : ""}`;
}

// The headline of a digested conversation: who wrote how many messages
// where. Single notifications keep their own sentence (describeNotification).
export function describeConversation<N extends Groupable>(
  row: FeedRow<N>,
  formerMember = "Former member",
): string {
  const names = [...new Set(row.items.map((n) => n.actorName ?? formerMember))];
  const count = `${row.items.length} message${row.items.length > 1 ? "s" : ""}`;
  const d = row.latest.detail;
  const name = str(d.channelName);
  if (d.channelKind === "direct" || !name) return `${people(names)} · ${count}`;
  return `#${name} · ${count} from ${people(names)}`;
}

export const unreadIn = <N extends Groupable>(row: FeedRow<N>) =>
  row.items.filter((n) => !n.readAt);
