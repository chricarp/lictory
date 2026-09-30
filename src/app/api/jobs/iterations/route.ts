import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { db } from "~/db";
import { trackPublicationCompleted } from "~/lib/analytics/server";
import { createDeliveryService } from "~/delivery/service";
import { dispatchNotificationEmails } from "~/notifications/email";
import {
  flushPosthogLogs,
  logScheduledJobsCompleted,
  logScheduledJobsStarted,
} from "~/lib/posthog-logs";
import { advanceSchedules } from "~/sync/server/service";

export const dynamic = "force-dynamic";

// Advances automatic cycles and resumes interrupted delivery exports. Called by a scheduler (Trigger.dev, Vercel cron,
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
  const delivery = await createDeliveryService(db, {
    onPublicationCompleted: trackPublicationCompleted,
  }).processPending();
  console.info(JSON.stringify({ event: "jobs.delivery", ...delivery }));
  const emails = await dispatchNotificationEmails(db);
  console.info(
    JSON.stringify({ event: "jobs.notification_emails", ...emails }),
  );
  logScheduledJobsCompleted();
  return Response.json({ ...result, delivery, emails });
}

export const GET = run;
export const POST = run;
