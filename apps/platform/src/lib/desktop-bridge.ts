import { useEffect, useRef } from "react";
import { paths, safeCallbackPath } from "@lictory/core/lib/paths";
import {
  notificationKindList,
  notificationKinds,
  type NotificationKind,
} from "@lictory/core/notifications/catalog";
import {
  describeNotification,
  notificationHref,
} from "@lictory/core/notifications/format";
import type { NotificationItem } from "@lictory/core/notifications/service";
import {
  notificationRequest,
  type NotificationPage,
} from "@lictory/platform/components/notifications/client";
import { subscribeNotificationSignals } from "@lictory/platform/data/signals";
import {
  desktop,
  type DesktopBridge,
  type DesktopNotification,
} from "@lictory/platform/lib/desktop";
import { useRouter } from "@lictory/platform/lib/navigation";

// What the web app tells the desktop app (apps/desktop) when it runs inside
// it: native notifications for new notifications that ask for the person's
// attention, the dock or taskbar badge, and navigation requested by the
// shell (a deep link, a notification click). In a browser `desktop()` is
// null and none of this runs.
//
// It reads the in-app notifications the inbox reads (POST
// /api/notifications), refreshed by the same realtime signals; it adds no
// server events. The badge is a sum of sources, so other kinds of unread
// activity add their own count with useDesktopBadgeSource: the shell adds
// its sidebar's mentions and direct messages (components/shell/nav-badges).
// This module is the only caller of `setBadge`.

// The catalog's rule (docs/internals/notifications.md): what asks something
// of the person notifies by email by default; what only informs does not.
// Those kinds are the ones worth a native notification and the badge.
export const attentionKinds: NotificationKind[] = notificationKindList.filter(
  (kind) => notificationKinds[kind].email,
);

// Channel mentions and direct messages reach the badge through the sidebar's
// source, from read state: reading a conversation clears them there without
// marking their notifications read, so counting both would count them twice
// and keep them after reading. They are still forwarded as native ones.
const channelKinds = new Set<string>(
  notificationKindList.filter(
    (kind) => notificationKinds[kind].category === "channels",
  ),
);
export const badgeCounts = (n: Pick<NotificationItem, "kind">) =>
  !channelKinds.has(n.kind);

const PAGE = 100;
// Native notifications per refresh; the rest are summed up in one.
const MAX_AT_ONCE = 3;

// ---------------------------------------------------------------- badge

export function createBadge(bridge: Pick<DesktopBridge, "setBadge">) {
  const counts = new Map<string, number>();
  let shown: number | null = null;
  const flush = () => {
    let total = 0;
    for (const count of counts.values()) total += count;
    if (total === shown) return;
    shown = total;
    bridge.setBadge(total);
  };
  return {
    set(source: string, count: number) {
      counts.set(
        source,
        Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
      );
      flush();
    },
    clear(source: string) {
      counts.delete(source);
      flush();
    },
  };
}

let sharedBadge: ReturnType<typeof createBadge> | null = null;
function badge() {
  const bridge = desktop();
  if (!bridge) return null;
  sharedBadge ??= createBadge(bridge);
  return sharedBadge;
}

// Adds `count` to the desktop badge under `source` while mounted.
export function useDesktopBadgeSource(source: string, count: number) {
  useEffect(() => {
    badge()?.set(source, count);
  }, [source, count]);
  useEffect(() => () => badge()?.clear(source), [source]);
}

// ---------------------------------------------------------- notifications

// Picks the notifications that are new since the bridge started. The first
// read only records what is already there (starting the app never replays
// the inbox); later reads return unseen notifications no older than the
// newest one of that first read, so older notifications that move into the
// first page as others are read are not mistaken for new ones.
export function createNotificationForwarder(options: {
  now: () => number;
  // When the inbox was empty at the start: how far back a notification may
  // be and still count as new (server and computer clocks differ).
  skewMs?: number;
}) {
  const seen = new Set<string>();
  let watermark: string | null = null;
  return {
    take(items: readonly NotificationItem[]): NotificationItem[] {
      if (watermark === null) {
        watermark =
          items.reduce<string | null>(
            (max, n) => (max === null || n.createdAt > max ? n.createdAt : max),
            null,
          ) ??
          new Date(
            options.now() - (options.skewMs ?? 5 * 60_000),
          ).toISOString();
        for (const n of items) seen.add(n.id);
        return [];
      }
      const since = watermark;
      const fresh = items.filter(
        (n) => !seen.has(n.id) && !n.readAt && n.createdAt >= since,
      );
      for (const n of items) seen.add(n.id);
      // Bounded: ids of a long session do not accumulate forever.
      if (seen.size > 2000)
        for (const id of [...seen].slice(0, seen.size - 1000)) seen.delete(id);
      return fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  };
}

export function desktopNotification(n: NotificationItem): DesktopNotification {
  const actor = n.actorName ?? (n.actorId ? "Former member" : "Lictory");
  const { headline, body } = describeNotification(n, actor);
  const title = typeof n.detail.title === "string" ? n.detail.title : null;
  return {
    title: headline,
    body: [title, body].filter(Boolean).join(" · ") || n.organizationName,
    path: notificationHref(n.organizationSlug, n),
    tag: n.id,
  };
}

// New notifications, oldest first, as native ones: a burst becomes the two
// newest and one that sums up the rest.
export function toDesktopNotifications(
  fresh: readonly NotificationItem[],
): DesktopNotification[] {
  if (fresh.length <= MAX_AT_ONCE) return fresh.map(desktopNotification);
  const shown = fresh.slice(-(MAX_AT_ONCE - 1));
  const rest = fresh.length - shown.length;
  const newest = fresh[fresh.length - 1]!;
  return [
    {
      title: `${rest} more notifications need you`,
      body: "Open your inbox to see them all.",
      path: paths.inbox(newest.organizationSlug),
      tag: "lictory-summary",
    },
    ...shown.map(desktopNotification),
  ];
}

// One refresh loop per mounted bridge: reads the unread notifications that
// ask for attention, updates the badge and forwards what is new. Refreshes
// asked for while one runs are coalesced into one more.
export function createDesktopSync(options: {
  bridge: Pick<DesktopBridge, "notify">;
  setBadge: (count: number) => void;
  fetchUnread: () => Promise<Pick<NotificationPage, "items" | "next">>;
  now?: () => number;
}) {
  const forwarder = createNotificationForwarder({
    now: options.now ?? Date.now,
  });
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  async function once() {
    try {
      const page = await options.fetchUnread();
      if (stopped) return;
      options.setBadge(page.items.filter(badgeCounts).length);
      for (const notification of toDesktopNotifications(
        forwarder.take(page.items),
      ))
        options.bridge.notify(notification);
    } catch {
      // Offline or signed out: the badge keeps its last count.
    }
  }

  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = once().finally(() => {
      running = null;
      if (again && !stopped) {
        again = false;
        void refresh();
      }
    });
    return running;
  }

  return {
    refresh,
    stop() {
      stopped = true;
    },
  };
}

const fetchUnread = () =>
  notificationRequest<NotificationPage>({
    action: "list",
    query: { status: "unread", kinds: attentionKinds, limit: PAGE },
  });

// Connects the signed-in app to the desktop shell. Mounted once, inside the
// signed-in layout, with the organizations the person belongs to (whose
// realtime signals say when the inbox changed).
export function useDesktopBridge(
  bridge: DesktopBridge,
  organizationIds: readonly string[],
) {
  const router = useRouter();
  useEffect(
    () =>
      bridge.onNavigate((path) => {
        // Pages of this app only: other origins and the account flows are
        // refused (they come back as "/").
        const target = safeCallbackPath(path);
        if (target !== "/" || path === "/") router.push(target);
      }),
    [bridge, router],
  );

  const sync = useRef<ReturnType<typeof createDesktopSync> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    // Signals come in bursts (one per recipient batch).
    timer.current = setTimeout(() => void sync.current?.refresh(), 250);
  });

  useEffect(() => {
    const current = createDesktopSync({
      bridge,
      setBadge: (count) => badge()?.set("notifications", count),
      fetchUnread,
    });
    sync.current = current;
    void current.refresh();
    const refresh = schedule.current;
    // Read state changed in this tab (the inbox announces it).
    window.addEventListener("lictory:notifications", refresh);
    window.addEventListener("focus", refresh);
    // Signals lost while a stream reconnects are caught up within a minute.
    const interval = setInterval(refresh, 60_000);
    return () => {
      current.stop();
      sync.current = null;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("lictory:notifications", refresh);
      window.removeEventListener("focus", refresh);
      clearInterval(interval);
      badge()?.clear("notifications");
    };
  }, [bridge]);

  const key = [...organizationIds].sort().join(",");
  useEffect(() => {
    if (!key) return;
    const refresh = schedule.current;
    const unsubscribe = key
      .split(",")
      .map((id) => subscribeNotificationSignals(id, refresh));
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, [key]);
}
