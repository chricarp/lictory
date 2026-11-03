import { test, expect, type APIRequestContext } from "@playwright/test";
import { platformOrigin } from "../helpers/app-urls";

async function emailLink(
  request: APIRequestContext,
  recipient: string,
  subject: string,
) {
  const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
  let id: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(`${mailpit}/api/v1/search`, {
        params: { query: `to:${recipient} subject:"${subject}"` },
      });
      expect(response.ok()).toBe(true);
      const result = (await response.json()) as {
        messages: { ID: string }[];
      };
      id = result.messages[0]?.ID;
      return Boolean(id);
    })
    .toBe(true);
  const response = await request.get(`${mailpit}/api/v1/message/${id}`);
  expect(response.ok()).toBe(true);
  const message = (await response.json()) as { Text: string };
  const link = /(?:Verify email|Reset password): (https?:\/\/\S+)/.exec(
    message.Text,
  )?.[1];
  expect(link).toBeDefined();
  // Mail delivery must retain the application's origin, not the SMTP host.
  expect(new URL(link!).origin).toBe(platformOrigin);
  return link!;
}

test("signup verification and password reset deliver usable email links @smoke", async ({
  page,
  request,
  context,
}) => {
  const email = `auth-${crypto.randomUUID()}@example.test`;
  const originalPassword = "Local-test-password-123";
  const newPassword = "Replacement-test-password-456";
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Email Test");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(originalPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();

  await page.goto(await emailLink(request, email, "Verify your Lictory email"));
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/welcome\?next=/);

  await context.clearCookies();
  await page.goto("/forgot-password");
  await page.getByLabel("Account email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText("If an account exists for that address", { exact: false }),
  ).toBeVisible();
  await page.goto(
    await emailLink(request, email, "Reset your Lictory password"),
  );
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Your password has been updated.")).toBeVisible();

  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(originalPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Invalid email or password", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/welcome\?next=/);
});
