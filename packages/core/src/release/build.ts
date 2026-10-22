import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertBuildVersion } from "@lictory/core/release/version";

export async function injectVersion(
  root: string,
  version: string,
): Promise<void> {
  assertBuildVersion(version);
  const path = join(root, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as {
    name: string;
    version: string;
  };
  if (manifest.name !== "lictory")
    throw new Error(
      "Version injection must target the Lictory source checkout.",
    );
  manifest.version = version;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
