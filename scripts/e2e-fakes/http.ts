// Small HTTP helpers shared by the browser suite's stand-ins for external
// services (scripts/e2e-fakes). They run inside scripts/test-e2e.ts only.
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export type Handler = (
  request: IncomingMessage & { body: string; url: string; method: string },
  response: ServerResponse,
) => void | Promise<void>;

export function send(
  response: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  if (body === undefined) {
    response.writeHead(status, headers).end();
    return;
  }
  response
    .writeHead(status, { "Content-Type": "application/json", ...headers })
    .end(JSON.stringify(body));
}

// Listens on 127.0.0.1 only: nothing outside this machine reaches a fake.
export async function listen(port: number, handler: Handler) {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      Promise.resolve(
        handler(
          Object.assign(request, {
            body,
            url: request.url ?? "/",
            method: request.method ?? "GET",
          }),
          response,
        ),
      ).catch((error: unknown) => {
        console.error(error);
        if (!response.headersSent)
          send(response, 500, {
            errorMessages: [error instanceof Error ? error.message : "Error"],
          });
        else response.end();
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => close(server),
  };
}

function close(server: Server) {
  return new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

export function json<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}
