import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

// Builds the desktop app into dist/ with esbuild, the bundler the API, worker
// and collaboration service already use (see docs/internals/desktop.md):
//
//   dist/main.cjs           main process (electron-updater bundled in, so the
//                           package needs no node_modules)
//   dist/preload-web.cjs    the desktop bridge for servers' pages
//   dist/preload-shell.cjs  the shell page's access to the main process
//   dist/shell/             the shell page (HTML, script, styles, font)
//   dist/assets/            icons the main process loads at run time
//
// Sandboxed preloads can require only `electron`, so each is one bundle.
// `--dev` keeps the output readable.
const dev = process.argv.includes("--dev");
const require = createRequire(import.meta.url);
const dist = "dist";

await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/shell`, { recursive: true });
await mkdir(`${dist}/assets`, { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  tsconfig: "tsconfig.json",
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  legalComments: "none",
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: { main: "src/main/index.ts" },
    outdir: dist,
    outExtension: { ".js": ".cjs" },
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: {
      "preload-web": "src/preload/web.ts",
      "preload-shell": "src/preload/shell.ts",
    },
    outdir: dist,
    outExtension: { ".js": ".cjs" },
    platform: "node",
    target: "chrome140",
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: { shell: "src/renderer/shell.ts" },
    outdir: `${dist}/shell`,
    platform: "browser",
    target: "chrome140",
    format: "iife",
  }),
]);

// Static specifiers, so the dependency checker sees them used.
const font = path.join(
  path.dirname(require.resolve("@fontsource-variable/geist/package.json")),
  "files/geist-latin-wght-normal.woff2",
);
const monoFont = path.join(
  path.dirname(require.resolve("@fontsource-variable/geist-mono/package.json")),
  "files/geist-mono-latin-wght-normal.woff2",
);
await Promise.all([
  cp("src/renderer/index.html", `${dist}/shell/index.html`),
  cp("src/renderer/shell.css", `${dist}/shell/shell.css`),
  cp(font, `${dist}/shell/geist-latin-wght-normal.woff2`),
  cp(monoFont, `${dist}/shell/geist-mono-latin-wght-normal.woff2`),
  cp("static/tray.png", `${dist}/assets/tray.png`),
  cp("static/trayTemplate.png", `${dist}/assets/trayTemplate.png`),
  cp("static/trayTemplate@2x.png", `${dist}/assets/trayTemplate@2x.png`),
  cp("static/icon.png", `${dist}/assets/icon.png`),
]);
