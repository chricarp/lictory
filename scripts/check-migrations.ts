// Fails when src/db/schema.ts has changes without a committed migration.
// Generates into a temporary copy so the working tree is never modified.
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const scratch = await mkdtemp(join(tmpdir(), "lictory-migration-check-"));
try {
  const out = join(scratch, "drizzle");
  await cp("drizzle", out, { recursive: true });
  const before = new Set(await readdir(out));
  const result = spawnSync(
    "bunx",
    [
      "drizzle-kit",
      "generate",
      "--dialect=postgresql",
      "--schema=./src/db/schema.ts",
      // drizzle-kit mishandles absolute output paths.
      `--out=${relative(process.cwd(), out)}`,
      "--name=uncommitted_schema_change",
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (result.status !== 0 || /Error|ENOENT/.test(result.stderr)) {
    console.error(result.stdout, result.stderr);
    throw new Error("drizzle-kit generate failed during the migration check.");
  }
  const added = (await readdir(out)).filter((name) => !before.has(name));
  if (added.length) {
    console.error(
      "src/db/schema.ts has changes that are not captured by a committed migration.\n" +
        "Run `bun run db:generate -- --name=<change>`, review the SQL and commit it.",
    );
    process.exitCode = 1;
  } else {
    console.log("Committed migrations match src/db/schema.ts.");
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
