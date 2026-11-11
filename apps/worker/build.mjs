import { build } from "esbuild";

// Bundles the worker and the workspace sources it imports into one ESM file
// for Node 24. npm dependencies stay external and resolve from node_modules.
// An output directory argument builds elsewhere (production-environment test).
await build({
  entryPoints: ["src/index.ts"],
  outfile: `${process.argv[2] ?? "dist"}/index.js`,
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
