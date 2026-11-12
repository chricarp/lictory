import type { Database } from "@lictory/core/domain/service";
import { processNotificationEvents } from "@lictory/core/notifications/events";

// Fans out every queued notification event, as the worker does moments after
// a command commits.
export async function drainNotifications(db: Database) {
  while ((await processNotificationEvents(db)).claimed > 0);
}
