import { test, expect } from "@playwright/test";

for (const width of [320, 390]) {
  test(`mobile landing makes signup visible and demonstrates refinement at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const hero = page.getByRole("region", {
      name: /Better specs\.\s*Fewer meetings\./,
    });
    const signup = hero.getByRole("link", { name: "Start for free" });
    // Geometry snapshots can race with rendering, even after a visibility check.
    await expect(async () => {
      const signupBox = await signup.boundingBox();
      expect(signupBox).not.toBeNull();
      expect(signupBox!.y + signupBox!.height).toBeLessThan(500);
      expect(signupBox!.height).toBeGreaterThanOrEqual(44);
    }).toPass({ timeout: 30_000 });

    const demo = page.getByLabel("Interactive specification example");
    if (width === 390) {
      await expect(async () => {
        const demoBox = await demo.boundingBox();
        expect(demoBox).not.toBeNull();
        expect(demoBox!.y + demoBox!.height).toBeLessThan(844);
      }).toPass({ timeout: 30_000 });
    }
    await expect(
      demo.getByText("How many retries? Could we charge twice?"),
    ).toBeVisible();
    await demo.getByRole("button", { name: "Revise", exact: true }).click();
    await expect(demo.getByText("Rev 13", { exact: true })).toBeVisible();
    await expect(demo.locator("ins")).toHaveText("up to 3 times");
    await expect(demo.getByText("Resolved", { exact: true })).toBeVisible();

    // The walkthrough works with a keyboard and keeps the example within the viewport.
    await page.keyboard.press("Tab");
    await expect(
      demo.getByRole("button", { name: "Ready", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(demo.getByText("3 of 3 approvals · rev 13")).toBeVisible();
    await expect(
      demo.getByText("Acceptance criteria checked. No blockers."),
    ).toBeVisible();
    const readyBox = await demo.boundingBox();
    expect(readyBox!.x).toBeGreaterThanOrEqual(0);
    expect(readyBox!.x + readyBox!.width).toBeLessThanOrEqual(width);
    await demo.getByRole("button", { name: "Review", exact: true }).click();
    await expect(demo.getByText("Rev 12", { exact: true })).toBeVisible();
    await expect(demo.getByText("Blocking", { exact: true })).toBeVisible();

    const tools = page.getByText(/^Explore the review tools/);
    await tools.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Revision-bound approvals" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Revision-bound approvals" }),
    ).toBeHidden();

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
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Show full comparison/ }).click();
    await expect(
      comparison.getByText("Estimates, burndown, velocity"),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);

    await signup.click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
  });
}

test("desktop landing shows the comparison table and autoplays the example", async ({
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

  // The example advances by itself, then stops once the visitor takes control.
  const demo = page.getByLabel("Interactive specification example");
  await expect(demo.getByText("Rev 12", { exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(demo.getByText("Rev 13", { exact: true })).toBeVisible({
    timeout: 8000,
  });
  await demo.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    demo.getByRole("button", { name: "Play example" }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(5000);
  await expect(demo.getByText("Rev 12", { exact: true })).toBeVisible();
});

test("anonymous visitors also reach the landing page at /home", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/home$/);
  // Search engines index the landing page once, at "/".
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /^https?:\/\/[^/]+\/?$/,
  );
  await page.getByRole("banner").getByRole("link", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
});
