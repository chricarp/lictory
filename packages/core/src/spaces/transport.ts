// WebSocket transport for the collaboration service: an HTTP server whose
// upgrades are checked (origin) before Hocuspocus sees them. Uses `ws`
// directly so the service runs on Node (production) and Bun (tests) alike.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";

type Options = {
  hocuspocus: Hocuspocus;
  port: number;
  host: string;
  // Refuses cross-site WebSocket hijacking: the browser's Origin must be the
  // platform's public origin. Absent means "allow" (tests only).
  allowedOrigin?: string;
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
    maxPayload: 1024 * 1024,
  });
  const http = createServer((_, response) => {
    response.writeHead(404).end();
  });
  http.on("upgrade", (request, socket, head) => {
    if (
      options.allowedOrigin &&
      request.headers.origin !== options.allowedOrigin
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      const connection = options.hocuspocus.handleConnection(
        websocket,
        toRequest(request),
      );
      websocket.on("message", (data: Buffer) =>
        connection.handleMessage(new Uint8Array(data)),
      );
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
      const stopped = new Promise<void>((resolve) =>
        http.close(() => resolve()),
      );
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
