import { test, expect } from "@playwright/test";
import { createWorkspace } from "../helpers/onboarding-helpers";
import { reloadWhenSaved } from "../helpers/sync-helpers";
import { clientAddress } from "../helpers/client-address";
import { people, seedPeople, signIn } from "../helpers/workspace-people";

// Native delivery: sprints, the board and accepted scope.
const deliveryEmail = people.delivery[1];
// Give independent browser scenarios distinct client addresses. Production auth
// throttles rapid sign-ins by IP; unrelated tests must not share that budget.
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});
test.beforeAll(() => seedPeople("delivery"));

test("native delivery: plan a sprint, move cards on the board, readiness gates starting, complete with carry-over @smoke", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, deliveryEmail);
  await page.goto("/new-organization");
  await createWorkspace(page, {
    organization: "Delivery Co",
    project: "Checkout",
    key: "CHK",
    planning: "manual",
  });

  // The catalog can create any enabled type; proposal capture stays focused on specifications.
  await page.getByRole("link", { name: "All items", exact: true }).click();
  // A Task (plain work) and a Story (specification) through quick create.
  for (const [type, title] of [
    ["Task", "Add payment method column"],
    ["Story", "Save a card for later"],
  ] as const) {
    await page.keyboard.press("c");
    await page
      .getByRole("dialog", { name: /^Create/ })
      .getByRole("button", { name: /^Type:/ })
      .click();
    await page.getByRole("option", { name: new RegExp(`^${type}`) }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
    await page
      .getByRole("button", { name: "Create another", exact: true })
      .click();
    await expect(page.getByText(`${type} “${title}” created`)).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // Plan: create a sprint and drag both items into it, then start it.
  await page.getByRole("link", { name: "Backlog & sprints" }).click();
  await page.getByRole("button", { name: "New sprint" }).click();
  const sprint = page.locator("section[aria-label='Iteration']").first();
  await expect(sprint.getByText("Sprint 1")).toBeVisible();
  for (const title of ["Add payment method column", "Save a card for later"]) {
    await page.locator("[data-row]", { hasText: title }).dragTo(sprint);
    await expect(sprint.getByText(title)).toBeVisible();
  }
  await sprint.getByRole("button", { name: "Start" }).click();
  await expect(sprint.getByText("Active", { exact: true })).toBeVisible();

  // Board: a second member session sees the same board state.
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.getByRole("link", { name: "Board" }).click();
  const column = (name: string) =>
    page.locator("[data-board-column]").filter({
      has: page.locator("span.truncate", {
        hasText: new RegExp(`^${name}$`),
      }),
    });
  await page
    .locator("[data-card]", { hasText: "Add payment method column" })
    .dragTo(column("In Progress"));
  await expect(
    column("In Progress").getByText("Add payment method column"),
  ).toBeVisible();
  // Warn (default): the Story starts, and the early start is surfaced.
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("In Progress"));
  await expect(
    page.getByText(/started before its specification is ready/),
  ).toBeVisible();
  await reloadWhenSaved(page);
  await expect(
    column("In Progress").getByText("Save a card for later"),
  ).toBeVisible();

  // Block: the project now requires a ready specification to start work.
  await page.getByRole("link", { name: "Project settings" }).click();
  await page.getByRole("link", { name: "Readiness", exact: true }).click();
  await page.getByRole("radio", { name: /^Block/ }).click();
  await expect(page.getByRole("radio", { name: /^Block/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Everything is saved" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("Todo"));
  await expect(column("Todo").getByText("Save a card for later")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Everything is saved" }),
  ).toBeVisible();
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("In Progress"));
  await expect(page.getByText(/requires a ready specification/)).toBeVisible();
  await expect(column("Todo").getByText("Save a card for later")).toBeVisible();

  // Cards open a preview docked over the board instead of leaving it.
  const storyCard = page.locator("[data-card]", {
    hasText: "Save a card for later",
  });
  const taskCard = page.locator("[data-card]", {
    hasText: "Add payment method column",
  });
  await storyCard.click();
  const storyPreview = page.getByRole("complementary", {
    name: "Preview of CHK-2",
  });
  await expect(
    storyPreview.getByRole("heading", { name: "Save a card for later" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/board\?(.*&)?item=CHK-2/);
  await expect(storyPreview.getByText("Readiness checks")).toBeVisible();
  // Another card swaps the content in place, and its status can be changed
  // from the preview.
  await taskCard.click();
  const taskPreview = page.getByRole("complementary", {
    name: "Preview of CHK-1",
  });
  await expect(
    taskPreview.getByRole("heading", { name: "Add payment method column" }),
  ).toBeVisible();
  await expect(storyPreview).toBeHidden();
  await taskPreview
    .getByRole("button", { name: "Status: In Progress" })
    .click();
  await page.getByRole("option", { name: /^Todo/ }).click();
  await expect(
    column("Todo").getByText("Add payment method column"),
  ).toBeVisible();
  await taskPreview.getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  await expect(
    column("In Progress").getByText("Add payment method column"),
  ).toBeVisible();
  // Planning fields are editable in place: the card shows the new estimate.
  await taskPreview
    .getByRole("button", { name: "Estimate: No estimate" })
    .click();
  await page.getByRole("option", { name: "5", exact: true }).click();
  await expect(
    taskPreview.getByRole("button", { name: "Estimate: 5" }),
  ).toBeVisible();
  await expect(taskCard.getByText("5", { exact: true })).toBeVisible();
  // The close icon, an outside click and Escape all dismiss it; a reload
  // keeps it open.
  await taskPreview.getByRole("button", { name: "Close preview" }).click();
  await expect(taskPreview).toBeHidden();
  await expect(page).not.toHaveURL(/item=/);
  await storyCard.click();
  await reloadWhenSaved(page);
  await expect(
    storyPreview.getByRole("heading", { name: "Save a card for later" }),
  ).toBeVisible();
  await page.getByRole("heading", { name: "Checkout", exact: true }).click();
  await expect(storyPreview).toBeHidden();
  await storyCard.click();
  await page.keyboard.press("Escape");
  await expect(storyPreview).toBeHidden();

  // The detail picker checks readiness before queueing: a blocked transition keeps
  // the status, explains why in a toast, and leaves the item usable.
  await storyCard.click();
  await storyPreview.getByRole("link", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/items\/CHK-2(\?.*)?$/);
  const detailProperties = page
    .getByRole("heading", { name: "Properties", exact: true })
    .locator("..");
  await detailProperties.getByRole("button", { name: "Status: Todo" }).click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  const rejectionToast = page.locator('[data-slot="toast"]', {
    hasText: "Change not applied",
  });
  await expect(rejectionToast).toContainText(/CHK-2 is not ready to start/);
  await expect(
    detailProperties.getByRole("button", { name: "Status: Todo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The workspace could not be synced" }),
  ).toBeHidden();
  await detailProperties.getByRole("button", { name: /^Priority:/ }).click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(
    detailProperties.getByRole("button", { name: "Priority: High" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Everything is saved", exact: true }),
  ).toBeVisible();
  await expect(rejectionToast).toHaveCount(1);
  await page.reload();
  await expect(
    detailProperties.getByRole("button", { name: "Status: Todo" }),
  ).toBeVisible();
  await expect(
    detailProperties.getByRole("button", { name: "Priority: High" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Everything is saved", exact: true })
    .click();
  const syncDialog = page.getByRole("dialog", { name: "Workspace sync" });
  await expect(syncDialog.getByText("Technical details")).toBeHidden();
  await expect(syncDialog).toContainText("Your workspace is up to date.");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Board", exact: true }).click();

  // Finish the task, complete the sprint, carry the story to the backlog.
  await page
    .locator("[data-card]", { hasText: "Add payment method column" })
    .dragTo(column("Done"));
  await expect(
    column("Done").getByText("Add payment method column"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Backlog & sprints" }).click();
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("option", { name: "Backlog" }).click();
  const backlog = page.locator("section[aria-label='Backlog']");
  await expect(backlog.getByText("Save a card for later")).toBeVisible();
  await page.getByRole("link", { name: /Sprint 1/ }).click();
  await expect(page.getByRole("heading", { name: "Burndown" })).toBeVisible();
  await expect(page.getByText("Carried over")).toBeVisible();
});

test("native delivery preserves accepted scope through an amendment, completion and reopen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, deliveryEmail);
  await page.goto("/new-organization");
  await createWorkspace(page, {
    organization: "Scope agreements",
    project: "Scope",
    key: "SCP",
    planning: "manual",
  });
  await page.getByRole("link", { name: "All items", exact: true }).click();
  await page.keyboard.press("c");
  const create = page.getByRole("dialog", { name: /^Create/ });
  await create.getByRole("button", { name: /^Type:/ }).click();
  await page.getByRole("option", { name: /^Task/ }).click();
  await create
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Keep the accepted payment scope");
  await create
    .getByRole("button", { name: "Create & open", exact: true })
    .click();
  await expect(page).toHaveURL(/\/items\/SCP-1(\?.*)?$/);
  const scope = page.getByRole("region", {
    name: "Delivery scope",
    exact: true,
  });
  // Plain work records its scope when it starts; there is nothing to accept
  // before then.
  await expect(scope).toHaveCount(0);
  const properties = page
    .getByRole("heading", { name: "Properties", exact: true })
    .locator("..");
  await properties.getByRole("button", { name: /^Status:/ }).click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  const workflow = page.getByRole("region", {
    name: "Item workflow",
    exact: true,
  });
  await expect(workflow).toContainText("Accepted revision 1");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification", exact: true })
    .fill(
      "An amended payment behavior that is not part of the accepted scope yet.",
    );
  await page.getByRole("button", { name: /^Save revision 2/ }).click();
  await expect(scope).toContainText(
    "Revision 2 changes the accepted specification",
  );
  await scope
    .getByRole("button", {
      name: "Compare with accepted revision",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByText(
        "An amended payment behavior that is not part of the accepted scope yet.",
      )
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close comparison", exact: true })
    .click();
  await properties
    .getByRole("button", { name: "Status: In Progress", exact: true })
    .click();
  await page.getByRole("option", { name: /^Done/ }).click();
  await expect(scope).toContainText("Delivered: revision 1");
  await expect(
    scope.getByRole("button", { name: /^Accept revision/ }),
  ).toHaveCount(0);
  await reloadWhenSaved(page);
  await expect(scope).toContainText("Delivered: revision 1");
  await properties
    .getByRole("button", { name: "Status: Done", exact: true })
    .click();
  await page.getByRole("option", { name: /^Todo/ }).click();
  await scope
    .getByRole("button", {
      name: "Accept revision 2 for delivery",
      exact: true,
    })
    .click();
  await expect(workflow).toContainText("Accepted revision 2");
  await expect(workflow).toContainText("Delivered revision 1");
  await properties
    .getByRole("button", { name: "Status: Todo", exact: true })
    .click();
  await page.getByRole("option", { name: /^Done/ }).click();
  await expect(workflow).toContainText("Delivered revision 2");
  await reloadWhenSaved(page);
  await expect(workflow).toContainText("Delivered revision 2");
});
