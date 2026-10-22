import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { authBaseUrl } from "@lictory/core/lib/auth-base-url";
import { oauthProxyConfig } from "@lictory/core/lib/oauth-proxy";

const proxyOrigin = "https://oauth.example.test";
const previewOrigin = "https://lictory-preview.vercel.app";
const proxyEnv = {
  OAUTH_PROXY_URL: proxyOrigin,
  OAUTH_PROXY_SECRET: "test-only-shared-oauth-proxy-secret-32",
};

function realm(
  origin: string,
  env: Readonly<Record<string, string | undefined>> = proxyEnv,
) {
  const data: Record<
    "user" | "account" | "session" | "verification",
    Record<string, unknown>[]
  > = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const config = { BETTER_AUTH_URL: origin, ...env };
  const auth = betterAuth({
    baseURL: authBaseUrl(config),
    secret: `test-only-private-realm-secret-${new URL(origin).hostname}`,
    database: memoryAdapter(data),
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: { clientId: "development-client", clientSecret: "test-secret" },
      microsoft: {
        clientId: "development-client",
        clientSecret: "test-secret",
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        allowDifferentEmails: false,
      },
    },
    ...oauthProxyConfig(config),
    advanced: { disableOriginCheck: false },
    logger: { disabled: true },
  });
  const request = (path: string, body: object, cookie = "consent=test") =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { auth, data, request };
}

async function mockGoogleCallback(auth: ReturnType<typeof realm>["auth"]) {
  const context = await auth.$context;
  const provider = context.socialProviders.find((p) => p.id === "google")!;
  // Mock only the external code exchange and provider profile. All Better
  // Auth state, redirect, account-linking and session handling runs normally.
  provider.validateAuthorizationCode = async ({ redirectURI }) => {
    assert.equal(redirectURI, `${proxyOrigin}/api/auth/callback/google`);
    return { accessToken: "test-access-token", scopes: ["email", "profile"] };
  };
  provider.getUserInfo = async () => ({
    user: {
      name: "OAuth Tester",
      email: "oauth@example.test",
      emailVerified: true,
    },
    data: { sub: "google-test-user", email: "oauth@example.test" },
  });
}

function callbackRequest(authorization: URL, params: Record<string, string>) {
  const url = new URL(authorization.searchParams.get("redirect_uri")!);
  url.searchParams.set("state", authorization.searchParams.get("state")!);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return new Request(url);
}

async function authorizationURL(response: Response) {
  const body = (await response.json()) as { url: string };
  return new URL(body.url);
}

void test("OAuth proxy is opt-in and rejects incomplete or unsafe configuration", () => {
  assert.deepEqual(oauthProxyConfig({}), { plugins: [], trustedOrigins: [] });
  for (const env of [
    { OAUTH_PROXY_URL: proxyOrigin },
    { OAUTH_PROXY_SECRET: proxyEnv.OAUTH_PROXY_SECRET },
    { ...proxyEnv, OAUTH_PROXY_SECRET: "short" },
    { ...proxyEnv, OAUTH_PROXY_URL: "http://oauth.example.test" },
    { ...proxyEnv, OAUTH_PROXY_URL: `${proxyOrigin}/api/auth` },
    {
      ...proxyEnv,
      OAUTH_PROXY_URL: "https://user:password@oauth.example.test",
    },
  ])
    assert.throws(() => oauthProxyConfig(env));
  assert.deepEqual(
    oauthProxyConfig({
      ...proxyEnv,
      OAUTH_PROXY_TRUSTED_ORIGINS:
        " http://localhost:3000, https://lictory-*-my-team.vercel.app, ",
    }).trustedOrigins,
    ["http://localhost:3000", "https://lictory-*-my-team.vercel.app"],
  );
});

void test("local and preview sign-ins use the proxy callback for Google and Microsoft", async () => {
  for (const origin of ["http://localhost:3000", previewOrigin]) {
    const app = realm(origin);
    for (const provider of ["google", "microsoft"]) {
      const response = await app.request("/sign-in/social", {
        provider,
        callbackURL: `${origin}/app/inbox`,
      });
      assert.equal(response.status, 200);
      const authorization = await authorizationURL(response);
      assert.equal(
        authorization.searchParams.get("client_id"),
        "development-client",
      );
      assert.equal(
        authorization.searchParams.get("redirect_uri"),
        `${proxyOrigin}/api/auth/callback/${provider}`,
      );
      assert.ok(authorization.searchParams.get("state"));
    }
  }
});

void test("the callback host keeps ordinary OAuth sign-ins direct", async () => {
  const app = realm(proxyOrigin);
  const response = await app.request("/sign-in/social", {
    provider: "google",
    callbackURL: `${proxyOrigin}/app`,
  });
  assert.equal(response.status, 200);
  const authorization = await authorizationURL(response);
  assert.equal(
    authorization.searchParams.get("redirect_uri"),
    `${proxyOrigin}/api/auth/callback/google`,
  );
  // Normal OAuth state is persisted directly, rather than wrapped for transport.
  assert.ok(
    app.data.verification.some((row) =>
      String(row.identifier).includes(authorization.searchParams.get("state")!),
    ),
  );
});

void test("Vercel previews return to their exact deployment and reject foreign origins", async () => {
  const app = realm(previewOrigin, {
    ...proxyEnv,
    BETTER_AUTH_URL: "https://production.example.test",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_URL: new URL(previewOrigin).hostname,
  });
  const proxy = realm(proxyOrigin);
  await mockGoogleCallback(proxy.auth);
  const started = await app.request("/sign-in/social", {
    provider: "google",
    callbackURL: `${previewOrigin}/app`,
  });
  assert.equal(started.status, 200);
  const authorization = await authorizationURL(started);
  const exchanged = await proxy.auth.handler(
    callbackRequest(authorization, { code: "test-code" }),
  );
  const completion = new URL(exchanged.headers.get("location")!);
  assert.equal(completion.origin, previewOrigin);
  const completed = await app.auth.handler(new Request(completion));
  assert.equal(completed.headers.get("location"), `${previewOrigin}/app`);
  assert.equal(app.data.session.length, 1);

  const foreign = await app.auth.handler(
    new Request(`${previewOrigin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        origin: "https://another-project.vercel.app",
        cookie: "consent=test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ provider: "google", callbackURL: "/app" }),
    }),
  );
  assert.equal(foreign.status, 403);
});

void test("a proxied sign-in creates the account and session only on the originating deployment", async () => {
  const proxy = realm(proxyOrigin);
  await mockGoogleCallback(proxy.auth);
  for (const origin of ["http://localhost:3000", previewOrigin]) {
    const app = realm(origin);
    const started = await app.request("/sign-in/social", {
      provider: "google",
      callbackURL: `${origin}/app/inbox`,
    });
    const authorization = await authorizationURL(started);
    const exchanged = await proxy.auth.handler(
      callbackRequest(authorization, { code: "test-code" }),
    );
    assert.equal(exchanged.status, 302);
    const completion = new URL(exchanged.headers.get("location")!);
    assert.equal(completion.origin, origin);
    assert.equal(completion.pathname, "/api/auth/callback/google/oauth-proxy");
    assert.ok(completion.searchParams.get("profile"));
    assert.equal(proxy.data.user.length, 0);
    assert.equal(proxy.data.account.length, 0);
    assert.equal(proxy.data.session.length, 0);

    const completed = await app.auth.handler(new Request(completion));
    assert.equal(completed.status, 302);
    assert.equal(completed.headers.get("location"), `${origin}/app/inbox`);
    assert.match(completed.headers.get("set-cookie")!, /session_token=/);
    assert.equal(app.data.user.length, 1);
    assert.equal(app.data.account[0]?.providerId, "google");
    assert.equal(app.data.session.length, 1);

    // State is consumed once, so replay cannot create another session.
    await app.auth.handler(new Request(completion));
    assert.equal(app.data.session.length, 1);
  }
});

void test("connecting Google links the originating account without creating users or sessions on the proxy", async () => {
  const app = realm(previewOrigin);
  const proxy = realm(proxyOrigin);
  await mockGoogleCallback(proxy.auth);
  const signup = await app.request("/sign-up/email", {
    name: "OAuth Tester",
    email: "oauth@example.test",
    password: "test-password-123",
  });
  assert.equal(signup.status, 200);
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const started = await app.request(
    "/link-social",
    {
      provider: "google",
      callbackURL: `${previewOrigin}/app/account?connected=google`,
    },
    cookie,
  );
  assert.equal(started.status, 200);
  const authorization = await authorizationURL(started);
  const exchanged = await proxy.auth.handler(
    callbackRequest(authorization, { code: "test-link-code" }),
  );
  const completed = await app.auth.handler(
    new Request(exchanged.headers.get("location")!),
  );
  assert.equal(completed.status, 302);
  assert.equal(
    completed.headers.get("location"),
    `${previewOrigin}/app/account?connected=google`,
  );
  assert.equal(app.data.user.length, 1);
  assert.equal(app.data.session.length, 1);
  assert.deepEqual(app.data.account.map((row) => row.providerId).sort(), [
    "credential",
    "google",
  ]);
  assert.ok(
    app.data.account.every((row) => row.userId === app.data.user[0]?.id),
  );
  assert.equal(proxy.data.user.length, 0);
  assert.equal(proxy.data.session.length, 0);
});

void test("provider cancellation returns to the originating sign-in page", async () => {
  const app = realm(previewOrigin);
  const proxy = realm(proxyOrigin);
  const started = await app.request("/sign-in/social", {
    provider: "google",
    callbackURL: `${previewOrigin}/app`,
    errorCallbackURL: `${previewOrigin}/sign-in`,
  });
  const authorization = await authorizationURL(started);
  const cancelled = await proxy.auth.handler(
    callbackRequest(authorization, { error: "access_denied" }),
  );
  assert.equal(cancelled.status, 302);
  assert.equal(
    cancelled.headers.get("location"),
    `${previewOrigin}/sign-in?error=access_denied`,
  );
  assert.equal(app.data.session.length, 0);
  assert.equal(proxy.data.session.length, 0);
});

void test("a different proxy secret cannot complete authentication", async () => {
  const app = realm(previewOrigin);
  const proxy = realm(proxyOrigin, {
    ...proxyEnv,
    OAUTH_PROXY_SECRET: "test-only-different-oauth-proxy-secret-32",
  });
  const started = await app.request("/sign-in/social", {
    provider: "google",
    callbackURL: `${previewOrigin}/app`,
  });
  const authorization = await authorizationURL(started);
  const rejected = await proxy.auth.handler(
    callbackRequest(authorization, { code: "test-code" }),
  );
  assert.equal(rejected.status, 302);
  assert.match(rejected.headers.get("location")!, /state_mismatch/);
  assert.equal(app.data.session.length, 0);
  assert.equal(proxy.data.session.length, 0);
});
