import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { seedDefaultRoles } from "../src/sync/server/roles";
import { createSyncService, directory } from "../src/sync/server/service";
import { PROTOCOL } from "../src/sync/shared/protocol";
import { paths } from "../src/lib/paths";
import { consentStatePath } from "./consent-setup";
import { reloadWhenSaved } from "./sync-helpers";

const password = "Local-test-password-123";
const suffix = crypto.randomUUID().slice(0, 8);
const emails = ["admin", "manager", "maintainer"].map(
  (name) => `configuration-${name}-${suffix}@example.test`,
);
let settingsUrl: string;
let teamUrl: string;
let teamName: string;

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client, { schema: s });
    const ids = emails.map(() => crypto.randomUUID());
    const organizationId = crypto.randomUUID();
    const slug = `delegation-${suffix}`;
    const hash = await hashPassword(password);
    for (const [index, email] of emails.entries()) {
      const id = ids[index]!;
      await db.insert(s.user).values({
        id,
        email,
        name: ["Configuration Admin", "Project Manager", "Team Maintainer"][
          index
        ]!,
        handle: `configuration_${index}_${suffix}`,
        emailVerified: true,
      });
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hash,
      });
    }
    await db.insert(s.organization).values({
      id: organizationId,
      name: "Delegation workspace",
      slug,
      createdAt: new Date(),
    });
    await db.insert(s.member).values(
      ids.map((userId, index) => ({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        role: index === 0 ? "owner" : "member",
        createdAt: new Date(),
      })),
    );
    await seedDefaultRoles(db, organizationId, ids[0]!);
    await createSyncService(db).mutate(ids[0]!, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createProject",
        projectId: crypto.randomUUID(),
        name: "Payments",
        key: "PAY",
      },
    });
    await createSyncService(db).mutate(ids[0]!, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createProject",
        projectId: crypto.randomUUID(),
        name: "Shared operations",
        key: "OPS",
      },
    });
    const roster = await directory(db, ids[0]!, organizationId);
    const payments = roster.projects.find((project) => project.key === "PAY")!;
    const team = roster.teams.find((team) =>
      team.projectIds?.includes(payments.id),
    )!;
    teamName = team.name;
    settingsUrl = paths.settings(slug);
    teamUrl = paths.teamSettings(slug, team.id);
  } finally {
    await client.end();
  }
});

async function signIn(page: Page, index: number) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(emails[index]!);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
}
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("organization delegation enables local roles, team configuration, live revocation and durable recovery", async ({
  page: adminPage,
  browser,
}) => {
  test.setTimeout(180_000);
  await adminPage
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.211" });
  const managerContext = await browser.newContext({
    storageState: consentStatePath,
    extraHTTPHeaders: { "x-forwarded-for": "192.0.2.212" },
  });
  const maintainerContext = await browser.newContext({
    storageState: consentStatePath,
    extraHTTPHeaders: { "x-forwarded-for": "192.0.2.213" },
  });
  try {
    const manager = await managerContext.newPage();
    const maintainer = await maintainerContext.newPage();
    await signIn(adminPage, 0);
    await signIn(manager, 1);
    await signIn(maintainer, 2);
    await manager.goto(teamUrl);
    await expect(
      manager.getByLabel("Team name", { exact: true }),
    ).toBeDisabled();
    await adminPage.goto(teamUrl);
    const associations = adminPage.getByRole("group", {
      name: "Associated projects",
    });
    await expect(
      associations.getByRole("checkbox", { name: "Payments", exact: true }),
    ).toBeChecked();
    await associations
      .getByRole("checkbox", { name: "Shared operations", exact: true })
      .check();
    await reloadWhenSaved(adminPage);
    await expect(
      associations.getByRole("checkbox", {
        name: "Shared operations",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      associations.getByRole("checkbox", { name: "Payments", exact: true }),
    ).toBeChecked();
    await associations
      .getByRole("checkbox", { name: "Shared operations", exact: true })
      .uncheck();
    await reloadWhenSaved(adminPage);
    await expect(
      associations.getByRole("checkbox", {
        name: "Shared operations",
        exact: true,
      }),
    ).not.toBeChecked();
    await associations
      .getByRole("checkbox", { name: "Shared operations", exact: true })
      .check();
    await reloadWhenSaved(adminPage);
    await expect(
      associations.getByRole("checkbox", {
        name: "Shared operations",
        exact: true,
      }),
    ).toBeChecked();
    await adminPage
      .locator("#team-details")
      .screenshot({ path: "/tmp/lictory-configuration-shared-team.png" });
    await adminPage.goto(settingsUrl);
    const roles = adminPage.locator("#configuration-roles");
    await roles.getByRole("button", { name: "Add configuration role" }).click();
    const form = roles.locator("form");
    await form
      .getByLabel("Configuration role name", { exact: true })
      .fill("Project maintainers");
    for (const label of [
      "Project name and default team",
      "Team details, estimates and iteration schedule",
      "Team workflow statuses",
      "Choose native or external delivery",
      "Manage team delivery credentials and export mapping",
      "Manage local role assignments",
    ])
      await form.getByLabel(label, { exact: true }).check();
    await form
      .getByRole("button", { name: "Create configuration role" })
      .click();
    await expect(
      roles.getByLabel("Configuration role name Project maintainers"),
    ).toBeVisible();
    await choose(adminPage, "Local configuration role", "Project maintainers");
    await choose(adminPage, "Configuration member", "Project Manager");
    await adminPage
      .locator("#configuration-access")
      .getByRole("button", { name: "Assign role" })
      .click();
    // The open second browser discovers the new rights through synchronization.
    await expect(
      manager.getByLabel("Team name", { exact: true }),
    ).toBeEnabled();
    await expect(
      manager
        .getByRole("group", { name: "Associated projects" })
        .getByRole("checkbox", { name: "Payments", exact: true }),
    ).toBeDisabled();
    await manager
      .getByLabel("Team name", { exact: true })
      .fill("Local delivery team");
    await manager.getByLabel("Team name", { exact: true }).press("Tab");
    await expect(
      manager.getByRole("heading", { name: "Local delivery team settings" }),
    ).toBeVisible();
    teamName = "Local delivery team";
    await manager
      .locator("#delivery")
      .getByRole("radio", { name: /External tool/ })
      .click();
    await reloadWhenSaved(manager);
    await expect(
      manager
        .locator("#delivery")
        .getByRole("radio", { name: /External tool/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(manager.getByLabel("API token")).toBeVisible();
    await expect(
      manager.locator("#delivery").getByRole("radio", { name: /Block/ }),
    ).toBeDisabled();

    // The project manager creates a bounded team role and delegates to a maintainer.
    await manager.goto(settingsUrl);
    const localRoles = manager.locator("#configuration-roles");
    await localRoles
      .getByRole("button", { name: "Add configuration role" })
      .click();
    await localRoles
      .locator("form")
      .getByLabel("Configuration role name", { exact: true })
      .fill("Workflow maintainer");
    await choose(manager, "Role definition scope", `${teamName} · team`);
    await choose(manager, "Parent configuration role", "Project maintainers");
    await localRoles
      .locator("form")
      .getByLabel("Team workflow statuses", { exact: true })
      .check();
    await localRoles
      .locator("form")
      .getByRole("button", { name: "Create configuration role" })
      .click();
    await expect(
      localRoles.getByLabel("Configuration role name Workflow maintainer"),
    ).toBeVisible();
    await localRoles.screenshot({
      path: "/tmp/lictory-configuration-roles.png",
    });
    await choose(manager, "Configuration target", `${teamName} · team`);
    await choose(manager, "Local configuration role", "Workflow maintainer");
    await choose(manager, "Configuration member", "Team Maintainer");
    await manager
      .locator("#configuration-access")
      .getByRole("button", { name: "Assign role" })
      .click();
    await maintainer.goto(teamUrl);
    await expect(
      maintainer.getByLabel("Team name", { exact: true }),
    ).toBeDisabled();
    await expect(maintainer.getByLabel("API token")).toHaveCount(0);
    const workflow = maintainer.locator("#workflow");
    await workflow
      .getByRole("button", { name: "Add", exact: true })
      .first()
      .click();
    await workflow.getByLabel("New status name").fill("Local triage");
    await workflow
      .locator("form")
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await expect(
      workflow.getByText("Local triage", { exact: true }),
    ).toBeVisible();
    await reloadWhenSaved(maintainer);
    await expect(
      workflow.getByText("Local triage", { exact: true }),
    ).toBeVisible();
    await workflow.screenshot({
      path: "/tmp/lictory-configuration-delegated.png",
    });
    // A reduced organization ceiling disables its customized descendant live.
    await reloadWhenSaved(adminPage);
    const rootCard = adminPage
      .locator("#configuration-roles")
      .locator("div.rounded-lg")
      .filter({
        has: adminPage.getByLabel(
          "Configuration role name Project maintainers",
          { exact: true },
        ),
      });
    await rootCard
      .getByLabel("Team workflow statuses", { exact: true })
      .uncheck();
    await expect(
      workflow.getByRole("button", { name: "Add", exact: true }),
    ).toHaveCount(0);
    await reloadWhenSaved(maintainer);
    // Reload and synchronization can replace the section during screenshot capture.
    // Re-resolve it and verify revocation again on each capture attempt.
    await expect(async () => {
      await expect(workflow).toContainText("Local triage");
      await expect(
        workflow.getByRole("button", { name: "Add", exact: true }),
      ).toHaveCount(0);
      await workflow.screenshot({
        path: "/tmp/lictory-configuration-revoked.png",
        timeout: 5_000,
      });
    }).toPass({ timeout: 30_000 });
  } finally {
    await managerContext.close();
    await maintainerContext.close();
  }
});
