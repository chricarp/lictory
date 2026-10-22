import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "./onboarding-helpers";

const email = "branding@example.test";
const password = "Local-test-password-123";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.240" });
});
test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(s.user)
    .values({
      id,
      name: "Morgan Brand",
      email,
      emailVerified: true,
      handle: "morgan_brand",
    })
    .onConflictDoNothing()
    .returning({ id: s.user.id });
  if (inserted.length)
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  await client.end();
});

async function loaded(page: Page, selector: string) {
  await expect
    .poll(() =>
      page
        .locator(selector)
        .first()
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);
}

test("an administrator brands the organization switcher with its logos", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Brand Co",
    project: "Brand project",
    key: "BRD",
  });

  const switcher = page.getByRole("button", { name: "Brand Co" }).first();
  await expect(switcher).toContainText("B");
  await expect(switcher.locator("img")).toHaveCount(0);

  await page
    .getByRole("link", { name: "Organization settings", exact: true })
    .click();
  await page.getByLabel("Upload logomark").setInputFiles({
    name: "mark.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByRole("button", { name: "Replace" })).toHaveCount(1);
  await expect(switcher.locator("img")).toHaveCount(1);
  await loaded(page, 'img[src*="/logo/mark"]');
  await expect(switcher).toContainText("Brand Co");

  // The full logo replaces the visible name but keeps the accessible name.
  await page.getByLabel("Upload full logo").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(switcher.locator('img[src*="/logo/full"]')).toHaveCount(1);
  await loaded(page, 'img[src*="/logo/full"]');
  await expect(page.getByRole("button", { name: "Brand Co" })).toHaveCount(1);

  // A collapsed sidebar shows the logomark.
  await page.getByRole("button", { name: "Collapse app sidebar" }).click();
  const collapsed = page.getByRole("button", {
    name: "Switch organization: Brand Co",
  });
  await expect(collapsed.locator('img[src*="/logo/mark"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Expand app sidebar" }).click();

  // Unsupported formats are refused with an actionable message.
  await page.getByLabel("Upload logomark").setInputFiles({
    name: "mark.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(
    page.getByText("Upload a PNG, JPEG or WebP image."),
  ).toBeVisible();

  // Removing reverses the upload.
  await page.getByRole("button", { name: "Remove full logo" }).click();
  await page.getByRole("button", { name: "Remove logomark" }).click();
  await expect(switcher.locator("img")).toHaveCount(0);
  await expect(switcher).toContainText("Brand Co");
});
