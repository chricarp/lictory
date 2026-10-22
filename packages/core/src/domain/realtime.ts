import postgres from "postgres";
import { z } from "zod";

// Ephemeral signals for the /api/events stream: presence and "refetch your
// inbox". Data synchronization goes through Zero, never through this hub.
// Presence is ephemeral: who is looking at which item. It is never persisted and
// carries no document content; every process learns about it through NOTIFY.
export const presenceSchema = z.object({
  organizationId: z.string(),
  workItemId: z.string().nullable(),
  userId: z.string(),
  at: z.number(),
});
export type PresenceEvent = z.infer<typeof presenceSchema>;
// Personal notifications: which users should refetch their inbox. No content.
const notificationSignalSchema = z.object({
  organizationId: z.string(),
  userIds: z.array(z.string()),
});
export type NotificationSignal = z.infer<typeof notificationSignalSchema>;
type NotificationListener = (event: NotificationSignal) => void;
type PresenceListener = (event: PresenceEvent) => void;
// Keyed by shape version so a hot-reloaded module never reuses an older hub.
const globalHub = globalThis as unknown as {
  realtimeHubV5?: {
    subscribeReconnects: (listener: () => void) => () => void;
    subscribePresence: (listener: PresenceListener) => Promise<() => void>;
    subscribeNotifications: (
      listener: NotificationListener,
    ) => Promise<() => void>;
    connect: () => Promise<unknown>;
    close: () => Promise<void>;
  };
};
function createHub() {
  const presenceListeners = new Set<PresenceListener>();
  const notificationListeners = new Set<NotificationListener>();
  const reconnectListeners = new Set<() => void>();
  let listening = false;
  // LISTEN is session-scoped and cannot use a transaction pooler.
  const directUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
  const client = postgres(
    directUrl?.length ? directUrl : process.env.DATABASE_URL!,
    {
      max: 1,
      onnotice: () => undefined,
    },
  );
  let ready: Promise<unknown> | undefined;
  // Channels are listened to one after another: concurrent `listen` calls
  // racing the first connection can resolve before the LISTEN is active.
  const listenAll = async () => {
    await client.listen(
      "lictory_presence",
      (payload) => {
        try {
          const event = presenceSchema.parse(JSON.parse(payload));
          for (const callback of presenceListeners) callback(event);
        } catch {
          /* ignore malformed presence */
        }
      },
      () => {
        // postgres.js calls this on every (re)connect. Signals sent while
        // disconnected are lost, so subscribers refetch after a reconnect.
        if (listening) for (const callback of reconnectListeners) callback();
        listening = true;
      },
    );
    await client.listen("lictory_notification", (payload) => {
      try {
        const event = notificationSignalSchema.parse(JSON.parse(payload));
        for (const callback of notificationListeners) callback(event);
      } catch {
        /* ignore malformed signals */
      }
    });
  };
  const connect = () =>
    (ready ??= listenAll().catch((error: unknown) => {
      ready = undefined;
      throw error;
    }));
  return {
    subscribeReconnects(listener: () => void) {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },
    async subscribePresence(listener: PresenceListener) {
      await connect();
      presenceListeners.add(listener);
      return () => {
        presenceListeners.delete(listener);
      };
    },
    async subscribeNotifications(listener: NotificationListener) {
      await connect();
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    },
    // Resolves once LISTEN is active, so signals sent afterwards arrive.
    connect,
    // Graceful shutdown: drop the LISTEN connection.
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
export const realtime = (globalHub.realtimeHubV5 ??= createHub());
