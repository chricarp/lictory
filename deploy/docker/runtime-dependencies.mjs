// Writes the runtime package.json for the API/worker image: exactly the npm
// packages the esbuild bundles leave external (native or deliberately
// unbundled), pinned to the versions the workspace lockfile installed.
// Usage: node deploy/docker/runtime-dependencies.mjs <out.json> <dist-dir>...
import { builtinModules } from "node:module";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [out, ...dists] = process.argv.slice(2);
if (!out || !dists.length) {
  console.error("Usage: runtime-dependencies.mjs <out.json> <dist-dir>...");
  process.exit(64);
}

// Always present even if a bundle only reaches them through a dynamic import.
const declared = (
  process.env.RUNTIME_EXTERNALS ?? "sharp @firecrawl/anydoc postgres"
)
  .split(/\s+/)
  .filter(Boolean);
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const specifier =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"'./][^"']*)["']/gm;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(m?js|cjs)$/.test(entry.name) ? [path] : [];
  });
}

const packages = new Set(declared);
for (const dist of dists)
  for (const file of files(dist))
    for (const [, name] of readFileSync(file, "utf8").matchAll(specifier)) {
      if (builtins.has(name) || name.startsWith("node:")) continue;
      const parts = name.split("/");
      packages.add(
        name.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0],
      );
    }

// The workspace uses Bun's hoisted linker: every package is in ./node_modules.
const dependencies = {};
for (const name of [...packages].sort()) {
  let version;
  try {
    version = JSON.parse(
      readFileSync(resolve("node_modules", name, "package.json"), "utf8"),
    ).version;
  } catch {
    console.error(
      `The bundles import "${name}", which is not installed in the workspace. Bundle it or add it as a pinned dependency.`,
    );
    process.exit(1);
  }
  dependencies[name] = version;
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ name: "lictory-runtime", private: true, type: "module", dependencies }, null, 2)}\n`,
);
console.log(`Runtime dependencies: ${JSON.stringify(dependencies)}`);
