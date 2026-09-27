import { timingSafeEqual } from "node:crypto";
import { db } from "~/db";
import { createDeliveryService } from "~/delivery/service";
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
  const result = await advanceSchedules(db);
  console.info(JSON.stringify({ event: "jobs.iterations", ...result }));
  // Resume delivery exports left running (deferred create confirmations,
  // interrupted workers).
  const delivery = await createDeliveryService(db).processPending();
  console.info(JSON.stringify({ event: "jobs.delivery", ...delivery }));
  return Response.json({ ...result, delivery });
}

export const GET = run;
export const POST = run;
