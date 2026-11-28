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

// Tab from the top of the shell page: each stop is named, shows a focus ring,
// and the stops listed come in this order (others may sit between them).
async function expectNamedTabStops(page: Page, expected: RegExp[]) {
  // Sequential focus starts from a temporary point before everything else.
  await page.evaluate(() => {
    const start = document.createElement("span");
    start.id = "tab-trail-start";
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
  });
  const names: string[] = [];
  for (let press = 0; press < 12; press++) {
    await page.keyboard.press("Tab");
    if (press === 0)
      await page.evaluate(() =>
        document.getElementById("tab-trail-start")?.remove(),
      );
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const label =
        el.getAttribute("aria-label") ??
        (el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : null) ??
        el.textContent ??
        "";
      const style = getComputedStyle(el);
      return {
        name: label.trim(),
        ring: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
      };
    });
    if (!stop || names.includes(stop.name)) break;
    expect(stop.name, "every Tab stop has a name").not.toBe("");
    expect(stop.ring, `${stop.name} shows where focus is`).toBe(true);
    names.push(stop.name);
  }
  let from = 0;
  for (const name of expected) {
    const at = names.findIndex((n, i) => i >= from && name.test(n));
    expect(at, `${name} in the Tab order ${names.join(" → ")}`).not.toBe(-1);
    from = at + 1;
  }
}

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
    // No servers yet, so no rail: the address field, then Connect.
    await expectNamedTabStops(shell, [/^Server address$/, /^Connect$/]);

    // An address that is not a server, then the fake Lictory server.
    const address = shell.getByLabel("Server address");
    await address.fill("ftp://lictory.example.com");
    await shell.getByRole("button", { name: "Connect" }).click();
    await expect(shell.getByRole("alert")).toHaveText(
      "A Lictory server address starts with https:// (or http://), not ftp://.",
    );
    await address.fill("http://127.0.0.1:1");
    await shell.getByRole("button", { name: "Connect" }).click();
    // Plain words and the next step; Chromium's code only as a detail.
    await expect(shell.getByRole("alert")).toHaveText(
      "127.0.0.1:1 uses a blocked port. Use the address you open Lictory at in your browser, usually without a port.",
    );
    await expect(shell.getByText("Details: ERR_UNSAFE_PORT")).toBeVisible();
    // In the product's code face, bundled like the text face.
    await expect
      .poll(() =>
        shell.evaluate(() =>
          [...document.fonts].some(
            (f) => f.family === "Geist Mono" && f.status === "loaded",
          ),
        ),
      )
      .toBe(true);
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
    // Slim scrollbars in the app's colors, not a browser's classic ones
    // (macOS keeps its overlay scrollbars).
    if (process.platform !== "darwin")
      await expect
        .poll(() =>
          page.evaluate(
            () => getComputedStyle(document.documentElement).scrollbarColor,
          ),
        )
        .not.toBe("auto");

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
    // Read out as the initials shown, the name and the badge in words.
    await expect(named).toHaveAccessibleName(
      /^HF Harborline Freight, 3 unread/,
    );
    await axe(shell, "server rail with a named server and its badge");
    await expectNamedTabStops(shell, [
      /^HF Harborline Freight, 3 unread/,
      /^Add a server$/,
      /^Settings$/,
    ]);

    // The View menu lists each command once; ⌘+ is a hidden alias of ⌘=.
    const viewMenu = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "View")
        ?.submenu?.items.filter((item) => item.visible && item.label)
        .map((item) => item.label),
    );
    expect(viewMenu?.filter((label) => label === "Zoom In")).toHaveLength(1);

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
    // Back can act now: its arrow is drawn in the text color (3:1 or more
    // on the bar), unlike a disabled one.
    const back = shell.getByRole("button", { name: "Back" });
    await expect(back).toBeEnabled();
    await expect(back).toHaveCSS(
      "color",
      /^rgb\((17, 18, 20|236, 238, 241)\)$/,
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
    // The top bar names the server, not Chromium's error page's address.
    await expect(shell.locator(".topbar-page")).toHaveText(
      "Harborline Freight",
    );
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
