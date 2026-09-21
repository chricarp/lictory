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
type Listener = (event: z.infer<typeof notificationSchema>) => void;
type PresenceListener = (event: PresenceEvent) => void;
// Keyed by shape version so a hot-reloaded module never reuses an older hub.
const globalHub = globalThis as unknown as {
  syncHubV2?: {
    subscribe: (listener: Listener) => Promise<() => void>;
    subscribePresence: (listener: PresenceListener) => Promise<() => void>;
  };
};
function createHub() {
  const listeners = new Set<Listener>();
  const presenceListeners = new Set<PresenceListener>();
  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,
    onnotice: () => undefined,
  });
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
  };
}
export const realtime = (globalHub.syncHubV2 ??= createHub());
