// One realtime invalidation source per organization, shared by every engine in
// the tab. Engines subscribe with a callback; the hub owns the EventSource,
// focus/online listeners and the recovery interval, and closes them when the
// last subscriber leaves. It carries no data: every signal triggers a delta read.
type Listener = () => void;
type PresenceEntry = { userId: string; workItemId: string | null; at: number };
type PresenceListener = () => void;
type Connection = {
  presence: Map<string, PresenceEntry>;
  presenceListeners: Set<PresenceListener>;
  listeners: Set<Listener>;
  source?: EventSource;
  timer?: ReturnType<typeof setInterval>;
  wake: () => void;
};
const connections = new Map<string, Connection>();

export function subscribeInvalidations(
  organizationId: string,
  listener: Listener,
) {
  let connection = connections.get(organizationId);
  if (!connection) {
    const listeners = new Set<Listener>();
    const wake = () => {
      for (const l of listeners) l();
    };
    connection = {
      listeners,
      wake,
      presence: new Map(),
      presenceListeners: new Set(),
    };
    connections.set(organizationId, connection);
    if (typeof window !== "undefined") {
      window.addEventListener("online", wake);
      window.addEventListener("focus", wake);
      connection.timer = setInterval(wake, 15_000);
      const source = new EventSource(
        `/api/sync/events?organizationId=${encodeURIComponent(organizationId)}`,
      );
      const conn = connection;
      source.onmessage = (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as {
            type: string;
            userId?: string;
            workItemId?: string | null;
            at?: number;
          };
          if (data.type === "presence" && data.userId) {
            conn.presence.set(data.userId, {
              userId: data.userId,
              workItemId: data.workItemId ?? null,
              at: data.at ?? Date.now(),
            });
            for (const l of conn.presenceListeners) l();
            return;
          }
        } catch {
          /* invalidation without payload */
        }
        wake();
      };
      source.onopen = wake;
      source.onerror = wake;
      connection.source = source;
    }
  }
  connection.listeners.add(listener);
  return () => {
    const current = connections.get(organizationId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size) return;
    current.source?.close();
    clearInterval(current.timer);
    window.removeEventListener("online", current.wake);
    window.removeEventListener("focus", current.wake);
    connections.delete(organizationId);
  };
}

// Presence: who is viewing which item, learned from SSE and expired locally.
// Heartbeats are sent by the viewing tab; nothing is stored server-side.
export const PRESENCE_TTL = 45_000;
export function subscribePresence(
  organizationId: string,
  listener: PresenceListener,
) {
  const connection = connections.get(organizationId);
  connection?.presenceListeners.add(listener);
  return () =>
    connections.get(organizationId)?.presenceListeners.delete(listener);
}
export function presenceFor(
  organizationId: string,
  workItemId: string,
): string[] {
  const connection = connections.get(organizationId);
  if (!connection) return [];
  const now = Date.now();
  return [...connection.presence.values()]
    .filter((p) => p.workItemId === workItemId && now - p.at < PRESENCE_TTL)
    .map((p) => p.userId)
    .sort();
}
export async function announcePresence(
  organizationId: string,
  workItemId: string | null,
) {
  try {
    await fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, workItemId }),
      keepalive: true,
    });
  } catch {
    /* presence is best-effort */
  }
}
