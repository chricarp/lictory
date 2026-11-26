import assert from "node:assert/strict";
import { test } from "node:test";
import { runnerVersionSkew } from "@lictory/platform/components/factory/runner-version";

void test("a runner on an older release than the server lags behind it", () => {
  assert.equal(runnerVersionSkew("0.25.0", "0.26.0"), "behind");
  assert.equal(runnerVersionSkew("0.26.0", "0.26.1"), "behind");
  assert.equal(runnerVersionSkew("v0.26.0", "0.26.0"), null);
  assert.equal(runnerVersionSkew("0.27.0", "0.26.0"), "ahead");
  // A nightly precedes the release it builds toward; later nightlies
  // follow earlier ones.
  assert.equal(
    runnerVersionSkew("0.27.0-nightly.20261120.1", "0.27.0"),
    "behind",
  );
  assert.equal(
    runnerVersionSkew("0.27.0-nightly.20261120.1", "0.27.0-nightly.20261121.1"),
    "behind",
  );
});

void test("builds without a release version are never compared", () => {
  assert.equal(runnerVersionSkew("0.0.0-dev", "0.26.0"), null);
  assert.equal(runnerVersionSkew("0.26.0", "development"), null);
  assert.equal(runnerVersionSkew(null, "0.26.0"), null);
  assert.equal(runnerVersionSkew("0.26.0", undefined), null);
});
