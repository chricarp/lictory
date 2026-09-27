// Self-hosted alternative to Trigger.dev/cron: advances automatic cycles every
// few minutes against DATABASE_URL, and resumes interrupted delivery exports. The job is idempotent.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { createDeliveryService } from "../src/delivery/service";
import { advanceSchedules } from "../src/sync/server/service";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = drizzle(postgres(url, { max: 2 }), { schema: s });
const every = Number(process.env.ITERATION_WORKER_INTERVAL_MS ?? 300_000);

async function tick() {
  try {
    const result = await advanceSchedules(db);
    console.info(JSON.stringify({ event: "jobs.iterations", ...result }));
    const delivery = await createDeliveryService(db).processPending();
    console.info(JSON.stringify({ event: "jobs.delivery", ...delivery }));
  } catch (error) {
    console.error(
      JSON.stringify({ event: "jobs.iterations.error", error: String(error) }),
    );
  }
}
await tick();
setInterval(() => void tick(), every);
