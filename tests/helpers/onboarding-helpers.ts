import { expect, type Page } from "@playwright/test";
import { waitUntilSaved } from "./sync-helpers";

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
  await configureFirstProject(page, mode);
  if (finish) {
    await page
      .getByRole("button", { name: "Skip and finish", exact: true })
      .click();
    // Setup ends on Home, whose checklist carries on where setup stops.
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 }),
    ).toBeVisible();
    await expect(page.locator("[data-setup-checklist]")).toBeVisible();
    const org = new URL(page.url()).pathname.split("/")[1]!;
    // The first project starts continuous; sprints are a settings choice.
    if (planning === "manual") {
      await page.goto(`/${org}/${key.toLowerCase()}/settings/planning`);
      await page.getByRole("radio", { name: /^Sprints/ }).click();
      await expect(page.getByRole("radio", { name: /^Sprints/ })).toBeChecked();
      await waitUntilSaved(page);
    }
    // Callers continue from the project's proposals.
    await page.goto(`/${org}/${key.toLowerCase()}/proposals`);
    await expect(
      page.getByRole("heading", { name: "Proposals", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create work item", exact: true }),
    ).toBeVisible();
  }
}

/** From the delivery step through Intelligence to the people step. */
export async function configureFirstProject(
  page: Page,
  mode: "native" | "external" = "native",
  aiEnabled?: boolean,
) {
  await expect(
    page.getByRole("heading", { name: "Where does delivery happen?" }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: mode === "native" ? "In Lictory" : "In Jira" })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lictory Intelligence", exact: true }),
  ).toBeVisible();
  // The browser suite's default servers have no AI provider, so the choice
  // starts off.
  await expect(
    page.getByRole("radio", {
      name: "Keep Lictory Intelligence off",
      exact: true,
    }),
  ).toBeChecked();
  if (aiEnabled !== undefined) {
    const choice = aiEnabled
      ? "Enable Lictory Intelligence"
      : "Keep Lictory Intelligence off";
    await page.getByRole("radio", { name: choice, exact: true }).click();
    await expect(
      page.getByRole("radio", { name: choice, exact: true }),
    ).toBeChecked();
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /^Invite people to / }),
  ).toBeVisible();
}
