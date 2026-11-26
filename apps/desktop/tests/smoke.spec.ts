import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { expectNoAccessibilityViolations } from "../../../tests/helpers/accessibility";
import { startFakeServer } from "./fake-server";

// The desktop app end to end against a fake Lictory server: add a server,
// load it with the desktop bridge, show its badge, notifications and the
// organization's name, follow a deep link, keep other sites and unsafe links
// out of the app, say when the network is gone, and reopen where it was. The
// app's own screens are checked with axe along the way.
// Needs `bun run build` first and a display (xvfb-run on Linux).

const appDirectory = path.resolve(import.meta.dirname, "..");

// The app's own screens, checked like the web app's (WCAG 2.2 AA).
const axe = (page: Page, state: string) =>
  expectNoAccessibilityViolations(page, state, { singlePage: true });

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
    // The bundled typeface, not a system fallback (the page's policy must
    // allow its font).
    await expect
      .poll(() => shell.evaluate(() => document.fonts.check("14px Geist")))
      .toBe(true);
    await expect
      .poll(() =>
        shell.evaluate(() =>
          [...document.fonts].some(
            (f) => f.family === "Geist" && f.status === "loaded",
          ),
        ),
      )
      .toBe(true);
    await axe(shell, "welcome");

    // An address that is not a server, then the fake Lictory server.
    const address = shell.getByLabel("Server address");
    await address.fill("ftp://lictory.example.com");
    await shell.getByRole("button", { name: "Connect" }).click();
    await expect(shell.getByRole("alert")).toContainText("https://");
    await address.fill("http://127.0.0.1:1");
    await shell.getByRole("button", { name: "Connect" }).click();
    // Plain words and the next step; Chromium's code only as a detail.
    await expect(shell.getByRole("alert")).toHaveText(
      "127.0.0.1:1 uses a port that Lictory never opens, for safety. Use the address you open Lictory at in your browser, usually without a port number.",
    );
    await expect(shell.getByText("Details: ERR_UNSAFE_PORT")).toBeVisible();
    await axe(shell, "welcome with an error");
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

    // The organization the person uses there names the server.
    await page.evaluate(() =>
      (
        window as {
          lictoryDesktop?: { setOrganizationName?: (n: string) => void };
        }
      ).lictoryDesktop?.setOrganizationName?.("Harborline Freight"),
    );
    const named = switcher.getByRole("button", { name: /Harborline Freight/ });
    await expect(named).toHaveText(/^HF/);

    // Native notifications: recorded where the app shows them. Working in
    // the app on another page of the same server, a review request still
    // interrupts; one about the page in front is not repeated.
    await app.evaluate(({ BaseWindow, Notification }) => {
      const shown: string[] = [];
      (globalThis as { shown?: string[] }).shown = shown;
      // A Linux computer without libnotify (this CI image) cannot show
      // them; the decision is what is tested.
      if (!Notification.isSupported())
        Object.defineProperty(Notification, "isSupported", {
          value: () => true,
        });
      Notification.prototype.show = function (this: Electron.Notification) {
        shown.push(this.title);
      };
      BaseWindow.getAllWindows()[0]?.focus();
    });
    expect(
      await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]?.isFocused(),
      ),
    ).toBe(true);
    await page.evaluate(() => {
      const bridge = (
        window as {
          lictoryDesktop?: {
            notify(n: { title: string; body: string; path?: string }): void;
          };
        }
      ).lictoryDesktop!;
      bridge.notify({
        title: "Review requested",
        body: "PAY-142",
        path: "/acme/items/PAY-142",
      });
      bridge.notify({
        title: "About this page",
        body: "",
        path: location.pathname,
      });
    });
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { shown?: string[] }).shown),
      )
      .toEqual(["Review requested"]);

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

    // No network: the top bar says so, and stops saying it when it is back.
    const cdp = await page.context().newCDPSession(page);
    const network = (offline: boolean) =>
      cdp.send("Network.emulateNetworkConditions", {
        offline,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    await cdp.send("Network.enable");
    await network(true);
    const offline = shell.locator('[data-status="offline"]');
    await expect(offline).toHaveText("Offline");
    await expect(shell.getByRole("status")).toContainText(
      "This computer is offline.",
    );
    await axe(shell, "offline");
    await network(false);
    await expect(offline).toBeHidden();
    await cdp.detach();

    // Settings open over the server and close with Escape.
    await switcher.getByRole("button", { name: "Settings" }).click();
    await expect(
      shell.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    await expect(shell.getByText(server.origin)).toBeVisible();
    await axe(shell, "settings");
    await switcher.getByRole("button", { name: "Add a server" }).click();
    await expect(
      shell.getByRole("heading", { name: "Add a server" }),
    ).toBeVisible();
    await axe(shell, "add a server");
    await switcher.getByRole("button", { name: "Settings" }).click();
    await shell.keyboard.press("Escape");
    await expect(shell.getByRole("heading", { name: "Settings" })).toBeHidden();

    // The server goes away: an error screen, then back with Try again.
    await server.stop();
    await page.evaluate(() => location.reload());
    const unavailable = shell.getByRole("heading", {
      name: "Harborline Freight is not available",
    });
    await expect(unavailable).toBeVisible();
    await expect(
      shell.getByText(`${server.host} refused the connection.`),
    ).toBeVisible();
    await expect(
      shell.getByText("Details: ERR_CONNECTION_REFUSED"),
    ).toBeVisible();
    await axe(shell, "server not available");
    await server.start();
    await shell.getByRole("button", { name: "Try again" }).click();
    await expect(unavailable).toBeHidden();
    await expect(page.locator("#bridge")).toContainText("bridge:");

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
