// Presence and notification signals for one organization, shared by every
// subscriber in the tab. They come from GET /api/events (server-sent events)
// and never carry workspace data: Zero synchronizes that.

type PresenceEntry = { userId: string; workItemId: string | null; at: number };
type Connection = {
  presence: Map<string, PresenceEntry>;
  presenceListeners: Set<() => void>;
  notificationListeners: Set<() => void>;
  refs: number;
  source?: EventSource;
};
const connections = new Map<string, Connection>();

function open(organizationId: string) {
  let connection = connections.get(organizationId);
  if (!connection) {
    const created: Connection = {
      presence: new Map(),
      presenceListeners: new Set(),
      notificationListeners: new Set(),
      refs: 0,
    };
    connection = created;
    connections.set(organizationId, created);
    if (typeof EventSource !== "undefined") {
      // The server ends each stream after a few minutes; EventSource
      // reconnects by itself.
      const source = new EventSource(
        `/api/events?organizationId=${encodeURIComponent(organizationId)}`,
      );
      source.onmessage = (event: MessageEvent<string>) => {
        let data: {
          type?: string;
          userId?: string;
          workItemId?: string | null;
          at?: number;
        };
        try {
          data = JSON.parse(event.data) as typeof data;
        } catch {
          return;
        }
        if (data.type === "presence" && data.userId) {
          created.presence.set(data.userId, {
            userId: data.userId,
            workItemId: data.workItemId ?? null,
            at: data.at ?? Date.now(),
          });
          for (const l of created.presenceListeners) l();
        } else if (data.type === "notification")
          for (const l of created.notificationListeners) l();
      };
      created.source = source;
    }
  }
  connection.refs++;
  return () => {
    const current = connections.get(organizationId);
    if (!current) return;
    current.refs--;
    if (current.refs > 0) return;
    current.source?.close();
    connections.delete(organizationId);
  };
}

// Fires when the signed-in user received a notification in this organization.
export function subscribeNotificationSignals(
  organizationId: string,
  listener: () => void,
) {
  const release = open(organizationId);
  connections.get(organizationId)?.notificationListeners.add(listener);
  return () => {
    connections.get(organizationId)?.notificationListeners.delete(listener);
    release();
  };
}

// Presence: who is viewing which item, learned from signals and expired
// locally. Heartbeats are sent by the viewing tab; nothing is stored.
export const PRESENCE_TTL = 45_000;
export function subscribePresence(
  organizationId: string,
  listener: () => void,
) {
  const release = open(organizationId);
  connections.get(organizationId)?.presenceListeners.add(listener);
  return () => {
    connections.get(organizationId)?.presenceListeners.delete(listener);
    release();
  };
}
export function presenceFor(organizationId: string, workItemId: string) {
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
