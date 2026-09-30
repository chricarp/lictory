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
  await page.getByLabel("Use these starter types", { exact: false }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Invite teammates later", { exact: false }).check();
  if (mode === "external")
    await page.getByLabel("Connect Jira and map", { exact: false }).check();
  await page.getByLabel("Customize types, workflow", { exact: false }).check();
}
