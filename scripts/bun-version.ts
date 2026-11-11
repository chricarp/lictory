// Compares the running Bun with the release `packageManager` pins. Bun does
// not enforce `engines` and `bun install` accepts any release, so
// `scripts/check-toolchain.ts` (the first step of `bun run check`) and
// `bun run dev` report a mismatch themselves.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { packageManager: string };
const bunWanted = manifest.packageManager.replace(/^bun@/, "");
export const bunHave = process.versions.bun ?? "";

const minor = (version: string) => version.split(".").slice(0, 2).join(".");
const install = `curl -fsSL https://bun.sh/install | bash -s "bun-v${bunWanted}"`;

// A different minor release can change test runner and module semantics
// (`severe`); a different patch rarely matters but explains results that
// differ from CI.
export function bunMismatch():
  { severe: boolean; message: string } | undefined {
  if (bunHave === bunWanted) return undefined;
  if (minor(bunHave) !== minor(bunWanted))
    return {
      severe: true,
      message: `Bun ${bunHave} is installed; this repository uses ${bunWanted}. Install it with \`${install}\`.`,
    };
  return {
    severe: false,
    message: `Bun ${bunHave} is installed; CI uses ${bunWanted}. If a result differs from CI, install it first: \`${install}\`.`,
  };
}
