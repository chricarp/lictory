// Builds single-file `lictory-runner` binaries with `bun build --compile`.
//
//   bun scripts/build.ts                 every target
//   bun scripts/build.ts linux-x64       some targets
//
// Output: apps/runner/dist/lictory-runner-<os>-<arch>[.exe]
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const targets = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
] as const;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv.slice(2);
const chosen = requested.length
  ? targets.filter((t) => requested.includes(t))
  : [...targets];
if (requested.length && chosen.length !== requested.length) {
  console.error(`Unknown target. Choose from: ${targets.join(", ")}`);
  process.exit(1);
}
mkdirSync(join(root, "dist"), { recursive: true });
for (const target of chosen) {
  const outfile = join(
    root,
    "dist",
    `lictory-runner-${target}${target.startsWith("windows") ? ".exe" : ""}`,
  );
  const result = spawnSync(
    "bun",
    [
      "build",
      "--compile",
      "--minify",
      "--sourcemap",
      `--target=bun-${target}`,
      join(root, "src", "cli.ts"),
      "--outfile",
      outfile,
    ],
    { stdio: "inherit", cwd: root },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Built ${outfile}`);
}
