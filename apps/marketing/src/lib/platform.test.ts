import { test } from "node:test";
import assert from "node:assert/strict";

import { configuredOrigin } from "@lictory/marketing/lib/platform";

void test("configured origins drop paths and treat empty variables as unset", () => {
  assert.equal(
    configuredOrigin("https://app.example.com/ignored?x=1", "http://fallback"),
    "https://app.example.com",
  );
  assert.equal(
    configuredOrigin("", "http://localhost:3000"),
    "http://localhost:3000",
  );
  assert.equal(
    configuredOrigin(undefined, "http://localhost:3000"),
    "http://localhost:3000",
  );
});
