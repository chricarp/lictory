import { resolve } from "node:path";
import { clientAssets } from "@lictory/core/release/clients";

// Checks a complete set of client downloads of one version, as the release
// publishing job does before signing (`bun run release clients`), without a
// release plan and without writing SHA256SUMS. Release clients runs it on
// every build, so pull requests prove the set a release will publish.
//
//   bun scripts/check-client-downloads.ts <directory> <version>
const [directory, version, ...extra] = process.argv.slice(2);
if (!directory || !version || extra.length)
  throw new Error(
    "Usage: bun scripts/check-client-downloads.ts <directory> <version>",
  );
const assets = await clientAssets(resolve(directory), version, false);
console.log(
  `${assets.length} client downloads of ${version}:\n${assets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n")}`,
);
