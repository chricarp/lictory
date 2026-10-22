import { advanceSchedules, type Database } from "@lictory/core/domain/service";
import { processAiRuns } from "@lictory/core/ai/runner";
import { createDeliveryService } from "@lictory/core/delivery/service";
import { trackPublicationCompleted } from "@lictory/core/lib/analytics/server";
import { dispatchNotificationEmails } from "@lictory/core/notifications/email";

export {
  WORK_CHANNEL,
  workKinds,
  type WorkKind,
} from "@lictory/core/jobs/signal";
export { advanceSchedules, processAiRuns, dispatchNotificationEmails };
export { rebuildProjections } from "@lictory/core/domain/projections";

// Background work for the worker process. Every job is idempotent, safe to
// run concurrently in several processes (claims use leases or the
// organization lock) and bounded per call; the worker runs them on its
// `lictory_work` signal and on a polling interval.

function deliveryService(db: Database) {
  return createDeliveryService(db, {
    onPublicationCompleted: (publication) =>
      trackPublicationCompleted(publication),
  });
}

// Advances running exports (new ones, deferred create confirmations, crashed
// runners whose lease expired).
export function processDeliveryPublications(db: Database) {
  return deliveryService(db).processPending();
}

// Read-only status sync of exported items, least recently checked first.
export function refreshDeliveryStatuses(db: Database, limit?: number) {
  return deliveryService(db).refreshPending(limit);
}
