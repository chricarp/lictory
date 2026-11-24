// The Inbox's Updates digest repeated traffic so it never buries a review
// request or a blocking discussion:
// - conversation traffic: messages in one channel or direct conversation
//   become one row ("Ben Ortiz · 2 messages") instead of one per message.
//   Mentions stay their own rows: they are addressed to the person.
// - an agent's failed sessions: one row per agent ("Forge failed 3
//   sessions"), the newest failure's reason under it, instead of one row
//   per failure. A finished session stays its own row.
// Pure, so the browser groups what it loaded and tests can pin the rule.

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

// One row of the feed: a single notification, or several notifications of
// one group (a conversation's messages, an agent's failures), newest first
// (`latest` is the first of `items`).
export type FeedRow<N> = {
  key: string;
  group?: "conversation" | "agent_failures";
  latest: N;
  items: N[];
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

// Which group a notification joins, if any.
function groupOf(n: Groupable) {
  const channelId = str(n.detail.channelId);
  if (conversationKinds.has(n.kind) && channelId)
    return {
      group: "conversation" as const,
      key: `conversation:${n.organizationId}:${channelId}`,
    };
  // Older notifications name the agent only; its name stands in for its id.
  const agent = str(n.detail.agentId) ?? str(n.detail.agentName);
  if (n.kind === "agent_session_finished" && n.detail.status === "failed")
    return {
      group: "agent_failures" as const,
      key: `agent-failures:${n.organizationId}:${agent ?? "unknown"}`,
    };
  return null;
}

export function digestFeed<N extends Groupable>(
  items: readonly N[],
): FeedRow<N>[] {
  const rows: FeedRow<N>[] = [];
  const byGroup = new Map<string, FeedRow<N>>();
  for (const n of items) {
    const group = groupOf(n);
    if (!group) {
      rows.push({ key: n.id, latest: n, items: [n] });
      continue;
    }
    const row = byGroup.get(group.key);
    if (row) {
      row.items.push(n);
      continue;
    }
    const created = { ...group, latest: n, items: [n] };
    byGroup.set(group.key, created);
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

// The headline of a digest: who wrote how many messages where, or which
// agent failed how many sessions. Single notifications keep their own
// sentence (describeNotification).
export function describeDigest<N extends Groupable>(
  row: FeedRow<N>,
  formerMember = "Former member",
): string {
  if (row.group === "agent_failures") {
    const agent = str(row.latest.detail.agentName) ?? "An agent";
    return `${agent} failed ${row.items.length} sessions`;
  }
  const names = [...new Set(row.items.map((n) => n.actorName ?? formerMember))];
  const count = `${row.items.length} message${row.items.length > 1 ? "s" : ""}`;
  const d = row.latest.detail;
  const name = str(d.channelName);
  if (d.channelKind === "direct" || !name) return `${people(names)} · ${count}`;
  return `#${name} · ${count} from ${people(names)}`;
}

export const unreadIn = <N extends Groupable>(row: FeedRow<N>) =>
  row.items.filter((n) => !n.readAt);
