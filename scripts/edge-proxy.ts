// Local stand-in for the production reverse proxy (deploy/Caddyfile), used by
// browser tests and `bun run start:local`: one origin that serves the built SPA
// assets, the API (including its document handler), the analytics relay and
// Zero's WebSocket endpoint, exactly as app.lictory.com routes them.
//
// Usage: bun scripts/edge-proxy.ts
// Env: EDGE_PORT (3001), PLATFORM_DIST_DIR (apps/platform/dist),
//      API_ORIGIN (http://localhost:3002), ZERO_ORIGIN (http://localhost:4848)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join, normalize } from "node:path";
import { createProxyServer } from "http-proxy-3";

const port = Number(process.env.EDGE_PORT ?? 3001);
const dist = process.env.PLATFORM_DIST_DIR ?? "apps/platform/dist";
const api = process.env.API_ORIGIN ?? "http://localhost:3002";
const zero = process.env.ZERO_ORIGIN ?? "http://localhost:4848";

const types: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// Like the production proxy, the API sees exactly one client address in
// X-Forwarded-For (Better Auth rate limits per address and ignores chains it
// cannot attribute). Locally the caller may name itself: browser tests give
// each scenario its own address so they do not share rate-limit buckets.
const proxy = createProxyServer({ xfwd: false });
function forwardedFor(req: IncomingMessage) {
  const claimed = req.headers["x-forwarded-for"];
  const first = (Array.isArray(claimed) ? claimed[0] : claimed)
    ?.split(",")[0]
    ?.trim();
  const peer = (req.socket.remoteAddress ?? "127.0.0.1").replace(
    /^::ffff:/,
    "",
  );
  req.headers["x-forwarded-for"] = (first === "" ? undefined : first) ?? peer;
  req.headers["x-forwarded-proto"] = "http";
  req.headers["x-forwarded-host"] = req.headers.host ?? `localhost:${port}`;
}
proxy.on("error", (_error, _req, res) => {
  if ("writeHead" in res && !res.headersSent) res.writeHead(502);
  res.end();
});

// Static files only: everything that is not a file goes to the API, which
// renders the SPA document for client routes.
function staticFile(pathname: string) {
  if (pathname === "/" || pathname.endsWith("/")) return null;
  const path = normalize(join(dist, decodeURIComponent(pathname)));
  if (!path.startsWith(normalize(dist))) return null;
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  if (path.endsWith("index.html")) return null;
  return path;
}

const server = createServer((req, res) => {
  forwardedFor(req);
  const pathname = new URL(req.url ?? "/", "http://edge").pathname;
  if (pathname.startsWith("/zero/"))
    return proxy.web(req, res, { target: zero });
  if (pathname.startsWith("/api/zero/")) {
    res.writeHead(404).end();
    return;
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/relay/"))
    return proxy.web(req, res, { target: api });
  const file =
    req.method === "GET" || req.method === "HEAD" ? staticFile(pathname) : null;
  if (file) {
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      // Build output and illustrations carry content hashes in their names.
      "cache-control": /^\/(assets|illustrations)\//.test(pathname)
        ? "public, max-age=31536000, immutable"
        : /^\/brand\//.test(pathname)
          ? "public, max-age=86400"
          : "public, max-age=3600",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
    return;
  }
  proxy.web(req, res, { target: api });
});
// Like the production proxy, only pages from this origin may open the sync
// socket (cross-site WebSocket hijacking).
server.on("upgrade", (req, socket, head) => {
  forwardedFor(req);
  const pathname = new URL(req.url ?? "/", "http://edge").pathname;
  const origin = `http://${req.headers.host}`;
  if (pathname.startsWith("/zero/") && req.headers.origin === origin)
    proxy.ws(req, socket, head, { target: zero });
  else socket.destroy();
});
server.listen(port, () =>
  console.log(
    `edge proxy on http://localhost:${port} (api ${api}, zero ${zero})`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
