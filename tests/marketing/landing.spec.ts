import { test, expect, type Locator, type Page } from "@playwright/test";

/** The application has its own origin; the website only links to it. */
async function expectApplicationLink(page: Page, link: Locator, path: string) {
  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();
  const target = new URL(href!);
  expect(target.pathname).toBe(path);
  expect(target.origin).not.toBe(new URL(page.url()).origin);
}

for (const width of [320, 390]) {
  test(`mobile landing makes signup visible and demonstrates refinement at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const hero = page.getByRole("region", {
      name: "Agree on what to build before anyone builds it",
    });
    const signup = hero.getByRole("link", { name: "Start for free" });
    // Geometry snapshots can race with rendering, even after a visibility check.
    await expect(async () => {
      const signupBox = await signup.boundingBox();
      expect(signupBox).not.toBeNull();
      expect(signupBox!.y + signupBox!.height).toBeLessThan(500);
      expect(signupBox!.height).toBeGreaterThanOrEqual(44);
    }).toPass({ timeout: 30_000 });

    // Each illustration is one described image. Under reduced motion it is a
    // still of its result, with nothing to replay.
    const heroScene = hero.getByRole("img", {
      name: /parallel branches.*revision 13/,
    });
    await expect(heroScene).toBeVisible();
    await expect(
      heroScene.getByText("Revision 13", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0);

    const review = page.getByRole("img", {
      name: /blocking question.*revision 13/,
    });
    await review.scrollIntoViewIfNeeded();
    await expect(
      review.getByText("Retries reuse the transaction ID."),
    ).toBeVisible();
    const reviewBox = await review.boundingBox();
    expect(reviewBox!.x).toBeGreaterThanOrEqual(0);
    expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole("img", { name: /same history/ })).toBeVisible();

    // The review tools are listed, not hidden behind a disclosure.
    await expect(
      page.getByRole("term").filter({ hasText: "Revision-bound approvals" }),
    ).toBeVisible();

    // Key differences are visible without interaction; phones get cards, not a wide table.
    const comparison = page.getByRole("list", {
      name: "Lictory compared with Jira and Linear",
    });
    await expect(
      comparison.getByText("Approvals bound to a specific revision"),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();
    await expect(
      comparison.getByText("Estimates, burndown, velocity"),
    ).toBeHidden();
    await page.getByRole("button", { name: /Show full comparison/ }).click();
    await expect(
      comparison.getByText("Estimates, burndown, velocity"),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);

    // Sign-up lives in the application, on its own origin.
    await expectApplicationLink(page, signup, "/sign-up");
  });
}

test("desktop landing shows the comparison table and plays the hero story", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const table = page.getByRole("table", {
    name: "Lictory compared with Jira and Linear",
  });
  await expect(table).toBeVisible();
  await expect(
    table.getByRole("rowheader", { name: "Durable decision records" }),
  ).toBeVisible();

  // The hero plays its story once, ends on the merge, and Replay tells it again.
  const heroScene = page.getByRole("img", { name: /parallel branches/ });
  const state = (text: string) =>
    heroScene.locator(".ss-states__item[data-on]", {
      hasText: new RegExp(`^${text}$`),
    });
  await expect(state("Open")).toHaveCount(1);
  await expect(state("Merged").first()).toBeVisible({ timeout: 20_000 });
  await page
    .locator(".hero-scene")
    .getByRole("button", { name: "Replay" })
    .click();
  await expect(state("Open")).toHaveCount(1);
  await expect(state("Merged").first()).toBeVisible({ timeout: 20_000 });
});

test("/home permanently redirects to the landing page", async ({
  page,
  request,
}) => {
  const response = await request.get("/home", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location!, response.url()).pathname).toBe(
    "/",
  );

  await page.goto("/home");
  expect(new URL(page.url()).pathname).toBe("/");
  // Search engines index the landing page once, at "/".
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /^https?:\/\/[^/]+\/?$/,
  );
});

test("calls to action lead to the application without reading its session", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const banner = page.getByRole("banner");
  await expectApplicationLink(
    page,
    banner.getByRole("link", { name: "Sign up" }),
    "/sign-up",
  );
  await expectApplicationLink(
    page,
    banner.getByRole("link", { name: "Log in" }),
    "/sign-in",
  );
  // Every account link, including the persistent header and final call to
  // action, points at the application origin.
  const hrefs = await page
    .locator('a[href*="sign-up"], a[href*="sign-in"], a[href*="/app"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThanOrEqual(4);
  for (const href of hrefs)
    expect(new URL(href, page.url()).origin).not.toBe(
      new URL(page.url()).origin,
    );
});

test("links shared before the split reach the application", async ({
  request,
}) => {
  for (const [path, target] of [
    ["/app", "/"],
    [
      "/app/acme/pay/epics/PAY-1?tab=review",
      "/acme/pay/epics/PAY-1?tab=review",
    ],
    ["/app/invitation?id=abc", "/invitation?id=abc"],
    ["/sign-in?callbackUrl=%2Facme", "/sign-in?callbackUrl=%2Facme"],
    ["/sign-up", "/sign-up"],
    ["/reset-password?token=t", "/reset-password?token=t"],
  ]) {
    const response = await request.get(path!, { maxRedirects: 0 });
    expect(response.status(), path).toBe(308);
    const location = new URL(response.headers().location!);
    expect(location.pathname + location.search, path).toBe(target);
    expect(location.origin, path).not.toBe(new URL(response.url()).origin);
  }
});

for (const width of [320, 390, 768, 1280]) {
  test(`marketing navigation exposes workflow and agent sections at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    if (width < 960) {
      const toggle = page.getByRole("button", { name: "Open navigation" });
      await toggle.click();
      await expect(
        page.getByRole("navigation", { name: "Mobile sections" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await page
        .getByRole("navigation", { name: "Mobile sections" })
        .getByRole("link", { name: "Agents", exact: true })
        .click();
      await expect(page).toHaveURL(/#agents$/);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    } else {
      await page
        .getByRole("navigation", { name: "Sections", exact: true })
        .getByRole("link", { name: "Agents", exact: true })
        .click();
    }
    await expect(page.locator("#agents h2")).toBeInViewport();
    await expect(async () => {
      const heading = await page.locator("#agents h2").boundingBox();
      const dock = await page.locator(".header-inner").boundingBox();
      expect(heading!.y).toBeGreaterThan(dock!.y + dock!.height);
      expect(dock!.y).toBeGreaterThanOrEqual(0);
      expect(dock!.y + dock!.height).toBeLessThan(100);
    }).toPass();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

test("persistent navigation tracks reading position and works from a guide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Sections", exact: true });
  const mainOffset = await page
    .locator("main")
    .evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  await page
    .locator("#delivery")
    .evaluate((node) =>
      node.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  await expect(
    nav.getByRole("link", { name: "Delivery", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("banner")).toHaveAttribute("data-scrolled");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Sign up" }),
  ).toBeInViewport();
  expect(
    await page
      .locator("main")
      .evaluate((node) => node.getBoundingClientRect().top + window.scrollY),
  ).toBe(mainOffset);

  await nav.getByRole("link", { name: "Guides", exact: true }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect(
    nav.getByRole("link", { name: "Guides", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await nav.getByRole("link", { name: "Workflow", exact: true }).click();
  await expect(page).toHaveURL(/\/#features$/);
  await expect(
    nav.getByRole("link", { name: "Workflow", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#features-title")).toBeInViewport();
});

test("mobile navigation dismisses outside, stays closed after resizing and respects reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open navigation" });
  const menu = page.getByRole("navigation", { name: "Mobile sections" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    menu.getByRole("link", { name: "Workflow", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  // Closing the menu returns to the page in reading order.
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("region", {
        name: "Agree on what to build before anyone builds it",
      })
      .getByRole("link", { name: "Start for free" }),
  ).toBeFocused();

  await toggle.click();
  await page.mouse.click(4, 400);
  await expect(menu).toBeHidden();
  await toggle.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("navigation", { name: "Sections", exact: true }),
  ).toBeVisible();
  // CSS responds before the media-query event. Let the desktop transition
  // finish dismissing the menu before returning to a phone viewport.
  await expect(page.locator(".mobile-nav > button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await expect(page.locator(".header-inner")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
});

test("the open-source link describes the project directly and leads to its code", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Mobile sections" })
    .getByRole("link", { name: "Open source", exact: true })
    .click();
  await expect(page).toHaveURL(/#open-source$/);
  const section = page.getByRole("region", {
    name: "Open source. Yours to shape.",
  });
  await expect(section).toContainText(
    "Lictory is open-source work management for software teams.",
  );
  await expect(
    section.getByRole("link", { name: "View on GitHub" }),
  ).toHaveAttribute("href", "https://github.com/chricarp/lictory");
  await expect(
    page.getByText(
      /repository coming soon|release is planned|going open source/i,
    ),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});
