import { test, expect } from "@playwright/test";
import { signedIn } from "../helpers/app-urls";

// Company single sign-on through a real OpenID Connect provider: the local Dex
// from `docker compose --profile sso up -d dex` (deploy/dex/development.yaml).
// scripts/test-e2e.ts configures the API for it when E2E_OIDC_ISSUER is set,
// for example E2E_OIDC_ISSUER=http://127.0.0.1:5556/dex. Without a reachable
// provider the test is skipped, so the suite runs without the container.
const issuer = process.env.E2E_OIDC_ISSUER?.trim();

async function providerReachable() {
  if (!issuer) return false;
  try {
    const response = await fetch(
      `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    );
    return response.ok;
  } catch {
    return false;
  }
}

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.102.${(testInfo.line % 254) + 1}`,
  });
});

test("a person signs in with the company identity provider and gets a verified account", async ({
  page,
}) => {
  test.skip(
    !(await providerReachable()),
    "Set E2E_OIDC_ISSUER and start the local Dex (docker compose --profile sso up -d dex).",
  );

  await page.goto("/sign-in?callbackUrl=%2F");
  // The operator's display name labels the button; passwords stay available.
  const sso = page.getByRole("button", { name: "Continue with Acme SSO" });
  await expect(sso).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await sso.click();

  // Dex's own login page.
  await page.waitForURL((url) => url.origin === new URL(issuer!).origin);
  await page.locator('input[name="login"]').fill("ada@sso.example.test");
  await page.locator('input[name="password"]').fill("Local-sso-password-123");
  await page.locator('button[type="submit"]').click();

  // Back in Lictory with a session: a new account chooses its handle first.
  await expect(page).toHaveURL(signedIn);
  await expect(
    page.getByRole("heading", { name: "Choose your handle" }),
  ).toBeVisible();
  const session = (await (await page.request.get("/api/session")).json()) as {
    user: { email: string; emailVerified: boolean } | null;
  };
  expect(session.user).toMatchObject({
    email: "ada@sso.example.test",
    // Dex vouches for the address (email_verified), so no verification email.
    emailVerified: true,
  });
});
