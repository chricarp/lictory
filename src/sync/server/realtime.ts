import "server-only";
import postgres from "postgres";
import { z } from "zod";
import { checkpointSchema } from "../shared/protocol";
const notificationSchema = z.object({
  organizationId: z.string(),
  cursor: checkpointSchema,
});
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
type Listener = (event: z.infer<typeof notificationSchema>) => void;
type PresenceListener = (event: PresenceEvent) => void;
// Keyed by shape version so a hot-reloaded module never reuses an older hub.
const globalHub = globalThis as unknown as {
  syncHubV3?: {
    subscribe: (listener: Listener) => Promise<() => void>;
    subscribePresence: (listener: PresenceListener) => Promise<() => void>;
    subscribeNotifications: (
      listener: NotificationListener,
    ) => Promise<() => void>;
  };
};
function createHub() {
  const listeners = new Set<Listener>();
  const presenceListeners = new Set<PresenceListener>();
  const notificationListeners = new Set<NotificationListener>();
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
  const connect = () =>
    (ready ??= Promise.all([
      client.listen("lictory_sync", (payload) => {
        try {
          const event = notificationSchema.parse(JSON.parse(payload));
          for (const callback of listeners) callback(event);
        } catch {
          /* Invalid notifications contain no application data. */
        }
      }),
      client.listen("lictory_presence", (payload) => {
        try {
          const event = presenceSchema.parse(JSON.parse(payload));
          for (const callback of presenceListeners) callback(event);
        } catch {
          /* ignore malformed presence */
        }
      }),
      client.listen("lictory_notification", (payload) => {
        try {
          const event = notificationSignalSchema.parse(JSON.parse(payload));
          for (const callback of notificationListeners) callback(event);
        } catch {
          /* ignore malformed signals */
        }
      }),
    ]).catch((error: unknown) => {
      ready = undefined;
      throw error;
    }));
  return {
    async subscribe(listener: Listener) {
      await connect();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
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
  };
}
export const realtime = (globalHub.syncHubV3 ??= createHub());
