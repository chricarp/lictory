import { readFile } from "node:fs/promises";
import path from "node:path";
import { protocol, session } from "electron";

// The shell page (server switcher, welcome, settings) is served from the
// app's own files under lictory-app://shell/, a standard secure scheme, rather
// than file://: it gets a real origin for its content security policy, and
// file:// keeps no extra privileges (the GrantFileProtocolExtraPrivileges
// fuse is off). Only the default session, which no server uses, knows the
// scheme.

export const APP_SCHEME = "lictory-app";
export const SHELL_URL = `${APP_SCHEME}://shell/index.html`;

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// Before the app is ready.
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

export function serveShell(root: string) {
  session.defaultSession.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(root, relative || "index.html");
    if (url.host !== "shell" || !file.startsWith(root + path.sep))
      return new Response("Not found", { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          "Content-Type":
            types[path.extname(file)] ?? "application/octet-stream",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
