import assert from "node:assert/strict";
import { test } from "node:test";
import {
  badgeLabel,
  renderBadge,
  sanitizeCount,
  totalCount,
  unreadSummary,
  withUnreadDot,
} from "./badge";
import {
  createRateLimiter,
  sanitizeNotification,
  shouldShowNotification,
} from "./notifications";
import {
  autostartEntry,
  defaultSettings,
  normalizeSettings,
  patchSettings,
} from "./settings";
import { normalizeWindowState, restoreBounds } from "./window-state";

void test("a page's notification is validated and shortened", () => {
  assert.deepEqual(
    sanitizeNotification({
      title: "  Ana requested Engineering review of PAY-142 ",
      body: "Retry failed payments",
      path: "/acme/items/PAY-142",
      tag: "n-1",
    }),
    {
      title: "Ana requested Engineering review of PAY-142",
      body: "Retry failed payments",
      path: "/acme/items/PAY-142",
      tag: "n-1",
    },
  );
  const long = sanitizeNotification({
    title: "x".repeat(500),
    body: 7,
    path: "https://evil.example/x",
  });
  assert.equal(long?.title.length, 120);
  assert.ok(long?.title.endsWith("…"));
  assert.equal(long?.body, "");
  assert.equal(long?.path, null);
  assert.equal(sanitizeNotification({ title: "  " }), null);
  assert.equal(sanitizeNotification("hello"), null);
  assert.equal(sanitizeNotification({ title: "a\u0007b" })?.title, "ab");
});

void test("notifications interrupt unless their page is the one in front", () => {
  const base = {
    enabled: true,
    windowFocused: true,
    activeServerId: "a",
    serverId: "a",
    activePath: "/acme/channels/c1",
    path: "/acme/items/PAY-142",
  };
  // Working in the app on the same server: a review request still shows.
  assert.equal(shouldShowNotification(base), true);
  // Already on the page it opens (a thread or tab of it counts): not repeated.
  assert.equal(
    shouldShowNotification({ ...base, activePath: "/acme/items/PAY-142" }),
    false,
  );
  assert.equal(
    shouldShowNotification({
      ...base,
      activePath: "/acme/items/PAY-142/",
      path: "/acme/items/PAY-142?tab=reviews",
    }),
    false,
  );
  // The same page of another server, or the window in the background.
  assert.equal(
    shouldShowNotification({
      ...base,
      serverId: "b",
      activePath: base.path,
    }),
    true,
  );
  assert.equal(
    shouldShowNotification({
      ...base,
      windowFocused: false,
      activePath: base.path,
    }),
    true,
  );
  // A notification without a page cannot be the page in front.
  assert.equal(shouldShowNotification({ ...base, path: null }), true);
  assert.equal(shouldShowNotification({ ...base, enabled: false }), false);
});

void test("a page cannot flood the notification centre", () => {
  const allow = createRateLimiter(2, 1000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 10), true);
  assert.equal(allow("a", 20), false);
  assert.equal(allow("b", 20), true);
  assert.equal(allow("a", 1001), true);
});

void test("badge counts add up across servers and read well", () => {
  assert.equal(sanitizeCount(3.7), 3);
  assert.equal(sanitizeCount(-1), 0);
  assert.equal(sanitizeCount(Number.NaN), 0);
  assert.equal(sanitizeCount("4"), 0);
  assert.equal(sanitizeCount(1e9), 9999);
  assert.equal(
    totalCount(
      new Map([
        ["a", 2],
        ["b", 5],
      ]),
    ),
    7,
  );
  assert.equal(badgeLabel(0), "");
  assert.equal(badgeLabel(7), "7");
  assert.equal(badgeLabel(120), "99+");
  assert.equal(unreadSummary(1), "1 unread notification");
  assert.equal(unreadSummary(0), "No unread notifications");
});

void test("the overlay badge is a red disc with white digits", () => {
  const size = 32;
  const empty = renderBadge(0, size);
  assert.equal(
    empty.every((v) => v === 0),
    true,
  );
  const pixels = renderBadge(3, size);
  const at = (x: number, y: number) => [
    ...pixels.slice((y * size + x) * 4, (y * size + x) * 4 + 4),
  ];
  // Corners stay transparent, the edge of the disc is red (BGRA).
  assert.deepEqual(at(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(16, 2), [0x4d, 0x48, 0xe5, 0xff]);
  // The digit is drawn in white somewhere in the middle.
  let white = 0;
  for (let y = 8; y < 24; y++)
    for (let x = 8; x < 24; x++) if (at(x, y).every((v) => v === 0xff)) white++;
  assert.ok(white > 10);
  assert.notDeepEqual(renderBadge(12, size), renderBadge(3, size));
  // Every count above nine reads "9+".
  assert.deepEqual(renderBadge(12, size), renderBadge(400, size));
});

void test("the tray icon gets an unread dot in its corner", () => {
  const icon = new Uint8Array(16 * 16 * 4);
  const dotted = withUnreadDot(icon, 16, 16);
  assert.equal(
    icon.every((v) => v === 0),
    true,
    "the original is untouched",
  );
  const corner = (15 - 2) * 4 + 2 * 16 * 4;
  assert.equal(dotted[corner + 3], 0xff);
  assert.equal(dotted[15 * 16 * 4 + 3], 0, "bottom left stays clear");
});

void test("settings keep their defaults and known keys only", () => {
  assert.deepEqual(normalizeSettings(undefined), defaultSettings);
  const settings = normalizeSettings({
    notifications: false,
    closeToTray: "yes",
    runner: { serverId: "aaaaaaaa-1", startWithApp: true },
    secret: "x",
  });
  assert.equal(settings.notifications, false);
  assert.equal(settings.closeToTray, true);
  assert.deepEqual(settings.runner, {
    serverId: "aaaaaaaa-1",
    startWithApp: true,
  });
  assert.equal("secret" in settings, false);
  const patched = patchSettings(settings, {
    launchAtLogin: true,
    runner: { startWithApp: false },
  });
  assert.equal(patched.launchAtLogin, true);
  assert.deepEqual(patched.runner, {
    serverId: "aaaaaaaa-1",
    startWithApp: false,
  });
  assert.deepEqual(patchSettings(settings, "nope"), settings);
});

void test("the Linux autostart entry quotes the executable", () => {
  assert.match(
    autostartEntry("/usr/bin/lictory"),
    /^Exec=\/usr\/bin\/lictory --hidden$/m,
  );
  assert.match(
    autostartEntry("/home/ana/Apps/Lictory 1.0.AppImage"),
    /^Exec="\/home\/ana\/Apps\/Lictory 1\.0\.AppImage" --hidden$/m,
  );
});

void test("the window reopens where it was while that place is visible", () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1050 },
    { x: 1920, y: 0, width: 1440, height: 900 },
  ];
  const saved = normalizeWindowState({
    x: 2000,
    y: 100,
    width: 1200,
    height: 800,
    maximized: true,
  });
  assert.deepEqual(restoreBounds(saved, displays), {
    x: 2000,
    y: 100,
    width: 1200,
    height: 800,
    maximized: true,
    fullScreen: false,
  });
  // The second display is gone: centred on the primary one.
  assert.deepEqual(restoreBounds(saved, displays.slice(0, 1)), {
    x: 360,
    y: 125,
    width: 1200,
    height: 800,
    maximized: true,
    fullScreen: false,
  });
  // Larger than the display it is on: shrunk to fit.
  const huge = normalizeWindowState({ x: 0, y: 0, width: 4000, height: 3000 });
  const fitted = restoreBounds(huge, displays.slice(0, 1));
  assert.equal(fitted.width, 1920);
  assert.equal(fitted.height, 1050);
  assert.equal(normalizeWindowState({ x: "1" }), null);
  assert.equal(
    normalizeWindowState({ x: 0, y: 0, width: 10, height: 10 })?.width,
    720,
  );
  assert.equal(restoreBounds(null, displays).width, 1280);
});
