import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertBuildVersion,
  conventionalTitle,
  nightlyVersion,
  parseNightly,
  predictedStable,
} from "@lictory/core/release/version";
import { changelog, manifestSchema, sameManifest } from "@lictory/core/release/model";
import { injectVersion } from "@lictory/core/release/build";
import {
  GitHubFixture,
  change,
  nightly,
  stable,
  shaA,
} from "@lictory/core/release/fixtures.test-helper";

for (const [title, expected] of [
  ["feat: add offline editing", "1.5.0"],
  ["feat(auth): add SSO", "1.5.0"],
  ["fix(editor): preserve unsaved text", "1.4.3"],
  ["perf(search): reduce latency", "1.4.3"],
  ["feat(api)!: replace authentication", "2.0.0"],
  ["fix!: change a public contract", "2.0.0"],
  ["chore(deps): update packages", "1.4.2"],
  ["docs!: change supported operations", "2.0.0"],
] as const)
  void test(`${title} predicts ${expected}`, () => {
    assert.equal(predictedStable("1.4.2", [title]).version, expected);
  });

void test("all PRs are combined once, with breaking changes before features before fixes", () => {
  const titles = [
    "feat: add search",
    "feat: add export",
    "fix: fix a crash",
    "fix: recover",
    "perf: speed up searches",
  ];
  assert.equal(predictedStable("1.4.2", titles).version, "1.5.0");
  assert.equal(
    predictedStable("1.4.2", [...titles, "refactor!: change the API"]).version,
    "2.0.0",
  );
  for (const type of [
    "docs",
    "chore",
    "ci",
    "test",
    "refactor",
    "style",
    "build",
  ])
    assert.equal(
      predictedStable("1.4.2", [`${type}: internal maintenance`]).version,
      "1.4.2",
    );
});

void test("pre-1.0 breaking changes advance the minor train and reset its patch", () => {
  assert.equal(
    predictedStable("0.4.9", ["feat!: replace API"]).version,
    "0.5.0",
  );
  assert.equal(
    predictedStable("0.0.3", ["fix!: incompatible fix"]).version,
    "0.1.0",
  );
});

void test("SemVer core arithmetic never rounds large numeric identifiers", () => {
  assert.equal(
    predictedStable("9007199254740992.3.4", ["feat!: change contract"]).version,
    "9007199254740993.0.0",
  );
});

void test("a reviewed breaking stable-API declaration graduates 0.x without a manual version bump", () => {
  assert.equal(
    predictedStable(
      "0.4.9",
      ["feat(api)!: declare the public contract stable"],
      true,
    ).version,
    "1.0.0",
  );
  assert.throws(
    () => predictedStable("0.4.9", ["feat: add a feature"], true),
    /breaking/,
  );
});

void test("nightly notes compare to the prior nightly while stable notes include every unreleased PR", () => {
  const candidate = nightly();
  const addedFix = change("fix(editor): recover drafts", "c".repeat(40), 2);
  candidate.changes.push(addedFix);
  candidate.nightlyNotes = {
    tag: "v1.5.0-nightly.20261008.141",
    sha: candidate.sha,
    changes: [addedFix],
  };
  const notes = changelog(candidate);
  assert.match(notes, /recover drafts/);
  assert.doesNotMatch(notes, /keep editing offline/);
  assert.match(notes, /20261008\.141\.\.\./);
  assert.match(changelog(stable(candidate)), /keep editing offline/);
});

void test("multiple nightlies preview one stable version and remain unique on retries", () => {
  const version = predictedStable("1.4.2", ["feat: add search"]).version;
  const first = nightlyVersion(version, "2026-10-08T01:00:00Z", 142);
  const second = nightlyVersion(version, "2026-10-08T02:00:00Z", 143);
  assert.notEqual(first, second);
  assert.equal(parseNightly(first).stable, "1.5.0");
  assert.equal(parseNightly(second).stable, "1.5.0");
  assert.equal(nightlyVersion(version, "2026-10-08T01:00:00Z", 142), first);
  for (const invalid of [
    "1.5.0",
    "1.5.0-nightly.20260230.1",
    "1.5.0-nightly.20261008.01",
    "01.5.0-nightly.20261008.1",
    "1.5.0-beta.1",
  ])
    assert.throws(() => parseNightly(invalid));
  assert.throws(() => conventionalTitle("Add search"));
  assert.throws(() => conventionalTitle("feat: "));
  assert.throws(() => assertBuildVersion("1.5.0+unknown"));
});

void test("changelogs use reviewed PR summaries, categories, and the stable baseline", () => {
  const manifest = nightly();
  manifest.changes = [
    change("feat(search): search decisions"),
    {
      ...change("fix(editor): preserve text", "c".repeat(40), 2),
      notes: "Unsaved edits now survive reconnects.",
    },
    change("feat(api)!: replace auth", "d".repeat(40), 3),
  ];
  const notes = changelog(stable(manifest));
  assert.match(notes, /### Breaking changes/);
  assert.match(notes, /### Added/);
  assert.match(notes, /### Fixed/);
  assert.match(notes, /Unsaved edits now survive reconnects/);
  assert.ok(notes.includes(`${shaA}...${manifest.sha}`));
  assert.match(notes, /pull\/2/);
  assert.doesNotMatch(notes, /fix\(editor\):/);
});

void test("release manifests cannot conceal channel, source, or version collisions", () => {
  const manifest = nightly();
  assert.throws(() => manifestSchema.parse({ ...manifest, version: "1.5.0" }));
  assert.throws(() =>
    manifestSchema.parse({ ...stable(manifest), sourceNightly: null }),
  );
  assert.throws(
    () => sameManifest(manifest, { ...manifest, sha: shaA }),
    /collision/,
  );
});

void test("nightly and stable version injection keeps build manifests consistent without altering scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "lictory-build-version-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "lictory",
        version: "0.1.0",
        scripts: { build: "next build" },
      }),
    );
    for (const version of ["1.5.0-nightly.20261008.142", "1.5.0"]) {
      await injectVersion(root, version);
      const manifest = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ) as { version: string; scripts: unknown };
      assert.equal(manifest.version, version);
      assert.deepEqual(manifest.scripts, { build: "next build" });
    }
    await assert.rejects(injectVersion(root, "1.5.0-preview.1"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("nightly and stable publication resume an existing draft without duplicating releases or assets", async () => {
  for (const manifest of [nightly(), stable()]) {
    const fixture = new GitHubFixture();
    const reserved = await fixture.github.reserve(manifest);
    assert.equal(reserved.draft, true);
    assert.equal(reserved.assets.length, 1);
    assert.deepEqual(await fixture.github.manifest(reserved), manifest);
    const writes = fixture.writes.length;
    await fixture.github.reserve(manifest);
    assert.equal(fixture.writes.length, writes);
    await assert.rejects(
      fixture.github.reserve({ ...manifest, changes: [] }),
      /collision/,
    );
    await fixture.github.publish(manifest);
    assert.equal(fixture.releases.length, 1);
    assert.equal(fixture.releases[0]!.id, reserved.id);
    assert.equal(fixture.releases[0]!.assets.length, 1);
    assert.equal(fixture.releases[0]!.draft, false);
  }
});

void test("publication resumes a draft whose manifest upload did not complete", async () => {
  const fixture = new GitHubFixture();
  const manifest = nightly();
  fixture.add(manifest, false);
  fixture.releases[0]!.assets = [];
  await fixture.github.publish(manifest);
  assert.equal(fixture.releases.length, 1);
  assert.equal(fixture.releases[0]!.draft, false);
  assert.equal(fixture.releases[0]!.assets.length, 1);
  assert.deepEqual(
    await fixture.github.manifest(fixture.releases[0]!),
    manifest,
  );
});

void test("tag and release publication are idempotent and never overwrite another source", async () => {
  const fixture = new GitHubFixture();
  const candidate = nightly();
  await fixture.github.publish(candidate);
  assert.equal(fixture.releases.length, 1);
  assert.equal(fixture.releases[0]!.prerelease, true);
  assert.equal(fixture.latestTag, undefined);
  const writes = fixture.writes.length;
  await fixture.github.publish(candidate);
  assert.equal(fixture.writes.length, writes);
  await assert.rejects(
    fixture.github.reserve({ ...candidate, sha: shaA }),
    /collision/,
  );
  const production = stable(candidate);
  await fixture.github.publish(production);
  assert.equal(fixture.latestTag, "v1.5.0");
  await assert.rejects(
    fixture.github.reserve({ ...production, sha: shaA }),
    /collision/,
  );
  assert.equal(fixture.tags.get(candidate.tag), candidate.sha);
});
