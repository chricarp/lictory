import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import {
  oidcPlugins,
  oidcSettings,
  passwordFlowClosed,
  passwordLoginEnabled,
  validateOidcAccountLink,
} from "@lictory/core/lib/sso";

// A minimal identity provider: discovery, token and userinfo endpoints. The
// profile it returns is set per test; everything else (state, PKCE, account
// binding, linking policy, verification, sessions) runs through Better Auth.
let idp: Server;
let issuer = "";
let profile: Record<string, unknown> = {};

before(async () => {
  idp = createServer((request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    const json = (body: unknown) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/keys`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (url.pathname === "/token")
      return json({ access_token: "test-access-token", token_type: "Bearer" });
    if (url.pathname === "/userinfo") return json(profile);
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
});
after(() => idp.close());

const origin = "http://localhost:3000";
const password = "Local-test-password-123";

async function fixture(env: Record<string, string> = {}) {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const sent: string[] = [];
  const settings = oidcSettings({
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: "lictory",
    OIDC_CLIENT_SECRET: "test-only-client-secret",
    ...env,
  });
  const auth = betterAuth({
    baseURL: origin,
    secret: "test-only-oidc-secret-with-at-least-32-characters",
    database: memoryAdapter(data),
    logger: { disabled: true },
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user }) => {
        sent.push(user.email);
      },
    },
    user: { validateUserInfo: validateOidcAccountLink },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "microsoft", "oidc"],
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    plugins: oidcPlugins(settings),
  });

  // With a session cookie, connects the provider from Account settings.
  async function signInWithProvider(
    session?: string,
    additionalData?: Record<string, unknown>,
  ) {
    const start = await auth.handler(
      new Request(
        `${origin}/api/auth/${session ? "link-social" : "sign-in/social"}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            ...(session ? { cookie: session } : {}),
          },
          body: JSON.stringify({
            provider: "oidc",
            callbackURL: "/app",
            errorCallbackURL: "/sign-in",
            additionalData,
          }),
        },
      ),
    );
    assert.equal(start.status, 200);
    const { url } = (await start.json()) as { url: string };
    const authorize = new URL(url);
    assert.equal(authorize.origin + authorize.pathname, `${issuer}/authorize`);
    assert.ok(authorize.searchParams.get("code_challenge"));
    assert.deepEqual(authorize.searchParams.get("scope")!.split(" ").sort(), [
      "email",
      "openid",
      "profile",
    ]);
    const cookie = start.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const state = authorize.searchParams.get("state")!;
    const callback = await auth.handler(
      new Request(
        `${origin}/api/auth/callback/oidc?code=test-code&state=${state}`,
        { headers: { cookie: [session, cookie].filter(Boolean).join("; ") } },
      ),
    );
    return callback.headers.get("location") ?? "";
  }

  async function passwordAccount(email: string) {
    await auth.api.signUpEmail({
      body: { name: "Local Person", email, password },
    });
    // An existing account whose email Lictory verified.
    data.user!.find((u) => u.email === email)!.emailVerified = true;
    const response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    return response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  return { data, sent, signInWithProvider, passwordAccount };
}

void test("a verified company email signs in a new person and records the provider account", async () => {
  const f = await fixture();
  profile = {
    sub: "employee-1",
    email: "ada@company.test",
    email_verified: true,
    given_name: "Ada",
    family_name: "Lovelace",
  };
  assert.equal(await f.signInWithProvider(), "/app");
  assert.equal(f.data.user!.length, 1);
  assert.equal(f.data.user![0]!.name, "Ada Lovelace");
  assert.equal(f.data.user![0]!.emailVerified, true);
  assert.equal(f.data.account![0]!.providerId, "oidc");
  assert.equal(f.data.account![0]!.accountId, "employee-1");
  assert.equal(f.data.session!.length, 1);
});

void test("an email the provider does not vouch for gets no session until Lictory verifies it", async () => {
  const f = await fixture();
  profile = { sub: "employee-2", email: "grace@company.test", name: "Grace" };
  assert.match(await f.signInWithProvider(), /error=email_not_verified/);
  assert.equal(f.data.session!.length, 0);
  assert.equal(f.data.user![0]!.emailVerified, false);
  assert.deepEqual(f.sent, ["grace@company.test"]);
});

void test("an existing account is linked only when the provider verified the same email", async () => {
  const f = await fixture();
  await f.passwordAccount("linus@company.test");

  profile = { sub: "employee-3", email: "linus@company.test", name: "Linus" };
  assert.match(await f.signInWithProvider(), /error=account_not_linked/);
  assert.equal(f.data.account!.length, 1);

  profile = { ...profile, email_verified: "false" };
  assert.match(await f.signInWithProvider(), /error=account_not_linked/);

  profile = { ...profile, email_verified: true };
  assert.equal(await f.signInWithProvider(), "/app");
  assert.equal(f.data.user!.length, 1);
  assert.deepEqual(f.data.account!.map((a) => a.providerId).sort(), [
    "credential",
    "oidc",
  ]);
  // The provider never rewrites the Lictory profile.
  assert.equal(f.data.user![0]!.name, "Local Person");
});

void test("a signed-in person connects the provider explicitly even without its email claim", async () => {
  const f = await fixture();
  const session = await f.passwordAccount("joan@company.test");
  profile = { sub: "employee-4", email: "joan@company.test", name: "Joan" };
  // Client-supplied link data cannot stand in for the session.
  assert.match(
    await f.signInWithProvider(undefined, {
      link: { userId: f.data.user![0]!.id, email: "joan@company.test" },
    }),
    /error=account_not_linked/,
  );
  assert.equal(await f.signInWithProvider(session), "/app");
  assert.deepEqual(f.data.account!.map((a) => a.providerId).sort(), [
    "credential",
    "oidc",
  ]);
  // Returning sign-ins use the stable subject.
  assert.equal(await f.signInWithProvider(), "/app");

  // The same email is still required.
  const other = await f.passwordAccount("kim@company.test");
  profile = { sub: "employee-5", email: "someone-else@company.test" };
  assert.match(await f.signInWithProvider(other), /error=email_does_not_match/);
});

void test("without auto-creation only people with an account can sign in", async () => {
  const f = await fixture({ OIDC_AUTO_CREATE_USERS: "false" });
  profile = {
    sub: "stranger",
    email: "new@company.test",
    email_verified: true,
  };
  assert.match(await f.signInWithProvider(), /error=signup_disabled/);
  assert.equal(f.data.user!.length, 0);

  await f.passwordAccount("known@company.test");
  profile = { sub: "known", email: "known@company.test", email_verified: true };
  assert.equal(await f.signInWithProvider(), "/app");
});

void test("settings: empty values are unset, the three essentials go together", () => {
  assert.equal(oidcSettings({}), null);
  assert.equal(
    oidcSettings({
      OIDC_ISSUER: " ",
      OIDC_CLIENT_ID: "",
      OIDC_CLIENT_SECRET: "",
    }),
    null,
  );
  assert.throws(
    () => oidcSettings({ OIDC_ISSUER: "https://idp.example.test" }),
    /together/,
  );
  const essentials = { OIDC_CLIENT_ID: "id", OIDC_CLIENT_SECRET: "secret" };
  const settings = oidcSettings({
    ...essentials,
    OIDC_ISSUER: " https://idp.example.test/realms/acme/ ",
    OIDC_SCOPES: "profile, groups",
    OIDC_DISPLAY_NAME: "Acme",
  })!;
  assert.equal(
    settings.discoveryUrl,
    "https://idp.example.test/realms/acme/.well-known/openid-configuration",
  );
  assert.deepEqual(settings.scopes, ["openid", "email", "profile", "groups"]);
  assert.equal(settings.displayName, "Acme");
  assert.equal(settings.autoCreateUsers, true);
  assert.equal(
    oidcSettings({
      ...essentials,
      OIDC_ISSUER: "https://idp.example.test/.well-known/openid-configuration",
    })!.discoveryUrl,
    "https://idp.example.test/.well-known/openid-configuration",
  );
  // ID tokens are verified against what discovery returns: HTTPS only,
  // except on this machine during development.
  assert.throws(
    () =>
      oidcSettings({ ...essentials, OIDC_ISSUER: "http://idp.example.test" }),
    /HTTPS/,
  );
  assert.ok(
    oidcSettings({ ...essentials, OIDC_ISSUER: "http://localhost:5556/dex" }),
  );
  assert.throws(
    () =>
      oidcSettings({
        ...essentials,
        OIDC_ISSUER: "https://idp.example.test",
        OIDC_AUTO_CREATE_USERS: "maybe",
      }),
    /true or false/,
  );
});

void test("password login can be turned off only when an identity provider exists", () => {
  assert.equal(passwordLoginEnabled({}, false), true);
  assert.equal(
    passwordLoginEnabled({ PASSWORD_LOGIN_ENABLED: "" }, false),
    true,
  );
  assert.equal(
    passwordLoginEnabled({ PASSWORD_LOGIN_ENABLED: "false" }, true),
    false,
  );
  assert.throws(
    () => passwordLoginEnabled({ PASSWORD_LOGIN_ENABLED: "false" }, false),
    /requires an identity provider/,
  );
});

void test("an SSO-only server rejects password sign-in, sign-up and resets", async () => {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: origin,
    secret: "test-only-oidc-secret-with-at-least-32-characters",
    database: memoryAdapter(data),
    logger: { disabled: true },
    emailAndPassword: {
      enabled: false,
      sendResetPassword: async () => assert.fail("no reset email"),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        passwordFlowClosed(ctx.path, false);
      }),
    },
  });
  const post = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      }),
    );
  const credentials = { name: "P", email: "p@company.test", password };
  for (const [path, body] of [
    ["/sign-up/email", credentials],
    ["/sign-in/email", credentials],
    ["/request-password-reset", { email: credentials.email }],
    ["/reset-password", { token: "t", newPassword: password }],
  ] as const) {
    const response = await post(path, body);
    assert.equal(response.status, 400, path);
  }
  assert.equal(data.user!.length, 0);
  assert.doesNotThrow(() => passwordFlowClosed("/sign-in/email", true));
});
