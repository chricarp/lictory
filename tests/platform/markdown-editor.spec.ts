import { test, expect, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";
import { clientAddress } from "../helpers/client-address";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import { fillMarkdown, richEditor } from "../helpers/editor";
import { waitUntilSaved } from "../helpers/sync-helpers";

// Work's Markdown fields are the Spaces editor: formatting from the toolbar
// and Markdown shortcuts, references picked with "#" and "[[", and Markdown
// that only changes where someone edited it.

const specification =
  "# Behavior\n\nRetries reuse the original transaction ID.\n\n## Acceptance criteria\n\n- [ ] One charge per request";

let seeded: Seeded;
let retryItem: string;
let callbackItem: string;
let pageId: string;
let pageCommit: string;

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Quill",
    key: "QL",
    users: ["Quinn Author"],
    disciplines: { 0: "Product" },
  });
  retryItem = await seedItem(seeded, {
    title: "Retry ledger",
    description: specification,
  });
  callbackItem = await seedItem(seeded, { title: "Late callbacks" });
  const spaceId = crypto.randomUUID();
  await seeded.command({
    type: "createSpace",
    spaceId,
    name: "Handbook",
    slug: "handbook",
    home: { projectId: seeded.projectId },
  });
  pageId = crypto.randomUUID();
  await seeded.command({
    type: "createPage",
    spaceId,
    pageId,
    title: "Retry runbook",
  });
  // The published version: main's head.
  pageCommit = await withDb(async (db) => {
    const [main] = await db
      .select({ head: s.pageBranch.headCommitId })
      .from(s.pageBranch)
      .where(
        and(eq(s.pageBranch.pageId, pageId), eq(s.pageBranch.isMain, true)),
      );
    return main!.head;
  });
});

async function openSpecification(page: Page) {
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(1));
  await expect(
    page.getByRole("heading", { name: "Retry ledger" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  return richEditor(page, "Specification");
}

test("opening and saving a specification without edits creates no revision", async ({
  page,
}) => {
  const editor = await openSpecification(page);
  await expect(editor.getByRole("heading", { name: "Behavior" })).toBeVisible();
  await editor.press("ControlOrMeta+Enter");
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  // Whatever the save sent has reached the server.
  await waitUntilSaved(page);
  const latest = await currentRevision(retryItem);
  expect(latest.number).toBe(1);
  expect(latest.content).toBe(specification);
});

test("toolbar and Markdown shortcuts write a revision that changes only the edited text", async ({
  page,
}) => {
  const editor = await openSpecification(page);
  await expectNoAccessibilityViolations(page, "specification editor");
  // A new section from the toolbar's text styles, a list from "- ".
  await editor.getByText("One charge per request", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const toolbar = page.getByRole("toolbar", {
    name: "Specification formatting",
  });
  await toolbar.getByRole("button", { name: /^Text style/ }).click();
  await page.getByRole("menuitemradio", { name: /Heading 2/ }).click();
  await page.keyboard.type("Failure behavior");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Timeouts retry with the same key");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("Never");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" charge twice");
  await expect(
    editor.getByRole("heading", { name: "Failure behavior" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(page.getByText("Revision 2 ·").first()).toBeVisible();
  const latest = await currentRevision(retryItem);
  expect(latest.number).toBe(2);
  expect(latest.content).toBe(
    `${specification}\n\n## Failure behavior\n\n- Timeouts retry with the same key\n- **Never** charge twice`,
  );
});

test("“#” and “[[” insert references that read as live chips", async ({
  page,
}) => {
  const editor = await openSpecification(page);
  await editor
    .getByText("Retries reuse the original transaction ID.", { exact: true })
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type(" See #QL-2");
  const items = page.getByRole("listbox", { name: "Work items" });
  await expect(
    items.getByRole("option", { name: /Late callbacks/ }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor.locator('[data-type="workItemRef"]')).toContainText(
    "QL-2",
  );
  await page.keyboard.type("and [[Retry");
  const pages = page.getByRole("listbox", { name: "Pages" });
  await expect(
    pages.getByRole("option", { name: /Retry runbook/ }),
  ).toBeVisible();
  // Shift+Enter cites the version published now.
  await page.keyboard.press("Shift+Enter");
  await expect(editor.locator('[data-type="pageRef"]')).toContainText(
    "Retry runbook",
  );
  await page.getByRole("button", { name: /Save revision 3/ }).click();
  await expect(page.getByText("Revision 3 ·").first()).toBeVisible();
  const latest = await currentRevision(retryItem);
  expect(latest.content).toContain(
    `See [QL-2](item:${callbackItem}) and [Retry runbook](page:${pageId}@${pageCommit})\n`,
  );

  // The reader shows chips that lead to their targets.
  const reader = page.locator("[data-spec-root]");
  const item = reader.locator('[data-reference="item"]');
  await expect(item).toContainText("Late callbacks");
  await expect(item).toHaveAttribute("href", /\/items\/QL-2$/);
  const pinned = reader.locator('[data-reference="page"]');
  await expect(pinned).toContainText("Retry runbook");
  await expect(pinned).toHaveAttribute(
    "href",
    new RegExp(`/pages/${pageId}\\?commit=${pageCommit}$`),
  );
  // Focusing a chip describes it: type, status, refinement, readiness.
  await item.focus();
  const card = page.getByRole("tooltip");
  await expect(card).toContainText("Late callbacks");
  await expect(card).toContainText("Refinement");
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await pinned.focus();
  await expect(page.getByRole("tooltip")).toContainText("Handbook");
  await expectNoAccessibilityViolations(page, "specification with references");
  await pinned.click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}\\?commit=`));
});

test("discussions and new items write in the same editor", async ({ page }) => {
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.itemPath(2));
  await expect(
    page.getByRole("heading", { name: "Late callbacks" }),
  ).toBeVisible();
  const composer = await richEditor(page, "Start a discussion");
  await composer.click();
  await page.keyboard.type("Does this depend on #QL-1");
  await page.getByRole("listbox", { name: "Work items" }).waitFor();
  await page.keyboard.press("Enter");
  await page.keyboard.type("?");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const discussion = page.getByRole("article", { name: "discussion" });
  await expect(discussion.locator('[data-reference="item"]')).toContainText(
    "Retry ledger",
  );

  await page.keyboard.press("c");
  const create = page.getByRole("dialog", { name: /^Create/ });
  await create
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Callback dedupe");
  const description = await fillMarkdown(
    create,
    "Description",
    "## Behavior\n\n- Duplicate callbacks are ignored",
  );
  await expect(
    description.getByRole("heading", { name: "Behavior" }),
  ).toBeVisible();
  await expect(description.locator("li")).toHaveText(
    "Duplicate callbacks are ignored",
  );
});
