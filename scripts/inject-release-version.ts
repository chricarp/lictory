import { injectVersion } from "@lictory/core/release/build";

const [version, ...extra] = process.argv.slice(2);
if (!version || extra.length)
  throw new Error("Supply one stable or nightly release version.");
await injectVersion(process.cwd(), version);
