// WebSocket transport for the collaboration service: an HTTP server whose
// upgrades are checked (readiness, origin) before Hocuspocus sees them, and
// which answers the container's health probes (/livez, /readyz). Uses `ws`
// directly so the service runs on Node (production) and Bun (tests) alike.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";

// Per socket inbound budget: a burst (a large paste) plus a sustained rate
// well above typing. A client beyond it is disconnected, which bounds what can
// queue behind a slow save.
const INBOUND = {
  messageBytes: 1024 * 1024,
  burstBytes: 2 * 1024 * 1024,
  bytesPerSecond: 512 * 1024,
};

type Options = {
  hocuspocus: Hocuspocus;
  port: number;
  host: string;
  // Refuses cross-site WebSocket hijacking: the browser's Origin must be the
  // platform's public origin. Absent means "allow" (tests only).
  allowedOrigin?: string;
  // Whether the service may take new connections (GET /readyz answers 200,
  // else 503). GET /livez answers 200 while the process runs. Neither
  // reports document content or identities.
  ready?: () => boolean;
};

function toRequest(request: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers))
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value))
      for (const v of value) headers.append(name, v);
  return new Request(
    `http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`,
    {
      headers,
    },
  );
}

export async function listenCollaboration(options: Options) {
  const sockets = new WebSocketServer({
    noServer: true,
    // Larger messages are refused before parsing; one Yjs update is bounded
    // well below this (DRAFT_LIMITS.updateBytes).
    maxPayload: INBOUND.messageBytes,
  });
  let accepting = true;
  const ready = () => accepting && (options.ready?.() ?? true);
  const http = createServer((request, response) => {
    const path = request.url?.split("?")[0];
    const probe =
      request.method === "GET" || request.method === "HEAD"
        ? path === "/livez"
          ? true
          : path === "/readyz"
            ? ready()
            : undefined
        : undefined;
    if (probe === undefined) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(probe ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(JSON.stringify({ status: probe ? "ok" : "unavailable" }));
  });
  http.on("upgrade", (request, socket, head) => {
    if (!ready()) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }
    if (
      options.allowedOrigin &&
      request.headers.origin !== options.allowedOrigin
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    let converted: Request;
    try {
      converted = toRequest(request);
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    socket.on("error", () => socket.destroy());
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      // Oversized or malformed frames raise `error`; unhandled, it would end
      // the process.
      websocket.on("error", () => websocket.terminate());
      const connection = options.hocuspocus.handleConnection(
        websocket,
        converted,
      );
      let budget = INBOUND.burstBytes;
      let refilled = Date.now();
      websocket.on("message", (data: Buffer) => {
        const now = Date.now();
        budget = Math.min(
          INBOUND.burstBytes,
          budget + ((now - refilled) / 1000) * INBOUND.bytesPerSecond,
        );
        refilled = now;
        budget -= data.byteLength;
        // maxPayload covers Node's ws; Bun's ws compatibility layer does not
        // enforce it, so the size is checked here too.
        if (data.byteLength > INBOUND.messageBytes) {
          websocket.close(1009, "Change too large.");
          websocket.terminate();
          return;
        }
        if (budget < 0) {
          websocket.close(1008, "Too many changes at once.");
          websocket.terminate();
          return;
        }
        connection.handleMessage(new Uint8Array(data));
      });
      websocket.on("pong", () => connection.touch());
      websocket.on("close", (code, reason) =>
        connection.handleClose({ code, reason: reason.toString() }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    http.listen(options.port, options.host, resolve),
  );
  return {
    port: (http.address() as AddressInfo).port,
    // Graceful stop: refuse new connections, close open ones, wait until every
    // room has unloaded (its writer settled), then run the destroy hooks.
    async close() {
      accepting = false;
      const stopped = new Promise<void>((resolve) =>
        http.close(() => resolve()),
      );
      // Keep-alive health probes would hold the server open.
      http.closeIdleConnections();
      options.hocuspocus.closeConnections();
      const deadline = Date.now() + 10_000;
      while (
        options.hocuspocus.getDocumentsCount() > 0 &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      await options.hocuspocus.hooks("onDestroy", {
        instance: options.hocuspocus,
      });
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await stopped;
    },
  };
}
