import { test, expect } from "@playwright/test";

test("page contents follow scrolling and keep nested and wrapped labels aligned", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/review/readiness#sign-offs");
  const contents = page.getByRole("navigation", { name: "On this page" });
  const current = contents.locator('a[aria-current="location"]');
  await expect(current).toHaveText("Sign-offs");
  await expect(contents.locator('a[data-active="true"]')).toHaveCount(1);
  await expect(current).toHaveCSS("font-weight", "700");

  const geometry = async () =>
    current.evaluate((link) => {
      const dot = link.querySelector(".docs-toc-dot")!;
      const label = link.lastElementChild!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const firstLine = range.getClientRects()[0]!;
      const marker = dot.getBoundingClientRect();
      const rail = link
        .querySelector(".docs-toc-rail > line")!
        .getBoundingClientRect();
      return {
        railAlignment: Math.abs(rail.left - (marker.left + marker.width / 2)),
        offset: marker.left - link.getBoundingClientRect().left,
        alignment: Math.abs(
          marker.top +
            marker.height / 2 -
            (firstLine.top + firstLine.height / 2),
        ),
        labelHeight: label.getBoundingClientRect().height,
      };
    });
  const nested = await geometry();
  expect(nested.alignment).toBeLessThan(2);
  expect(nested.railAlignment).toBeLessThan(1);

  // Clicking a top-level entry updates both navigation and the current row.
  await contents
    .getByRole("link", { name: "The default checks", exact: true })
    .click();
  await expect(current).toHaveText("The default checks");
  expect((await geometry()).offset).toBe(nested.offset - 12);

  // Scrolling the document, independently of clicking the contents, follows
  // the heading again. The marker aligns with the first line if text wraps.
  await page
    .locator("#lictory-intelligence-check")
    .evaluate((heading) => heading.scrollIntoView());
  await expect(current).toHaveText("Lictory Intelligence check");
  await contents.evaluate((nav) => {
    nav.style.width = "180px";
  });
  await expect
    .poll(async () => (await geometry()).labelHeight)
    .toBeGreaterThan(20);
  expect((await geometry()).alignment).toBeLessThan(2);
  expect((await geometry()).railAlignment).toBeLessThan(1);
  const railGaps = await contents.locator("a").evaluateAll((links) =>
    links.slice(1).map((link, index) => {
      const previous = links[index]!.querySelector(
        ".docs-toc-rail > line",
      )!.getBoundingClientRect();
      const curve = link
        .querySelector(".docs-toc-rail path")!
        .getBoundingClientRect();
      const line = link
        .querySelector(".docs-toc-rail > line")!
        .getBoundingClientRect();
      return Math.max(
        Math.abs(previous.bottom - curve.top),
        Math.abs(curve.bottom - line.top),
      );
    }),
  );
  expect(Math.max(...railGaps)).toBeLessThan(1);

  await page.setViewportSize({ width: 1440, height: 400 });
  await page.locator("#tips").evaluate((heading) => heading.scrollIntoView());
  await expect(current).toHaveText("Tips");
  await expect(current).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(current).toHaveText("Read an item's readiness");
});

test("mobile page contents navigate to a nested section and close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/review/readiness");
  const trigger = page.locator("[data-toc-popover-trigger]");
  await trigger.click();
  const contents = page.locator("[data-toc-popover-content]");
  await contents.getByRole("link", { name: "Sign-offs", exact: true }).click();
  await expect(page).toHaveURL(/#sign-offs$/);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toContainText("Sign-offs");
});
