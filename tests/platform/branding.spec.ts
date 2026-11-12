import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "../helpers/onboarding-helpers";
import { inApp } from "../helpers/app-urls";
import { clientAddress } from "../helpers/client-address";

const email = "branding@example.test";
const password = "Local-test-password-123";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
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

test("an administrator brands the organization with its logos, browser icon and color", async ({
  page,
  playwright,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);
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
  await expect(
    page.getByRole("button", { name: "Replace", exact: true }),
  ).toHaveCount(1);
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

  // The browser tab wears the logomark until a browser icon is uploaded.
  const tabIcon = page.locator('link[rel="icon"]');
  await expect(tabIcon).toHaveAttribute("href", /\/logo\/mark\?v=/);
  await page.getByLabel("Upload browser icon").setInputFiles({
    name: "icon.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(tabIcon).toHaveAttribute("href", /\/logo\/icon\?v=/);

  // The brand color tints primary actions; a pale one is darkened for
  // contrast, and resetting returns to Lictory's color.
  const primary = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--primary")
        .trim(),
    );
  const defaultPrimary = await primary();
  await page.getByLabel("Brand color", { exact: true }).fill("#1D4ED8");
  await page.getByRole("button", { name: "Save color" }).click();
  await expect.poll(primary).toBe("#1d4ed8");
  await page.reload();
  await expect.poll(primary).toBe("#1d4ed8");
  await page.getByLabel("Brand color", { exact: true }).fill("not a color");
  await page.getByRole("button", { name: "Save color" }).click();
  await expect(
    page.getByText("Enter the color as six hexadecimal digits"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset brand color" }).click();
  await expect.poll(primary).toBe(defaultPrimary);

  // Email clients load logos without a session, by content hash only.
  const organizationId = (await tabIcon.getAttribute("href"))!.split("/")[3]!;
  const anonymous = await playwright.request.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const sha = createHash("sha256").update(png).digest("hex");
  const logoPath = `/api/organizations/${organizationId}/logo/mark`;
  expect((await anonymous.get(`${logoPath}/${sha}`)).status()).toBe(200);
  expect((await anonymous.get(`${logoPath}/${"0".repeat(64)}`)).status()).toBe(
    404,
  );
  expect((await anonymous.get(logoPath)).status()).toBe(401);
  await anonymous.dispose();

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
  await page.getByRole("button", { name: "Remove browser icon" }).click();
  await expect(tabIcon).toHaveAttribute("href", /\/logo\/mark\?v=/);
  await page.getByRole("button", { name: "Remove logomark" }).click();
  await expect(tabIcon).toHaveAttribute("href", "/icon.svg");
  await expect(switcher.locator("img")).toHaveCount(0);
  await expect(switcher).toContainText("Brand Co");
});
