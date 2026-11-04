import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { PROTOCOL } from "@lictory/core/contracts/protocol";
import { inApp } from "../helpers/app-urls";
import { clientAddress } from "../helpers/client-address";

const password = "Audit-log-test-password-123";
// A retry runs in a new worker that seeds again; each worker gets its own users.
const run = crypto.randomUUID().slice(0, 8);
const admin = {
  id: crypto.randomUUID(),
  name: "Audit Admin",
  email: `audit-admin-${run}@example.test`,
  handle: `audit_admin_${run}`,
};
const teammate = {
  id: crypto.randomUUID(),
  name: "Audit Teammate",
  email: `audit-teammate-${run}@example.test`,
  handle: `audit_teammate_${run}`,
};
const organizationId = crypto.randomUUID();
const slug = `audit-${run}`;

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client, { schema: s });
    for (const user of [admin, teammate]) {
      await db.insert(s.user).values({ ...user, emailVerified: true });
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(password),
      });
    }
    await db.insert(s.organization).values({
      id: organizationId,
      name: "Audit Studio",
      slug,
      createdAt: new Date(),
    });
    await db.insert(s.member).values([
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: admin.id,
        role: "owner",
        createdAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: teammate.id,
        role: "member",
        createdAt: new Date(),
      },
    ]);
    await seedOrganization(db, organizationId);
    // The first project also writes the directory both members appear in.
    await executeMutation(
      db,
      { userId: admin.id },
      {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command: {
          type: "createProject",
          projectId: crypto.randomUUID(),
          name: "Audit project",
          key: "AUD",
        },
      },
    );
  } finally {
    await client.end();
  }
});

test("with analytics disabled, role and token changes appear in the audit log", async ({
  page,
  playwright,
  baseURL,
}) => {
  // The browser suite runs without PostHog (scripts/test-e2e.ts), the
  // self-hosted default: nothing here depends on analytics.
  expect(process.env.POSTHOG_PROJECT_TOKEN ?? "").toBe("");

  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(admin.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);

  // An application role change through Better Auth.
  await page.goto(`/${slug}/settings/members`);
  const row = page
    .locator("#members")
    .locator("div.group", { hasText: teammate.email });
  await row.hover();
  await row.getByRole("button", { name: "Make admin" }).click();
  await expect(row.getByText("Admin", { exact: true })).toBeVisible();

  // An access token created and revoked in account settings.
  await page.goto("/account#agents");
  const agents = page.locator("#agents");
  await agents.getByRole("button", { name: "New token" }).click();
  await agents.getByLabel("Agent name", { exact: true }).fill("Audit agent");
  await agents.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByTestId("access-token-secret")).toBeVisible();

  await page.goto(`/${slug}/settings/audit`);
  const log = page.locator("#audit");
  await expect(
    log.getByText(
      `Changed ${teammate.name}'s application role from member to admin`,
    ),
  ).toBeVisible();
  await expect(
    log.getByText(/Created write access token “Audit agent”/),
  ).toBeVisible();

  // Filters run on the server.
  await log.getByLabel("Activity").click();
  await page.getByRole("option", { name: "Access tokens" }).click();
  await expect(log.getByText(/Created write access token/)).toBeVisible();
  await expect(
    log.getByText(`Changed ${teammate.name}'s application role`),
  ).toHaveCount(0);

  // The CSV export carries the same filtered entries and is recorded itself.
  const csvPath = `/api/organizations/${organizationId}/audit-log.csv`;
  const csv = await page.request.get(`${csvPath}?category=access`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain("access_token.created");
  expect(body).not.toContain("member.role_changed");
  await log.getByLabel("Activity").click();
  await page.getByRole("option", { name: "Organization" }).click();
  await expect(log.getByText("Exported the audit log")).toBeVisible();

  // Signed-out callers get nothing; non-administrators are covered by the
  // domain tests.
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get(csvPath)).status()).toBe(401);
  await anonymous.dispose();
});
