import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptCredential,
  derivedCredentialsKeyInProduction,
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

void test("setting DELIVERY_CREDENTIALS_KEY to the current BETTER_AUTH_SECRET keeps stored credentials readable", () => {
  // What an existing installation does to decouple the two secrets.
  const authSecret = "a".repeat(64);
  const previous = process.env.DELIVERY_CREDENTIALS_KEY;
  const previousAuth = process.env.BETTER_AUTH_SECRET;
  try {
    delete process.env.DELIVERY_CREDENTIALS_KEY;
    process.env.BETTER_AUTH_SECRET = authSecret;
    const encoded = encryptCredential("org-a", { apiToken: "x" });
    assert.deepEqual(decryptCredential("org-a", encoded, authSecret), {
      apiToken: "x",
    });
  } finally {
    if (previous === undefined) delete process.env.DELIVERY_CREDENTIALS_KEY;
    else process.env.DELIVERY_CREDENTIALS_KEY = previous;
    if (previousAuth === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousAuth;
  }
});

void test("only production without an explicit key derives it from BETTER_AUTH_SECRET", () => {
  assert.equal(
    derivedCredentialsKeyInProduction({ NODE_ENV: "production" }),
    true,
  );
  assert.equal(
    derivedCredentialsKeyInProduction({
      NODE_ENV: "production",
      DELIVERY_CREDENTIALS_KEY: "  ",
    }),
    true,
  );
  assert.equal(
    derivedCredentialsKeyInProduction({
      NODE_ENV: "production",
      DELIVERY_CREDENTIALS_KEY: "k".repeat(64),
    }),
    false,
  );
  assert.equal(derivedCredentialsKeyInProduction({ NODE_ENV: "test" }), false);
});
