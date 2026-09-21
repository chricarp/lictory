import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
const email = "reviewer@example.test";
const password = "Local-test-password-123";
test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const userId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Alex Morgan", email, emailVerified: true });
  await db.insert(s.account).values({
    id: crypto.randomUUID(),
    userId,
    accountId: userId,
    providerId: "credential",
    password: await hashPassword(password),
  });
  const teammateId = crypto.randomUUID();
  await db.insert(s.user).values({
    id: teammateId,
    name: "Riley Chen",
    email: "teammate@example.test",
    emailVerified: true,
  });
  await db.insert(s.account).values({
    id: crypto.randomUUID(),
    userId: teammateId,
    accountId: teammateId,
    providerId: "credential",
    password: await hashPassword(password),
  });
  await client.end();
});
async function signIn(page: Page, loginEmail = email) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email", { exact: true }).fill(loginEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
}
test("authenticated proposal, review, two-client sync, offline queue, revision history, archive", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.getByLabel("Organization name").fill("Northstar");
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await page.getByLabel("Product name").first().fill("Payments");
  await page
    .getByRole("button", { name: "Create product", exact: true })
    .first()
    .click();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await page.getByRole("button", { name: "New proposal", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Safe payment retries");
  await page
    .getByLabel("Problem / intent")
    .fill("Customers need retries without duplicate charges.");
  await page
    .getByRole("button", { name: "Create proposal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Safe payment retries", exact: true }),
  ).toBeVisible();
  const url = page.url();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other);
  await other.goto(url);
  await expect(
    other.getByRole("heading", { name: "Safe payment retries", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Alex Morgan: granted")).toBeVisible();
  await page
    .getByRole("textbox", { name: "MARKDOWN SPECIFICATION" })
    .fill(
      "# Safe payment retries\n\nRetries reuse the original transaction ID.\n\n## Acceptance criteria\n\nA repeated request must not create a second charge.",
    );
  await page.getByLabel("What changed?").fill("Define idempotency");
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await expect(other.getByText("Revision 2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Alex Morgan: approval stale — specification changed"),
  ).toBeVisible();
  await page.getByRole("button", { name: "discussions", exact: true }).click();
  await page
    .getByLabel("Comment", { exact: true })
    .fill("What happens after a late provider response?");
  await page.getByLabel("Blocks readiness").check();
  await page
    .getByRole("button", { name: "Post discussion", exact: true })
    .click();
  await other.getByRole("button", { name: "discussions", exact: true }).click();
  await expect(
    other.getByText("What happens after a late provider response?", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(
    other.getByText("Blocking · resolved", { exact: true }),
  ).toBeVisible();
  // Block sync traffic only so Next's authenticated document can still reload.
  await page.route("**/api/sync**", (route) =>
    route.abort("internetdisconnected"),
  );
  await page
    .getByLabel("Reply in context")
    .fill("Pending reply survives reload");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(
    page.getByText("Pending reply survives reload", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "discussions", exact: true }).click();
  await expect(
    page.getByText("Pending reply survives reload", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/sync**");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    other.getByText("Pending reply survives reload", { exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "history", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Revision 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(other.getByText("Archived", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(other.getByText("Archived", { exact: true })).toHaveCount(0);
  await other.route("**/api/sync/events**", (route) => route.abort());
  await other.reload();
  await page.getByRole("button", { name: "suggestions", exact: true }).click();
  await page.getByLabel("Why this change?").fill("Clarify timeout behavior");
  await page
    .getByLabel("Proposed specification (Markdown)")
    .fill(
      "# Safe retries\n\nRetries reuse the original transaction ID. Late responses must preserve the original result.",
    );
  await page
    .getByRole("button", { name: "Propose change", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Accept suggestion", exact: true })
    .click();
  await expect(other.getByText("Revision 3", { exact: true })).toBeVisible({
    timeout: 25_000,
  });
  await page.getByLabel("Why this change?").fill("A proposal to reject");
  await page
    .getByLabel("Proposed specification (Markdown)")
    .fill("Unwanted replacement");
  await page
    .getByRole("button", { name: "Propose change", exact: true })
    .click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    page.getByText("rejected · revision 3", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Teammate email").fill("teammate@example.test");
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  const invitation = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  const teammateContext = await browser.newContext();
  const teammate = await teammateContext.newPage();
  await signIn(teammate, "teammate@example.test");
  await teammate.goto(invitation);
  await teammate
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(teammate).toHaveURL("http://localhost:3001/app");
  await teammate.goto(url);
  await expect(
    teammate.getByRole("heading", {
      name: "Safe payment retries",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(url);
  await page
    .getByRole("combobox", { name: "Reviewer", exact: true })
    .selectOption({ label: "Riley Chen" });
  await page
    .getByRole("button", { name: "Request review", exact: true })
    .click();
  await teammate.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("Riley Chen: granted", { exact: true }),
  ).toBeVisible();
  await teammateContext.close();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/lictory-workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/lictory-workspace-mobile.png",
    fullPage: true,
  });
  await otherContext.close();
});
