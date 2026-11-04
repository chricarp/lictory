import { test, expect } from "@playwright/test";

// Browser tests run the platform without analytics settings (no
// POSTHOG_PROJECT_TOKEN), the default for a self-hosted installation: there is
// nothing to consent to, so no banner, no stored choice and no request to
// PostHog or its first-party relay.
test.use({ storageState: { cookies: [], origins: [] } });

test("without analytics settings there is no consent banner and no analytics traffic @smoke", async ({
  page,
}) => {
  const analytics: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/relay") || /posthog/i.test(url.hostname))
      analytics.push(request.url());
  });

  await page.goto("/sign-up");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "Reject All" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept All" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Privacy preferences" }),
  ).toHaveCount(0);
  expect(analytics).toEqual([]);
  const stored = await page.evaluate(() => ({
    cookies: document.cookie,
    consent: localStorage.getItem("c15t"),
    posthog: Object.keys(localStorage).filter((key) => key.startsWith("ph_")),
    sdk: "posthog" in window,
  }));
  expect(stored.cookies).not.toMatch(/c15t|ph_|lictory_analytics/);
  expect(stored).toMatchObject({ consent: null, posthog: [], sdk: false });
});
