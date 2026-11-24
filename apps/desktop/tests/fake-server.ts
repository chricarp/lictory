import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for a Lictory server: the public session endpoint the desktop
// app probes, and a page that uses the desktop bridge the way the web app's
// lib/desktop-bridge.ts does. Enough to prove the shell end to end without
// starting the whole stack.

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fake Lictory</title></head>
<body>
  <h1>Fake Lictory</h1>
  <p id="bridge"></p>
  <p id="navigated">none</p>
  <a id="external" href="https://example.com/docs">External docs</a>
  <a id="file" href="file:///etc/hosts">A file</a>
  <script>
    const bridge = window.lictoryDesktop;
    document.getElementById("bridge").textContent = bridge
      ? "bridge:" + bridge.platform + ":" + typeof bridge.notify
      : "no bridge";
    window.nodeVisible = typeof require + "/" + typeof process;
    if (bridge) {
      // Like the web app's router: the URL follows.
      bridge.onNavigate((path) => {
        history.pushState({}, "", path);
        document.getElementById("navigated").textContent = path;
      });
      bridge.setBadge(3);
    }
  </script>
</body></html>`;

export async function startFakeServer() {
  const server: Server = createServer((request, response) => {
    if (request.url === "/api/session") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          user: null,
          providers: { google: false, microsoft: false, oidc: false },
          signIn: { password: true, ssoName: null, signUpMode: "invite" },
        }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
