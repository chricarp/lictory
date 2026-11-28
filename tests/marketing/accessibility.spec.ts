import { test } from "@playwright/test";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";

// The website in both schemes it follows from the system: the landing page
// (product mockups included), downloads and a guide.
const pages = [
  "/",
  "/download",
  "/guides/requirements-review",
  "/compare/jira",
];

for (const colorScheme of ["light", "dark"] as const)
  test(`the website has no serious accessibility violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoAccessibilityViolations(page, `${path} (${colorScheme})`);
    }
  });
