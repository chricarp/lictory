import { test, expect } from "@playwright/test";

// The suite configures synthetic LEGAL_TERMS_URL and LEGAL_PRIVACY_URL
// (scripts/test-e2e.ts): account creation links to the installation's own
// notices, never to notices it did not configure.
test.use({ storageState: { cookies: [], origins: [] } });

test("sign-up links to the installation's configured terms and privacy notice", async ({
  page,
}) => {
  await page.goto("/sign-up");
  const notice = page.getByText("By creating an account, you agree to the");
  await expect(notice).toBeVisible();
  await expect(
    notice.getByRole("link", { name: "Terms of Service" }),
  ).toHaveAttribute("href", /\/terms-of-service$/);
  await expect(
    notice.getByRole("link", { name: "Privacy Notice" }),
  ).toHaveAttribute("href", /\/privacy$/);
  // Analytics are off in the suite, so there is no analytics choice to mention.
  await expect(notice).not.toContainText("Privacy preferences");
});
