import { build } from "esbuild";

// Bundles the collaboration service and the workspace sources it imports
// into one ESM file for Node 24. npm dependencies stay external and resolve
// from node_modules (the API image traces them).
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
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
