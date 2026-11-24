import assert from "node:assert/strict";
import { test } from "node:test";
import type { NotificationItem } from "@lictory/core/notifications/service";
import type { DesktopNotification } from "@lictory/platform/lib/desktop";
import {
  attentionKinds,
  createBadge,
  createDesktopSync,
  createNotificationForwarder,
  desktopNotification,
  toDesktopNotifications,
} from "@lictory/platform/lib/desktop-bridge";

let sequence = 0;
function notification(
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  sequence++;
  return {
    id: `n-${sequence}`,
    organizationId: "org-1",
    organizationSlug: "acme",
    organizationName: "Acme",
    kind: "review_requested",
    actorId: "user-ana",
    actorName: "Ana",
    projectId: "p-1",
    teamId: null,
    workItemId: "w-1",
    detail: {
      itemKey: "PAY-142",
      title: "Retry failed payments",
      responsibility: "Engineering",
      revision: 3,
    },
    readAt: null,
    archivedAt: null,
    createdAt: `2026-11-24T10:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

void test("attention kinds are those that ask something of the person", () => {
  for (const kind of [
    "review_requested",
    "mentioned",
    "blocking_thread",
    "approval_invalidated",
    "assigned",
    "page_mentioned",
  ] as const)
    assert.ok(attentionKinds.includes(kind), kind);
  for (const kind of [
    "thread_reply",
    "status_changed",
    "specification_revised",
    "iteration_started",
  ] as const)
    assert.ok(!attentionKinds.includes(kind), kind);
});

void test("the badge is the sum of its sources and only changes when it must", () => {
  const sent: number[] = [];
  const badge = createBadge({ setBadge: (count) => sent.push(count) });
  badge.set("notifications", 2);
  badge.set("channels", 3);
  badge.set("channels", 3);
  badge.set("notifications", -4);
  badge.set("channels", Number.NaN);
  badge.set("channels", 1.8);
  badge.clear("channels");
  assert.deepEqual(sent, [2, 5, 3, 0, 1, 0]);
});

void test("starting the app never replays the inbox", () => {
  const forwarder = createNotificationForwarder({ now: () => 0 });
  const existing = [notification(), notification()];
  assert.deepEqual(forwarder.take(existing), []);
  assert.deepEqual(forwarder.take(existing), []);
  const later = notification({ createdAt: "2026-11-24T11:00:00.000Z" });
  assert.deepEqual(
    forwarder.take([later, ...existing]).map((n) => n.id),
    [later.id],
  );
  // Seen once, notified once.
  assert.deepEqual(forwarder.take([later, ...existing]), []);
});

void test("older notifications sliding into the first page are not new", () => {
  const forwarder = createNotificationForwarder({ now: () => 0 });
  forwarder.take([notification({ createdAt: "2026-11-24T10:00:00.000Z" })]);
  const older = notification({ createdAt: "2026-11-20T08:00:00.000Z" });
  assert.deepEqual(forwarder.take([older]), []);
});

void test("an empty inbox at start accepts notifications from the last minutes", () => {
  const now = Date.parse("2026-11-24T10:00:00.000Z");
  const forwarder = createNotificationForwarder({ now: () => now });
  assert.deepEqual(forwarder.take([]), []);
  const skewed = notification({ createdAt: "2026-11-24T09:58:00.000Z" });
  const stale = notification({ createdAt: "2026-11-24T08:00:00.000Z" });
  assert.deepEqual(
    forwarder.take([skewed, stale]).map((n) => n.id),
    [skewed.id],
  );
});

void test("a notification reads like the inbox row and opens its item", () => {
  const n = notification();
  assert.deepEqual(desktopNotification(n), {
    title: "Ana requested Engineering review of PAY-142",
    body: "Retry failed payments · Revision 3",
    path: "/acme/items/PAY-142",
    tag: n.id,
  });
  // A kind this version does not know: its label, and the organization.
  const system = notification({
    kind: "retired_kind",
    actorId: null,
    actorName: null,
    detail: {},
  });
  assert.equal(desktopNotification(system).body, "Acme");
});

void test("a burst becomes the newest two and a summary", () => {
  const burst = Array.from({ length: 6 }, (_, i) =>
    notification({ createdAt: `2026-11-24T12:00:0${i}.000Z` }),
  );
  const shown = toDesktopNotifications(burst);
  assert.equal(shown.length, 3);
  assert.equal(shown[0]?.title, "4 more notifications need you");
  assert.equal(shown[0]?.path, "/acme/inbox");
  assert.deepEqual(
    shown.slice(1).map((n) => n.tag),
    [burst[4]?.id, burst[5]?.id],
  );
  assert.equal(toDesktopNotifications(burst.slice(0, 3)).length, 3);
});

void test("a sync updates the badge, forwards new notifications and coalesces refreshes", async () => {
  let items = [notification()];
  let fetches = 0;
  const notified: DesktopNotification[] = [];
  const badges: number[] = [];
  let release: () => void = () => undefined;
  const sync = createDesktopSync({
    bridge: { notify: (n) => notified.push(n) },
    setBadge: (count) => badges.push(count),
    fetchUnread: async () => {
      fetches++;
      if (fetches === 2) await new Promise<void>((r) => (release = r));
      return { items, next: null };
    },
  });
  await sync.refresh();
  assert.deepEqual(badges, [1]);
  assert.equal(notified.length, 0);

  items = [notification({ createdAt: "2026-11-24T13:00:00.000Z" }), ...items];
  const first = sync.refresh();
  // Two more requests while one runs: one more read, not two.
  void sync.refresh();
  void sync.refresh();
  release();
  await first;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetches, 3);
  assert.deepEqual(badges, [1, 2, 2]);
  assert.equal(notified.length, 1);
  assert.equal(
    notified[0]?.title,
    "Ana requested Engineering review of PAY-142",
  );

  // A failed read keeps the badge; a stopped sync does nothing.
  const failing = createDesktopSync({
    bridge: { notify: () => assert.fail("no notification") },
    setBadge: () => assert.fail("no badge"),
    fetchUnread: () => Promise.reject(new Error("offline")),
  });
  await failing.refresh();
  sync.stop();
  await sync.refresh();
  assert.equal(fetches, 3);
});
