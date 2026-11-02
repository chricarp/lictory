import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { paths } from "@lictory/core/lib/paths";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";
import { reloadWhenSaved, waitUntilSaved } from "../helpers/sync-helpers";

let seeded: Seeded;
const proposalTitle = "Remember the selected payment method";
const taskTitle = "Rotate the test signing key";

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Custom workflow",
    key: "NAV",
    users: ["Nadia Product", "Quinn Navigation QA"],
    disciplines: { 1: "QA" },
    settings: {
      deliveryMode: "native",
      iterationMode: "off",
      readinessPolicy: "block",
    },
  });
  // The project has only its own two names. No active Epic type exists in
  // the organization, and neither navigation nor creation should require it.
  await seeded.command({
    type: "updateType",
    typeId: seeded.typeId("Story"),
    name: "Feature",
  });
  await seeded.command({
    type: "updateType",
    typeId: seeded.typeId("Task"),
    name: "Chore",
  });
  for (const type of seeded.roster.types)
    if (!["Story", "Task"].includes(type.name))
      await seeded.command({
        type: "setProjectType",
        projectId: seeded.projectId,
        typeId: type.id,
        enabled: false,
      });
  await seeded.command({
    type: "updateType",
    typeId: seeded.typeId("Epic"),
    archived: true,
  });
  await seedItem(seeded, { type: "Task", title: taskTitle });
});

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.176" });
});

test("custom types move from proposal through refinement to native delivery, with one catalog across every type", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, seeded.owner.email);
  // Refinement is the project's home when it reviews specifications.
  await page.goto(paths.project(seeded.slug, "NAV"));
  await expect(page).toHaveURL(paths.refinement(seeded.slug, "NAV"));
  const sidebar = page.getByRole("navigation", {
    name: "Workspace",
    exact: true,
  });
  await expect(
    sidebar.getByRole("link", { name: "Epics", exact: true }),
  ).toHaveCount(0);
  await sidebar.getByRole("link", { name: "Proposals", exact: true }).click();
  await expect(
    sidebar.getByRole("link", { name: "Proposals", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "New proposal", exact: true }).click();
  const create = page.getByRole("dialog", { name: /^Create/ });
  await expect(
    create.getByRole("button", { name: "Type: Feature", exact: true }),
  ).toBeVisible();
  await create
    .getByRole("button", { name: "Type: Feature", exact: true })
    .click();
  await expect(page.getByRole("option", { name: /^Feature/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^Chore|^Epic/ })).toHaveCount(
    0,
  );
  await page.getByRole("option", { name: /^Feature/ }).click();
  await create
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(proposalTitle);
  await create
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(
      "# Expected behavior\n\nRemember the selected method for this browser.\n\n## Acceptance criteria\n\nA removed method is never restored.",
    );
  await create
    .getByRole("button", { name: "Create & open", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`^${proposalTitle}`) }),
  ).toBeVisible();
  const workflow = page.getByRole("region", {
    name: "Item workflow",
    exact: true,
  });
  await workflow
    .getByRole("button", { name: "Start refinement", exact: true })
    .click();
  await expect(workflow).toContainText("Agree on what to build");
  await waitUntilSaved(page);
  await sidebar.getByRole("link", { name: "Refinement", exact: true }).click();
  await expect(page).toHaveURL(paths.refinement(seeded.slug, "NAV"));
  await expect(
    page.getByRole("link", { name: new RegExp(`^${proposalTitle}`) }),
  ).toBeVisible();
  await reloadWhenSaved(page);
  await expect(
    page.getByRole("link", { name: new RegExp(`^${proposalTitle}`) }),
  ).toBeVisible();

  // A second discipline agrees on the current revision. The browser's ready
  // queue updates from the real domain events, without a reload.
  const workItemId = await withDb(async (db) => {
    const [item] = await db
      .select({ id: s.workItem.id })
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.projectId, seeded.projectId),
          eq(s.workItem.title, proposalTitle),
        ),
      );
    return item!.id;
  });
  const revision = await currentRevision(workItemId);
  const reviewId = crypto.randomUUID();
  const qa = seeded.roster.disciplines.find(
    (discipline) => discipline.name === "QA",
  )!;
  await seeded.command({
    type: "requestReview",
    workItemId,
    baseRevisionId: revision.id,
    reviewId,
    disciplineId: qa.id,
    userId: seeded.users[1]!.id,
    required: true,
  });
  await seeded.command(
    {
      type: "decideReview",
      workItemId,
      baseRevisionId: revision.id,
      reviewId,
      decision: "approve",
    },
    seeded.users[1]!.id,
  );
  await page
    .getByRole("navigation", { name: "Specification lifecycle" })
    .getByRole("link", { name: /^Ready for delivery/ })
    .click();
  await expect(
    page.getByRole("link", { name: new RegExp(`^${proposalTitle}`) }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/lictory-custom-ready-queue.png" });
  await page
    .getByRole("link", { name: new RegExp(`^${proposalTitle}`) })
    .click();
  // The item keeps the queue it was opened from: address, sidebar,
  // breadcrumb and the list beside it.
  await expect(page).toHaveURL(
    /\/nav\/items\/NAV-2\?from=refinement&stage=ready$/,
  );
  await expect(
    sidebar.getByRole("link", { name: "Refinement", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    sidebar.getByRole("link", { name: "All items", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(
    breadcrumb.getByRole("link", { name: "Refinement", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Refinement", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: taskTitle, exact: true }),
  ).toHaveCount(0);
  // The list's search toggle opens with Enter and returns focus on Escape,
  // without the list's own Enter shortcut reopening the item.
  const searchToggle = page.getByRole("button", {
    name: "Search items",
    exact: true,
  });
  await searchToggle.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("textbox", {
    name: "Filter by title or identifier",
  });
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(searchToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(
    /\/nav\/items\/NAV-2\?from=refinement&stage=ready$/,
  );
  await expect(workflow).toContainText("Ready for delivery");
  const scope = page.getByRole("region", {
    name: "Delivery scope",
    exact: true,
  });
  await scope
    .getByRole("button", { name: "Accept revision 1 for delivery" })
    .click();
  await expect(workflow).toContainText("Accepted revision 1");
  await expect(scope).toHaveCount(0);
  await page.screenshot({ path: "/tmp/lictory-agreed-delivery-scope.png" });
  await workflow
    .getByRole("link", { name: "Open delivery", exact: true })
    .click();
  await expect(page).toHaveURL(paths.board(seeded.slug, "NAV"));
  await expect(
    page.locator("[data-card]", { hasText: proposalTitle }),
  ).toBeVisible();
  await reloadWhenSaved(page);
  await expect(
    page.locator("[data-card]", { hasText: proposalTitle }),
  ).toBeVisible();
  // Earlier item addresses keep working.
  await page.goto(`/${seeded.slug}/nav/stories/NAV-2`);
  await expect(page).toHaveURL(/\/nav\/items\/NAV-2$/);
  await expect(workflow).toContainText("Accepted for delivery");
  await expect(
    breadcrumb.getByRole("link", { name: "All items", exact: true }),
  ).toBeVisible();

  await sidebar.getByRole("link", { name: "All items", exact: true }).click();
  await expect(page).toHaveURL(paths.items(seeded.slug, "NAV"));
  await expect(
    page.getByRole("link", { name: new RegExp(`^${proposalTitle}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: taskTitle, exact: true }),
  ).toBeVisible();
  const types = page.getByRole("navigation", { name: "Item types" });
  await expect(
    types.getByRole("link", { name: "Epic", exact: true }),
  ).toHaveCount(0);
  await types.getByRole("link", { name: "Feature", exact: true }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(`^${proposalTitle}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: taskTitle, exact: true }),
  ).toHaveCount(0);
  await reloadWhenSaved(page);
  await expect(
    types.getByRole("link", { name: "Feature", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: taskTitle, exact: true }),
  ).toHaveCount(0);
  await types.getByRole("link", { name: "All types", exact: true }).click();
  await expect(
    page.getByRole("link", { name: taskTitle, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    types.getByRole("link", { name: "Feature", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: taskTitle, exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "/tmp/lictory-custom-types-catalog.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(paths.proposals(seeded.slug, "NAV"));
  await page.getByRole("button", { name: "New proposal", exact: true }).click();
  await expect(create).toBeVisible();
  await expect(
    create.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: "/tmp/lictory-mobile-proposal-create.png" });
  await page.keyboard.press("Escape");
  await expect(create).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await sidebar.getByRole("link", { name: "All items", exact: true }).click();
  await expect(page).toHaveURL(paths.items(seeded.slug, "NAV"));
  await expect(sidebar).toBeHidden();
  await expect(
    page.getByRole("link", { name: taskTitle, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/lictory-mobile-catalog.png" });
});
