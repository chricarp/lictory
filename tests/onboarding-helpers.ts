import type { Page } from "@playwright/test";

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
    await page.getByLabel("Estimate scale").selectOption("fibonacci");
  }
  if (mode === "native")
    await page.getByRole("button", { name: "Continue", exact: true }).click();
}
