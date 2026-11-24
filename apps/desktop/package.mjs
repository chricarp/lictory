// Packages the built app (dist/) with electron-builder, for one platform per
// run, the way a release job runs one per operating system:
//
//   node package.mjs --linux [AppImage deb] [--arch x64,arm64]
//   node package.mjs --mac   [dmg zip]      [--arch universal]
//   node package.mjs --win   [nsis]         [--arch x64,arm64]
//
// Nothing is ever published from here (`publish: "never"`); the `publish`
// setting only writes app-update.yml so installed apps know where to look.
// Signing and notarization use electron-builder's standard environment
// variables when they are present and are skipped otherwise; the build then
// records that it is unsigned, and such a build does not update itself (see
// src/main/updater.ts and docs/internals/desktop.md).
import { readFileSync } from "node:fs";
import { Arch, build, Platform } from "electron-builder";

const argv = process.argv.slice(2);
const platformFlag = ["--mac", "--win", "--linux"].find((f) =>
  argv.includes(f),
);
const platform =
  platformFlag === "--mac"
    ? Platform.MAC
    : platformFlag === "--win"
      ? Platform.WINDOWS
      : platformFlag === "--linux"
        ? Platform.LINUX
        : Platform.current();
const archIndex = argv.indexOf("--arch");
const archNames = archIndex >= 0 ? (argv[archIndex + 1] ?? "").split(",") : [];
const targetNames = argv.filter(
  (arg, i) => !arg.startsWith("--") && (archIndex < 0 || i !== archIndex + 1),
);

const env = process.env;
// One product version: the repository's, which release builds set with
// scripts/inject-release-version.ts.
const version = /** @type {{ version: string }} */ (
  JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  )
).version;
/** @param {string[]} names */
const has = (...names) => names.every((name) => !!env[name]);
const macSigned = has("CSC_LINK") || has("CSC_NAME");
const macNotarized =
  macSigned &&
  (has("APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID") ||
    has("APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"));
const winSigned = has("WIN_CSC_LINK") || has("CSC_LINK");
// Whether this build may update itself: only a signed (and on macOS
// notarized) build. Linux AppImages are checked against the release's
// SHA-512 instead.
const updatable =
  platform === Platform.MAC
    ? macNotarized
    : platform === Platform.WINDOWS
      ? winSigned
      : true;

/** @type {import("electron-builder").Configuration} */
const config = {
  appId: "com.lictory.desktop",
  productName: "Lictory",
  copyright: "Copyright © Lictory contributors. MIT License.",
  directories: { output: "out", buildResources: "static" },
  // Everything the app runs is bundled into dist/; no node_modules ship.
  files: ["dist/**", "package.json"],
  asar: true,
  extraMetadata: {
    main: "dist/main.cjs",
    version,
    // The window's WM_CLASS / app id, matching the installed .desktop file.
    desktopName: "lictory.desktop",
    lictory: { updatable },
  },
  // The static AppImage runtime: runs without libfuse2 (absent from current
  // Ubuntu and Fedora) and links nothing from the system.
  toolsets: { appimage: "1.0.3" },
  protocols: [{ name: "Lictory link", schemes: ["lictory"] }],
  // Hardening of the Electron binary itself (@electron/fuses).
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  publish: [
    {
      provider: "github",
      owner: "chricarp",
      repo: "lictory",
      releaseType: "release",
    },
  ],
  mac: {
    category: "public.app-category.productivity",
    target: [
      { target: "dmg", arch: ["universal"] },
      { target: "zip", arch: ["universal"] },
    ],
    hardenedRuntime: true,
    entitlements: "static/entitlements.mac.plist",
    entitlementsInherit: "static/entitlements.mac.plist",
    // Without a certificate the app is left unsigned rather than signed
    // with whatever identity the build machine's keychain holds.
    ...(macSigned ? {} : { identity: null }),
    notarize: macNotarized,
    extendInfo: {
      NSMicrophoneUsageDescription:
        "A Lictory server you use asks for the microphone, for example for a call.",
      NSCameraUsageDescription:
        "A Lictory server you use asks for the camera, for example for a call.",
    },
  },
  dmg: { writeUpdateInfo: false },
  win: {
    target: [{ target: "nsis", arch: ["x64", "arm64"] }],
  },
  nsis: {
    // Per-user install without administrator rights, like Slack.
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    shortcutName: "Lictory",
  },
  linux: {
    target: [
      { target: "AppImage", arch: ["x64", "arm64"] },
      { target: "deb", arch: ["x64", "arm64"] },
    ],
    category: "Office",
    executableName: "lictory",
    synopsis: "Lictory desktop app",
    description:
      "The Lictory desktop app: your team's Lictory servers with native notifications, a badge and lictory:// links.",
    maintainer: "Lictory contributors",
    vendor: "Lictory",
    syncDesktopName: true,
  },
};

const arch = archNames.filter(Boolean).map((name) => {
  const value = Arch[/** @type {keyof typeof Arch} */ (name)];
  if (value === undefined) throw new Error(`Unknown architecture ${name}.`);
  return value;
});

const outputs = await build({
  targets: platform.createTarget(
    targetNames.length ? targetNames : null,
    ...arch,
  ),
  config,
  publish: "never",
});
console.log(
  `Packaged (${updatable ? "updates itself" : "does not update itself"}):\n${outputs.join("\n")}`,
);
