import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";

type PushedMutation = {
  name: string;
  args: unknown[];
};
export type WorkspaceMutation = {
  id: string;
  organizationId: string;
  command: { type: string; [key: string]: unknown };
};

// Workspace changes travel over Zero's WebSocket (/zero/...). This proxies
// it to observe pushed mutations, rewrite them before the server sees them,
// or interrupt the connection like a network failure. A browser context
// controls the connections of all its tabs.
export async function controlZeroConnection(page: Page | BrowserContext) {
  let blocked = false;
  let rewrite: ((mutation: WorkspaceMutation) => void) | undefined;
  let afterPush: ((socket: WebSocketRoute) => void) | undefined;
  const open = new Set<WebSocketRoute>();
  const pushed: WorkspaceMutation[] = [];
  await page.routeWebSocket("**/zero/**", (socket) => {
    if (blocked) {
      void socket.close({ code: 1011, reason: "Test connection interrupted" });
      return;
    }
    open.add(socket);
    const server = socket.connectToServer();
    socket.onClose(() => open.delete(socket));
    socket.onMessage((message) => {
      if (typeof message !== "string" || !message.startsWith('["push"')) {
        server.send(message);
        return;
      }
      const [kind, body] = JSON.parse(message) as [
        string,
        { mutations: PushedMutation[] },
      ];
      for (const mutation of body.mutations) {
        if (mutation.name !== "workspace.apply") continue;
        const args = mutation.args[0] as WorkspaceMutation;
        pushed.push(structuredClone(args));
        rewrite?.(args);
      }
      server.send(JSON.stringify([kind, body]));
      afterPush?.(socket);
    });
  });
  return {
    pushed,
    // Commands as the browser sent them (before any rewrite).
    commands: () => pushed.map((m) => m.command),
    rewrite: (fn: typeof rewrite) => {
      rewrite = fn;
    },
    afterPush: (fn: typeof afterPush) => {
      afterPush = fn;
    },
    // Drops the connection and refuses new ones until `restore`.
    interrupt: async () => {
      blocked = true;
      for (const socket of [...open])
        await socket.close({
          code: 1011,
          reason: "Test connection interrupted",
        });
      open.clear();
    },
    restore: () => {
      blocked = false;
    },
  };
}
