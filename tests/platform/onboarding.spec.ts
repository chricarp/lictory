import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { platformOrigin } from "../helpers/app-urls";
import { seedOrganization } from "@lictory/core/domain/organization";
import { rebuildProjections } from "@lictory/core/domain/projections";
import { paths } from "@lictory/core/lib/paths";
import {
  configureFirstProject,
  createWorkspace,
} from "../helpers/onboarding-helpers";
import { reloadWhenSaved } from "../helpers/sync-helpers";
import { controlZeroConnection } from "../helpers/zero-socket";
import { consentStatePath } from "../consent-setup";
import { clientAddress } from "../helpers/client-address";
const password = "Onboarding-test-password-123";

test.beforeEach(async ({ page, context }) => {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": clientAddress(),
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
  test(`${mode} onboarding resumes, invites reviewers, and saves the complete setup @smoke`, async ({
    page,
  }) => {
    if (mode === "native") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
    }
    await page
      .getByRole("button", { name: "Create a workspace", exact: false })
      .click();
    await page
      .getByLabel("Organization", { exact: true })
      .fill(`Onboarding ${mode}`);
    await page.getByLabel("Project", { exact: true }).fill("Payments");
    await expect(page.getByLabel("Key", { exact: true })).toHaveValue("PAYM");
    await page.getByLabel("Key", { exact: true }).fill("PAY");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // The project chosen with the organization carries into setup and survives reload.
    await expect(
      page.getByRole("heading", { name: "Where does delivery happen?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeDisabled();
    const zero = await controlZeroConnection(page);
    await page.reload();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Project", { exact: true })).toHaveValue(
      "Payments",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await configureFirstProject(page, mode, "off", mode === "native");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await reloadWhenSaved(page);
    await expect(
      page.getByRole("radio", {
        name:
          mode === "native"
            ? "Enable Lictory Intelligence"
            : "Keep Lictory Intelligence off",
        exact: true,
      }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const invitee = `${crypto.randomUUID()}@example.test`;
    await page
      .getByLabel("Emails or usernames")
      .fill(`${invitee}, bad@@address`);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Not an email or username")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "People to invite" }).getByText(invitee),
    ).toBeVisible();
    // Lose the connection right after the setup was sent: Zero reconnects and
    // the server answers the same mutation from its receipt, once.
    let interrupted = false;
    zero.afterPush((socket) => {
      if (interrupted) return;
      interrupted = true;
      void socket.close({ code: 1011, reason: "Test connection interrupted" });
    });
    await page
      .getByRole("button", { name: "Invite 1 and finish", exact: true })
      .click();
    await expect(page).toHaveURL(/\/pay\/proposals$/);
    expect(interrupted).toBe(true);
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    const db = drizzle(client);
    const org = (
      await db
        .select()
        .from(s.organization)
        .where(
          eq(s.organization.slug, new URL(page.url()).pathname.split("/")[1]!),
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
    const invitations = await db
      .select()
      .from(s.invitation)
      .where(eq(s.invitation.organizationId, org.id));
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: "Payments",
      key: "PAY",
      deliveryMode: mode,
      readinessPolicy: "warn",
      iterationMode: "off",
      estimateScale: mode === "native" ? "fibonacci" : "none",
    });
    // Delivery configuration belongs to the project; no team is needed to start.
    expect(teams).toHaveLength(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decisions.invitations).toBe(1);
    expect(decisions[0]!.decisions.aiEnabled).toBe(mode === "native");
    const [aiPolicy] = await db
      .select()
      .from(s.organizationAiPolicy)
      .where(eq(s.organizationAiPolicy.organizationId, org.id));
    expect(aiPolicy!.enabled).toBe(mode === "native");
    expect(invitations.map((i) => i.email)).toEqual([invitee]);
    await client.end();
  });

test("organizations choose and change URL handles with server validation and administrator permissions", async ({
  page,
  browser,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const handle = `chosen-${suffix}`;
  const nextHandle = `renamed-${suffix}`;
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await page
    .getByLabel("Organization", { exact: true })
    .fill(`Handle Team ${suffix}`);
  await expect(
    page.getByLabel("Organization handle", { exact: true }),
  ).toHaveValue(`handle-team-${suffix}`);
  await page.getByLabel("Organization handle", { exact: true }).fill("account");
  await expect(
    page.getByText("That organization handle is reserved."),
  ).toBeVisible();
  await createWorkspace(page, {
    organization: `Handle Team ${suffix}`,
    handle: `Chosen-${suffix}`,
    project: "Payments",
    key: "PAY",
  });
  await expect(page).toHaveURL(new RegExp(`/${handle}/pay/proposals$`));

  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const memberContext = await browser.newContext({
    baseURL: platformOrigin,
    storageState: consentStatePath,
    extraHTTPHeaders: {
      Origin: platformOrigin,
      "x-forwarded-for": clientAddress(),
    },
  });
  try {
    const [org] = await db
      .select()
      .from(s.organization)
      .where(eq(s.organization.slug, handle));
    const memberId = crypto.randomUUID();
    const memberEmail = `${memberId}@example.test`;
    await db.insert(s.user).values({
      id: memberId,
      name: "Handle member",
      email: memberEmail,
      emailVerified: true,
      handle: `member_${suffix}`,
    });
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: memberId,
      accountId: memberId,
      providerId: "credential",
      password: await hashPassword(password),
    });
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId: org!.id,
      userId: memberId,
      role: "member",
      createdAt: new Date(),
    });
    const login = await memberContext.request.post("/api/auth/sign-in/email", {
      headers: { Origin: platformOrigin },
      data: { email: memberEmail, password },
    });
    expect(login.ok()).toBe(true);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(paths.settings(handle, "general"));
    // The member keeps the settings open while the handle changes.
    await expect(
      memberPage.getByRole("link", { name: "General", exact: true }),
    ).toHaveAttribute("href", paths.settings(handle, "general"));
    await expect(
      memberPage.getByRole("button", { name: "Save handle" }),
    ).toHaveCount(0);
    const denied = await memberContext.request.post(
      "/api/auth/organization/update",
      {
        headers: { Origin: platformOrigin },
        data: { organizationId: org!.id, data: { slug: nextHandle } },
      },
    );
    expect(denied.status()).toBe(403);

    // Existing generated handles are preserved by unrelated name updates.
    const legacy = `handle-team-${suffix}-generated`;
    await db
      .update(s.organization)
      .set({ slug: legacy })
      .where(eq(s.organization.id, org!.id));
    // The rename also refreshes the synchronized organization profile, which
    // the direct database update above bypassed.
    const renamed = await page.request.post("/api/auth/organization/update", {
      headers: { Origin: platformOrigin },
      data: { organizationId: org!.id, data: { name: "Handle Team renamed" } },
    });
    expect(renamed.ok()).toBe(true);
    expect(((await renamed.json()) as { slug: string }).slug).toBe(legacy);
    await page.goto(paths.settings(legacy, "general"));
    await expect(
      page.getByLabel("Organization handle", { exact: true }),
    ).toHaveValue(legacy);

    for (const bad of [
      "account",
      "invitation",
      "new-organization",
      "sign-in",
      "welcome",
      "api",
      "zero",
      "bad/handle",
      "bad--handle",
      "ab",
    ]) {
      const rejected = await page.request.post(
        "/api/auth/organization/update",
        {
          headers: { Origin: platformOrigin },
          data: { organizationId: org!.id, data: { slug: bad } },
        },
      );
      expect(rejected.status()).toBe(400);
      const createRejected = await page.request.post(
        "/api/auth/organization/create",
        {
          headers: { Origin: platformOrigin },
          data: { name: "Rejected", slug: bad },
        },
      );
      expect(createRejected.status()).toBe(400);
    }
    const other = await page.request.post("/api/auth/organization/create", {
      headers: { Origin: platformOrigin },
      data: {
        name: "Other handle team",
        slug: `taken-${suffix}`,
        keepCurrentActiveOrganization: true,
      },
    });
    expect(other.ok()).toBe(true);
    const duplicate = await page.request.post("/api/auth/organization/create", {
      headers: { Origin: platformOrigin },
      data: { name: "Duplicate", slug: `TAKEN-${suffix}` },
    });
    expect(duplicate.status()).toBe(400);
    const duplicateUpdate = await page.request.post(
      "/api/auth/organization/update",
      {
        headers: { Origin: platformOrigin },
        data: { organizationId: org!.id, data: { slug: `TAKEN-${suffix}` } },
      },
    );
    expect(duplicateUpdate.status()).toBe(400);

    await page
      .getByLabel("Organization handle", { exact: true })
      .fill(`taken-${suffix}`);
    await expect(
      page.getByText("That organization handle is already taken."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save handle" }),
    ).toBeDisabled();
    await page
      .getByLabel("Organization handle", { exact: true })
      .fill(`Renamed-${suffix}`);
    await expect(
      page.getByRole("button", { name: "Save handle" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("note", { name: "Organization handle warning" }),
    ).toContainText(
      "Changing the organization handle will invalidate all previously shared links to this workspace.",
    );
    await page.getByRole("button", { name: "Save handle" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${nextHandle}/settings/general$`),
    );
    await page.reload();
    await expect(
      page.getByLabel("Organization handle", { exact: true }),
    ).toHaveValue(nextHandle);
    await expect(
      page.getByRole("link", { name: "Proposals", exact: true }),
    ).toHaveAttribute("href", paths.proposals(nextHandle, "PAY"));
    await expect(
      memberPage.getByRole("link", { name: "General", exact: true }),
    ).toHaveAttribute("href", paths.settings(nextHandle, "general"));
    await memberPage.goto(paths.settings(nextHandle, "general"));
    await expect(
      memberPage.getByRole("button", { name: "Save handle" }),
    ).toHaveCount(0);
    const [saved] = await db
      .select()
      .from(s.organization)
      .where(eq(s.organization.id, org!.id));
    expect(saved!.slug).toBe(nextHandle);
    expect(
      await db
        .select()
        .from(s.project)
        .where(eq(s.project.organizationId, org!.id)),
    ).toHaveLength(1);
    await page.screenshot({ path: "/tmp/lictory-organization-handle.png" });
  } finally {
    await memberContext.close();
    await client.end();
  }
});

test("joining waits without creating an organization, discovers invitations, and keeps the existing setup", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Join my organization", exact: false })
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
  await seedOrganization(db, orgId);
  const [project] = await db
    .insert(s.project)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      name: "Existing project",
      slug: "exist",
      key: "EXIST",
      createdById: adminId,
    })
    .returning();
  // Written directly, so the synchronized read model is reconciled the way an
  // operator would after a manual repair.
  await rebuildProjections(db, orgId);
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
  await page.getByRole("button", { name: "Join", exact: true }).click();
  // Joining an organization with projects lands on Litto.
  await expect(page).toHaveURL(/\/intelligence$/);
  expect(
    await db
      .select()
      .from(s.organizationOnboarding)
      .where(eq(s.organizationOnboarding.organizationId, orgId)),
  ).toHaveLength(0);
  expect(
    (
      await db
        .select()
        .from(s.project)
        .where(eq(s.project.organizationId, orgId))
    )[0],
  ).toEqual(project);
  await client.end();
});

test("cycle selects support keyboard choices, numeric zero, and persisted project settings", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Cycle select verification",
    project: "Payments",
    key: "PAY",
    finish: false,
  });
  // Revisit planning to exercise the conditional cycle controls.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  for (const [name, description] of [
    ["None", "Items have no estimates."],
    ["Linear", "Points from 0 to 8 in equal steps."],
    ["T-shirt", "Sizes: XS, S, M, L, XL."],
    ["Fibonacci", "Bigger gaps reflect more uncertainty in larger work."],
  ]) {
    await page.getByRole("radio", { name, exact: true }).click();
    await expect(page.getByText(description!, { exact: false })).toBeVisible();
  }
  await page.getByRole("radio", { name: "Cycles", exact: true }).click();
  const length = page.getByRole("combobox", { name: "Length" });
  await length.click();
  await page.getByRole("option", { name: "3 weeks", exact: true }).click();
  const startDay = page.getByRole("combobox", { name: "Starts on" });
  await expect(startDay).toHaveText("Monday");
  await startDay.focus();
  await startDay.press("Enter");
  await page.getByRole("option", { name: "Sunday", exact: true }).click();
  await expect(startDay).toHaveText("Sunday");
  await expect(startDay).toBeFocused();
  await expect(startDay).toHaveCSS("height", "40px");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Skip and finish", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pay\/proposals$/);
  const orgSlug = new URL(page.url()).pathname.split("/")[1]!;
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const [organization] = await db
    .select()
    .from(s.organization)
    .where(eq(s.organization.slug, orgSlug));
  const [project] = await db
    .select()
    .from(s.project)
    .where(eq(s.project.organizationId, organization!.id));
  expect(project).toMatchObject({
    iterationWeeks: 3,
    iterationStartDay: 0,
    estimateScale: "fibonacci",
  });
  await page.goto(paths.projectSettings(orgSlug, "PAY", "planning"));
  const upcoming = page.getByRole("combobox", { name: "Upcoming cycles" });
  await expect(upcoming).toHaveCSS("height", "32px");
  await upcoming.click();
  await page.getByRole("option", { name: "0", exact: true }).click();
  await expect(upcoming).toHaveText("0");
  await expect
    .poll(async () => {
      const [saved] = await db
        .select()
        .from(s.project)
        .where(eq(s.project.id, project!.id));
      return saved?.upcomingIterations;
    })
    .toBe(0);
  await client.end();
  await page.reload();
  await expect(upcoming).toHaveText("0");
  await page.getByRole("combobox", { name: "Estimate scale" }).click();
  await page.screenshot({ path: "/tmp/lictory-select-project-settings.png" });
  await page.keyboard.press("Escape");
});
