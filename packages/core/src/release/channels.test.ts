import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  GitHubFixture,
  change,
  images,
  nightly,
  shaA,
  stable,
} from "@lictory/core/release/fixtures.test-helper";
import { collectChanges, git } from "@lictory/core/release/repository";
import { releaseFile } from "@lictory/core/release/images";
import { nightlyDue } from "@lictory/core/release/plan";

async function history() {
  const root = await mkdtemp(join(tmpdir(), "lictory-release-paths-"));
  const commit = async (files: Record<string, string>, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(join(root, dirname(file)), { recursive: true });
      await writeFile(join(root, file), content);
    }
    await git(root, "add", "-A");
    await git(root, "commit", "--quiet", "-m", message);
    return git(root, "rev-parse", "HEAD");
  };
  await git(root, "init", "--quiet", "--initial-branch=main");
  await git(root, "config", "user.name", "Release tests");
  await git(root, "config", "user.email", "release@example.test");
  const base = await commit({ "apps/api/src/index.ts": "1" }, "base");
  const website = await commit(
    {
      "apps/docs/content/docs/index.mdx": "docs",
      "apps/marketing/src/app/page.tsx": "landing",
      "README.md": "readme",
    },
    "website",
  );
  const platform = await commit(
    { "packages/core/src/domain/approval.ts": "rule" },
    "platform",
  );
  return { root, base, website, platform };
}

void test("a nightly is due only when the platform changed since the newest nightly", async () => {
  const { root, base, website, platform } = await history();
  try {
    const fixture = new GitHubFixture();
    const run = 9_001;
    const due = (sha: string, branch = "main") =>
      nightlyDue(fixture.github, root, sha, branch, run);
    // No nightly yet: the first scheduled run publishes one.
    assert.equal(await due(website), true);
    fixture.add(nightly(base, 140));
    // Only the websites and the README changed: the schedule publishes nothing.
    assert.equal(await due(website), false);
    assert.equal(await due(platform), true);
    fixture.add(nightly(platform, 141));
    // Nothing merged since the newest nightly.
    assert.equal(await due(platform), false);
    // Maintenance branches are judged by their own nightlies.
    assert.equal(await due(platform, "release/1.4"), true);
    // A retried run that already planned a nightly always continues.
    await fixture.github.keepReleaseIntent(run, nightly(platform, 142));
    assert.equal(await due(platform), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("website-only pull requests never bump or describe the platform release", async () => {
  const { root, base, website, platform } = await history();
  try {
    const fixture = new GitHubFixture();
    const docs = change("feat(docs): explain self-hosting", website, 1);
    const fix = change("fix(review): keep approvals on revisions", platform, 2);
    fixture.associate(website, [docs]);
    fixture.associate(platform, [fix]);
    const baseline = { version: "1.4.2", tag: null, sha: base };
    assert.deepEqual(
      (await collectChanges(fixture.github, root, baseline, platform)).map(
        (value) => value.number,
      ),
      [2],
    );
    // A release with only website changes has nothing to version.
    assert.deepEqual(
      await collectChanges(fixture.github, root, baseline, website),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("release.env reaches a just-reserved draft that the tag lookup and listing cannot see yet", async () => {
  const fixture = new GitHubFixture();
  fixture.staleListing = true;
  const manifest = nightly();
  const reserved = await fixture.github.reserve(manifest);
  // The tag endpoint never returns drafts and the listing has not caught up.
  assert.equal(await fixture.github.release(manifest.tag), undefined);
  const file = releaseFile(manifest, images("a"));
  await fixture.github.attach(manifest, "release.env", file, reserved);
  const draft = fixture.releases.find((value) => value.id === reserved.id)!;
  assert.equal(draft.draft, true);
  assert.deepEqual(draft.assets.map((asset) => asset.name).sort(), [
    "release-manifest.json",
    "release.env",
  ]);
  // A later run that only has the manifest finds the same draft by tag once
  // it is listed: the same bytes are a no-op, different bytes are refused.
  fixture.refreshListing();
  const uploads = fixture.writes.filter((write) =>
    write.includes("/assets"),
  ).length;
  await fixture.github.attach(manifest, "release.env", file);
  assert.equal(
    fixture.writes.filter((write) => write.includes("/assets")).length,
    uploads,
  );
  await assert.rejects(
    fixture.github.attach(
      manifest,
      "release.env",
      releaseFile(manifest, images("b")),
      reserved,
    ),
    /already has a different release.env/,
  );
  // The reserved release must belong to the manifest's tag.
  await assert.rejects(
    fixture.github.attach(nightly(shaA, 90), "release.env", file, reserved),
    /belongs to/,
  );
});

void test("every release carries its release.env once, and retries cannot change it", async () => {
  const fixture = new GitHubFixture();
  const manifest = stable();
  await fixture.github.reserve(manifest);
  const file = releaseFile(manifest, images("a"));
  await fixture.github.attach(manifest, "release.env", file);
  const uploads = () =>
    fixture.writes.filter((write) => write.includes("/assets")).length;
  const afterFirst = uploads();
  // A retry with the same digests is a no-op…
  await fixture.github.attach(manifest, "release.env", file);
  assert.equal(uploads(), afterFirst);
  // …and different digests for the same version are refused.
  await assert.rejects(
    fixture.github.attach(
      manifest,
      "release.env",
      releaseFile(manifest, images("b")),
    ),
    /already has a different release.env/,
  );
  const release = (await fixture.github.release(manifest.tag))!;
  assert.deepEqual(release.assets.map((asset) => asset.name).sort(), [
    "release-manifest.json",
    "release.env",
  ]);
  // A release published before release.env existed stays immutable.
  const older = nightly(shaA, 90);
  fixture.add(older, true);
  const before = uploads();
  await fixture.github.attach(older, "release.env", file);
  assert.equal(uploads(), before);
});
