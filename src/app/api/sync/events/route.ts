import { db } from "~/db";
import { auth } from "~/lib/auth";
import { authorize } from "~/sync/server/service";
import { realtime } from "~/sync/server/realtime";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
// Streams end before the function limit; the browser reconnects and the
// reconnection revalidates session and membership.
const STREAM_LIFETIME = 240_000;
const HEARTBEAT = 20_000;
export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get(
    "organizationId",
  );
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !organizationId) return new Response(null, { status: 401 });
  try {
    await authorize(db, session.user.id, organizationId);
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
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const send = (data: string) => write(`data: ${data}\n\n`);
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
      const unsubscribeNotifications = await realtime.subscribeNotifications(
        (event) => {
          if (event.userIds.includes(session.user.id))
            send(JSON.stringify({ type: "notification" }));
        },
      );
      // A comment keeps proxies from closing an idle stream without waking
      // any client engine. Invalidations missed while the server's LISTEN
      // connection reconnects are recovered by the hub's reconnect handling.
      const unsubscribeReconnects = realtime.subscribeReconnects(() =>
        send('{"type":"invalidate"}'),
      );
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT);
      const expiry = setTimeout(() => {
        dispose();
      }, STREAM_LIFETIME);
      dispose = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        unsubscribePresence();
        unsubscribeNotifications();
        unsubscribeReconnects();
        clearInterval(heartbeat);
        clearTimeout(expiry);
        controller.close();
      };
      request.signal.addEventListener("abort", dispose, { once: true });
      // A new stream may have missed changes while disconnected.
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
