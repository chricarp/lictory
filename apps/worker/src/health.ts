import { createServer, type Server } from "node:http";
import type { Supervisor } from "@lictory/worker/supervisor";

// GET /healthz for the container healthcheck: 200 while every job loop is
// alive, 503 otherwise or while shutting down. The body reports per-job
// state (timestamps, failure counts, error categories) and never secrets or
// content. Bind it to loopback unless something outside the container must
// reach it.
export function startHealthServer(
  supervisor: Supervisor,
  listening: () => boolean,
  options: { port: number; host: string },
  onListening: (port: number) => void,
): Server {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/healthz") {
      response.writeHead(404).end();
      return;
    }
    const healthy = supervisor.healthy();
    response
      .writeHead(healthy ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(
        JSON.stringify({
          status: healthy ? "ok" : "unhealthy",
          listening: listening(),
          jobs: supervisor.status(),
        }),
      );
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    onListening(typeof address === "object" && address ? address.port : 0);
  });
  return server;
}
