import { test, expect } from "@playwright/test";

test("legal notices are public, linked from the landing footer, and usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  const footer = page.getByRole("navigation", { name: "Footer", exact: true });
  await footer.getByRole("link", { name: "Privacy Notice" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { name: "Privacy Notice", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Christian Carpinelli", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Privacy Notice contents" })
    .getByRole("link", { name: "Your rights and how to contact us" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Your rights and how to contact us/ }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );

  await page
    .getByRole("navigation", { name: "Legal footer" })
    .getByRole("link", { name: "Terms of Service" })
    .click();
  await expect(page).toHaveURL(/\/terms-of-service$/);
  await expect(
    page.getByRole("heading", { name: "Terms of Service", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Privacy preferences" }).click();
  await expect(
    page.getByRole("dialog", { name: "Privacy Settings" }),
  ).toBeVisible();
});

for (const path of ["/privacy", "/terms-of-service"]) {
  test(`${path} can be opened directly without an account`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new URL(path, page.url()).toString(),
    );
    // Lictory is self-hosted: the header leads to the installation guide.
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Get started" }),
    ).toHaveAttribute("href", "https://docs.lictory.com/self-hosting/install");
  });
}
