import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  nextVersion,
  parseVersion,
  prepareChangelog,
  releaseNotes,
} from "./version";

const changelog =
  "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Recover interrupted exports.\n\n## [1.2.3] - 2026-09-01\n\n- Earlier release.\n";

for (const [kind, expected] of [
  ["major", "2.0.0"],
  ["minor", "1.3.0"],
  ["patch", "1.2.4"],
  ["hotfix", "1.2.4"],
] as const) {
  void test(`${kind} release from 1.2.3 becomes ${expected}`, () => {
    assert.equal(nextVersion("1.2.3", kind), expected);
  });
}

void test("initial development follows the same numbering rules", () => {
  assert.equal(nextVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(nextVersion("0.1.0", "major"), "1.0.0");
});

for (const version of [
  "1.2",
  "v1.2.3",
  "01.2.3",
  "1.2.3-beta.1",
  "1.2.3+build",
  "-1.2.3",
  "9007199254740992.0.0",
]) {
  void test(`rejects unsupported version ${version}`, () => {
    assert.throws(() => parseVersion(version));
  });
}

void test("rejects unknown release kinds and numeric overflow", () => {
  assert.throws(() => nextVersion("1.2.3", "feature"), /Choose/);
  assert.throws(
    () => nextVersion("9007199254740991.0.0", "major"),
    /safe integers/,
  );
});

void test("preparation moves pending notes into the new release and preserves history", () => {
  const prepared = prepareChangelog(changelog, "1.2.4", "2026-10-08");
  assert.ok(prepared.includes("## [Unreleased]\n\n## [1.2.4] - 2026-10-08"));
  assert.equal(
    prepared.split("## [1.2.3]")[1],
    changelog.split("## [1.2.3]")[1],
  );
  assert.equal(
    releaseNotes("1.2.4", "v1.2.4", prepared),
    "### Fixed\n\n- Recover interrupted exports.",
  );
  assert.throws(
    () => prepareChangelog(prepared, "1.2.5", "2026-10-08"),
    /release notes/,
  );
});

void test("requires notes and refuses duplicate release entries", () => {
  assert.throws(
    () =>
      prepareChangelog("## [Unreleased]\n\n### Added\n", "1.2.4", "2026-10-08"),
    /release notes/,
  );
  assert.throws(
    () => prepareChangelog(changelog, "1.2.3", "2026-10-08"),
    /already contains/,
  );
  assert.throws(
    () =>
      prepareChangelog(
        `${changelog}\n## [Unreleased]\n- Duplicate`,
        "1.2.4",
        "2026-10-08",
      ),
    /exactly one/,
  );
});

void test("a deployment requires a matching tag and dated, nonempty release notes", () => {
  assert.throws(() => releaseNotes("1.2.3", "v1.2.4", changelog), /must match/);
  assert.throws(
    () => releaseNotes("1.2.4", "v1.2.4", changelog),
    /dated changelog/,
  );
  assert.throws(
    () => releaseNotes("1.2.3", "v1.2.3", "## [1.2.3] - 2026-10-08\n"),
    /release notes/,
  );
  assert.throws(
    () =>
      releaseNotes(
        "1.2.3",
        "v1.2.3",
        `${changelog}\n## [1.2.3] - 2026-10-08\n- Duplicate`,
      ),
    /dated changelog/,
  );
});

void test("release commands prepare and validate without publishing or changing other package fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "lictory-release-"));
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "src/release"), { recursive: true });
    for (const path of [
      "scripts/prepare-release.ts",
      "scripts/check-release.ts",
      "src/release/version.ts",
    ]) {
      await copyFile(
        new URL(`../../${path}`, import.meta.url),
        join(root, path),
      );
    }
    const original = `${JSON.stringify({ name: "lictory", version: "1.2.3", private: true }, null, 2)}\n`;
    await writeFile(join(root, "package.json"), original);
    await writeFile(join(root, "CHANGELOG.md"), changelog);
    const run = (script: string, ...args: string[]) =>
      promisify(execFile)("bun", [join(root, "scripts", script), ...args]);

    await run("prepare-release.ts", "hotfix", "--dry-run");
    assert.equal(await readFile(join(root, "package.json"), "utf8"), original);
    assert.equal(await readFile(join(root, "CHANGELOG.md"), "utf8"), changelog);
    await assert.rejects(
      run("prepare-release.ts", "hotfix", "--unknown"),
      /Usage/,
    );
    await run("prepare-release.ts", "hotfix");
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "package.json"), "utf8")),
      { name: "lictory", version: "1.2.4", private: true },
    );
    await assert.rejects(run("check-release.ts", "v1.2.3"), /must match/);
    const checked = await run("check-release.ts", "v1.2.4");
    assert.equal(
      checked.stdout.trim(),
      "### Fixed\n\n- Recover interrupted exports.",
    );
    const prepared = await readFile(join(root, "CHANGELOG.md"), "utf8");
    await assert.rejects(run("prepare-release.ts", "patch"), /release notes/);
    assert.equal(await readFile(join(root, "CHANGELOG.md"), "utf8"), prepared);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
