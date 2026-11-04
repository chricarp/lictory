import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { consentStatePath } from "../consent-setup";
import { clientAddress, useClientAddress } from "../helpers/client-address";

// Sign-in and sign-up are rate limited per client address: this page
// authenticates from its own.
test.beforeEach(async ({ page }) => {
  await useClientAddress(page);
});

// Instance administration in the browser: an instance administrator creates
// an account and an organization for it, deactivates the account (which can
// no longer sign in), reactivates it, and finds each change in the activity.

const password = "Admin-console-test-password-123";
// A retry runs in a new worker that seeds again; each worker gets its own users.
const run = crypto.randomUUID().slice(0, 8);
const administrator = {
  id: crypto.randomUUID(),
  name: "Instance Admin",
  email: `instance-admin-${run}@example.test`,
  handle: `instance_admin_${run}`,
};
const newcomer = {
  name: `Console Newcomer ${run}`,
  email: `console-newcomer-${run}@example.test`,
  password: "Newcomer-password-123",
};
const organization = `Console Org ${run}`;

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client, { schema: s });
    await db
      .insert(s.user)
      .values({ ...administrator, emailVerified: true, instanceAdmin: true });
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: administrator.id,
      accountId: administrator.id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  } finally {
    await client.end();
  }
});

async function signIn(page: Page, email: string, secret: string) {
  // Its own client address: sign-in is rate limited per address.
  await useClientAddress(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("an instance administrator manages accounts and organizations from the admin console", async ({
  page,
  browser,
  context,
}) => {
  test.setTimeout(90_000);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
  await signIn(page, administrator.email, password);
  // Without an organization, the entry page leads to the console.
  await page.getByRole("button", { name: /Open the admin console/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("heading", { name: "Admin console", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Instance administrators")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Access policy", exact: true }),
  ).toBeVisible();

  // A new account with a password.
  await page.getByRole("link", { name: "People", exact: true }).click();
  await page.getByRole("button", { name: "New account" }).click();
  const form = page.getByRole("form", { name: "New account" });
  await form.getByLabel("Full name").fill(newcomer.name);
  await form.getByLabel("Work email").fill(newcomer.email);
  await form.getByLabel(/Initial password/).fill(newcomer.password);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`Created ${newcomer.email}`)).toBeVisible();
  const row = page
    .getByTestId("admin-person")
    .filter({ hasText: newcomer.email });
  await expect(row).toContainText("no organization");

  // An organization owned by the new account.
  await page.getByRole("link", { name: "Organizations", exact: true }).click();
  await page.getByRole("button", { name: "New organization" }).click();
  const orgForm = page.getByRole("form", { name: "New organization" });
  await orgForm.getByLabel("Organization name").fill(organization);
  await orgForm.getByLabel("Owner’s email").fill(newcomer.email);
  await orgForm.getByRole("button", { name: "Create organization" }).click();
  await expect(
    page.getByTestId("admin-organization").filter({ hasText: organization }),
  ).toContainText(`owned by ${newcomer.name}`);

  // Deactivation signs the account out and keeps it out.
  await page.getByRole("link", { name: "People", exact: true }).click();
  await row.getByRole("button", { name: `Manage ${newcomer.name}` }).click();
  await row.getByRole("button", { name: "Deactivate…" }).click();
  await row
    .getByRole("button", { name: `Confirm: deactivate ${newcomer.name}` })
    .click();
  await expect(row.getByText("Deactivated", { exact: true })).toBeVisible();

  const other = await browser.newContext({
    storageState: consentStatePath,
    extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
  });
  const person = await other.newPage();
  await signIn(person, newcomer.email, newcomer.password);
  await expect(person.getByRole("alert")).toContainText("deactivated");

  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(row.getByText("Deactivated", { exact: true })).toBeHidden();
  await signIn(person, newcomer.email, newcomer.password);
  // A new account chooses its handle first, then reaches its organization.
  await expect(person).toHaveURL(/\/welcome/);
  await other.close();

  await page.getByRole("link", { name: "Activity", exact: true }).click();
  const activity = page.getByTestId("admin-activity");
  for (const label of [
    "Created an account",
    "Created an organization",
    "Deactivated an account",
    "Reactivated an account",
  ])
    await expect(activity.filter({ hasText: label }).first()).toContainText(
      administrator.name,
    );
});
