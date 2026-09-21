import { db } from "~/db";
import { auth } from "~/lib/auth";
import { directory } from "~/sync/server/service";
import { realtime } from "~/sync/server/realtime";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !organizationId) return new Response(null, { status: 401 });
  try {
    await directory(db, session.user.id, organizationId);
  } catch {
    return new Response(null, { status: 403 });
  }
  const encoder = new TextEncoder();
  let dispose = () => {
    return;
  };
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: string) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      const unsubscribe = await realtime.subscribe((event) => {
        if (event.organizationId === organizationId)
          send(JSON.stringify({ type: "invalidate" }));
      });
      const unsubscribePresence = await realtime.subscribePresence((event) => {
        if (event.organizationId === organizationId)
          send(
            JSON.stringify({
              type: "presence",
              workItemId: event.workItemId,
              userId: event.userId,
              at: event.at,
            }),
          );
      });
      // Bounded connections revalidate session and membership. Heartbeats also
      // recover invalidations missed while a Postgres LISTEN connection reconnects.
      const heartbeat = setInterval(
        () => send('{"type":"invalidate"}'),
        20_000,
      );
      const expiry = setTimeout(() => {
        dispose();
      }, 60_000);
      dispose = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        unsubscribePresence();
        clearInterval(heartbeat);
        clearTimeout(expiry);
        controller.close();
      };
      request.signal.addEventListener("abort", dispose, { once: true });
      if (request.signal.aborted) dispose();
      else send('{"type":"invalidate"}');
    },
    cancel() {
      dispose();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
