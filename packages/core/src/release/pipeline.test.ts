import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeRelease,
  type ReleasePorts,
} from "@lictory/core/release/pipeline";
import {
  images,
  nightly,
  stable,
} from "@lictory/core/release/fixtures.test-helper";

function ports() {
  const calls: string[] = [];
  let publicationFails = false;
  const build = {
    id: "verified",
    url: "https://github.com/example/lictory/releases/tag/v1.5.0",
    images: images("b"),
  };
  const adapter: ReleasePorts = {
    validate: async () => {
      calls.push("validate");
    },
    active: async () => undefined,
    build: async () => {
      calls.push("build");
      return build;
    },
    record: async () => {
      calls.push("record");
      return 1;
    },
    status: async (_id, state) => {
      calls.push(state);
    },
    reserve: async () => {
      calls.push("reserve");
    },
    publish: async () => {
      calls.push("publish");
      if (publicationFails) throw new Error("GitHub unavailable");
    },
  };
  return {
    adapter,
    calls,
    failPublication: (value: boolean) => {
      publicationFails = value;
    },
  };
}

void test("nightly and stable releases build, revalidate, reserve and publish, deploying nothing", async () => {
  for (const manifest of [nightly(), stable()]) {
    const fixture = ports();
    await executeRelease(manifest, fixture.adapter);
    assert.deepEqual(fixture.calls, [
      "validate",
      "build",
      "record",
      "in_progress",
      "validate",
      "reserve",
      "publish",
      "success",
    ]);
  }
});

void test("a failed validation or build publishes nothing", async () => {
  for (const failAt of ["validate", "build"] as const) {
    const fixture = ports();
    fixture.adapter[failAt] = async () => {
      throw new Error("Failed gate");
    };
    await assert.rejects(executeRelease(stable(), fixture.adapter));
    assert.ok(!fixture.calls.includes("reserve"));
    assert.ok(!fixture.calls.includes("publish"));
  }
});

void test("a publication outage is recorded as a failure and retried from the journaled build", async () => {
  const fixture = ports();
  fixture.failPublication(true);
  await assert.rejects(executeRelease(stable(), fixture.adapter), /failed/);
  assert.ok(fixture.calls.includes("failure"));
  // The retry finds the journaled images and publishes them without a rebuild.
  const retry = ports();
  const journaled = {
    id: "journaled",
    url: "https://github.com/example/lictory/releases/tag/v1.5.0",
    images: images("c"),
  };
  retry.adapter.active = async () => journaled;
  assert.equal(await executeRelease(stable(), retry.adapter), journaled);
  assert.deepEqual(retry.calls, [
    "validate",
    "record",
    "reserve",
    "success",
    "publish",
  ]);
});
