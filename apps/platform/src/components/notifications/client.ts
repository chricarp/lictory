import { useCallback, useEffect, useState } from "react";
import type {
  NotificationAction,
  NotificationItem,
  NotificationQuery,
} from "@lictory/core/notifications/service";
import type { PreferenceRule } from "@lictory/core/notifications/catalog";
import { subscribeNotificationSignals } from "@lictory/platform/data/signals";

type Request =
  | { action: "list"; query: NotificationQuery }
  | { action: "unread" }
  | { action: "preferences"; organizationId: string }
  | { action: "watching"; organizationId: string; workItemId: string }
  | NotificationAction;

export async function notificationRequest<T>(body: Request): Promise<T> {
  const response = await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as
    (T & { error?: { message: string } }) | null;
  if (!response.ok)
    throw new Error(
      json?.error?.message ?? "Notifications are unavailable right now.",
    );
  return json as T;
}

export type NotificationPage = {
  items: NotificationItem[];
  next: string | null;
  unread: Record<string, number>;
};
export type PreferencesResponse = { rules: PreferenceRule[] };

// Refetches on realtime signals for this organization, on focus and slowly in
// the background (signals from other organizations are not subscribed).
export function useNotificationSignal(
  organizationId: string,
  onSignal: () => void,
) {
  useEffect(() => {
    const unsubscribe = subscribeNotificationSignals(organizationId, onSignal);
    window.addEventListener("focus", onSignal);
    const timer = setInterval(onSignal, 60_000);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onSignal);
      clearInterval(timer);
    };
  }, [organizationId, onSignal]);
}

export function useUnreadNotifications(organizationId: string) {
  const [unread, setUnread] = useState<Record<string, number>>({});
  const refresh = useCallback(() => {
    void notificationRequest<{ unread: Record<string, number> }>({
      action: "unread",
    })
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);
  useNotificationSignal(organizationId, refresh);
  useEffect(() => {
    // Pages that change read state announce it so badges update at once.
    window.addEventListener("lictory:notifications", refresh);
    return () => window.removeEventListener("lictory:notifications", refresh);
  }, [refresh]);
  return unread;
}

export function announceNotificationChange() {
  window.dispatchEvent(new Event("lictory:notifications"));
}
