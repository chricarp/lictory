import { expect, type Page } from "@playwright/test";

export async function createWorkspace(
  page: Page,
  {
    organization,
    handle,
    project,
    key,
    mode = "native",
    planning = "off",
    finish = true,
  }: {
    organization: string;
    handle?: string;
    project: string;
    key: string;
    mode?: "native" | "external";
    planning?: "off" | "manual";
    finish?: boolean;
  },
) {
  await page.getByLabel("Organization", { exact: true }).fill(organization);
  if (handle)
    await page.getByLabel("Organization handle", { exact: true }).fill(handle);
  await page.getByLabel("Project", { exact: true }).fill(project);
  await page.getByLabel("Key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await configureFirstProject(page, mode, planning);
  if (finish) {
    await page
      .getByRole("button", { name: "Skip and finish", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/${key.toLowerCase()}/proposals$`),
    );
    // The URL changes before the onboarding-to-workspace render finishes.
    await expect(
      page.getByRole("heading", { name: "Proposals", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New item C", exact: true }),
    ).toBeVisible();
  }
}

/** From the delivery step through Intelligence to the people step. */
export async function configureFirstProject(
  page: Page,
  mode: "native" | "external" = "native",
  planning: "off" | "manual" = "off",
  aiEnabled = true,
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
    await page.getByRole("radio", { name: "Fibonacci", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Lictory Intelligence", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", {
      name: "Enable Lictory Intelligence",
      exact: true,
    }),
  ).toBeChecked();
  if (!aiEnabled)
    await page
      .getByRole("radio", {
        name: "Keep Lictory Intelligence off",
        exact: true,
      })
      .click();
  await expect(
    page.getByRole("radio", {
      name: aiEnabled
        ? "Enable Lictory Intelligence"
        : "Keep Lictory Intelligence off",
      exact: true,
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /^Invite people to / }),
  ).toBeVisible();
}
