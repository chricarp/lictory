import { build } from "esbuild";

// Bundles the API and the workspace sources it imports into one ESM file for
// Node 24. npm dependencies stay external (native modules such as sharp and
// @firecrawl/anydoc cannot be bundled) and resolve from node_modules.
// admin.js is the server command line for instance administration
// (src/admin-cli.ts), run by `lictory admin` inside the API container.
// An output directory argument builds elsewhere (production-environment test).
await build({
  entryPoints: { index: "src/index.ts", admin: "src/admin-cli.ts" },
  outdir: process.argv[2] ?? "dist",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  tsconfig: "tsconfig.json",
  jsx: "automatic",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
});
