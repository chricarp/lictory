import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expiresIn,
  runnerFromSourceCommand,
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
      "curl -fsSLO https://github.com/chricarp/lictory/releases/latest/download/lictory-runner-install.sh &&",
      "  sh lictory-runner-install.sh --version 0.27.0-nightly.20261124.150 --url https://lictory.example.com --token lrt_abc --service",
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
  for (const version of [undefined, "", "dev", "1.2", "0.0.0-dev"]) {
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

void test("a release without runner files gets the same runner from its own source tag", () => {
  const unix = runnerFromSourceCommand(
    "linux",
    "https://lictory.example.com",
    "lrt_abc",
    "0.26.0",
  ).split("\n");
  assert.equal(
    unix[0],
    "git clone --depth 1 --branch v0.26.0 https://github.com/chricarp/lictory.git && cd lictory",
  );
  assert.match(unix[2]!, /^bun run --cwd apps\/runner build linux-x64 /);
  assert.equal(
    unix.at(-2),
    "~/.local/bin/lictory-runner register --url https://lictory.example.com --token lrt_abc",
  );
  assert.equal(
    unix.at(-1),
    "~/.local/bin/lictory-runner install-service --enable",
  );
  assert.match(
    runnerFromSourceCommand("macos", "https://l", "lrt_x", "0.26.0"),
    /build darwin-arm64 .*\n.*lictory-runner-darwin-arm64 ~\/\.local\/bin/,
  );
  // A build without a release version builds the default branch.
  assert.ok(
    !runnerFromSourceCommand("linux", "https://l", "lrt_x", "dev").includes(
      "--branch",
    ),
  );
  const windows = runnerFromSourceCommand(
    "windows",
    "https://l",
    "lrt_x",
    "0.26.0",
  );
  assert.match(
    windows,
    /\.\\apps\\runner\\dist\\lictory-runner-windows-x64\.exe register --url https:\/\/l --token lrt_x/,
  );
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
