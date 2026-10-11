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
import * as s from "../src/db/schema";

const password = "Local-test-password-123";

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${(testInfo.line % 254) + 1}`,
  });
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
    await db
      .insert(s.user)
      .values({ id, name: "Gale Google", email, emailVerified: true, handle });
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

async function addGoogleAccount(userId: string) {
  await withDb((db) =>
    db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId,
      accountId: `google-${userId}`,
      providerId: "google",
    }),
  );
}

async function signIn(page: Page, email: string, secret = password) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/(app|welcome)/);
  await page.waitForLoadState("networkidle");
}

// Stops the browser at Google and returns the authorization request.
async function interceptGoogle(page: Page) {
  let authorize: URL | undefined;
  await page.route("https://accounts.google.com/**", async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ contentType: "text/html", body: "Google" });
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

test("continuing with Google from sign-in and sign-up asks Google for this application", async ({
  page,
}) => {
  const authorize = await interceptGoogle(page);
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(`${path}?callbackUrl=%2Fapp%2Finbox`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect.poll(() => authorize()?.pathname).toContain("/o/oauth2/");
    const url = authorize()!;
    expect(url.searchParams.get("client_id")).toBe("e2e-google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/auth/callback/google",
    );
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")).toContain("email");
  }

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

test("a password account connects and disconnects Google from account settings", async ({
  page,
}) => {
  const email = `google-link-${crypto.randomUUID()}@example.test`;
  const userId = await createPasswordUser(email, "gale_link");
  await signIn(page, email);
  await page.goto("/app/account");
  const connections = page.locator("section#connections");
  await expect(connections).toContainText("Not connected.");

  const authorize = await interceptGoogle(page);
  await connections.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => authorize()?.pathname).toContain("/o/oauth2/");
  expect(authorize()!.searchParams.get("redirect_uri")).toBe(
    "http://localhost:3001/api/auth/callback/google",
  );

  // Google returned a different address: explained, then the URL is cleaned.
  await page.goto("/app/account?error=email_does_not_match");
  await expect(connections).toContainText("uses a different email address");
  await expect(page).toHaveURL(/\/app\/account$/);

  // Google linked (the provider callback is outside the browser's reach).
  await addGoogleAccount(userId);
  await page.goto("/app/account?connected=google");
  await expect(connections).toContainText("Google connected.");
  await expect(
    connections.getByText("Connected", { exact: true }),
  ).toBeVisible();

  await connections.getByRole("button", { name: "Disconnect" }).click();
  await expect(connections).toContainText("Google disconnected.");
  await expect(connections).toContainText("Not connected.");
  const remaining = await withDb((db) =>
    db
      .select({ providerId: s.account.providerId })
      .from(s.account)
      .where(eq(s.account.userId, userId)),
  );
  expect(remaining.map((a) => a.providerId)).toEqual(["credential"]);
});

test("a Google-only account keeps its last sign-in method and can add a password", async ({
  page,
  request,
}) => {
  const email = `google-only-${crypto.randomUUID()}@example.test`;
  const userId = await createPasswordUser(email, "gale_only");
  await addGoogleAccount(userId);
  await signIn(page, email);
  // Leave Google as the only sign-in method, as after a Google sign-up.
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

  await page.goto("/app/account");
  const connections = page.locator("section#connections");
  await expect(connections).toContainText("Your only way to sign in.");
  await expect(
    connections.getByRole("button", { name: "Disconnect" }),
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
  await expect(page.getByText("Your password has been updated.")).toBeVisible();

  // Setting the password signed every session out; both methods now work.
  await signIn(page, email, newPassword);
  await page.goto("/app/account");
  await expect(
    page.locator("section#password").getByRole("button", {
      name: "Update password",
    }),
  ).toBeVisible();
  await expect(
    connections.getByRole("button", { name: "Disconnect" }),
  ).toBeEnabled();
});
