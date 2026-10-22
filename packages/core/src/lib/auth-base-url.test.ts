import assert from "node:assert/strict";
import { test } from "node:test";
import { betterAuth } from "better-auth/minimal";
import {
  matchesPlatformOrigin,
  platformUrl,
  siteUrl,
} from "@lictory/core/lib/auth-base-url";

void test("the platform origin is exact and required in production", () => {
  assert.equal(
    platformUrl({ PLATFORM_URL: "https://app.lictory.com/" }),
    "https://app.lictory.com",
  );
  assert.throws(() => platformUrl({ NODE_ENV: "production" }));
  assert.throws(() =>
    platformUrl({ PLATFORM_URL: "https://app.lictory.com/app" }),
  );
  assert.equal(
    platformUrl({ BETTER_AUTH_URL: "http://localhost:3001" }),
    "http://localhost:3001",
  );
  assert.equal(
    siteUrl({
      PLATFORM_URL: "https://app.lictory.com",
      SITE_URL: "https://lictory.com",
    }),
    "https://lictory.com",
  );
});

void test("writes are accepted only from the exact platform origin", () => {
  const env = { PLATFORM_URL: "https://app.lictory.com" };
  assert.equal(matchesPlatformOrigin("https://app.lictory.com", env), true);
  for (const origin of [
    "https://lictory.com",
    "https://app.lictory.com.evil.example",
    "http://app.lictory.com",
    null,
  ])
    assert.equal(matchesPlatformOrigin(origin, env), false);
});

void test("the auth server rejects writes from another origin", async () => {
  const auth = betterAuth({
    baseURL: platformUrl({ PLATFORM_URL: "https://app.lictory.com" }),
    secret: "test-only-platform-origin-secret-at-least-32",
    emailAndPassword: { enabled: true },
    advanced: { disableOriginCheck: false },
    logger: { disabled: true },
  });
  const request = (origin: string) =>
    new Request("https://app.lictory.com/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin,
        cookie: "consent=test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "absent@example.test",
        password: "Test-password-123",
      }),
    });
  assert.equal(
    (await auth.handler(request("https://app.lictory.com"))).status,
    401,
  );
  assert.equal(
    (await auth.handler(request("https://lictory.com"))).status,
    403,
  );
});
