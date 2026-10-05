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
      `http://localhost:3001${path}`,
    );
  });
}

for (const path of ["/sign-up", "/sign-in"]) {
  test(`${path} explains account acceptance separately from analytics and links to public documents`, async ({
    page,
  }) => {
    await page.goto(`${path}?callbackUrl=%2Fapp%2Finvitation%3Fid%3Dtest`);
    const notice = page.getByText(/you agree to our/);
    await expect(notice).toContainText("acknowledge our Privacy Notice");
    await expect(notice).toContainText(
      "Optional analytics is a separate choice",
    );
    await notice.getByRole("link", { name: "Terms of Service" }).click();
    await expect(
      page.getByRole("heading", { name: "Terms of Service", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/callbackUrl=/);
    await page
      .getByRole("link", { name: "Privacy Notice", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Privacy Notice", exact: true }),
    ).toBeVisible();
  });
}
