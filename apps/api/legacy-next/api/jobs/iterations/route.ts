import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { db } from "@lictory/core/db";
import { trackPublicationCompleted } from "@lictory/core/lib/analytics/server";
import { createDeliveryService } from "@lictory/core/delivery/service";
import { dispatchNotificationEmails } from "@lictory/core/notifications/email";
import {
  flushPosthogLogs,
  logScheduledJobsCompleted,
  logScheduledJobsStarted,
} from "@lictory/core/lib/posthog-logs";
import { advanceSchedules } from "@lictory/core/domain/service";
import { processAiRuns } from "@lictory/core/ai/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Advances automatic cycles, resumes interrupted delivery exports and syncs
// Jira status back onto handed-off work. Called by a scheduler (Trigger.dev, Vercel cron,
// or `bun scripts/iteration-worker.ts`). Idempotent, so retries and
// overlapping runs are safe. Disabled unless CRON_SECRET is configured.
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return (
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET)
    return Response.json(
      { error: "Scheduled jobs are disabled: set CRON_SECRET." },
      { status: 503 },
    );
  if (!authorized(request))
    return Response.json(
      { error: "Invalid job credentials." },
      { status: 401 },
    );
  logScheduledJobsStarted();
  after(flushPosthogLogs);
  const result = await advanceSchedules(db);
  console.info(JSON.stringify({ event: "jobs.iterations", ...result }));
  // Resume delivery exports left running (deferred create confirmations,
  // interrupted workers).
  const deliveryService = createDeliveryService(db, {
    onPublicationCompleted: trackPublicationCompleted,
  });
  const delivery = await deliveryService.processPending();
  console.info(JSON.stringify({ event: "jobs.delivery", ...delivery }));
  // Mirror Jira status and assignee onto handed-off work (read-only).
  const deliveryStatus = await deliveryService.refreshPending();
  console.info(
    JSON.stringify({ event: "jobs.delivery_status", ...deliveryStatus }),
  );
  // Recover Lictory Intelligence runs whose in-request worker was lost
  // (deploys, timeouts).
  const ai = await processAiRuns(db, { limit: 5 });
  console.info(JSON.stringify({ event: "jobs.ai", ...ai }));
  const emails = await dispatchNotificationEmails(db);
  console.info(
    JSON.stringify({ event: "jobs.notification_emails", ...emails }),
  );
  logScheduledJobsCompleted();
  return Response.json({ ...result, delivery, deliveryStatus, ai, emails });
}

export const GET = run;
export const POST = run;
