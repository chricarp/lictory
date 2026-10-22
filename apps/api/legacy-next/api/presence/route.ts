import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@lictory/core/db";
import { auth } from "@lictory/core/lib/auth";
import { authorize } from "@lictory/core/domain/service";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  workItemId: z.string().min(1).nullable(),
});
export const dynamic = "force-dynamic";

// Presence heartbeat. Authorization is the same organization membership check
// as sync; the payload is broadcast through PostgreSQL NOTIFY so every server
// process fans it out to its SSE clients. Nothing is stored.
export async function POST(request: Request) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin &&
    request.headers.get("origin") !== process.env.BETTER_AUTH_URL
  )
    return new Response(null, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  try {
    await authorize(db, session.user.id, parsed.data.organizationId);
  } catch {
    return new Response(null, { status: 403 });
  }
  const payload = JSON.stringify({
    organizationId: parsed.data.organizationId,
    workItemId: parsed.data.workItemId,
    userId: session.user.id,
    at: Date.now(),
  });
  await db.execute(sql`select pg_notify('lictory_presence', ${payload})`);
  return new Response(null, { status: 204 });
}
