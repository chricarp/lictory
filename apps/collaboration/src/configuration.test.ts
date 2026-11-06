import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The real entry point, in a directory without an .env file, so nothing but
// this environment configures it.
void test("the collaboration service refuses to start with every configuration problem listed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lictory-collaboration-config-"));
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
          COLLABORATION_PORT: "websocket",
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Lictory collaboration cannot start: 4 configuration problems/,
    );
    for (const name of [
      "DATABASE_URL is required",
      "PLATFORM_URL is required in production",
      "BETTER_AUTH_SECRET is a placeholder",
      'COLLABORATION_PORT must be a whole number, got "websocket"',
    ])
      assert.ok(result.stderr.includes(name), name);
    assert.ok(!result.stderr.includes("change-before-production"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
