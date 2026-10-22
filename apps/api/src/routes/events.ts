import { Hono } from "hono";
import { db } from "@lictory/core/db";
import { realtime } from "@lictory/core/domain/realtime";
import { authorize } from "@lictory/core/domain/service";
import { auth } from "@lictory/core/lib/auth";

// Ephemeral signals for an open workspace: presence and "your inbox
// changed". Data never travels here; Zero synchronizes it. Each stream ends
// after STREAM_LIFETIME so reconnection revalidates session and membership.
const STREAM_LIFETIME = 240_000;
const HEARTBEAT = 20_000;

// Open streams, closed on shutdown so the server can drain.
const open = new Set<() => void>();
export function closeEventStreams() {
  for (const close of [...open]) close();
}

export function eventRoutes() {
  const app = new Hono();
  app.get("/api/events", async (c) => {
    const request = c.req.raw;
    const organizationId = c.req.query("organizationId");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return new Response(null, { status: 401 });
    if (!organizationId) return new Response(null, { status: 400 });
    try {
      await authorize(db, session.user.id, organizationId);
    } catch {
      return new Response(null, { status: 403 });
    }
    const userId = session.user.id;
    const encoder = new TextEncoder();
    let dispose = () => undefined as void;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const write = (chunk: string) => {
          if (!closed) controller.enqueue(encoder.encode(chunk));
        };
        const send = (event: object) =>
          write(`data: ${JSON.stringify(event)}\n\n`);
        const unsubscribePresence = await realtime.subscribePresence(
          (event) => {
            if (event.organizationId === organizationId)
              send({
                type: "presence",
                workItemId: event.workItemId,
                userId: event.userId,
                at: event.at,
              });
          },
        );
        const unsubscribeNotifications = await realtime.subscribeNotifications(
          (event) => {
            if (
              event.organizationId === organizationId &&
              event.userIds.includes(userId)
            )
              send({ type: "notification" });
          },
        );
        // Signals sent while the LISTEN connection reconnected are lost:
        // clients refetch their inbox.
        const unsubscribeReconnects = realtime.subscribeReconnects(() =>
          send({ type: "notification" }),
        );
        // A comment keeps proxies from closing an idle stream.
        const heartbeat = setInterval(
          () => write(": keep-alive\n\n"),
          HEARTBEAT,
        );
        const expiry = setTimeout(() => dispose(), STREAM_LIFETIME);
        dispose = () => {
          if (closed) return;
          closed = true;
          open.delete(dispose);
          unsubscribePresence();
          unsubscribeNotifications();
          unsubscribeReconnects();
          clearInterval(heartbeat);
          clearTimeout(expiry);
          controller.close();
        };
        open.add(dispose);
        request.signal.addEventListener("abort", dispose, { once: true });
        if (request.signal.aborted) dispose();
        // A new stream may have missed signals while disconnected.
        else send({ type: "ready" });
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
  });
  return app;
}
