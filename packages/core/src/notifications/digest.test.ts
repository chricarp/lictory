import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeConversation,
  digestConversations,
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
  const rows = digestConversations(items);
  assert.deepEqual(
    rows.map((r) => r.items.map((i) => i.id)),
    [
      [items[0]!.id, items[3]!.id],
      [items[1]!.id],
      [items[2]!.id, items[4]!.id],
    ],
  );
  assert.equal(describeConversation(rows[0]!), "Ben Ortiz · 2 messages");
  assert.equal(
    describeConversation(rows[2]!),
    "#payments · 2 messages from Dev Patel and Cara Singh",
  );
});

void test("mentions stay their own rows: they are addressed to me", () => {
  const items = [
    n("channel_mentioned", payments),
    n("channel_message", payments),
    n("channel_mentioned", payments),
  ];
  assert.equal(digestConversations(items).length, 3);
});

void test("the same channel in two organizations is two conversations", () => {
  const a = n("channel_message", payments);
  const b = { ...n("channel_message", payments), organizationId: "other" };
  assert.equal(digestConversations([a, b]).length, 2);
});
