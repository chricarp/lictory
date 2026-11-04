import { test } from "node:test";
import assert from "node:assert/strict";

import { configuredOrigin } from "@lictory/marketing/lib/origin";

void test("configured origins drop paths and treat empty variables as unset", () => {
  assert.equal(
    configuredOrigin(
      "https://lictory.example.com/ignored?x=1",
      "http://fallback",
    ),
    "https://lictory.example.com",
  );
  assert.equal(
    configuredOrigin("", "http://localhost:3100"),
    "http://localhost:3100",
  );
  assert.equal(
    configuredOrigin(undefined, "http://localhost:3100"),
    "http://localhost:3100",
  );
});
