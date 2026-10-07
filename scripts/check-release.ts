import { readFile } from "node:fs/promises";
import { releaseNotes } from "../src/release/version";

try {
  const [tag, ...extra] = process.argv.slice(2);
  if (!tag || extra.length)
    throw new Error("Usage: bun run release:check v<major.minor.patch>");
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  console.log(
    releaseNotes(
      manifest.version,
      tag,
      await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
