// Copies exactly the files the API, worker and collaboration bundles load at
// runtime (npm packages left external, including native binaries installed
// for this platform) from ./node_modules into <out>/node_modules, using the same file
// tracer as Next.js standalone output. Fails if a bundle imports a package
// that is not installed.
// Usage: node deploy/docker/trace-runtime.mjs <out> <entry>...
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { nodeFileTrace } from "@vercel/nft";

const [out, ...entries] = process.argv.slice(2);
if (!out || !entries.length) {
  console.error("Usage: trace-runtime.mjs <out> <entry>...");
  process.exit(64);
}

const { fileList, warnings } = await nodeFileTrace(entries, {
  base: process.cwd(),
  // The sharp and anydoc loaders pick their native package at runtime.
  mixedModules: true,
});
// sharp and anydoc probe builds for other platforms (and WebAssembly); only
// the current platform's binary must exist, which loading it below checks.
const missing = [...warnings].filter(
  (w) =>
    /Cannot find module|Failed to resolve/.test(String(w.message)) &&
    !/node_modules\/(sharp|@firecrawl\/anydoc)\//.test(String(w.message)),
);
for (const warning of missing) console.error(String(warning.message));
let copied = 0;
for (const file of fileList) {
  if (
    !file.startsWith("node_modules/") ||
    file.startsWith("node_modules/@lictory/")
  )
    continue;
  mkdirSync(join(out, dirname(file)), { recursive: true });
  cpSync(file, join(out, file), { dereference: false, recursive: true });
  copied++;
}
console.log(`Traced ${copied} runtime files from node_modules.`);
if (missing.length) process.exit(1);

// The native packages must load from the traced copy on this platform.
const { createRequire } = await import("node:module");
const load = createRequire(join(resolve(out), "index.js"));
for (const name of ["sharp", "@firecrawl/anydoc"]) load(name);
console.log("Native packages load from the traced files.");
