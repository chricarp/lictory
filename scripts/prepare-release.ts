import { readFile, writeFile } from "node:fs/promises";
import { nextVersion, prepareChangelog } from "../src/release/version";

const [kind, flag, ...extra] = process.argv.slice(2);
try {
  if (!kind || (flag && flag !== "--dry-run") || extra.length) {
    throw new Error(
      "Usage: bun run release:prepare <major|minor|patch|hotfix> [--dry-run]",
    );
  }
  const packagePath = new URL("../package.json", import.meta.url);
  const changelogPath = new URL("../CHANGELOG.md", import.meta.url);
  const original = await readFile(packagePath, "utf8");
  const manifest = JSON.parse(original) as { version: string };
  const version = nextVersion(manifest.version, kind);
  const changelog = prepareChangelog(
    await readFile(changelogPath, "utf8"),
    version,
    new Date().toISOString().slice(0, 10),
  );
  console.log(`${manifest.version} → ${version} (${kind})`);
  if (flag === "--dry-run") {
    console.log("Dry run: no files changed.");
  } else {
    manifest.version = version;
    await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(changelogPath, changelog);
    console.log(
      `Updated package.json and CHANGELOG.md. Review and commit them together.`,
    );
    console.log(
      `After verification and merge, tag the release commit: git tag -a v${version} -m "Lictory ${version}"`,
    );
    console.log(`Publish when ready: git push origin v${version}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
