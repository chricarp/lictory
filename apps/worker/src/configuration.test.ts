import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The real entry point, in a directory without an .env file, so nothing but
// this environment configures it.
void test("the worker refuses to start with every configuration problem listed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lictory-worker-config-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--no-env-file", fileURLToPath(new URL("./index.ts", import.meta.url))],
      {
        cwd,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          WORKER_DB_POOL_MAX: "0",
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Lictory worker cannot start: 3 configuration problems/,
    );
    for (const name of [
      "DATABASE_URL is required",
      "PLATFORM_URL is required in production",
      "WORKER_DB_POOL_MAX must be a whole number of at least 1",
    ])
      assert.ok(result.stderr.includes(name), name);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
