import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { oauthErrorMessage } from "./oauth-errors";

void describe("OAuth error messages", () => {
  void test("no error means no message", () => {
    assert.equal(oauthErrorMessage(null, "sign-in"), null);
    assert.equal(oauthErrorMessage("", "connect"), null);
  });

  void test("an unverified existing account explains how to link it", () => {
    assert.match(
      oauthErrorMessage("account_not_linked", "sign-in")!,
      /Sign in with your password/,
    );
  });

  void test("connecting an account with another email names the mismatch", () => {
    assert.match(
      oauthErrorMessage("email_does_not_match", "connect")!,
      /different email address/,
    );
  });

  void test("unknown codes fall back to an actionable message per situation", () => {
    assert.match(oauthErrorMessage("invalid_code", "sign-in")!, /Try again/);
    assert.match(oauthErrorMessage("invalid_code", "connect")!, /Try again/);
  });
});
