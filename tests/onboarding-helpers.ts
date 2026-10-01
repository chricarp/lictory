import { expect, type Page } from "@playwright/test";

export async function configureFirstProject(
  page: Page,
  mode: "native" | "external" = "native",
  planning: "off" | "manual" = "off",
) {
  await page.getByLabel("Team name", { exact: true }).fill("Delivery team");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", {
      name:
        mode === "native"
          ? "Refine and deliver in Lictory"
          : "Refine here, deliver in Jira",
      exact: false,
    })
    .click();
  await page
    .getByRole("button", { name: "Warn before starting", exact: false })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  if (mode === "native") {
    await page
      .getByRole("button", {
        name: planning === "manual" ? "Manual sprints" : "Continuous flow",
        exact: false,
      })
      .click();
    const estimates = page.getByRole("combobox", { name: "Estimate scale" });
    await expect(estimates).toHaveCSS("height", "40px");
    await estimates.focus();
    await estimates.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(estimates).toBeFocused();
    await estimates.click();
    await page
      .getByRole("option", { name: "Fibonacci points", exact: true })
      .click();
  }
  if (mode === "native")
    await page.getByRole("button", { name: "Continue", exact: true }).click();
}
