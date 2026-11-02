import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";
import { waitUntilSaved } from "../helpers/sync-helpers";
import { controlZeroConnection } from "../helpers/zero-socket";

// Project policy and server capabilities as a person meets them: the server
// enforces readiness even when the browser's view is out of date, external
// delivery hands off instead of offering a board, and features that need
// unconfigured infrastructure explain why they are unavailable.

const properties = (page: Page) =>
  page.getByRole("heading", { name: "Properties", exact: true }).locator("..");

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.170" });
});

test("the server refuses to start a not-ready specification even from an outdated view", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Policy Lab",
    key: "POL",
    users: ["Pia Policy"],
    disciplines: { 0: "Product" },
    settings: { readinessPolicy: "warn" },
  });
  const workItemId = await seedItem(seeded, {
    title: "Refund limits",
    description: "# Behavior\n\nRefunds are capped.",
  });
  const zero = await controlZeroConnection(page.context());
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(1));
  await expect(
    properties(page).getByRole("button", {
      name: "Status: Backlog",
      exact: true,
    }),
  ).toBeVisible();
  await waitUntilSaved(page);
  // The project switches to blocking while this browser is not listening.
  await zero.interrupt();
  await seeded.command({
    type: "updateProject",
    projectId: seeded.projectId,
    readinessPolicy: "block",
  });
  // Locally the project still warns, so the browser lets the change through.
  await properties(page)
    .getByRole("button", { name: "Status: Backlog", exact: true })
    .click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  zero.restore();
  await expect(
    page.locator('[data-slot="toast"]', { hasText: "Change not applied" }),
  ).toContainText("POL-1 is not ready to start", { timeout: 30_000 });
  await expect(
    properties(page).getByRole("button", {
      name: "Status: Backlog",
      exact: true,
    }),
  ).toBeVisible();
  const [row] = await withDb((db) =>
    db
      .select({ statusId: s.workItem.statusId })
      .from(s.workItem)
      .where(eq(s.workItem.id, workItemId)),
  );
  const [status] = await withDb((db) =>
    db
      .select({ category: s.workflowStatus.category })
      .from(s.workflowStatus)
      .where(eq(s.workflowStatus.id, row!.statusId)),
  );
  expect(status!.category).toBe("backlog");
  // Now the local view knows the policy: the browser explains before sending.
  await properties(page)
    .getByRole("button", { name: "Status: Backlog", exact: true })
    .click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  await expect(
    page
      .locator('[data-slot="toast"]', { hasText: "Change not applied" })
      .last(),
  ).toContainText("Complete the required reviews and readiness checks first.");
});

test("an externally delivered project hands off instead of offering a board or backlog", async ({
  page,
}) => {
  const seeded: Seeded = await seedWorkspace({
    name: "Jira Shop",
    key: "EXT",
    users: ["Eli External"],
    disciplines: { 0: "Product" },
    settings: { deliveryMode: "external" },
  });
  await seedItem(seeded, { title: "Invoice exports" });
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.projectPath("/items"));
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(
    rail.getByRole("link", { name: "Proposals", exact: true }),
  ).toBeVisible();
  await expect(rail.getByRole("link", { name: "Board" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /^Backlog/ })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "Hand-off" })).toBeVisible();
  // Old links to native delivery explain where delivery happens.
  for (const surface of ["board", "backlog"]) {
    await page.goto(seeded.projectPath(`/${surface}`));
    await expect(
      page.getByRole("heading", {
        name: "Jira Shop project delivers in your delivery tool",
      }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Open hand-off" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${seeded.projectPath("/handoff")}$`),
  );
});

test("without an AI provider or file storage, refinement works and those features explain why they are unavailable", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Plain Team",
    key: "PLN",
    users: ["Noor Plain"],
    disciplines: { 0: "Product" },
  });
  await seedItem(seeded, {
    title: "Statement cut-off",
    description: "# Behavior\n\nStatements close at midnight.",
  });
  await signIn(page, seeded.owner.email);
  await page.goto(`/${seeded.slug}/intelligence`);
  await expect(
    page.getByText(
      "Lictory Intelligence is not configured on this server. Ask an administrator to set OPENAI_API_KEY.",
    ),
  ).toBeVisible();

  // Core refinement does not depend on AI.
  await page.goto(seeded.itemPath(1));
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill("# Behavior\n\nStatements close at midnight UTC.");
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(page.getByText("Revision 2 ·").first()).toBeVisible();
  await page
    .getByRole("textbox", { name: "Start a discussion" })
    .fill("Which time zone do merchants expect?");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(
    page
      .getByRole("article", { name: "discussion" })
      .getByText("Which time zone do merchants expect?"),
  ).toBeVisible();

  // Attachments need object storage.
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Insert file or image" })
    .first()
    .click();
  await (
    await chooser
  ).setFiles({
    name: "cut-off.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.getByText(
      "File storage is not configured. Ask an administrator to add storage credentials.",
    ),
  ).toBeVisible();
});
