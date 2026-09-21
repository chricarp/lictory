// One realtime invalidation source per organization, shared by every engine in
// the tab. Engines subscribe with a callback; the hub owns the EventSource,
// focus/online listeners and the recovery interval, and closes them when the
// last subscriber leaves. It carries no data: every signal triggers a delta read.
type Listener = () => void;
type Connection = {
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
    connection = { listeners, wake };
    connections.set(organizationId, connection);
    if (typeof window !== "undefined") {
      window.addEventListener("online", wake);
      window.addEventListener("focus", wake);
      connection.timer = setInterval(wake, 15_000);
      const source = new EventSource(
        `/api/sync/events?organizationId=${encodeURIComponent(organizationId)}`,
      );
      source.onmessage = wake;
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
