import { test, expect } from "@playwright/test";

test("missing pages stay readable, show the shared artwork and lead back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const response = await page.goto("/missing-illustration-page");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "This page does not exist" }),
    ).toBeVisible();
    // The website shows the application's animated artwork, at rest under
    // reduced motion.
    const art = page.locator('[data-illustration="search"]');
    await expect(art).toHaveAttribute("data-state", "rest");
    await expect(art.locator("svg")).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    await expect(
      page.getByRole("link", { name: "Get started" }),
    ).toHaveAttribute("href", "https://docs.lictory.com/self-hosting/try");
    await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/chricarp/lictory",
    );
    await page.getByRole("button", { name: "Go home" }).click();
    await expect(page).toHaveURL("/");
  }
});
