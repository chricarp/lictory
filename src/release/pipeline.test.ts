import assert from "node:assert/strict";
import { test } from "node:test";
import { executeRelease, type ReleasePorts } from "./pipeline";
import { nightly, stable } from "./fixtures.test-helper";

function ports() {
  const calls: string[] = [];
  let active = false;
  let publicationFails = false;
  const build = { id: "dpl_verified", url: "https://verified.vercel.app" };
  const adapter: ReleasePorts = {
    validate: async () => {
      calls.push("validate");
    },
    active: async () => (active ? build : undefined),
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
    migrate: async () => {
      calls.push("migrate");
    },
    reserve: async () => {
      calls.push("reserve");
    },
    promote: async () => {
      calls.push("promote");
      active = true;
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

void test("production cannot reserve a tag or activate a build before migrations succeed", async () => {
  const fixture = ports();
  fixture.adapter.migrate = async () => {
    throw new Error("Migration transaction failed");
  };
  await assert.rejects(executeRelease(stable(), fixture.adapter), /failed/);
  assert.ok(fixture.calls.includes("failure"));
  assert.ok(!fixture.calls.includes("reserve"));
  assert.ok(!fixture.calls.includes("promote"));
  assert.ok(!fixture.calls.includes("publish"));
});

void test("an activation gate revalidates history after a configured build and migration", async () => {
  const fixture = ports();
  await executeRelease(stable(), fixture.adapter);
  assert.deepEqual(fixture.calls, [
    "validate",
    "build",
    "record",
    "in_progress",
    "migrate",
    "validate",
    "reserve",
    "promote",
    "success",
    "publish",
  ]);
});

void test("publication failure is repaired without rebuilding, remigrating, or reactivating production", async () => {
  const fixture = ports();
  fixture.failPublication(true);
  await assert.rejects(executeRelease(stable(), fixture.adapter));
  fixture.calls.length = 0;
  fixture.failPublication(false);
  await executeRelease(stable(), fixture.adapter);
  assert.deepEqual(fixture.calls, [
    "validate",
    "record",
    "reserve",
    "success",
    "publish",
  ]);
});

void test("failed nightly validation or build leaves the working alias untouched", async () => {
  for (const failAt of ["validate", "build"] as const) {
    const fixture = ports();
    fixture.adapter[failAt] = async () => {
      throw new Error("Failed gate");
    };
    await assert.rejects(executeRelease(nightly(), fixture.adapter));
    assert.ok(!fixture.calls.includes("promote"));
    assert.ok(!fixture.calls.includes("publish"));
  }
});

void test("a nightly publication outage cannot replace the working nightly alias", async () => {
  const fixture = ports();
  fixture.failPublication(true);
  await assert.rejects(executeRelease(nightly(), fixture.adapter));
  assert.ok(fixture.calls.includes("publish"));
  assert.ok(!fixture.calls.includes("promote"));
});
