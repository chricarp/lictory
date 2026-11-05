import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { platformOrigin, signedIn } from "../helpers/app-urls";
import { clientAddress, useClientAddress } from "../helpers/client-address";

const password = "Local-test-password-123";

test.beforeEach(async ({ context }) => {
  // Each case gets its own rate limit bucket while keeping production
  // authentication limits enabled.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

async function withDb<T>(run: (db: ReturnType<typeof drizzle>) => Promise<T>) {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
}

async function createPasswordUser(email: string, handle: string) {
  return withDb(async (db) => {
    const id = crypto.randomUUID();
    await db.insert(s.user).values({
      id,
      name: "Social Sign-in Person",
      email,
      emailVerified: true,
      handle,
    });
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
    return id;
  });
}

async function addProviderAccount(userId: string, provider: string) {
  await withDb((db) =>
    db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId,
      accountId: `${provider}-${userId}`,
      providerId: provider,
    }),
  );
}

async function signIn(page: Page, email: string, secret = password) {
  // Its own client address: sign-in is rate limited per address.
  await useClientAddress(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(signedIn);
  await page.waitForLoadState("networkidle");
}

// Stops the browser at the provider and returns the authorization request.
async function interceptProvider(page: Page, host: string) {
  let authorize: URL | undefined;
  await page.route(`https://${host}/**`, async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ contentType: "text/html", body: "Provider" });
  });
  return () => authorize;
}

async function resetLink(request: APIRequestContext, recipient: string) {
  const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
  let id: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(`${mailpit}/api/v1/search`, {
        params: {
          query: `to:${recipient} subject:"Reset your Lictory password"`,
        },
      });
      const result = (await response.json()) as { messages: { ID: string }[] };
      id = result.messages[0]?.ID;
      return Boolean(id);
    })
    .toBe(true);
  const message = (await (
    await request.get(`${mailpit}/api/v1/message/${id}`)
  ).json()) as { Text: string };
  return /Reset password: (https?:\/\/\S+)/.exec(message.Text)![1]!;
}

const providers = [
  {
    id: "google",
    label: "Google",
    host: "accounts.google.com",
    path: "/o/oauth2/",
  },
  {
    id: "microsoft",
    label: "Microsoft",
    host: "login.microsoftonline.com",
    path: "/common/oauth2/v2.0/authorize",
  },
] as const;

for (const {
  id: provider,
  label,
  host,
  path: authorizationPath,
} of providers) {
  test(`continuing with ${label} from sign-in and sign-up asks the provider for this application`, async ({
    page,
  }) => {
    const authorize = await interceptProvider(page, host);
    for (const path of ["/sign-in", "/sign-up"]) {
      await page.goto(`${path}?callbackUrl=%2Facme%2Finbox`);
      await page
        .getByRole("button", { name: `Continue with ${label}` })
        .click();
      await page.waitForURL((url) => url.hostname === host);
      await expect
        .poll(() => authorize()?.pathname)
        .toContain(authorizationPath);
      const url = authorize()!;
      expect(url.searchParams.get("client_id")).toBe(
        `e2e-${provider}-client-id`,
      );
      expect(url.searchParams.get("redirect_uri")).toBe(
        `${platformOrigin}/api/auth/callback/${provider}`,
      );
      expect(url.searchParams.get("prompt")).toBe("select_account");
      expect(url.searchParams.get("scope")).toContain("email");
    }

    const url = authorize()!;
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    // Return through the real callback with cancellation and its signed state.
    await page.goto(
      `/api/auth/callback/${provider}?error=access_denied&state=${url.searchParams.get("state")}`,
    );
    await expect(page).toHaveURL(
      /sign-up\?callbackUrl=%2Facme%2Finbox&error=access_denied/,
    );
    await expect(
      page.getByRole("alert").filter({ hasText: "Sign-in was cancelled" }),
    ).toBeVisible();

    // A failed provider round trip comes back to the page with an explanation.
    await page.goto("/sign-in?error=account_not_linked");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "can't be connected automatically" }),
    ).toBeVisible();
    await page.goto("/sign-up?error=access_denied");
    await expect(
      page.getByRole("alert").filter({ hasText: "Sign-in was cancelled" }),
    ).toBeVisible();
  });

  test(`a password account connects and disconnects ${label} from account settings`, async ({
    page,
  }) => {
    const email = `${provider}-link-${crypto.randomUUID()}@example.test`;
    const userId = await createPasswordUser(email, `gale_${provider}_link`);
    await signIn(page, email);
    await page.goto("/account");
    const connections = page.locator("section#connections");
    const providerRow = connections
      .locator("div.flex.items-center.gap-3")
      .filter({ hasText: label });
    await expect(connections).toContainText("Not connected.");

    const authorize = await interceptProvider(page, host);
    await providerRow
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    // The provider page must have replaced the account page before the next
    // navigation: otherwise the provider redirect, still in flight on a busy
    // machine, replaces /account below and that navigation never loads.
    await page.waitForURL((url) => url.hostname === host);
    await expect.poll(() => authorize()?.pathname).toContain(authorizationPath);
    expect(authorize()!.searchParams.get("redirect_uri")).toBe(
      `${platformOrigin}/api/auth/callback/${provider}`,
    );

    // The provider returned a different address: explained, then the URL is cleaned.
    await page.goto("/account?error=email_does_not_match");
    await expect(connections).toContainText("uses a different email address");
    await expect(page).toHaveURL(/\/account$/);

    // The provider linked (the provider callback is outside the browser's reach).
    await addProviderAccount(userId, provider);
    await page.goto(`/account?connected=${provider}`);
    await expect(connections).toContainText(`${label} connected.`);
    await expect(
      providerRow.getByText("Connected", { exact: true }),
    ).toBeVisible();

    await providerRow
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await expect(connections).toContainText(`${label} disconnected.`);
    await expect(connections).toContainText("Not connected.");
    const remaining = await withDb((db) =>
      db
        .select({ providerId: s.account.providerId })
        .from(s.account)
        .where(eq(s.account.userId, userId)),
    );
    expect(remaining.map((a) => a.providerId)).toEqual(["credential"]);
  });

  test(`a ${label}-only account keeps its last sign-in method and can add a password`, async ({
    page,
    request,
  }) => {
    const email = `${provider}-only-${crypto.randomUUID()}@example.test`;
    const userId = await createPasswordUser(email, `gale_${provider}_only`);
    await addProviderAccount(userId, provider);
    await signIn(page, email);
    // Leave the provider as the only sign-in method, as after a social sign-up.
    await withDb((db) =>
      db
        .delete(s.account)
        .where(
          and(
            eq(s.account.userId, userId),
            eq(s.account.providerId, "credential"),
          ),
        ),
    );

    await page.goto("/account");
    const connections = page.locator("section#connections");
    const providerRow = connections
      .locator("div.flex.items-center.gap-3")
      .filter({ hasText: label });
    await expect(connections).toContainText("Your only way to sign in.");
    await expect(
      providerRow.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeDisabled();

    const passwordSection = page.locator("section#password");
    await expect(passwordSection).toContainText("Not set");
    await passwordSection
      .getByRole("button", { name: "Email me a link" })
      .click();
    await expect(passwordSection).toContainText(`Check ${email}`);

    const newPassword = "Chosen-after-google-789";
    await page.goto(await resetLink(request, email));
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(
      page.getByText("Your password has been updated."),
    ).toBeVisible();

    // Setting the password signed every session out; both methods now work.
    await signIn(page, email, newPassword);
    await page.goto("/account");
    await expect(
      page.locator("section#password").getByRole("button", {
        name: "Update password",
      }),
    ).toBeVisible();
    await expect(
      providerRow.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeEnabled();
  });

  test(`${label} sign-in prevents duplicate requests and recovers from a failed request`, async ({
    page,
  }) => {
    let finish: (() => void) | undefined;
    await page.route("**/api/auth/sign-in/social", async (route) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Provider unavailable" }),
      });
    });
    await page.goto("/sign-in");
    await page.getByRole("button", { name: `Continue with ${label}` }).click();
    await expect(
      page.getByRole("button", { name: `Redirecting to ${label}…` }),
    ).toBeDisabled();
    const other = label === "Google" ? "Microsoft" : "Google";
    await expect(
      page.getByRole("button", { name: `Continue with ${other}` }),
    ).toBeDisabled();
    await expect(
      page.getByRole("status").filter({ hasText: `Redirecting to ${label}` }),
    ).toHaveText(`Redirecting to ${label}…`);
    await expect.poll(() => Boolean(finish)).toBe(true);
    finish!();
    await expect(
      page.getByRole("alert").filter({ hasText: `We couldn't reach ${label}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Continue with ${label}` }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: `Continue with ${other}` }),
    ).toBeEnabled();
    await page.unroute("**/api/auth/sign-in/social");
    const authorize = await interceptProvider(page, host);
    await page.getByRole("button", { name: `Continue with ${label}` }).click();
    await expect.poll(() => authorize()?.hostname).toBe(host);
  });
}
