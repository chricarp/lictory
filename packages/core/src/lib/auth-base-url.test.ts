import assert from "node:assert/strict";
import { test } from "node:test";
import { betterAuth } from "better-auth/minimal";
import { authBaseUrl, matchesAuthOrigin } from "@lictory/core/lib/auth-base-url";

const env = {
  BETTER_AUTH_URL: "https://lictory.com",
  LICTORY_RELEASE_CHANNEL: "nightly",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "verified-nightly.vercel.app",
};

void test("nightly origins are exact and provider-declared, with no wildcard or production expansion", () => {
  assert.deepEqual(authBaseUrl(env), {
    allowedHosts: ["verified-nightly.vercel.app"],
    protocol: "https",
    fallback: "https://verified-nightly.vercel.app",
  });
  assert.equal(
    authBaseUrl({ ...env, VERCEL_ENV: "production" }),
    env.BETTER_AUTH_URL,
  );
  for (const deployment of [
    "*.vercel.app",
    "https://evil.example",
    "evil.example",
    "nightly.vercel.app.evil.example",
  ])
    assert.equal(
      authBaseUrl({ ...env, VERCEL_URL: deployment }),
      env.BETTER_AUTH_URL,
    );
  assert.equal(
    authBaseUrl({
      ...env,
      BETTER_AUTH_URL: "https://lictory.com",
      LICTORY_RELEASE_CHANNEL: "stable",
    }),
    "https://lictory.com",
  );
  assert.equal(
    authBaseUrl({
      ...env,
      VERCEL: undefined,
      BETTER_AUTH_URL: "http://localhost:3001",
    }),
    "http://localhost:3001",
  );
});

void test("the auth server accepts its own immutable nightly origin and rejects another project's origin", async () => {
  const auth = betterAuth({
    baseURL: authBaseUrl(env),
    secret: "test-only-nightly-origin-secret-at-least-32",
    emailAndPassword: { enabled: true },
    advanced: { disableOriginCheck: false },
    logger: { disabled: true },
  });
  const request = (origin: string) =>
    new Request("https://verified-nightly.vercel.app/api/auth/sign-in/email", {
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
    (await auth.handler(request("https://verified-nightly.vercel.app"))).status,
    401,
  );
  assert.equal(
    (await auth.handler(request("https://another-project.vercel.app"))).status,
    403,
  );
  const production = betterAuth({
    baseURL: authBaseUrl({
      ...env,
      BETTER_AUTH_URL: "https://lictory.com",
      LICTORY_RELEASE_CHANNEL: "stable",
    }),
    secret: "test-only-production-origin-secret-at-least-32",
    emailAndPassword: { enabled: true },
    advanced: { disableOriginCheck: false },
    logger: { disabled: true },
  });
  assert.equal(
    (await production.handler(request("https://verified-nightly.vercel.app")))
      .status,
    403,
  );
});

void test("ordinary previews opt into their exact Vercel origin only with an OAuth proxy", () => {
  const preview = { ...env, LICTORY_RELEASE_CHANNEL: "development" };
  assert.equal(authBaseUrl(preview), env.BETTER_AUTH_URL);
  assert.deepEqual(
    authBaseUrl({
      ...preview,
      OAUTH_PROXY_URL: "https://oauth.example.test",
      OAUTH_PROXY_SECRET: "test-only-shared-secret",
    }),
    authBaseUrl(env),
  );
  assert.equal(
    authBaseUrl({ ...preview, OAUTH_PROXY_URL: "https://oauth.example.test" }),
    env.BETTER_AUTH_URL,
  );
});

void test("invitation wrappers use the same exact origins, not a client-supplied request host", () => {
  const base = authBaseUrl(env);
  assert.equal(
    matchesAuthOrigin(
      base,
      "https://verified-nightly.vercel.app",
      "https://verified-nightly.vercel.app/api/invitations",
    ),
    true,
  );
  assert.equal(
    matchesAuthOrigin(
      base,
      "https://another-project.vercel.app",
      "https://another-project.vercel.app/api/invitations",
    ),
    false,
  );
  assert.equal(
    matchesAuthOrigin(
      "https://lictory.com",
      "https://evil.example",
      "https://evil.example/api/invitations",
    ),
    false,
  );
  assert.equal(
    matchesAuthOrigin(base, null, "https://lictory.com/api/invitations"),
    false,
  );
});
