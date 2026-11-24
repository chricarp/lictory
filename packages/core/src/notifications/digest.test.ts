import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeDigest,
  digestFeed,
  messageCount,
} from "@lictory/core/notifications/digest";

let sequence = 0;
function n(
  kind: string,
  detail: Record<string, unknown>,
  actorName: string | null = "Ben Ortiz",
) {
  sequence += 1;
  return {
    id: `n${sequence}`,
    organizationId: "org",
    kind,
    actorName,
    readAt: null,
    detail,
  };
}

const dm = { channelId: "dm-ben", channelKind: "direct", channelName: "" };
const payments = {
  channelId: "c-pay",
  channelKind: "public",
  channelName: "payments",
};

void test("messages of one conversation become one row, in feed order", () => {
  const items = [
    n("direct_message", dm),
    n("item_ready", { itemKey: "PAY-1" }, null),
    n("channel_thread_reply", payments, "Dev Patel"),
    n("direct_message", dm),
    n("channel_message", payments, "Cara Singh"),
  ];
  const rows = digestFeed(items);
  assert.deepEqual(
    rows.map((r) => r.items.map((i) => i.id)),
    [
      [items[0]!.id, items[3]!.id],
      [items[1]!.id],
      [items[2]!.id, items[4]!.id],
    ],
  );
  assert.equal(describeDigest(rows[0]!), "Ben Ortiz · 2 messages");
  assert.equal(
    describeDigest(rows[2]!),
    "#payments · 2 messages from Dev Patel and Cara Singh",
  );
});

void test("thread replies are digested per thread, counting folded messages", () => {
  const thread = (root: string, count?: number) => ({
    ...payments,
    threadRootId: root,
    ...(count ? { count } : {}),
  });
  const items = [
    // The fan-out folded three unread replies of thread A into one row.
    n("channel_thread_reply", thread("a", 3), "Dev Patel"),
    n("channel_thread_reply", thread("b"), "Cara Singh"),
    n("channel_message", payments, "Cara Singh"),
    // Read earlier: the same thread, so the same row.
    n("channel_thread_reply", thread("a"), "Cara Singh"),
    n("direct_message", { ...dm, count: 2 }),
  ];
  const rows = digestFeed(items);
  assert.deepEqual(
    rows.map((r) => r.items.map((i) => i.id)),
    [
      [items[0]!.id, items[3]!.id],
      [items[1]!.id],
      [items[2]!.id],
      [items[4]!.id],
    ],
  );
  assert.equal(rows[0]!.group, "thread");
  assert.equal(
    describeDigest(rows[0]!),
    "4 replies to a thread in #payments from Dev Patel and Cara Singh",
  );
  assert.equal(messageCount(rows[3]!), 2);
});

void test("mentions stay their own rows: they are addressed to me", () => {
  const items = [
    n("channel_mentioned", payments),
    n("channel_message", payments),
    n("channel_mentioned", payments),
  ];
  assert.equal(digestFeed(items).length, 3);
});

void test("the same channel in two organizations is two conversations", () => {
  const a = n("channel_message", payments);
  const b = { ...n("channel_message", payments), organizationId: "other" };
  assert.equal(digestFeed([a, b]).length, 2);
});

void test("an agent's failed sessions become one row; finished ones stay single", () => {
  const failed = (agentId: string, agentName: string, title: string) =>
    n(
      "agent_session_finished",
      {
        agentId,
        agentName,
        status: "failed",
        sessionTitle: title,
        error: "Runner went offline",
      },
      null,
    );
  const items = [
    failed("forge", "Forge", "Fix refunds"),
    n("agent_session_finished", {
      agentId: "forge",
      agentName: "Forge",
      status: "completed",
    }),
    failed("forge", "Forge", "Fix refunds"),
    failed("scout", "Scout", "Triage"),
    failed("forge", "Forge", "Add webhooks"),
    // Written before notifications named the agent's id: grouped by name.
    n("agent_session_finished", { agentName: "Forge", status: "failed" }),
  ];
  const rows = digestFeed(items);
  assert.deepEqual(
    rows.map((r) => r.items.map((i) => i.id)),
    [
      [items[0]!.id, items[2]!.id, items[4]!.id],
      [items[1]!.id],
      [items[3]!.id],
      [items[5]!.id],
    ],
  );
  assert.equal(rows[0]!.group, "agent_failures");
  assert.equal(describeDigest(rows[0]!), "Forge failed 3 sessions");
  assert.equal(rows[1]!.group, undefined);
});
