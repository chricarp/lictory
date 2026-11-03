import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyticsConsentCookie,
  analyticsConsentMode,
  hasAnalyticsConsentCookie,
  serverEventAllowed,
} from "@lictory/core/lib/analytics/consent";

void test("strict consent is opt-in by configuration; anything else keeps the default", () => {
  assert.equal(analyticsConsentMode("strict"), "strict");
  assert.equal(analyticsConsentMode(" Strict "), "strict");
  for (const value of [undefined, "", "cookieless", "off"])
    assert.equal(analyticsConsentMode(value), "cookieless");
});

void test("in strict mode server events follow the visitor's browser choice", () => {
  const request = (cookie?: string) =>
    new Headers(cookie ? { cookie } : undefined);
  const granted = analyticsConsentCookie(true, true).split(";")[0]!;
  const cleared = analyticsConsentCookie(false, true).split(";")[0]!;
  // Granted in this browser: the request carries the record.
  assert.equal(
    serverEventAllowed("strict", request(`session=x; ${granted}`)),
    true,
  );
  // Undecided, rejected or withdrawn, or no request at all (background jobs).
  assert.equal(serverEventAllowed("strict", request("session=x")), false);
  assert.equal(serverEventAllowed("strict", request(cleared)), false);
  assert.equal(serverEventAllowed("strict", undefined), false);
  // The default mode keeps today's behavior.
  assert.equal(serverEventAllowed("cookieless", undefined), true);
});

void test("the consent record is a first-party, identity-free cookie that withdrawal expires", () => {
  assert.equal(
    analyticsConsentCookie(true, true),
    "lictory_analytics_consent=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
  );
  assert.equal(
    analyticsConsentCookie(false, false),
    "lictory_analytics_consent=; Path=/; Max-Age=0; SameSite=Lax",
  );
  assert.equal(
    hasAnalyticsConsentCookie("lictory_analytics_consent=10"),
    false,
  );
});
