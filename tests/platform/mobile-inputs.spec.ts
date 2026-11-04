import { test, expect, type Page } from "@playwright/test";
import { seedItem, seedWorkspace, signIn } from "../helpers/seed";
import { reloadWhenSaved } from "../helpers/sync-helpers";

async function expectUnscaled(page: Page) {
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("desktop sign-in retains its compact field sizes and permits user zoom", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email", { exact: true })).toHaveCSS(
    "font-size",
    "15px",
  );
  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1",
  );
});

test.describe("touch devices", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    test(`text entry stays readable through navigation and editing at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      // Chromium emulation verifies the readable font sizes and layout. Actual
      // iOS keyboard/focus zoom still needs a physical-device Safari check.
      expect(
        await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches),
      ).toBe(true);
      await page.goto("/sign-up");
      for (const label of ["Full name", "Work email", "Password"]) {
        const field = page.getByLabel(label, { exact: true });
        await expect(field).toHaveCSS("font-size", "16px");
        await expect(field).toHaveCSS("touch-action", "manipulation");
        await field.tap();
        await expect(field).toBeFocused();
        await expectUnscaled(page);
      }

      await page.goto("/forgot-password");
      const email = page.getByLabel("Account email");
      await email.fill("mobile@example.test");
      await expect(email).toHaveCSS("font-size", "16px");
      await expectUnscaled(page);

      const workspace = await seedWorkspace({
        name: "Mobile refinement",
        key: "MOB",
        users: ["Mobile Reviewer"],
      });
      await seedItem(workspace, {
        title: "Readable mobile requirements",
        description: "Initial behavior.",
      });
      await signIn(page, workspace.owner.email);
      await page.goto(workspace.itemPath(1));

      await page
        .getByRole("heading", { name: "Readable mobile requirements" })
        .tap();
      const title = page.getByRole("textbox", { name: "Title", exact: true });
      await expect(title).toBeFocused();
      await expect(title).toHaveCSS("font-size", "28px");
      await title.press("Escape");

      await page.getByRole("button", { name: "Edit", exact: true }).tap();
      const specification = page.getByRole("textbox", {
        name: "Specification",
        exact: true,
      });
      await expect(specification).toHaveCSS("font-size", "16px");
      await specification.fill("Mobile editing preserves the agreed behavior.");
      const summary = page.getByRole("textbox", { name: "Change summary" });
      await expect(summary).toHaveCSS("font-size", "16px");
      await summary.fill("Clarify behavior from a touch device");
      await expectUnscaled(page);
      await page.getByRole("button", { name: "Save revision 2" }).tap();
      await expect(
        page.getByText("Mobile editing preserves the agreed behavior.", {
          exact: true,
        }),
      ).toBeVisible();
      await reloadWhenSaved(page);
      await expect(
        page.getByText("Mobile editing preserves the agreed behavior.", {
          exact: true,
        }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Search", exact: true }).tap();
      const search = page
        .getByRole("dialog", { name: "Command palette" })
        .getByRole("textbox", { name: "Search", exact: true });
      await expect(search).toBeFocused();
      await expect(search).toHaveCSS("font-size", "16px");
      await search.fill("Readable mobile requirements");
      await expectUnscaled(page);
      await search.press("Escape");

      // A small, auto-focused field rendered through the shared picker.
      await page.goto(workspace.itemPath(1) + "?branches=1");
      const branch = page.getByRole("textbox", { name: "New branch name" });
      await expect(branch).toHaveCSS("font-size", "16px");
      await branch.fill("mobile/readability");
      await page
        .getByRole("combobox", { name: "Branch from", exact: true })
        .tap();
      await expectUnscaled(page);
    });
  }
});
