import { expect, type Page } from "@playwright/test";

export async function createWorkspace(
  page: Page,
  {
    organization,
    project,
    key,
    mode = "native",
    planning = "off",
    finish = true,
  }: {
    organization: string;
    project: string;
    key: string;
    mode?: "native" | "external";
    planning?: "off" | "manual";
    finish?: boolean;
  },
) {
  await page.getByLabel("Organization", { exact: true }).fill(organization);
  await page.getByLabel("Project", { exact: true }).fill(project);
  await page.getByLabel("Key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await configureFirstProject(page, mode, planning);
  if (finish) {
    await page
      .getByRole("button", { name: "Skip and finish", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${key.toLowerCase()}/epics$`));
  }
}

/** From the delivery step to the team step. */
export async function configureFirstProject(
  page: Page,
  mode: "native" | "external" = "native",
  planning: "off" | "manual" = "off",
) {
  await expect(
    page.getByRole("heading", { name: "Where does delivery happen?" }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: mode === "native" ? "In Lictory" : "In Jira" })
    .click();
  if (mode === "native")
    await expect(
      page.getByRole("radio", { name: "Warn", exact: true }),
    ).toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  if (mode === "native") {
    await page
      .getByRole("radio", {
        name: planning === "manual" ? "Sprints" : "Continuous",
        exact: true,
      })
      .click();
    await page.getByRole("radio", { name: "1 2 3 5 8", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Who reviews with you?" }),
  ).toBeVisible();
}
