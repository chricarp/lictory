import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { seedOrganization } from "../src/sync/server/organization";
import { createSyncService, directory } from "../src/sync/server/service";
import { PROTOCOL, type Command } from "../src/sync/shared/protocol";
import { paths } from "../src/lib/paths";
import { consentStatePath } from "./consent-setup";
import { reloadWhenSaved } from "./sync-helpers";

const password = "Local-test-password-123";
const suffix = crypto.randomUUID().slice(0, 8);
const emails = ["admin", "lead", "engineer"].map(
  (name) => `project-${name}-${suffix}@example.test`,
);
const names = ["Organization Admin", "Project Lead", "Board Engineer"];
const slug = `projects-${suffix}`;
let projectId: string;

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client, { schema: s });
    const ids = emails.map(() => crypto.randomUUID());
    const organizationId = crypto.randomUUID();
    const hash = await hashPassword(password);
    for (const [index, email] of emails.entries()) {
      const id = ids[index]!;
      await db.insert(s.user).values({
        id,
        email,
        name: names[index]!,
        handle: `project_${index}_${suffix}`,
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
      name: "Atlassian",
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
    await seedOrganization(db, organizationId);
    const sync = createSyncService(db);
    const run = (command: Command) =>
      sync.mutate(ids[0]!, {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command,
      });
    projectId = crypto.randomUUID();
    await run({ type: "createProject", projectId, name: "Jira", key: "JIRA" });
    // The lead administers the project; the engineer is only a member.
    await run({
      type: "setProjectMember",
      projectId,
      userId: ids[1]!,
      role: "admin",
    });
    await run({
      type: "setProjectMember",
      projectId,
      userId: ids[2]!,
      role: "member",
    });
    const roster = await directory(db, ids[0]!, organizationId);
    await run({
      type: "createWorkItem",
      projectId,
      workItemId: crypto.randomUUID(),
      typeId: roster.types.find((t) => t.name === "Task")!.id,
      parentId: null,
      title: "Virtualize board columns",
    });
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

test("project administrators configure teams, disciplines and delivery; capabilities follow disciplines live", async ({
  page: lead,
  browser,
}) => {
  test.setTimeout(180_000);
  await lead
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.221" });
  const engineerContext = await browser.newContext({
    storageState: consentStatePath,
    extraHTTPHeaders: { "x-forwarded-for": "192.0.2.222" },
  });
  try {
    const engineer = await engineerContext.newPage();
    await signIn(lead, 1);
    await signIn(engineer, 2);

    // A project member without a discipline reads settings but cannot change
    // them, and cannot change work item properties.
    await engineer.goto(paths.projectSettings(slug, "JIRA", "teams"));
    await expect(
      engineer.getByRole("button", { name: "Add team" }),
    ).toHaveCount(0);
    await engineer.goto(paths.list(slug, "JIRA", "stories"));
    await expect(engineer.getByText("Virtualize board columns")).toBeVisible();
    await expect(
      engineer.getByRole("button", { name: /^Status:/ }).first(),
    ).toHaveCount(0);

    // The project lead creates a team: a vertical with no configuration.
    await lead.goto(paths.projectSettings(slug, "JIRA", "teams"));
    await lead.getByRole("button", { name: "Add team" }).click();
    await lead.getByLabel("Team name", { exact: true }).fill("Board");
    await lead.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      lead.getByLabel("Team name Board", { exact: true }),
    ).toBeVisible();

    // Granting the Engineering discipline gives the engineer property rights,
    // and the open second browser picks them up through synchronization.
    await lead.goto(paths.projectSettings(slug, "JIRA", "members"));
    await lead
      .getByLabel(`Disciplines of ${names[2]}`)
      .getByRole("button", { name: "Engineering", exact: true })
      .click();
    await expect(
      lead
        .getByLabel(`Disciplines of ${names[2]}`)
        .getByRole("button", { name: "Engineering", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await reloadWhenSaved(lead);
    await expect(
      engineer.getByRole("button", { name: /^Status:/ }).first(),
    ).toBeVisible();
    await lead.screenshot({ path: "/tmp/lictory-project-members.png" });

    // The team owns a backlog: it takes unclaimed project work, ranks it,
    // and its board is the project board narrowed to the team.
    await engineer.goto(paths.board(slug, "JIRA"));
    await engineer
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name: "Board", exact: true })
      .and(engineer.locator('a[href*="/jira/teams/"]'))
      .click();
    await expect(engineer).toHaveURL(/\/jira\/teams\//);
    const intake = engineer.getByRole("region", {
      name: "Unassigned project work",
    });
    const teamBacklog = engineer.getByRole("region", { name: "Team backlog" });
    await expect(intake.getByText("Virtualize board columns")).toBeVisible();
    await intake
      .getByRole("button", { name: /^Take JIRA-1 into Board$/ })
      .click();
    await expect(
      teamBacklog.getByText("Virtualize board columns"),
    ).toBeVisible();
    await expect(intake.getByText("Virtualize board columns")).toHaveCount(0);
    await reloadWhenSaved(engineer);
    await expect(
      teamBacklog.getByText("Virtualize board columns"),
    ).toBeVisible();
    await engineer.screenshot({ path: "/tmp/lictory-team-backlog.png" });
    await engineer
      .getByRole("main")
      .getByRole("link", { name: "Board" })
      .click();
    await expect(engineer).toHaveURL(/\/jira\/board\?team=/);

    // Handing delivery off to Jira replaces the board with the hand-off view.
    await lead.goto(paths.projectSettings(slug, "JIRA", "delivery"));
    await lead
      .getByRole("radiogroup", { name: "Delivery mode" })
      .getByRole("radio", { name: /Hand off to Jira/ })
      .click();
    await lead.getByRole("button", { name: "Hand off to Jira" }).click();
    await expect(
      lead
        .getByRole("radiogroup", { name: "Delivery mode" })
        .getByRole("radio", { name: /Hand off to Jira/ }),
    ).toHaveAttribute("aria-checked", "true");
    await reloadWhenSaved(lead);
    await expect(
      lead.getByRole("link", { name: "Hand-off", exact: true }),
    ).toBeVisible();
    await expect(lead.getByRole("link", { name: /Backlog/ })).toHaveCount(0);
    await lead.screenshot({ path: "/tmp/lictory-project-delivery.png" });

    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const [saved] = await drizzle(client, { schema: s })
        .select()
        .from(s.project)
        .where(eq(s.project.id, projectId));
      expect(saved).toMatchObject({
        deliveryMode: "external",
        iterationMode: "off",
        estimateScale: "none",
      });
    } finally {
      await client.end();
    }

    // The engineer is not a project administrator.
    await engineer.goto(paths.projectSettings(slug, "JIRA", "delivery"));
    await expect(
      engineer
        .getByRole("radiogroup", { name: "Delivery mode" })
        .getByRole("radio", { name: /Deliver in Lictory/ }),
    ).toBeDisabled();
  } finally {
    await engineerContext.close();
  }
});
