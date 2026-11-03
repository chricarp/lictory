import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GitHubFixture,
  images,
  nightly,
  shaA,
  shaB,
  stable,
} from "@lictory/core/release/fixtures.test-helper";
import { releaseFile } from "@lictory/core/release/images";
import { nightlyDue } from "@lictory/core/release/plan";

void test("a nightly is due only when its branch has commits the newest nightly did not ship", async () => {
  const fixture = new GitHubFixture();
  const run = 9_001;
  // No nightly yet: the first scheduled run publishes one.
  assert.equal(await nightlyDue(fixture.github, shaB, "main", run), true);
  fixture.add(nightly(shaA, 140));
  fixture.add(nightly(shaB, 141));
  // Nothing merged since the newest nightly: the schedule publishes nothing.
  assert.equal(await nightlyDue(fixture.github, shaB, "main", run), false);
  // An older nightly of the same commit does not hide new work.
  assert.equal(await nightlyDue(fixture.github, shaA, "main", run), true);
  // Maintenance branches are judged by their own nightlies.
  assert.equal(
    await nightlyDue(fixture.github, shaB, "release/1.4", run),
    true,
  );
  // A retried run that already planned a nightly always continues.
  await fixture.github.keepReleaseIntent(run, nightly(shaB, 142));
  assert.equal(await nightlyDue(fixture.github, shaB, "main", run), true);
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
