import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";
import { startFakeServer } from "./fake-server";

// The desktop app end to end against a fake Lictory server: add a server,
// load it with the desktop bridge, show its badge, follow a deep link, keep
// other sites and unsafe links out of the app, and reopen where it was.
// Needs `bun run build` first and a display (xvfb-run on Linux).

const appDirectory = path.resolve(import.meta.dirname, "..");

async function launch(userData: string) {
  return electron.launch({
    // CI containers have no setuid sandbox helper; the app still runs every
    // renderer with Electron's sandboxed preload rules.
    args: [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      appDirectory,
    ],
    env: { ...process.env, LICTORY_DESKTOP_USER_DATA: userData },
  });
}

async function serverPage(app: ElectronApplication, origin: string) {
  await expect
    .poll(() => app.windows().find((w) => w.url().startsWith(origin)))
    .toBeTruthy();
  return app.windows().find((w) => w.url().startsWith(origin))!;
}

test("connect to a server, use the bridge and deep links, reopen", async () => {
  const server = await startFakeServer();
  const userData = await mkdtemp(path.join(os.tmpdir(), "lictory-desktop-"));
  let app = await launch(userData);
  try {
    const shell = await app.firstWindow();
    await expect(
      shell.getByRole("heading", { name: "Connect to your Lictory server" }),
    ).toBeVisible();

    // An address that is not a server, then the fake Lictory server.
    const address = shell.getByLabel("Server address");
    await address.fill("ftp://lictory.example.com");
    await shell.getByRole("button", { name: "Connect" }).click();
    await expect(shell.getByRole("alert")).toContainText("https://");
    await address.fill("http://127.0.0.1:1");
    await shell.getByRole("button", { name: "Connect" }).click();
    await expect(shell.getByRole("alert")).toContainText("could not reach");
    await address.fill(server.origin);
    await shell.getByRole("button", { name: "Connect" }).click();

    // The server's page gets the bridge and no Node.js.
    const page = await serverPage(app, server.origin);
    await expect(page.locator("#bridge")).toHaveText(
      `bridge:${process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux"}:function`,
    );
    expect(
      await page.evaluate(
        () => (window as { nodeVisible?: string }).nodeVisible,
      ),
    ).toBe("undefined/undefined");

    // Its badge (3) shows on its button in the switcher.
    const switcher = shell.getByRole("navigation", { name: "Servers" });
    await expect(
      switcher.getByRole("button", { name: /3 unread/ }),
    ).toHaveAttribute("aria-current", "page");

    // A deep link reaches the page's router through the bridge.
    await app.evaluate(({ app: electronApp }, link) => {
      electronApp.emit("second-instance", {}, ["lictory", link], process.cwd());
    }, `lictory://${server.host}/acme/items/PAY-142?pr=3`);
    await expect(page.locator("#navigated")).toHaveText(
      "/acme/items/PAY-142?pr=3",
    );

    // Other sites open in the browser, unsafe schemes nowhere; the page stays.
    await app.evaluate(({ shell: electronShell }) => {
      const opened: string[] = [];
      (globalThis as { opened?: string[] }).opened = opened;
      electronShell.openExternal = (url: string) => {
        opened.push(url);
        return Promise.resolve();
      };
    });
    // Clicked from the page: the cancelled navigations never finish, which
    // Playwright's click would wait for.
    await page.evaluate(() => {
      document.getElementById("external")?.click();
      document.getElementById("file")?.click();
    });
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { opened?: string[] }).opened),
      )
      .toEqual(["https://example.com/docs"]);
    expect(page.url().startsWith(server.origin)).toBe(true);

    // Settings open over the server and close with Escape.
    await switcher.getByRole("button", { name: "Settings" }).click();
    await expect(
      shell.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    await expect(shell.getByText(server.origin)).toBeVisible();
    await shell.keyboard.press("Escape");
    await expect(shell.getByRole("heading", { name: "Settings" })).toBeHidden();

    // Reopening restores the server and the page it was on.
    await app.close();
    app = await launch(userData);
    const reopened = await serverPage(app, server.origin);
    await expect
      .poll(() => new URL(reopened.url()).pathname)
      .toBe("/acme/items/PAY-142");
  } finally {
    await app.close();
    await server.close();
    await rm(userData, { recursive: true, force: true });
  }
});
