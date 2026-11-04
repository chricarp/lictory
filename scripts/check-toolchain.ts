// The first step of `bun run check`: confirms this machine has the tools the
// verification sequence relies on before spending minutes on it, so a
// contributor (or their agent) gets one actionable message instead of a
// failure deep inside a test that looks like a product defect.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { packageManager: string; engines: { node: string } };
const bunWanted = manifest.packageManager.replace(/^bun@/, "");
const nodeMajor = manifest.engines.node.replace(/\.x$/, "");

const problems: string[] = [];
const warnings: string[] = [];
const minor = (version: string) => version.split(".").slice(0, 2).join(".");

// Bun runs every command and the domain tests. A different minor release can
// change test runner and module semantics; a different patch rarely matters
// but is worth knowing when a result differs from CI.
const bunHave = process.versions.bun ?? "";
if (minor(bunHave) !== minor(bunWanted))
  problems.push(
    `Bun ${bunHave} is installed; this repository uses ${bunWanted}. Install it with \`curl -fsSL https://bun.sh/install | bash -s "bun-v${bunWanted}"\`.`,
  );
else if (bunHave !== bunWanted)
  warnings.push(
    `Bun ${bunHave} is installed; CI uses ${bunWanted}. If a result differs from CI, install it first: \`curl -fsSL https://bun.sh/install | bash -s "bun-v${bunWanted}"\`.`,
  );

// Node runs workspace builds and Zero's native SQLite module.
const node = spawnSync("node", ["--version"], { encoding: "utf8" });
const nodeHave = node.status === 0 ? node.stdout.trim().replace(/^v/, "") : "";
if (!nodeHave)
  problems.push(`Node.js ${nodeMajor} is required and \`node\` was not found.`);
else if (nodeHave.split(".")[0] !== nodeMajor)
  problems.push(
    `Node.js ${nodeHave} is installed; this repository uses Node.js ${nodeMajor} (see .nvmrc).`,
  );

// The deployment tooling the release tests run for real (the tests stub
// Docker, curl and the network, not these).
for (const tool of ["jq", "openssl"]) {
  const found = spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0;
  if (!found)
    problems.push(
      `\`${tool}\` was not found. The release tests run the deployment scripts, which need it: install it with your package manager (for example \`apt-get install ${tool}\` or \`brew install ${tool}\`).`,
    );
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (problems.length) {
  for (const problem of problems) console.error(`error: ${problem}`);
  console.error(
    "See docs/operations/development.md#first-checkout for the requirements.",
  );
  process.exit(1);
}
console.log(`Toolchain: Bun ${bunHave}, Node.js ${nodeHave}, jq, openssl.`);
