import assert from "node:assert/strict";
import { test } from "node:test";

import { latestDesktopInstallers } from "@lictory/core/release/downloads";
import {
  desktopDownloads,
  isPublished,
  otherSystems,
  primaryDownload,
  releaseFiles,
} from "@lictory/marketing/content/downloads";
import {
  detectSystem,
  type BrowserHints,
} from "@lictory/marketing/lib/download-platform";

// User-Agent strings as current browsers send them (Chromium's are reduced:
// fixed OS versions, and always x86_64 on Linux and x64 on Windows).
const ua = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  firefoxMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:145.0) Gecko/20100101 Firefox/145.0",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  firefoxWindowsArm:
    "Mozilla/5.0 (Windows NT 10.0; ARM64; rv:145.0) Gecko/20100101 Firefox/145.0",
  chromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  firefoxLinuxArm:
    "Mozilla/5.0 (X11; Linux aarch64; rv:145.0) Gecko/20100101 Firefox/145.0",
  firefoxUbuntu:
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
};

const primary = (hints: BrowserHints) =>
  primaryDownload(detectSystem(hints))?.id ?? null;

void test("a Mac gets the universal app, whatever its processor reports", () => {
  // Safari and Firefox report "MacIntel" on Apple silicon too.
  for (const userAgent of [ua.safariMac, ua.firefoxMac])
    assert.deepEqual(detectSystem({ userAgent, platform: "MacIntel" }), {
      kind: "computer",
      os: "macos",
      arch: null,
    });
  assert.equal(
    primary({
      userAgent: ua.chromeMac,
      platform: "MacIntel",
      userAgentData: {
        platform: "macOS",
        mobile: false,
        architecture: "arm",
        bitness: "64",
      },
    }),
    "macos",
  );
});

void test("Windows on x64 and arm64 gets the one installer for both", () => {
  assert.deepEqual(
    detectSystem({ userAgent: ua.chromeWindows, platform: "Win32" }),
    {
      kind: "computer",
      os: "windows",
      arch: "x64",
    },
  );
  // Chromium's string says x64 on arm64; its client hint does not.
  assert.deepEqual(
    detectSystem({
      userAgent: ua.chromeWindows,
      platform: "Win32",
      userAgentData: {
        platform: "Windows",
        mobile: false,
        architecture: "arm",
        bitness: "64",
      },
    }),
    { kind: "computer", os: "windows", arch: "arm64" },
  );
  assert.equal(
    detectSystem({ userAgent: ua.firefoxWindowsArm, platform: "Win32" }).kind,
    "computer",
  );
  assert.equal(primary({ userAgent: ua.firefoxWindowsArm }), "windows");
});

void test("Linux gets the AppImage of its architecture", () => {
  assert.equal(
    primary({ userAgent: ua.chromeLinux, platform: "Linux x86_64" }),
    "linux-x64-appimage",
  );
  assert.equal(primary({ userAgent: ua.firefoxUbuntu }), "linux-x64-appimage");
  assert.equal(
    primary({ userAgent: ua.firefoxLinuxArm, platform: "Linux aarch64" }),
    "linux-arm64-appimage",
  );
  // Chromium on an arm64 Linux machine still sends "x86_64"; the hint wins.
  assert.equal(
    primary({
      userAgent: ua.chromeLinux,
      userAgentData: {
        platform: "Linux",
        mobile: false,
        architecture: "arm",
        bitness: "64",
      },
    }),
    "linux-arm64-appimage",
  );
  // Without any architecture, the common one; the list offers the other.
  assert.deepEqual(detectSystem({ userAgent: "Mozilla/5.0 (X11; Linux)" }), {
    kind: "computer",
    os: "linux",
    arch: null,
  });
  assert.equal(
    primary({ userAgent: "Mozilla/5.0 (X11; Linux)" }),
    "linux-x64-appimage",
  );
});

void test("phones, tablets, Chromebooks and unknown systems get no promoted download", () => {
  assert.deepEqual(
    detectSystem({ userAgent: ua.chromeAndroid, platform: "Linux armv8l" }),
    {
      kind: "mobile",
    },
  );
  assert.deepEqual(
    detectSystem({ userAgent: ua.safariIphone, platform: "iPhone" }),
    {
      kind: "mobile",
    },
  );
  // iPadOS requests desktop sites as a Mac; its touch screen gives it away.
  assert.deepEqual(
    detectSystem({
      userAgent: ua.safariMac,
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    { kind: "mobile" },
  );
  assert.deepEqual(
    detectSystem({
      userAgent: ua.chromeMac,
      userAgentData: { platform: "Android", mobile: false },
    }),
    { kind: "mobile" },
  );
  assert.deepEqual(detectSystem({ userAgent: ua.chromeOs }), {
    kind: "chromeos",
  });
  assert.deepEqual(
    detectSystem({
      userAgent: ua.chromeLinux,
      userAgentData: { platform: "Chrome OS" },
    }),
    { kind: "chromeos" },
  );
  assert.deepEqual(detectSystem({ userAgent: "" }), { kind: "unknown" });
  for (const userAgent of [
    ua.chromeAndroid,
    ua.safariIphone,
    ua.chromeOs,
    "curl/8.5.0",
  ])
    assert.equal(primary({ userAgent }), null, userAgent);
});

void test("every download is the newest stable release's file under its contract name", () => {
  assert.deepEqual(
    desktopDownloads.map((download) => download.file).sort(),
    Object.keys(latestDesktopInstallers).sort(),
  );
  for (const download of desktopDownloads)
    assert.equal(
      download.href,
      `https://github.com/chricarp/lictory/releases/latest/download/${download.file}`,
    );
  const mac = desktopDownloads.find((download) => download.id === "macos")!;
  assert.deepEqual(
    otherSystems(mac).map(({ name, download }) => [name, download.id]),
    [
      ["Windows", "windows"],
      ["Linux", "linux-x64-appimage"],
    ],
  );
});

void test("a file the release does not carry is offered as missing, never as a link that 404s", () => {
  assert.equal(releaseFiles(undefined), null);
  assert.equal(releaseFiles(" , "), null);
  // Without the list (local builds) every file is offered.
  assert.ok(isPublished("Lictory-mac-universal.dmg", null));
  const v026 = releaseFiles("release.env,manifest.json,LICENSE");
  assert.ok(!isPublished("Lictory-mac-universal.dmg", v026));
  assert.ok(!isPublished("lictory-runner-install.sh", v026));
  assert.ok(isPublished("release.env", v026));
});
