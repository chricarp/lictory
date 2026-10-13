import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceCodeUrl } from "./source-code";

void test("source offers accept deployment-specific HTTPS archives without credential URLs", () => {
  assert.equal(
    sourceCodeUrl(" https://example.org/source/v1.tar.gz "),
    "https://example.org/source/v1.tar.gz",
  );
  for (const value of [
    undefined,
    "",
    "invalid",
    "javascript:alert(1)",
    "https://token:secret@example.org",
    "http://example.org",
  ])
    assert.equal(sourceCodeUrl(value), undefined);
});
