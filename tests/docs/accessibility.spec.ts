import { expect, test } from "@playwright/test";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";

// The documentation in light and dark (it follows the system until a reader
// picks a theme), and the layout problems a scan cannot see.
const pages = [
  "/",
  "/getting-started",
  "/factory/runners",
  "/basics/account",
  "/basics/accessibility",
];

for (const colorScheme of ["light", "dark"] as const)
  test(`the documentation has no serious accessibility violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveClass(
        colorScheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
      );
      await expectNoAccessibilityViolations(page, `${path} (${colorScheme})`);
    }
  });

test("deep pages keep the sidebar's labels whole and commands readable beside the copy button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/factory/autonomy");
  await page.waitForLoadState("networkidle");
  const sidebar = page.locator("#nd-sidebar");
  await expect(
    sidebar.getByRole("link", { name: "Agents, autonomy and Done" }),
  ).toHaveAttribute("data-active", "true");
  expect(await sidebar.evaluate((element) => element.scrollLeft)).toBe(0);

  await page.goto("/factory/runners");
  const block = page.locator("figure.shiki").first();
  // The command wraps inside its block instead of running under the copy
  // button or past the edge.
  const fits = await block.evaluate((figure) => {
    const region = figure.querySelector<HTMLElement>("[role=region]")!;
    const pre = figure.querySelector("pre")!;
    const copy = figure.querySelector("button")!.getBoundingClientRect();
    const lines = [...pre.querySelectorAll<HTMLElement>(".line")];
    const text = lines.map((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      return range.getBoundingClientRect();
    });
    return {
      scrolls: region.scrollWidth > region.clientWidth,
      underCopy: text.some(
        (box) =>
          box.right > copy.left &&
          box.top < copy.bottom &&
          box.bottom > copy.top,
      ),
    };
  });
  expect(fits).toEqual({ scrolls: false, underCopy: false });
});
