import assert from "node:assert/strict";
import { test } from "node:test";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  microsoftEmailPolicy,
  validateMicrosoftAccountLink,
} from "@lictory/core/lib/microsoft-auth";

async function fixture() {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  let verificationUrl = "";
  let email = "entra@example.test";
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-only-microsoft-secret-at-least-32-characters",
    database: memoryAdapter(data),
    logger: { disabled: true },
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ url }) => {
        verificationUrl = url;
      },
    },
    user: { validateUserInfo: validateMicrosoftAccountLink },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "microsoft"],
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    socialProviders: {
      microsoft: {
        clientId: "test-microsoft-client",
        clientSecret: "test-microsoft-secret",
        ...microsoftEmailPolicy,
      },
    },
  });
  // Replace only the external provider exchange. State, account binding,
  // linking policy, verification and session issuance run through Better Auth.
  const provider = (await auth.$context).socialProviders.find(
    (p) => p.id === "microsoft",
  )!;
  provider.validateAuthorizationCode = async () => ({
    accessToken: "test-token",
  });
  provider.getUserInfo = async () => ({
    user: {
      name: "Entra Person",
      email,
      ...microsoftEmailPolicy.mapProfileToUser(),
    },
    data: { oid: "stable-entra-object-id" },
  });
  async function roundTrip(
    linkCookie?: string,
    additionalData?: Record<string, unknown>,
  ) {
    const start = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/${linkCookie ? "link-social" : "sign-in/social"}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            ...(linkCookie ? { cookie: linkCookie } : {}),
          },
          body: JSON.stringify({
            provider: "microsoft",
            callbackURL: "/app",
            errorCallbackURL: "/sign-in",
            additionalData,
          }),
        },
      ),
    );
    assert.equal(start.status, 200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const cookies = start.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    return auth.handler(
      new Request(
        `http://localhost:3000/api/auth/callback/microsoft?code=test-code&state=${state}`,
        {
          headers: { cookie: [linkCookie, cookies].filter(Boolean).join("; ") },
        },
      ),
    );
  }
  async function passwordAccount() {
    await auth.api.signUpEmail({
      body: {
        name: "Local Person",
        email,
        password: "Local-test-password-123",
      },
    });
    // This fixture represents an existing verified password account.
    data.user![0]!.emailVerified = true;
    const response = await auth.api.signInEmail({
      body: { email, password: "Local-test-password-123" },
      asResponse: true,
    });
    return response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }
  return {
    auth,
    data,
    roundTrip,
    passwordAccount,
    verificationUrl: () => verificationUrl,
    changeEmail: (value: string) => {
      email = value;
    },
  };
}

void test("Microsoft signup verifies the mailbox before issuing a session, then returns by stable identity", async () => {
  const f = await fixture();
  const first = await f.roundTrip();
  assert.match(first.headers.get("location")!, /email_not_verified/);
  assert.equal(f.data.session!.length, 0);
  assert.equal(f.data.user![0]!.emailVerified, false);
  assert.equal(f.data.account![0]!.accountId, "stable-entra-object-id");
  const verified = await f.auth.handler(new Request(f.verificationUrl()));
  assert.equal(verified.status, 302);
  assert.equal(f.data.user![0]!.emailVerified, true);
  f.changeEmail("changed-by-tenant@example.test");
  const returning = await f.roundTrip();
  assert.equal(returning.headers.get("location"), "/app");
  assert.equal(f.data.user!.length, 1);
  assert.equal(f.data.user![0]!.email, "entra@example.test");
});

void test("Microsoft cannot implicitly link by email or spoof explicit link state", async () => {
  const f = await fixture();
  await f.passwordAccount();
  const response = await f.roundTrip(undefined, {
    link: { userId: f.data.user![0]!.id, email: "entra@example.test" },
  });
  assert.match(response.headers.get("location")!, /account_not_linked/);
  assert.equal(f.data.account!.length, 1);
});

void test("an authenticated account explicitly connects Microsoft without changing its profile", async () => {
  const f = await fixture();
  const cookie = await f.passwordAccount();
  const response = await f.roundTrip(cookie);
  assert.equal(response.headers.get("location"), "/app");
  assert.equal(f.data.account!.length, 2);
  assert.equal(f.data.user![0]!.name, "Local Person");
  assert.equal(f.data.user![0]!.emailVerified, true);
});

void test("explicit Microsoft linking rejects a different email", async () => {
  const f = await fixture();
  const cookie = await f.passwordAccount();
  f.changeEmail("different@example.test");
  const response = await f.roundTrip(cookie);
  assert.match(response.headers.get("location")!, /email_does_not_match/);
  assert.equal(f.data.account!.length, 1);
});
