// `bun run db:generate` (and `db:generate:data`): drizzle-kit generate, then
// Prettier on the journal and snapshots it wrote. drizzle-kit writes JSON in
// its own layout, which `bun run check` (prettier --check) refuses, so a
// first schema change would otherwise fail the gate until formatted by hand.
// Arguments are passed to drizzle-kit (`-- --name=<change>`, `--custom`).
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((arg) => arg !== "--");

const run = (commandArgs: string[]) =>
  spawnSync("bunx", commandArgs, { stdio: "inherit" }).status ?? 1;

const generated = run(["drizzle-kit", "generate", ...args]);
// The SQL is left as drizzle-kit wrote it: Prettier has no SQL parser here.
process.exitCode =
  generated || run(["prettier", "--write", "--log-level=warn", "drizzle/meta"]);
