import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { PROTOCOL } from "@lictory/core/contracts/protocol";
import { inApp } from "../helpers/app-urls";

const password = "Data-export-test-password-123";
// A retry runs in a new worker that seeds again; each worker gets its own users.
const run = crypto.randomUUID().slice(0, 8);
const admin = {
  id: crypto.randomUUID(),
  name: "Export Admin",
  email: `export-admin-${run}@example.test`,
  handle: `export_admin_${run}`,
};
const organizationId = crypto.randomUUID();
const slug = `export-${run}`;

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.173" });
});

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client, { schema: s });
    await db.insert(s.user).values({ ...admin, emailVerified: true });
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: admin.id,
      accountId: admin.id,
      providerId: "credential",
      password: await hashPassword(password),
    });
    await db.insert(s.organization).values({
      id: organizationId,
      name: "Export Studio",
      slug,
      createdAt: new Date(),
    });
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: admin.id,
      role: "owner",
      createdAt: new Date(),
    });
    await seedOrganization(db, organizationId);
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
          name: "Export project",
          key: "EXP",
        },
      },
    );
  } finally {
    await client.end();
  }
});

test("an administrator exports the organization, downloads the archive and the export is audited", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(admin.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);

  await page.goto(`/${slug}/settings/export`);
  const section = page.locator("#export");
  await section.getByRole("button", { name: "Export data" }).click();
  // The worker builds the archive in the background.
  const row = section.getByTestId("organization-export").first();
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 75_000 });

  const downloading = page.waitForEvent("download");
  await row.getByRole("button", { name: "Download" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^lictory-export-.*\.tar\.gz$/);
  const tar = gunzipSync(await readFile(await download.path()));
  const text = tar.toString("utf8");
  expect(text).toContain('"format": "lictory-organization-export"');
  expect(text).toContain("Export project");
  expect(text).toContain("entities/specification_revision.jsonl");

  await page.goto(`/${slug}/settings/audit`);
  const log = page.locator("#audit");
  await expect(
    log.getByText("Started an export of the organization's data"),
  ).toBeVisible();
  await expect(
    log.getByText("Downloaded an export of the organization's data"),
  ).toBeVisible();
});
