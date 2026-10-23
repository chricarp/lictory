import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasSignedInHint,
  signedInHintCookie,
  signedInHintDomain,
} from "@lictory/core/lib/signed-in-hint";

void test("the hint is shared through the hosts' common parent domain", () => {
  assert.equal(
    signedInHintDomain("app.lictory.com", "lictory.com"),
    "lictory.com",
  );
  assert.equal(
    signedInHintDomain("app.lictory.com", "www.lictory.com"),
    "lictory.com",
  );
  assert.equal(signedInHintDomain("localhost", "localhost"), undefined);
  assert.equal(signedInHintDomain("app.lictory.com", "example.com"), null);
  assert.equal(signedInHintDomain("127.0.0.1", "10.0.0.1"), null);
  assert.equal(signedInHintDomain("10.0.0.1", "11.0.0.1"), null);
});

void test("signing out expires the hint the website reads", () => {
  const app = new URL("https://app.lictory.com");
  const site = new URL("https://lictory.com");
  assert.equal(
    signedInHintCookie(true, app, site),
    "lictory_signed_in=1; Path=/; Max-Age=604800; SameSite=Lax; Domain=lictory.com; Secure",
  );
  assert.match(
    signedInHintCookie(false, app, site)!,
    /^lictory_signed_in=; .*Max-Age=0/,
  );
  assert.equal(
    signedInHintCookie(true, app, new URL("https://example.com")),
    null,
  );
  assert.equal(
    signedInHintCookie(
      true,
      new URL("http://localhost:3000"),
      new URL("http://localhost:3100"),
    ),
    "lictory_signed_in=1; Path=/; Max-Age=604800; SameSite=Lax",
  );
  assert.equal(hasSignedInHint("a=b; lictory_signed_in=1"), true);
  assert.equal(hasSignedInHint("lictory_signed_in="), false);
  assert.equal(hasSignedInHint(""), false);
});
