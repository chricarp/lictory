import { advanceSchedules, type Database } from "@lictory/core/domain/service";
import { processAiRuns } from "@lictory/core/ai/runner";
import { createDeliveryService } from "@lictory/core/delivery/service";
import { trackPublicationCompleted } from "@lictory/core/lib/analytics/server";
import { dispatchNotificationEmails } from "@lictory/core/notifications/email";
import { processNotificationEvents } from "@lictory/core/notifications/events";
import { processOrganizationExports } from "@lictory/core/export/service";
import { processOrganizationDeletions } from "@lictory/core/domain/organization-deletion";
import { storage } from "@lictory/core/storage";
import { createCodeIngest } from "@lictory/core/code/ingest";
import { createCodeOutbox } from "@lictory/core/code/outbox";
import { createCodeReconciler } from "@lictory/core/code/reconcile";

export {
  WORK_CHANNEL,
  workKinds,
  type WorkKind,
} from "@lictory/core/jobs/signal";
export {
  advanceSchedules,
  processAiRuns,
  dispatchNotificationEmails,
  processNotificationEvents,
};
export { rebuildProjections } from "@lictory/core/domain/projections";
export {
  createJobDatabase,
  listenForWork,
  type WorkListener,
} from "@lictory/core/jobs/listener";

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
export function processDeliveryPublications(
  db: Database,
  options?: { limit?: number; signal?: AbortSignal },
) {
  return deliveryService(db).processPending(options);
}

// Builds at most one queued organization data export (and expires old
// archives). Attachments are included when file storage is configured.
export function processDataExports(
  db: Database,
  options?: { signal?: AbortSignal },
) {
  return processOrganizationExports(db, { storage, ...options });
}

// Carries out at most one organization deletion whose grace period has
// ended: stored files first, then every organization row.
export function processDueOrganizationDeletions(
  db: Database,
  options?: { signal?: AbortSignal },
) {
  return processOrganizationDeletions(db, { storage, ...options });
}

// Read-only status sync of exported items, least recently checked first.
export function refreshDeliveryStatuses(db: Database, limit?: number) {
  return deliveryService(db).refreshPending(limit);
}

// Code hosts (docs/internals/code-hosts.md): verified webhook deliveries
// first, then writes queued for the hosts. Woken by the `code` signal.
export async function processCodeWork(
  db: Database,
  options: { limit?: number; signal?: AbortSignal } = {},
) {
  const limit = options.limit ?? 20;
  const webhooks = await createCodeIngest(db).processPending(
    limit,
    options.signal,
  );
  const writes = await createCodeOutbox(db).processDue(limit, options.signal);
  return {
    more: webhooks.claimed === limit || writes.due === limit,
    webhooks,
    writes,
  };
}

// Periodic reconciliation and first backfills of linked repositories.
export function reconcileCodeRepositories(
  db: Database,
  options: { limit?: number; signal?: AbortSignal } = {},
) {
  return createCodeReconciler(db).processDue(
    options.limit ?? 5,
    options.signal,
  );
}
