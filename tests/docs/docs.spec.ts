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

  // The product guides are in the same index.
  await page.getByRole("button", { name: "Search" }).first().click();
  await page.getByPlaceholder(/search/i).fill("Propose page update");
  const guide = page
    .getByRole("dialog")
    .getByRole("option", { name: /Pages in your work/ });
  await expect(guide.first()).toBeVisible();
  await guide.first().click();
  await expect(page).toHaveURL(/\/knowledge\/in-work/);
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

  for (const path of [
    "/concepts/specifications",
    "/knowledge/in-work",
    "/delivery/board",
  ]) {
    await page.goto(path);
    const screenshot = page.locator("article img").first();
    await screenshot.scrollIntoViewIfNeeded();
    await expect(screenshot).toBeVisible();
    await expect
      .poll(() =>
        screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
  }
});

// Addresses published before the product guide was reorganized (README,
// the website, earlier links people saved) keep working.
const publishedAddresses = [
  "/getting-started",
  "/develop",
  "/concepts/specifications",
  "/concepts/reviews",
  "/concepts/readiness",
  "/concepts/delivery",
  "/concepts/organizations",
  "/concepts/spaces",
  "/spaces",
  "/spaces/create",
  "/spaces/pages",
  "/spaces/editing",
  "/spaces/publishing",
  "/spaces/history",
  "/spaces/branches",
  "/spaces/comments",
  "/spaces/access",
  "/spaces/agents",
  "/spaces/faq",
  "/integrations/jira",
  "/integrations/agents",
  "/self-hosting",
  "/self-hosting/install",
  "/self-hosting/configuration",
  "/self-hosting/terminal",
  "/self-hosting/commands",
  "/self-hosting/troubleshooting",
  "/self-hosting/privacy",
];

test("every page in the navigation loads, and its links and screenshots resolve", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  for (const path of publishedAddresses)
    expect((await request.get(path)).status(), path).toBe(200);

  await page.goto("/");
  const pages = [
    ...new Set(
      await page
        .locator("#nd-sidebar a[href^='/']")
        .evaluateAll((links) =>
          links.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
        ),
    ),
  ];
  // The guide covers every part of the product.
  for (const section of [
    "/basics/navigation",
    "/specifications/live-drafts",
    "/review/readiness",
    "/delivery/iterations",
    "/spaces/blocks",
    "/knowledge/in-work",
    "/search",
    "/ai/litto",
    "/inbox",
    "/organization/disciplines",
  ])
    expect(pages, section).toContain(section);

  const checked = new Map<string, number>();
  const status = async (url: string) => {
    if (!checked.has(url)) checked.set(url, (await request.get(url)).status());
    return checked.get(url)!;
  };
  for (const path of pages) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("article h1, h1").first()).toBeVisible();
    const { links, images } = await page
      .locator("article")
      .first()
      .evaluate((article) => ({
        links: [...article.querySelectorAll("a[href]")]
          .map((a) => new URL((a as HTMLAnchorElement).href))
          .filter((url) => url.origin === location.origin)
          .map((url) => url.pathname),
        images: [...article.querySelectorAll("img")].map(
          (img) => new URL(img.src).pathname,
        ),
      }));
    for (const link of links)
      expect(await status(link), `${path} links to ${link}`).toBe(200);
    for (const image of images) {
      expect(await status(image), `${path} shows ${image}`).toBe(200);
      expect(
        (
          await page
            .locator(`article img[src="${image}"]`)
            .first()
            .getAttribute("alt")
        )?.trim(),
        `${image} has alt text on ${path}`,
      ).toBeTruthy();
    }
  }
});
