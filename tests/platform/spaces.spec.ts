import { test, expect, type Page } from "@playwright/test";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import { clientAddress } from "../helpers/client-address";
import { newPerson, seedWorkspace, signIn, type Seeded } from "../helpers/seed";

// Lictory Spaces from the browser: a space homed in a project, its page
// tree (create, nest by dragging and with the keyboard Move dialog, archive
// and restore), who can read and edit it while access is inherited, and a
// restricted space that only named people can open.

// The tests build on each other's space; a failure skips the rest.
test.describe.configure({ mode: "serial" });

let seeded: Seeded;
let spaceUrl: string;

const [owner, viewer, member, outsider] = [0, 1, 2, 3] as const;
const user = (index: number) => seeded.users[index]!;

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Northwind",
    key: "NW",
    users: ["Sasha Owner", "Vera Viewer", "Milo Member", "Otto Outsider"],
  });
  // Milo works in the project; Vera and Otto are only in the organization.
  await seeded.command({
    type: "setProjectMember",
    projectId: seeded.projectId,
    userId: user(member).id,
    role: "member",
  });
  spaceUrl = `/${seeded.slug}/spaces/payments-handbook`;
});

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

const treeItem = (page: Page, name: string) =>
  page.getByRole("treeitem", { name, exact: true });

async function newPage(page: Page, title: string) {
  await page
    .getByRole("main")
    .getByRole("button", { name: "New page" })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create page" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
}

test("a project's space: pages are created, nested, moved and archived @smoke", async ({
  page,
}) => {
  await signIn(page, user(owner).email);
  await page.goto(`/${seeded.slug}/spaces`);
  await expect(
    page.getByRole("heading", { name: "No spaces yet" }),
  ).toBeVisible();

  await page
    .getByRole("main")
    .getByRole("button", { name: "New space" })
    .first()
    .click();
  const create = page.getByRole("dialog", { name: "New space" });
  await create.getByLabel("Name").fill("Payments handbook");
  await expect(create.getByLabel("Handle")).toHaveValue("payments-handbook");
  await create.getByLabel("Home").click();
  await page
    .getByRole("option", { name: "Northwind project", exact: true })
    .click();
  // The explanation follows the home.
  await expect(
    create.getByText(
      "Members of Northwind project can edit. Everyone else in Northwind can view.",
    ),
  ).toBeVisible();
  await create.getByRole("button", { name: "Create space" }).click();

  await expect(page).toHaveURL(new RegExp(`${spaceUrl}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Payments handbook" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No pages yet" }),
  ).toBeVisible();
  // It appears in the organization's and the project's navigation.
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(
    nav.getByRole("link", { name: "Payments handbook" }).first(),
  ).toBeVisible();

  for (const title of ["Runbooks", "Refunds", "Disputes"]) {
    await newPage(page, title);
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Payments handbook" })
      .click();
    await expect(treeItem(page, title)).toBeVisible();
  }

  // Drag Refunds into Runbooks.
  await treeItem(page, "Refunds").dragTo(treeItem(page, "Runbooks"));
  await expect(treeItem(page, "Runbooks")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(treeItem(page, "Refunds")).toHaveAttribute("aria-level", "2");

  // Move Disputes under Runbooks with the keyboard only.
  await treeItem(page, "Disputes").focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Actions for Disputes" });
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Move…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const move = page.getByRole("dialog", { name: "Move “Disputes”" });
  await expect(move.getByLabel("Filter pages")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(move.getByRole("radio", { name: /Top level/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(move.getByRole("radio", { name: "Runbooks" })).toBeChecked();
  await move.getByRole("button", { name: "Move page" }).focus();
  await page.keyboard.press("Enter");
  await expect(move).toBeHidden();
  await expect(treeItem(page, "Disputes")).toHaveAttribute("aria-level", "2");
  // Arrow keys walk the tree.
  await treeItem(page, "Runbooks").focus();
  await page.keyboard.press("ArrowDown");
  await expect(treeItem(page, "Refunds")).toBeFocused();
  await expectNoAccessibilityViolations(page, "space home with a page tree");

  // Archive from the tree, then undo.
  await treeItem(page, "Disputes").focus();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menu", { name: "Actions for Disputes" })
    .getByRole("menuitem", { name: "Archive" })
    .click();
  await expect(treeItem(page, "Disputes")).toBeHidden();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(treeItem(page, "Disputes")).toBeVisible();

  // Archive a page from its own view; it stays readable and restorable.
  await treeItem(page, "Refunds").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Refunds" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Runbooks" }),
  ).toBeVisible();
  await expect(page.getByText(/Published by Sasha Owner/)).toBeVisible();
  // The undone archive's notice has left (its closing animation is not
  // part of the page being checked).
  await expect(page.locator('[data-slot="toast-close"]')).toHaveCount(0);
  await expectNoAccessibilityViolations(page, "page view");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("This page is archived.")).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("This page is archived.")).toBeHidden();

  // The structure is durable.
  await page.reload();
  await expect(treeItem(page, "Refunds")).toHaveAttribute("aria-level", "2");
  await expect(treeItem(page, "Disputes")).toHaveAttribute("aria-level", "2");
  // Nothing stayed archived.
  await page.goto(spaceUrl);
  await treeItem(page, "Runbooks").focus();
  await page.keyboard.press("ArrowRight");
  await expect(treeItem(page, "Refunds")).toBeVisible();
  await expect(treeItem(page, "Disputes")).toBeVisible();
  const archivedToggle = page.getByRole("button", {
    name: /Show archived pages/,
  });
  await expect(archivedToggle).toHaveCount(0);
});

test("inherited access: project members edit, everyone else in the organization reads", async ({
  browser,
}) => {
  const reader = await newPerson(browser);
  await signIn(reader.page, user(viewer).email);
  await reader.page.goto(spaceUrl);
  await expect(
    reader.page.getByRole("heading", { level: 1, name: "Payments handbook" }),
  ).toBeVisible();
  await expect(
    reader.page.getByText("Can view", { exact: true }),
  ).toBeVisible();
  await expect(treeItem(reader.page, "Runbooks")).toBeVisible();
  await expect(
    reader.page.getByRole("main").getByRole("button", { name: "New page" }),
  ).toHaveCount(0);
  await treeItem(reader.page, "Runbooks").click();
  await expect(
    reader.page.getByRole("heading", { level: 1, name: "Runbooks" }),
  ).toBeVisible();
  await expect(reader.page.getByRole("button", { name: "Move…" })).toHaveCount(
    0,
  );
  await reader.context.close();

  const editor = await newPerson(browser);
  await signIn(editor.page, user(member).email);
  await editor.page.goto(spaceUrl);
  await expect(
    editor.page.getByText("Can edit", { exact: true }),
  ).toBeVisible();
  await newPage(editor.page, "Chargebacks");
  await expect(treeItem(editor.page, "Chargebacks")).toBeVisible();
  await editor.context.close();
});

test("a restricted space opens only for the people named in it", async ({
  page,
  browser,
}) => {
  await signIn(page, user(owner).email);
  await page.goto(`${spaceUrl}/settings`);
  await page.getByRole("radio", { name: /^Restricted/ }).click();
  const confirm = page.getByRole("dialog", {
    name: "Restrict Payments handbook?",
  });
  await confirm.getByRole("button", { name: "Restrict access" }).click();
  await expect(page.getByRole("radio", { name: /^Restricted/ })).toBeChecked();
  // Restricting gave the owner an edit grant, so they keep reading it.
  await expect(page.getByLabel("Access of Sasha Owner")).toBeVisible();

  await page.getByRole("button", { name: "Add people" }).click();
  await page.getByPlaceholder("Search people…").fill("Vera");
  await page.getByRole("option", { name: /Vera Viewer/ }).click();
  await expect(page.getByLabel("Access of Vera Viewer")).toContainText(
    "Can view",
  );

  const reader = await newPerson(browser);
  await signIn(reader.page, user(viewer).email);
  await reader.page.goto(spaceUrl);
  await expect(
    reader.page.getByRole("heading", { level: 1, name: "Payments handbook" }),
  ).toBeVisible();
  await expect(
    reader.page.getByText("Restricted", { exact: true }),
  ).toBeVisible();
  await reader.context.close();

  for (const index of [outsider, member]) {
    const other = await newPerson(browser);
    await signIn(other.page, user(index).email);
    await other.page.goto(spaceUrl);
    await expect(
      other.page.getByRole("heading", { name: "This space was not found" }),
    ).toBeVisible();
    await expect(
      other.page.getByRole("link", { name: "Payments handbook" }),
    ).toHaveCount(0);
    await other.context.close();
  }
});
