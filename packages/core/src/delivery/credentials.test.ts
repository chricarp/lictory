import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptCredential,
  encryptCredential,
} from "@lictory/core/delivery/credentials";

const secret = "test-secret";

void test("credentials round-trip and never appear in the ciphertext", () => {
  const value = { email: "bot@acme.test", apiToken: "tok-123" };
  const encoded = encryptCredential("org-a", value, secret);
  assert.ok(!encoded.includes("tok-123"));
  assert.deepEqual(decryptCredential("org-a", encoded, secret), value);
  // Fresh IV per encryption.
  assert.notEqual(encryptCredential("org-a", value, secret), encoded);
});

void test("a credential copied to another organization or key does not decrypt", () => {
  const encoded = encryptCredential("org-a", { apiToken: "x" }, secret);
  assert.throws(() => decryptCredential("org-b", encoded, secret));
  assert.throws(() => decryptCredential("org-a", encoded, "other-secret"));
});
