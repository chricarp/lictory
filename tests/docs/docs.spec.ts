import { test, expect } from "@playwright/test";

test("the static documentation serves its pages and searches them in the browser", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(
    page.getByRole("heading", { level: 1, name: "Introduction" }),
  ).toBeVisible();

  // Search downloads the prebuilt index once; no search request is served.
  const index = page.waitForResponse((r) => r.url().endsWith("/search.json"));
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.getByPlaceholder(/search/i).fill("rollback");
  expect((await index).status()).toBe(200);
  const result = page.getByRole("dialog").getByRole("option", {
    name: /Upgrades and release channels/,
  });
  await expect(result.first()).toBeVisible();
  await result.first().click();
  await expect(page).toHaveURL(/\/self-hosting\/upgrades/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Roll back" }),
  ).toBeVisible();
});

test("terminal guides are discoverable and product screenshots load", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "lictory CLI", exact: true }).click();
  await expect(page).toHaveURL(/\/self-hosting\/terminal/);
  await expect(
    page.getByRole("heading", { level: 2, name: /^Unattended installation/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "AI agents and MCP", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/integrations\/agents/);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /^Propose a change for review/,
    }),
  ).toBeVisible();

  for (const path of ["specifications", "reviews", "delivery"]) {
    await page.goto(`/concepts/${path}`);
    const screenshot = page.locator("article img");
    await screenshot.scrollIntoViewIfNeeded();
    await expect(screenshot).toBeVisible();
    await expect
      .poll(() =>
        screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
  }
});
