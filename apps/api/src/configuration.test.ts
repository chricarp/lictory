import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The real entry point, in a directory without an .env file, so nothing but
// this environment configures it.
void test("the API refuses to start in production with every configuration problem listed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lictory-api-config-"));
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
          BETTER_AUTH_SECRET:
            "local-development-secret-change-before-production",
          ZERO_QUERY_API_KEY: "short-zero-key",
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Lictory api cannot start: 5 configuration problems/,
    );
    for (const name of [
      "DATABASE_URL is required",
      "PLATFORM_URL is required in production",
      "BETTER_AUTH_SECRET is a placeholder",
      "ZERO_QUERY_API_KEY is shorter than 32 bytes",
      "ZERO_MUTATE_API_KEY is required in production",
    ])
      assert.ok(result.stderr.includes(name), name);
    // Without a mail transport the API warns rather than refusing to start.
    assert.match(result.stderr, /config\.warning.*Email is not configured/);
    assert.ok(!result.stderr.includes("short-zero-key"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
