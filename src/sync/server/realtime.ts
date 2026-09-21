import "server-only";
import postgres from "postgres";
import { z } from "zod";
import { checkpointSchema } from "../shared/protocol";
const notificationSchema = z.object({
  organizationId: z.string(),
  cursor: checkpointSchema,
});
type Listener = (event: z.infer<typeof notificationSchema>) => void;
const globalHub = globalThis as unknown as {
  syncHub?: { subscribe: (listener: Listener) => Promise<() => void> };
};
function createHub() {
  const listeners = new Set<Listener>();
  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,
    onnotice: () => undefined,
  });
  let ready: Promise<unknown> | undefined;
  return {
    async subscribe(listener: Listener) {
      ready ??= client
        .listen("lictory_sync", (payload) => {
          try {
            const event = notificationSchema.parse(JSON.parse(payload));
            for (const callback of listeners) callback(event);
          } catch {
            /* Invalid notifications contain no application data. */
          }
        })
        .catch((error: unknown) => {
          ready = undefined;
          throw error;
        });
      await ready;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export const realtime = (globalHub.syncHub ??= createHub());
