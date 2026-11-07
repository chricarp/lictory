import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { consentStatePath } from "../consent-setup";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import { clientAddress } from "../helpers/client-address";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";

// Work in Lictory Spaces pages: selected page text and open tasks become
// work items that remember their source and can be mentioned back in the
// page's draft; the page lists the work it knows about; decision cards and
// live work lists render what Work holds now; templates start new pages;
// what a person cannot see stays out of every count.

test.describe.configure({ mode: "serial" });

let seeded: Seeded;
let pageUrl: string;
let pageId: string;
let secretUrl: string;
let epicId: string;
let childIds: string[];
let decisionId: string;
const [owner, , outsider] = [0, 1, 2] as const;
const user = (index: number) => seeded.users[index]!;
const wide = { width: 1440, height: 1000 };

async function person(
  browser: Browser,
  index: number,
  viewport = wide,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: consentStatePath,
    extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
    viewport,
  });
  const page = await context.newPage();
  await signIn(page, user(index).email);
  return { context, page };
}

const reader = (page: Page) => page.getByRole("document", { name: /content/ });
const liveEditor = (page: Page) =>
  page.locator('.page-document[contenteditable="true"]');
const saved = (page: Page) =>
  page.getByTestId("draft-save-state").filter({ hasText: /^Saved$/ });

async function selectText(page: Page, text: string) {
  await page.evaluate((wanted) => {
    const root = document.querySelector(".page-document");
    if (!root) throw new Error("No page content");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${wanted}" is not in the page`);
  }, text);
}

const itemByTitle = (title: string) =>
  withDb(async (db) => {
    const [row] = await db
      .select({ id: s.workItem.id, number: s.workItem.number })
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, seeded.organizationId),
          eq(s.workItem.title, title),
        ),
      );
    return row!;
  });

const paragraph = (id: string, ...content: object[]) => ({
  type: "paragraph",
  attrs: { id },
  content,
});
const text = (value: string) => ({ type: "text", text: value });

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Harbor",
    key: "HW",
    users: ["Ada Owner", "Ben Member", "Cleo Outsider"],
  });
  epicId = await seedItem(seeded, { type: "Epic", title: "Refunds" });
  childIds = [];
  for (const title of ["Partial refunds", "Refund window"]) {
    const id = crypto.randomUUID();
    await seeded.command({
      type: "createWorkItem",
      projectId: seeded.projectId,
      workItemId: id,
      typeId: seeded.typeId("Task"),
      parentId: epicId,
      title,
    });
    childIds.push(id);
  }
  const mentioned = await seedItem(seeded, { title: "Retry captures" });
  const withdrawn = await seedItem(seeded, { title: "Withdrawn idea" });
  await seeded.command({
    type: "archiveWorkItem",
    workItemId: withdrawn,
    archived: true,
  });
  decisionId = crypto.randomUUID();
  await seeded.command({
    type: "recordDecision",
    workItemId: epicId,
    baseRevisionId: (await currentRevision(epicId)).id,
    decisionId,
    title: "Refunds reuse the original payment",
    body: "A refund never creates a new charge.",
  });

  const spaceId = crypto.randomUUID();
  await seeded.command({
    type: "createSpace",
    spaceId,
    name: "Operations",
    slug: "operations",
    home: { projectId: seeded.projectId },
  });
  pageId = crypto.randomUUID();
  await seeded.command({
    type: "createPage",
    spaceId,
    pageId,
    title: "Refund runbook",
    content: {
      type: "doc",
      content: [
        paragraph(
          "rule",
          text("Refunds above 500 EUR need a second approver from finance."),
        ),
        paragraph(
          "mentions",
          text("Retries: "),
          {
            type: "workItemRef",
            attrs: { workItemId: mentioned, key: "HW-4" },
          },
          text(", withdrawn: "),
          {
            type: "workItemRef",
            attrs: { workItemId: withdrawn, key: "HW-5" },
          },
        ),
        {
          type: "taskList",
          attrs: { id: "checklist" },
          content: [
            {
              type: "taskItem",
              attrs: { id: "task", checked: false },
              content: [
                paragraph("task-text", text("Write the chargeback checklist")),
              ],
            },
          ],
        },
        paragraph("decision", {
          type: "decisionRef",
          attrs: { decisionId, label: "Refunds reuse the original payment" },
        }),
        {
          type: "workList",
          attrs: {
            id: "children",
            projectId: seeded.projectId,
            filter: "epic-children",
            filterId: epicId,
          },
        },
        {
          type: "workList",
          attrs: { id: "referenced", filter: "referenced" },
        },
      ],
    } as unknown as Record<string, never>,
  });
  pageUrl = `/${seeded.slug}/spaces/operations/pages/${pageId}`;

  // A restricted space only Ada reads, whose page mentions the epic.
  const secretSpace = crypto.randomUUID();
  await seeded.command({
    type: "createSpace",
    spaceId: secretSpace,
    name: "Security",
    slug: "security",
    home: { projectId: seeded.projectId },
    accessMode: "restricted",
  });
  const secretPage = crypto.randomUUID();
  await seeded.command({
    type: "createPage",
    spaceId: secretSpace,
    pageId: secretPage,
    title: "Key rotation",
    content: {
      type: "doc",
      content: [
        paragraph("secret", text("Rotate keys before "), {
          type: "workItemRef",
          attrs: { workItemId: epicId, key: "HW-1" },
        }),
      ],
    } as unknown as Record<string, never>,
  });
  secretUrl = `/${seeded.slug}/spaces/security/pages/${secretPage}`;
});

test("selected page text becomes a work item that remembers its source and is listed on the page", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  await ada.page.goto(pageUrl);
  await expect(reader(ada.page)).toContainText("second approver");

  await selectText(ada.page, "need a second approver from finance");
  const toolbar = ada.page.getByRole("group", { name: "Selected text" });
  await expect(toolbar.getByRole("button", { name: "Comment" })).toBeVisible();
  await toolbar.getByRole("button", { name: "Create work item" }).click();

  const dialog = ada.page.getByRole("dialog", { name: "Create work item" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "need a second approver from finance",
  );
  await dialog
    .getByRole("textbox", { name: "Title" })
    .fill("Second approver for large refunds");
  // The quote leaves the page: the dialog says where it goes.
  await expect(dialog).toContainText(
    "The quoted text is copied into HW, where everyone in Harbor can read it.",
  );
  // The description quotes the text and cites this exact page version.
  const description = dialog.getByRole("textbox", { name: "Description" });
  await expect(description).toContainText(
    "need a second approver from finance",
  );
  await expect(description).toContainText("Refund runbook");
  await expectNoAccessibilityViolations(ada.page, "create work from a page");
  await dialog.getByRole("button", { name: "Create work item" }).click();

  const done = ada.page.getByRole("dialog", { name: /created$/ });
  await expect(done.getByTestId("created-from-page")).toContainText(
    "Second approver for large refunds",
  );
  await done.getByRole("button", { name: "Done" }).click();

  // The item records its exact source; the page lists it.
  const created = await itemByTitle("Second approver for large refunds");
  const knowledge = await ada.page.evaluate(
    async ([organizationId, workItemId]) =>
      (await (
        await fetch("/api/capabilities/getWorkItemKnowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId, workItemId }),
        })
      ).json()) as {
        source: { pageId: string; blockId: string; quote: string } | null;
      },
    [seeded.organizationId, created.id],
  );
  expect(knowledge.source).toMatchObject({
    pageId,
    blockId: "rule",
    quote: "need a second approver from finance",
  });
  const panel = ada.page.getByTestId("page-work");
  const row = panel.locator(`[data-work-row="HW-${created.number}"]`);
  await expect(row).toContainText("Second approver for large refunds");
  await expect(row).toContainText("Created from this page");
  // Mentioned items are listed; archived ones are left out, uncounted.
  await expect(panel.locator('[data-work-row="HW-4"]')).toContainText(
    "Mentioned",
  );
  await expect(panel).not.toContainText("Withdrawn idea");
  await expect(panel.getByTestId("page-work-rollup")).toHaveText("0 of 2 done");
  await ada.context.close();
});

test("an open task becomes a work item and is mentioned after the task in the draft", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  await ada.page.goto(pageUrl);
  const task = reader(ada.page).locator("li", {
    hasText: "Write the chargeback checklist",
  });
  await task.hover();
  await task
    .getByRole("button", {
      name: "Create a work item from the task “Write the chargeback checklist”",
    })
    .click();
  const dialog = ada.page.getByRole("dialog", { name: "Create work item" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Write the chargeback checklist",
  );
  // Tasks default to plain delivery work.
  await expect(dialog.getByRole("combobox", { name: "Type" })).toContainText(
    "Task",
  );
  await dialog.getByRole("button", { name: "Create work item" }).click();
  const done = ada.page.getByRole("dialog", { name: /created$/ });
  await done.getByRole("button", { name: "Add to the page" }).click();

  // The editor opens with the new item mentioned right after the task:
  // an ordinary draft edit, published only when Ada publishes.
  const created = await itemByTitle("Write the chargeback checklist");
  const editor = liveEditor(ada.page);
  await expect(
    editor
      .locator("li", { hasText: "Write the chargeback checklist" })
      .locator('[data-type="workItemRef"]'),
  ).toContainText(`HW-${created.number}`);
  await expect(saved(ada.page)).toBeVisible({ timeout: 20_000 });
  await expect(ada.page.getByText("Unpublished changes")).toBeVisible();
  await ada.context.close();
});

test("decision cards and live work lists render what Work holds now", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  await ada.page.goto(pageUrl);
  const card = reader(ada.page).locator(".decision-card");
  await expect(card).toContainText("Refunds reuse the original payment");
  await expect(card).toContainText("A refund never creates a new charge.");
  await expect(card).toContainText("HW-1");
  await expect(card).toContainText("Recorded on revision 1");
  await expect(card).not.toContainText("Archived");
  // Withdrawn elsewhere (another tab, another person): the open page shows
  // it as soon as the window is focused again, without a reload, and
  // follows the restore too.
  const archive = (archived: boolean) =>
    seeded.command({
      type: "setDecisionArchived",
      workItemId: epicId,
      decisionId,
      archived,
    });
  // Focus is read again once what is shown is a few seconds old.
  const refocus = async (event: "focus" | "visibilitychange") =>
    ada.page.evaluate((name) => {
      const target = name === "focus" ? window : document;
      target.dispatchEvent(new Event(name));
    }, event);
  await archive(true);
  await expect(async () => {
    await refocus("focus");
    await expect(card.locator(".decision-card-archived")).toHaveText(
      "Archived",
      { timeout: 1000 },
    );
  }).toPass({ timeout: 20_000 });
  await expect(card).toContainText("withdrawn from active product knowledge");
  await archive(false);
  await expect(async () => {
    await refocus("visibilitychange");
    await expect(card.locator(".decision-card-archived")).toHaveCount(0, {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  // Archived again while the page cannot reach the server: the card keeps
  // the decision it read but says it could not check it, instead of
  // presenting it as current; Retry shows the archive once it can.
  const offline = "**/api/capabilities/getDecisions";
  await ada.page.route(offline, (route) => route.abort());
  await archive(true);
  await expect(async () => {
    await refocus("focus");
    await expect(card).toContainText("Couldn’t refresh", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  // When it was last checked is text, not only a hover title.
  await expect(card).toContainText(/Couldn’t refresh · last checked \S/);
  await expect(card).toContainText("Refunds reuse the original payment");
  await expect(card.locator(".decision-card-archived")).toHaveCount(0);
  await ada.page.unroute(offline);
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(card.locator(".decision-card-archived")).toHaveText("Archived");
  await expect(card).not.toContainText("Couldn’t refresh");
  await archive(false);
  await expect(async () => {
    await refocus("visibilitychange");
    await expect(card.locator(".decision-card-archived")).toHaveCount(0, {
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });

  const children = reader(ada.page)
    .getByTestId("work-list")
    .filter({ hasText: "Children of HW-1" });
  await expect(children.locator("[data-work-row]")).toHaveCount(2);
  await expect(children.getByTestId("work-list-count")).toHaveText(
    "0 of 2 done",
  );
  // Another person finishes a child: the page follows without a reload.
  const done = seeded.roster.statuses.find(
    (x) => x.projectId === seeded.projectId && x.category === "done",
  )!;
  await seeded.command({
    type: "updateWorkItem",
    workItemId: childIds[0]!,
    statusId: done.id,
  });
  await expect(children.getByTestId("work-list-count")).toHaveText(
    "1 of 2 done",
  );
  await expect(
    children.locator("[data-work-row]", { hasText: "Partial refunds" }),
  ).toContainText(done.name);
  // The page holds no item state: nothing in the list edits the item.
  await expect(children.getByRole("combobox")).toHaveCount(0);

  // "Work on this page" lists the mentioned item, not the archived one.
  const referenced = reader(ada.page)
    .getByTestId("work-list")
    .filter({ hasText: "Work referenced on this page" });
  await expect(referenced.locator("[data-work-row]")).toHaveCount(1);
  await expect(referenced).toContainText("Retry captures");
  await expect(referenced).not.toContainText("Withdrawn idea");
  await expectNoAccessibilityViolations(ada.page, "page with work blocks");
  await ada.context.close();
});

test("decisions and work lists are inserted from the / menu", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  await ada.page.goto(pageUrl);
  await ada.page
    .getByRole("button", { name: /^(Edit|Edit unpublished draft)$/ })
    .click();
  const editor = liveEditor(ada.page);
  await expect(saved(ada.page)).toBeVisible({ timeout: 20_000 });
  await editor.click();
  await ada.page.keyboard.press("ControlOrMeta+End");
  await ada.page.keyboard.press("Enter");
  await ada.page.keyboard.type("/decision");
  await ada.page.keyboard.press("Enter");
  // The shared decision picker; a decision alone on its line is a card.
  await ada.page
    .getByRole("combobox", { name: "Find a decision" })
    .fill("reuse");
  await ada.page
    .getByRole("listbox", { name: "Decisions" })
    .getByRole("option", { name: /Refunds reuse the original payment/ })
    .click();
  // Alone on its line: a card.
  await expect(editor.locator(".decision-card")).toHaveCount(2);

  await ada.page.keyboard.press("ControlOrMeta+End");
  await ada.page.keyboard.press("Enter");
  await ada.page.keyboard.type("/epic");
  await ada.page.keyboard.press("Enter");
  const config = ada.page.getByRole("dialog", { name: "Insert a work list" });
  await config.getByRole("radio", { name: /An epic’s work/ }).check();
  await config.getByRole("combobox", { name: "Epic" }).click();
  await ada.page.getByRole("option", { name: "HW-1 Refunds" }).click();
  await config.getByRole("textbox", { name: /Title/ }).fill("Refund delivery");
  await config.getByRole("button", { name: "Insert list" }).click();
  const list = editor
    .getByTestId("work-list")
    .filter({ hasText: "Refund delivery" });
  await expect(list.locator("[data-work-row]")).toHaveCount(2);
  await expect(saved(ada.page)).toBeVisible({ timeout: 20_000 });
  await ada.context.close();
});

test("a template starts a new page with its structure", async ({ browser }) => {
  const ada = await person(browser, owner);
  await ada.page.goto(`/${seeded.slug}/spaces/operations`);
  await ada.page.getByRole("button", { name: "New page" }).first().click();
  const dialog = ada.page.getByRole("dialog", { name: "New page" });
  await dialog
    .getByRole("textbox", { name: "Title" })
    .fill("Card dispute runbook");
  await dialog.getByRole("radio", { name: /Runbook/ }).check();
  await dialog.getByRole("button", { name: "Create page" }).click();
  await expect(
    ada.page.getByRole("heading", { level: 1, name: "Card dispute runbook" }),
  ).toBeVisible();
  const content = reader(ada.page);
  for (const heading of [
    "When to use this runbook",
    "Before you start",
    "Steps",
    "Verify",
    "Roll back",
    "Escalation",
  ])
    await expect(
      content.getByRole("heading", { level: 2, name: heading }),
    ).toBeVisible();
  await expect(content.locator('ul[data-type="taskList"] li')).toHaveCount(2);
  await ada.context.close();
});

test("work from a restricted page stays with its readers; phones fit", async ({
  browser,
}) => {
  const cleo = await person(browser, outsider, { width: 390, height: 844 });
  // Cleo cannot read the Security space: its page does not exist for her,
  // nor does anything it says about work.
  await cleo.page.goto(secretUrl);
  await expect(cleo.page.getByText(/was not found/)).toBeVisible();
  const refused = await cleo.page.evaluate(
    async ([organizationId, workItemId]) =>
      (await (
        await fetch("/api/capabilities/getWorkItemKnowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId, workItemId }),
        })
      ).json()) as { referencedIn: { pageId: string }[] },
    [seeded.organizationId, epicId],
  );
  expect(refused.referencedIn).toEqual([]);

  // The space home's linked work: what Operations pages mention, without
  // the epic the Security page mentions.
  await cleo.page.goto(`/${seeded.slug}/spaces/operations`);
  const linked = cleo.page.getByRole("region", { name: /Linked work/ });
  await expect(linked).toContainText("Retry captures");
  await expect(linked).not.toContainText("Refunds");
  await expect(linked).not.toContainText("Withdrawn idea");

  // Cleo reads the Operations page (inherited access) at phone width: the
  // work blocks and the panel fit without scrolling sideways, and she
  // cannot create work (no discipline), so the page offers none.
  await cleo.page.goto(pageUrl);
  await expect(reader(cleo.page).locator(".decision-card")).toBeVisible();
  await expect(cleo.page.getByTestId("page-work")).toBeVisible();
  await expect(
    cleo.page.getByRole("button", { name: /Create a work item from the task/ }),
  ).toBeHidden();
  expect(
    await cleo.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await cleo.context.close();
});
