import assert from "node:assert/strict";
import { test } from "node:test";
import {
  channelLabel,
  groupReactions,
  indexChannels,
  lastOwnMessage,
  listEntries,
  sidebarChannels,
  sidebarDirect,
  type ChannelRow,
  type MemberRow,
  type MessageRow,
} from "@lictory/platform/components/channels/data";

const minute = 60_000;
const start = new Date(2026, 10, 2, 9, 0).getTime();

function message(
  sequence: number,
  author: string,
  at: number,
  extra: Partial<MessageRow> = {},
): MessageRow {
  return {
    id: `m${sequence}`,
    channelId: "c",
    sequence,
    threadRootId: null,
    authorKind: "user",
    authorUserId: author,
    authorAgentId: null,
    onBehalfOfUserId: null,
    via: null,
    kind: "message",
    body: `message ${sequence}`,
    payload: null,
    attachments: [],
    replyCount: 0,
    lastReplyAt: null,
    replyAuthors: [],
    editedAt: null,
    deletedAt: null,
    externalSource: null,
    createdAt: at,
    ...extra,
  };
}

void test("messages group by author within minutes, split by day and by the first unread", () => {
  const messages = [
    message(1, "ada", start),
    message(2, "ada", start + minute),
    message(3, "bo", start + 2 * minute),
    message(4, "bo", start + 3 * minute),
    message(5, "bo", start + 20 * minute),
    message(6, "ada", start + 24 * 60 * minute),
  ];
  const entries = listEntries(messages, {
    readSequence: 3,
    userId: "ada",
    now: start + 24 * 60 * minute,
  });
  assert.deepEqual(
    entries.map((e) =>
      e.type === "message"
        ? `${e.message.sequence}${e.grouped ? "+" : ""}`
        : e.type === "day"
          ? `[${e.label}]`
          : "[new]",
    ),
    ["[Yesterday]", "1", "2+", "3", "[new]", "4", "5", "[Today]", "6"],
  );
  // My own messages after my cursor are not "new" to me.
  const mine = listEntries(
    [message(1, "bo", start), message(2, "ada", start + minute)],
    { readSequence: 1, userId: "ada" },
  );
  assert.ok(!mine.some((e) => e.type === "unread"));
  // System lines and deleted messages break a group.
  const broken = listEntries([
    message(1, "ada", start, { deletedAt: start }),
    message(2, "ada", start + minute),
    message(3, "ada", start + 2 * minute, { kind: "system" }),
    message(4, "ada", start + 3 * minute),
  ]);
  assert.deepEqual(
    broken.flatMap((e) => (e.type === "message" ? [e.grouped] : [])),
    [false, false, false, false],
  );
});

const channel = (id: string, extra: Partial<ChannelRow> = {}): ChannelRow => ({
  id,
  organizationId: "org",
  kind: "public",
  name: id,
  topic: "",
  projectId: null,
  teamId: null,
  lastSequence: 10,
  rootCount: 8,
  lastMessageAt: start,
  createdById: "ada",
  archivedAt: null,
  externalSource: null,
  createdAt: start,
  ...extra,
});
const member = (
  channelId: string,
  userId: string,
  extra: Partial<MemberRow> = {},
): MemberRow => ({
  id: `${channelId}:${userId}`,
  channelId,
  memberKind: "user",
  userId,
  agentId: null,
  readSequence: 10,
  readRootCount: 8,
  mentionCount: 0,
  notificationLevel: "mentions",
  joinedAt: start,
  ...extra,
});

void test("the sidebar lists joined channels by name and recent direct conversations", () => {
  const { list } = indexChannels(
    [
      channel("zeta"),
      channel("alpha", { rootCount: 10 }),
      channel("unjoined"),
      channel("old", { archivedAt: start }),
      channel("dm1", { kind: "direct", name: null, lastMessageAt: start }),
      channel("dm2", {
        kind: "direct",
        name: null,
        lastMessageAt: start + minute,
      }),
      channel("empty", {
        kind: "direct",
        name: null,
        lastSequence: 0,
        rootCount: 0,
      }),
    ],
    [
      member("zeta", "ada"),
      member("alpha", "ada", { mentionCount: 1 }),
      member("old", "ada"),
      member("dm1", "ada"),
      member("dm2", "ada"),
      member("empty", "ada", { readSequence: 0, readRootCount: 0 }),
    ],
    [
      member("dm1", "ada"),
      member("dm1", "bo"),
      member("dm2", "ada"),
      member("dm2", "cy"),
      member("dm2", "bo"),
    ],
    "ada",
  );
  assert.deepEqual(
    sidebarChannels(list).map((c) => [c.name, c.unread, c.mentions]),
    [
      ["alpha", 2, 1],
      ["zeta", 0, 0],
    ],
  );
  const direct = sidebarDirect(list);
  assert.deepEqual(
    direct.map((c) => c.id),
    ["dm2", "dm1"],
  );
  const names: Record<string, string> = { bo: "Bo", cy: "Cy" };
  assert.equal(
    channelLabel(direct[0]!, (id) => names[id]!),
    "Bo, Cy",
  );
});

void test("reactions group by emoji with mine marked; ↑ finds my last editable message", () => {
  const reactions = groupReactions(
    [
      {
        id: "1",
        messageId: "m",
        emoji: "👍",
        userId: "bo",
        agentId: null,
        createdAt: 2,
      },
      {
        id: "2",
        messageId: "m",
        emoji: "🎉",
        userId: "ada",
        agentId: null,
        createdAt: 1,
      },
      {
        id: "3",
        messageId: "m",
        emoji: "👍",
        userId: "ada",
        agentId: null,
        createdAt: 3,
      },
    ],
    "ada",
  );
  assert.deepEqual(
    reactions.map((r) => [r.emoji, r.count, r.mine]),
    [
      ["🎉", 1, true],
      ["👍", 2, true],
    ],
  );
  const messages = [
    message(1, "ada", start),
    message(2, "ada", start, { deletedAt: start }),
    message(3, "bo", start),
    message(4, "ada", start, { externalSource: "slack" }),
  ];
  assert.equal(lastOwnMessage(messages, "ada")?.id, "m1");
});
