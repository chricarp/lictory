import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

void test("the release key accepts registry credentials only on stdin and only for GHCR", () => {
  const dir = mkdtempSync(join(tmpdir(), "lictory-registry-transport-"));
  try {
    writeFileSync(
      join(dir, "docker"),
      '#!/bin/sh\n[ "$1" = login ] || exit 80\n[ "$2" = ghcr.io ] || exit 81\n[ "$3" = --username ] || exit 82\n[ "$4" = chricarp ] || exit 83\n[ "$5" = --password-stdin ] || exit 84\nIFS= read -r password\n[ "$password" = test-only-token ] || exit 85\n',
      { mode: 0o700 },
    );
    const run = (command: string, input: string) =>
      spawnSync("bash", ["deploy/bin/lictory-remote"], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          SSH_ORIGINAL_COMMAND: command,
        },
        input,
        encoding: "utf8",
      });
    const accepted = run(
      "production registry-login",
      "chricarp\ntest-only-token\n",
    );
    assert.equal(accepted.status, 0);
    assert.ok(!accepted.stdout.includes("test-only-token"));
    assert.equal(
      run("production registry-login extra", "chricarp\ntest-only-token\n")
        .status,
      64,
    );
    assert.equal(
      run("production registry-login", "--password-stdin\ntest-only-token\n")
        .status,
      64,
    );
    assert.equal(
      run(
        "production registry-login",
        "chricarp;echo injected\ntest-only-token\n",
      ).status,
      64,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
