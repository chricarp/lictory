import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { seedDefaultRoles } from "../src/sync/server/roles";
import { configureFirstProject } from "./onboarding-helpers";
const password = "Onboarding-test-password-123";

test.beforeEach(async ({ page, context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${testInfo.line}`,
  });
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  await db.insert(s.user).values({
    id,
    name: "Sam Rivera",
    email,
    emailVerified: true,
    handle: `sam_${id.slice(0, 8)}`,
  });
  await db.insert(s.account).values({
    id: crypto.randomUUID(),
    userId: id,
    accountId: id,
    providerId: "credential",
    password: await hashPassword(password),
  });
  await client.end();
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Sam." }),
  ).toBeVisible();
});

for (const mode of ["native", "external"] as const)
  test(`${mode} onboarding resumes, requires choices, and saves the complete setup`, async ({
    page,
  }) => {
    if (mode === "native") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".onboarding-step")).toHaveCSS(
        "animation-name",
        "none",
      );
    }
    await page
      .getByRole("button", { name: "Create a workspace", exact: false })
      .click();
    await page.getByLabel("Organization name").fill(`Onboarding ${mode}`);
    await page
      .getByRole("button", { name: "Create organization", exact: true })
      .click();
    await page.getByLabel("Project name").fill("Payments");
    await page.getByLabel("Key", { exact: true }).fill("PAY");
    await page.getByLabel("Team name", { exact: true }).fill("Payments team");
    await page.reload();
    await expect(page.getByLabel("Project name")).toHaveValue("Payments");
    await configureFirstProject(page, mode);
    await page
      .getByLabel("Customize types, workflow", { exact: false })
      .uncheck();
    await expect(
      page.getByRole("button", { name: "Create project", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Customize types, workflow", { exact: false })
      .check();
    // Lose the first committed response; retry must use the same mutation receipt.
    let interrupted = false;
    await page.route("**/api/sync", async (route) => {
      if (route.request().method() !== "POST" || interrupted)
        return route.continue();
      interrupted = true;
      await route.fetch();
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm saved setup" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Confirm saved setup" }).click();
    await expect(page).toHaveURL(/\/pay\/epics$/);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const db = drizzle(client);
    const org = (
      await db
        .select()
        .from(s.organization)
        .where(
          eq(s.organization.slug, new URL(page.url()).pathname.split("/")[2]!),
        )
    )[0]!;
    const projects = await db
      .select()
      .from(s.project)
      .where(eq(s.project.organizationId, org.id));
    const teams = await db
      .select()
      .from(s.team)
      .where(eq(s.team.organizationId, org.id));
    const decisions = await db
      .select()
      .from(s.organizationOnboarding)
      .where(eq(s.organizationOnboarding.organizationId, org.id));
    expect(projects).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      name: "Delivery team",
      deliveryMode: mode,
      readinessPolicy: "warn",
      iterationMode: "off",
      estimateScale: mode === "native" ? "fibonacci" : "none",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decisions.deferInvitations).toBe(true);
    await client.end();
  });

test("joining waits without creating an organization, discovers invitations, and keeps the existing setup", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Join my team", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "No invitation yet" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No invitation yet" }),
  ).toBeVisible();
  const email = await page
    .locator("main")
    .getByText(/@example.test$/, { exact: false })
    .first()
    .textContent();
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client, { schema: s });
  const invited = (
    await db.select().from(s.user).where(eq(s.user.email, email!.trim()))
  )[0]!;
  const adminId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: adminId, name: "Admin", email: `${adminId}@example.test` });
  await db.insert(s.organization).values({
    id: orgId,
    name: "Existing team",
    slug: orgId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId: adminId,
    role: "owner",
    createdAt: new Date(),
  });
  await seedDefaultRoles(db, orgId, adminId);
  const team = (
    await db.select().from(s.team).where(eq(s.team.organizationId, orgId))
  )[0]!;
  await db.insert(s.project).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    name: "Existing project",
    slug: "exist",
    key: "EXIST",
    defaultTeamId: team.id,
    createdById: adminId,
  });
  await db.insert(s.invitation).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    email: invited.email,
    role: "member",
    status: "pending",
    inviterId: adminId,
    expiresAt: new Date(Date.now() + 86400000),
  });
  await page.getByRole("button", { name: "Check invitations" }).click();
  await page
    .getByRole("button", { name: "Join Existing team", exact: true })
    .click();
  await expect(page).toHaveURL(/\/exist\/epics$/);
  expect(
    await db
      .select()
      .from(s.organizationOnboarding)
      .where(eq(s.organizationOnboarding.organizationId, orgId)),
  ).toHaveLength(0);
  expect(
    (await db.select().from(s.team).where(eq(s.team.organizationId, orgId)))[0],
  ).toEqual(team);
  await client.end();
});
