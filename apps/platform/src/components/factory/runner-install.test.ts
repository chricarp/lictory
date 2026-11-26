import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expiresIn,
  runnerInstallCommand,
} from "@lictory/platform/components/factory/runner-install";

// The dialog installs the runner of the server's own release through the
// published installers, whose options apps/runner/install.sh and
// install.ps1 define.

void test("the install command pins the server's release and registers the runner", () => {
  const unix = runnerInstallCommand(
    "linux",
    "https://lictory.example.com",
    "lrt_abc",
    "0.27.0-nightly.20261124.150",
  );
  assert.equal(
    unix,
    [
      "curl -fsSL https://github.com/chricarp/lictory/releases/latest/download/lictory-runner-install.sh | sh -s -- \\",
      "  --version 0.27.0-nightly.20261124.150 --url https://lictory.example.com --token lrt_abc --service",
    ].join("\n"),
  );
  assert.equal(
    runnerInstallCommand("macos", "https://l.example", "lrt_abc", "0.27.0"),
    runnerInstallCommand("linux", "https://l.example", "lrt_abc", "0.27.0"),
  );
  const windows = runnerInstallCommand(
    "windows",
    "https://lictory.example.com",
    "lrt_abc",
    "0.27.0",
  );
  assert.match(windows, /lictory-runner-install\.ps1\)\)\) `\n/);
  assert.match(
    windows,
    /-Version 0\.27\.0 -Url https:\/\/lictory\.example\.com -Token lrt_abc -Service$/,
  );
});

void test("a build without a release version installs the latest stable runner", () => {
  for (const version of [undefined, "", "dev", "1.2"]) {
    const command = runnerInstallCommand(
      "linux",
      "https://l",
      "lrt_x",
      version,
    );
    assert.ok(!command.includes("--version"), String(version));
    assert.ok(
      !runnerInstallCommand("windows", "https://l", "lrt_x", version).includes(
        "-Version",
      ),
    );
  }
});

void test("a fresh registration token says it is valid for an hour, not that it expires now", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const hour = new Date(now + 60 * 60_000).toISOString();
  assert.match(expiresIn(hour, now), /^in 60 minutes \(at .+\)$/);
  assert.match(
    expiresIn(new Date(now + 60_000).toISOString(), now),
    /^in 1 minute /,
  );
  assert.match(
    expiresIn(new Date(now - 5_000).toISOString(), now),
    /^in less than a minute /,
  );
});
