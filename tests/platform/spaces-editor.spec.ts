import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { fillMarkdown } from "../helpers/editor";
import { consentStatePath } from "../consent-setup";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import { clientAddress } from "../helpers/client-address";
import { seedItem, seedWorkspace, signIn, type Seeded } from "../helpers/seed";

// The page editor of Lictory Spaces from the browser: two editors write one
// live draft together (text, carets, "Saved"), mention a work item, add an
// image, publish, and a reader sees the published version without editing
// controls; comments anchored to draft text are seen, answered, resolved
// and reopened by the other editor; a Reviewed space starts a branch whose
// draft commits; going offline keeps the text and saves it afterwards;
// text typed into a draft replaced before it was saved is kept and can be
// inserted into the new draft.

test.describe.configure({ mode: "serial" });

let seeded: Seeded;
let pageUrl: string;
let operationsSpaceId: string;
let reviewedUrl: string;
const [owner, editor, viewer] = [0, 1, 2] as const;
const user = (index: number) => seeded.users[index]!;

// Wide enough for the comments column beside the page.
const wide = { width: 1680, height: 1000 };

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

const liveEditor = (page: Page) =>
  page.locator('.page-document[contenteditable="true"]');
const saved = (page: Page) =>
  page.getByTestId("draft-save-state").filter({ hasText: /^Saved$/ });

async function openEditor(page: Page, url = pageUrl) {
  await page.goto(url);
  await page
    .getByRole("button", { name: /^(Edit|Edit unpublished draft)$/ })
    .click();
  await expect(liveEditor(page)).toBeVisible();
  await expect(saved(page)).toBeVisible({ timeout: 20_000 });
}

// Waits until `viewer` shows `name`'s caret at the very end of the page,
// which is what the other person sees once the editor has taken the caret
// there. The browser reports a click or Ctrl+End to the editor a moment
// later (a selectionchange event); a key pressed within those few
// milliseconds, which only automation does, would still act at the
// editor's previous caret.
async function expectCaretAtEnd(viewer: Page, name: string) {
  await expect
    .poll(() =>
      viewer.evaluate((name) => {
        const block =
          document.querySelector(".page-document")?.lastElementChild;
        const caret = [
          ...(block?.querySelectorAll(".collaboration-carets__caret") ?? []),
        ].find((c) => c.textContent === name);
        if (!block || !caret) return false;
        const after = document.createRange();
        after.setStartAfter(caret);
        after.setEnd(block, block.childNodes.length);
        return after.toString() === "";
      }, name),
    )
    .toBe(true);
}

// Selects the first occurrence of `text` inside the page content.
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

// File storage is not configured in the browser suite: the upload's
// storage leg (presigned URL, object PUT, download redirect) is answered
// here so the editor's insertion is what is tested.
async function fakeFileStorage(page: Page) {
  const fileId = "e2e-diagram-1";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/session", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, attachments: true } });
  });
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "start")
      return route.fulfill({
        json: {
          id: "00000000-0000-4000-8000-00000000e2e1",
          uploadUrl: "https://storage.e2e.invalid/upload",
          headers: {},
        },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("https://storage.e2e.invalid/upload", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route(
    `**/api/files/00000000-0000-4000-8000-00000000e2e1`,
    (route) => route.fulfill({ contentType: "image/png", body: png }),
  );
  return { fileId, png };
}

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Harbor",
    key: "HB",
    users: ["Ada Owner", "Ben Editor", "Cleo Viewer"],
  });
  // Ada and Ben work in the project that homes the space; Cleo only reads.
  await seeded.command({
    type: "setProjectMember",
    projectId: seeded.projectId,
    userId: user(editor).id,
    role: "member",
  });
  await seedItem(seeded, { title: "Refund window policy" });
  const spaceId = crypto.randomUUID();
  operationsSpaceId = spaceId;
  await seeded.command({
    type: "createSpace",
    spaceId,
    name: "Operations",
    slug: "operations",
    home: { projectId: seeded.projectId },
  });
  const pageId = crypto.randomUUID();
  await seeded.command({
    type: "createPage",
    spaceId,
    pageId,
    title: "Refunds",
  });
  pageUrl = `/${seeded.slug}/spaces/operations/pages/${pageId}`;
  const reviewedId = crypto.randomUUID();
  await seeded.command({
    type: "createSpace",
    spaceId: reviewedId,
    name: "Policies",
    slug: "policies",
    home: { projectId: seeded.projectId },
    publishing: "reviewed",
  });
  const reviewedPage = crypto.randomUUID();
  await seeded.command({
    type: "createPage",
    spaceId: reviewedId,
    pageId: reviewedPage,
    title: "Chargebacks",
  });
  reviewedUrl = `/${seeded.slug}/spaces/policies/pages/${reviewedPage}`;
});

test("two editors write one live draft, publish it, and a reader sees the published page", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  await fakeFileStorage(ada.page);
  const ben = await person(browser, editor);
  await openEditor(ada.page);
  await openEditor(ben.page);

  // Every keystroke is saved within milliseconds; the save state must not
  // flash "Saving…" and "Saved" with each one.
  await ada.page.evaluate(() => {
    const shown: string[] = [];
    (window as unknown as { saveStates: string[] }).saveStates = shown;
    const read = () =>
      document.querySelector('[data-testid="draft-save-state"]')?.textContent;
    new MutationObserver(() => {
      const text = read();
      if (text && text !== shown.at(-1)) shown.push(text);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await liveEditor(ada.page).click();
  await ada.page.keyboard.type("Refunds are processed within five days.", {
    delay: 40,
  });
  await expect(liveEditor(ben.page)).toContainText(
    "Refunds are processed within five days.",
  );
  await expect(saved(ada.page)).toBeVisible();
  const saveStates = await ada.page.evaluate(
    () => (window as unknown as { saveStates: string[] }).saveStates,
  );
  // "Saving…" once, "Saved" once typing stopped. A loaded machine that
  // pauses typing for over a second shows "Saved" in the pause, which is
  // right, so a few pairs are allowed; 39 keystrokes used to make 78 changes.
  expect(saveStates.length, saveStates.join(" → ")).toBeLessThanOrEqual(12);
  expect(saveStates.at(-1)).toBe("Saved");
  await liveEditor(ben.page).click();
  await ben.page.keyboard.press("ControlOrMeta+End");
  await expectCaretAtEnd(ada.page, "Ben Editor");
  await ben.page.keyboard.press("Enter");
  await ben.page.keyboard.type("Escalate disputes to finance.");
  await expect(liveEditor(ada.page)).toContainText(
    "Escalate disputes to finance.",
  );
  // Each sees the other's caret, named.
  await expect(
    ada.page.locator(".collaboration-carets__label", { hasText: "Ben Editor" }),
  ).toBeVisible();
  await expect(
    ben.page.locator(".collaboration-carets__label", { hasText: "Ada Owner" }),
  ).toBeVisible();
  await expect(ada.page.getByText("Ben Editor is editing")).toBeVisible();
  await expect(saved(ada.page)).toBeVisible();
  await expect(saved(ben.page)).toBeVisible();
  await expect(ada.page.getByText("Unpublished changes")).toBeVisible();

  // A work item mention picked with "#".
  await liveEditor(ada.page).click();
  await ada.page.keyboard.press("ControlOrMeta+End");
  await expectCaretAtEnd(ben.page, "Ada Owner");
  await ada.page.keyboard.press("Enter");
  await ada.page.keyboard.type("Policy: #HB-1");
  const listbox = ada.page.getByRole("listbox", { name: "Work items" });
  await expect(
    listbox.getByRole("option", { name: /Refund window policy/ }),
  ).toBeVisible();
  await ada.page.keyboard.press("Enter");
  const chip = liveEditor(ada.page).locator('[data-type="workItemRef"]');
  await expect(chip).toContainText("HB-1");
  await expect(chip).toContainText("Refund window policy");
  await expect(
    liveEditor(ben.page).locator('[data-type="workItemRef"]'),
  ).toContainText("HB-1");

  // An image becomes a page file and an image block.
  await ada.page.locator('input[type="file"][id$="-images"]').setInputFiles({
    name: "diagram.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    liveEditor(ada.page).locator(
      'img[src="/api/files/00000000-0000-4000-8000-00000000e2e1"]',
    ),
  ).toHaveAttribute("alt", "diagram.png");
  await expect(saved(ada.page)).toBeVisible();
  await expectNoAccessibilityViolations(ada.page, "live page editor");

  // Publish what is saved.
  await ada.page.getByRole("button", { name: "Publish", exact: true }).click();
  const publish = ada.page.getByRole("dialog", { name: "Publish this page" });
  await publish.getByLabel(/Message/).fill("First version of the refund page");
  await publish.getByRole("button", { name: "Publish now" }).click();
  await expect(ada.page.getByText("Published version 2")).toBeVisible();
  await expect(ada.page.getByText("No unpublished changes")).toBeVisible();

  // A reader gets the published page, read-only.
  const cleo = await person(browser, viewer);
  await cleo.page.goto(pageUrl);
  const content = cleo.page.getByRole("document", { name: /content/ });
  await expect(content).toContainText(
    "Refunds are processed within five days.",
  );
  await expect(content).toContainText("Escalate disputes to finance.");
  await expect(content.locator('[data-type="workItemRef"]')).toContainText(
    "HB-1",
  );
  await expect(content.locator("img")).toHaveAttribute("alt", "diagram.png");
  await expect(cleo.page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(
    cleo.page.getByRole("button", { name: /^(Edit|Publish)$/ }),
  ).toHaveCount(0);
  await expectNoAccessibilityViolations(cleo.page, "published page reader");

  await Promise.all([
    ada.context.close(),
    ben.context.close(),
    cleo.context.close(),
  ]);
});

test("comments on draft text are seen, answered, resolved and reopened", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  const ben = await person(browser, editor);
  await openEditor(ada.page);
  await openEditor(ben.page);

  await selectText(ada.page, "five days");
  await ada.page.getByRole("button", { name: "Comment", exact: true }).click();
  await fillMarkdown(
    ada.page,
    "Comment on the selected text",
    "Business days or calendar days?",
  );
  await ada.page
    .getByRole("complementary", { name: "Page comments" })
    .getByRole("button", { name: "Comment", exact: true })
    .click();

  // Ben sees the highlight and the thread beside the page.
  const highlight = liveEditor(ben.page).locator(".page-comment");
  await expect(highlight).toHaveText("five days");
  const comments = ben.page.getByRole("complementary", {
    name: "Page comments",
  });
  const thread = comments.getByRole("article", {
    name: /Comment by Ada Owner/,
  });
  await expect(thread).toContainText("Business days or calendar days?");
  await expect(thread).toContainText("five days");
  await expectNoAccessibilityViolations(ben.page, "live editor with comments");

  await thread.getByRole("button", { name: "Reply" }).click();
  await fillMarkdown(thread, "Reply to Ada Owner", "Business days.");
  await thread
    .getByRole("button", { name: "Reply", exact: true })
    .last()
    .click();
  const adaThread = ada.page
    .getByRole("complementary", { name: "Page comments" })
    .getByRole("article", { name: /Comment by Ada Owner/ });
  await expect(adaThread).toContainText("Business days.");

  await adaThread.getByRole("button", { name: "Resolve" }).click();
  await expect(highlight).toHaveCount(0);
  await expect(
    comments.getByRole("button", { name: "Show 1 resolved" }),
  ).toBeVisible();
  await comments.getByRole("button", { name: "Show 1 resolved" }).click();
  await thread.getByRole("button", { name: "Reopen" }).click();
  await expect(highlight).toHaveText("five days");
  await expect(
    adaThread.getByRole("button", { name: "Resolve" }),
  ).toBeVisible();

  // On the published page a comment anchors to the commit's block; the
  // live draft, which keeps block ids, highlights the same words.
  await ben.page.getByRole("button", { name: "Close editor" }).click();
  const published = ben.page.getByRole("document", { name: /content/ });
  await expect(published).toContainText("Escalate disputes to finance.");
  await selectText(ben.page, "finance");
  await ben.page.getByRole("button", { name: "Comment", exact: true }).click();
  await fillMarkdown(
    ben.page,
    "Comment on the selected text",
    "Which finance team?",
  );
  await comments.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(published.locator(".page-comment")).toHaveText("finance");
  await expect(
    liveEditor(ada.page).locator(".page-comment", { hasText: "finance" }),
  ).toBeVisible();

  await Promise.all([ada.context.close(), ben.context.close()]);
});

test("offline edits stay on the page and are saved after reconnecting", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  const ben = await person(browser, editor);
  await openEditor(ada.page);
  await openEditor(ben.page);
  await ada.context.setOffline(true);
  await expect(
    ada.page.getByTestId("draft-save-state").filter({ hasText: /^Offline/ }),
  ).toBeVisible();
  await liveEditor(ada.page).click();
  await ada.page.keyboard.press("ControlOrMeta+End");
  await ada.page.keyboard.press("Enter");
  await ada.page.keyboard.type("Written while offline.");
  await expect(liveEditor(ada.page)).toContainText("Written while offline.");
  await ada.context.setOffline(false);
  await expect(saved(ada.page)).toBeVisible({ timeout: 30_000 });
  await expect(liveEditor(ben.page)).toContainText("Written while offline.");
  // Durable: a reload of the draft has it.
  await ben.page.reload();
  await ben.page
    .getByRole("button", { name: "Edit unpublished draft" })
    .click();
  await expect(liveEditor(ben.page)).toContainText("Written while offline.");
  await Promise.all([ada.context.close(), ben.context.close()]);
});

test("text typed into a draft that is replaced before it was saved is kept and can be inserted again", async ({
  browser,
}) => {
  // A page of its own, so a merge into main replaces its draft's epoch.
  const created = await seeded.command({
    type: "createPage",
    spaceId: operationsSpaceId,
    pageId: crypto.randomUUID(),
    title: "Escalations",
  });
  const { pageId, commitId } = created.summary as {
    pageId: string;
    commitId: string;
  };
  const url = pageUrl.replace(/pages\/[^/]+$/, `pages/${pageId}`);
  const ada = await person(browser, owner);
  await openEditor(ada.page, url);
  await ada.context.setOffline(true);
  await expect(
    ada.page.getByTestId("draft-save-state").filter({ hasText: /^Offline/ }),
  ).toBeVisible();
  await liveEditor(ada.page).click();
  await ada.page.keyboard.type("Page the on-call engineer after ten minutes.");
  // Meanwhile a proposal is merged into main: a new epoch of main's draft.
  const proposal = (
    await seeded.command({
      type: "proposePageChange",
      pageId,
      branchId: crypto.randomUUID(),
      pullRequestId: crypto.randomUUID(),
      title: "Escalations",
      markdown: "Escalate to the incident lead.",
      message: "Name the incident lead",
    })
  ).summary as { pullRequestId: string; commitId: string };
  await seeded.command({
    type: "mergePagePullRequest",
    pullRequestId: proposal.pullRequestId,
    inspectedSourceHead: proposal.commitId,
    inspectedTargetHead: commitId,
  });
  await ada.context.setOffline(false);

  const notice = ada.page.getByRole("status", {
    name: "Unsaved text kept on this device",
  });
  await expect(notice).toContainText(
    "This page was replaced while you had unsaved changes. Your text is kept on this device.",
    { timeout: 30_000 },
  );
  await expect(notice).toContainText(
    "Page the on-call engineer after ten minutes.",
  );
  // The new draft has the merged content, not the unsaved text…
  await expect(liveEditor(ada.page)).toContainText(
    "Escalate to the incident lead.",
  );
  await expect(liveEditor(ada.page)).not.toContainText("on-call engineer");
  // …until Ada asks for it back.
  await notice.getByRole("button", { name: "Insert at end" }).click();
  await expect(notice).toBeHidden();
  await expect(liveEditor(ada.page)).toContainText(
    "Page the on-call engineer after ten minutes.",
  );
  await expect(saved(ada.page)).toBeVisible({ timeout: 20_000 });
  // Stored like any edit: a reload of the draft has both.
  await ada.page.reload();
  await ada.page
    .getByRole("button", { name: "Edit unpublished draft" })
    .click();
  await expect(liveEditor(ada.page)).toContainText(
    "Page the on-call engineer after ten minutes.",
  );
  await expect(liveEditor(ada.page)).toContainText(
    "Escalate to the incident lead.",
  );
  await ada.context.close();
});

test("a change the service refuses shows Save failed, keeps the text and offers it back after reopening", async ({
  browser,
}) => {
  const created = await seeded.command({
    type: "createPage",
    spaceId: operationsSpaceId,
    pageId: crypto.randomUUID(),
    title: "Refund appendix",
  });
  const { pageId } = created.summary as { pageId: string };
  const url = pageUrl.replace(/pages\/[^/]+$/, `pages/${pageId}`);
  const ada = await person(browser, owner);
  const ben = await person(browser, editor);
  await openEditor(ada.page, url);
  await openEditor(ben.page, url);
  await liveEditor(ada.page).click();
  await ada.page.keyboard.type("Refunds take five days.");
  await expect(saved(ada.page)).toBeVisible();

  // One paste larger than the service stores at once (512 KiB per change).
  await ada.page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      ` Imported appendix: ${"settlement ".repeat(60_000)}`,
    );
    document
      .querySelector('.page-document[contenteditable="true"]')!
      .dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  const state = ada.page.getByTestId("draft-save-state");
  await expect(state).toHaveText("Save failed", { timeout: 20_000 });
  const failed = ada.page.getByTestId("draft-save-failed");
  await expect(failed).toContainText("Your latest edits were not saved.");
  await expect(failed).toContainText(
    "This change is too large to save at once.",
  );
  // Announced once to assistive technology, with the reason.
  await expect(
    ada.page.getByRole("status").filter({ hasText: /^Save failed\./ }),
  ).toHaveText(
    "Save failed. This change is too large to save at once. Your unsaved text is kept in this tab; reopen the editor to keep working.",
  );
  // The text stays in the tab, and typing on does not pretend to save.
  await ada.page.keyboard.type(" Typed after the refusal.");
  await expect(liveEditor(ada.page)).toContainText("Typed after the refusal.");
  await ada.page.waitForTimeout(1500);
  await expect(state).toHaveText("Save failed");
  // Nobody else saw the refused text; what was stored before is intact.
  await expect(liveEditor(ben.page)).toContainText("Refunds take five days.");
  await expect(liveEditor(ben.page)).not.toContainText("Imported appendix");
  await expectNoAccessibilityViolations(ada.page, "live editor, save failed");

  await failed.getByRole("button", { name: "Reopen editor" }).click();
  const notice = ada.page.getByRole("status", {
    name: "Unsaved text kept on this device",
  });
  await expect(notice).toContainText(
    "The editor closed before some of your changes were saved. Your text is kept on this device.",
  );
  await expect(notice).toContainText("Typed after the refusal.");
  // Inserting it as one change would be refused again.
  await expect(notice).toContainText(
    "It is too large to insert at once. Copy it and paste it in smaller parts.",
  );
  await expect(
    notice.getByRole("button", { name: "Insert at end" }),
  ).toHaveCount(0);
  await expect(notice.getByRole("button", { name: "Copy text" })).toBeVisible();
  // The reopened editor starts from what is stored, takes the keyboard
  // focus back, and saves again.
  await expect(liveEditor(ada.page)).toContainText("Refunds take five days.");
  await expect(liveEditor(ada.page)).not.toContainText("Imported appendix");
  await expect(failed).toBeHidden();
  await expect(liveEditor(ada.page)).toBeFocused();
  await ada.page.keyboard.press("ControlOrMeta+End");
  await ada.page.keyboard.type(" Partial refunds too.");
  await expect(saved(ada.page)).toBeVisible({ timeout: 20_000 });
  await expect(liveEditor(ben.page)).toContainText("Partial refunds too.");
  await Promise.all([ada.context.close(), ben.context.close()]);
});

test("a Reviewed space protects main: a branch is started and its draft commits", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  await ada.page.goto(reviewedUrl);
  await expect(
    ada.page.getByText(
      "Changes to this page are reviewed. Start a branch to propose changes.",
    ),
  ).toBeVisible();
  await expect(ada.page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await ada.page.getByRole("button", { name: "Start a branch" }).click();
  const start = ada.page.getByRole("dialog", { name: "Start a branch" });
  await expect(start.getByLabel("Branch name")).not.toHaveValue("");
  await start.getByRole("button", { name: "Start branch" }).click();
  await expect(ada.page).toHaveURL(/[?&]branch=/);
  await expect(liveEditor(ada.page)).toBeVisible();
  await expect(saved(ada.page)).toBeVisible({ timeout: 20_000 });
  await liveEditor(ada.page).click();
  await ada.page.keyboard.type("Chargebacks are answered within ten days.");
  await expect(saved(ada.page)).toBeVisible();
  await expect(
    ada.page.getByText("Uncommitted changes", { exact: true }),
  ).toBeVisible();
  await ada.page.getByRole("button", { name: "Commit", exact: true }).click();
  await ada.page
    .getByRole("dialog", { name: "Commit to this branch" })
    .getByRole("button", { name: "Commit now" })
    .click();
  await expect(ada.page.getByText("Committed version 2")).toBeVisible();
  await expect(ada.page.getByText("All changes committed")).toBeVisible();
  await ada.context.close();
});

test("at phone width the editor fits and comments open as a sheet", async ({
  browser,
}) => {
  const ada = await person(browser, owner, { width: 390, height: 844 });
  await openEditor(ada.page);
  await expect(
    ada.page.getByRole("toolbar", { name: "Formatting" }),
  ).toBeVisible();
  const overflow = await ada.page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await ada.page.getByRole("button", { name: /^Comments:/ }).click();
  const sheet = ada.page.getByRole("dialog", { name: "Comments" });
  await expect(sheet.getByRole("heading", { name: "Comments" })).toBeVisible();
  await expectNoAccessibilityViolations(
    ada.page,
    "comments sheet at phone width",
  );
  await ada.page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await ada.context.close();
});

test("the link form refuses an address the page cannot keep and explains why", async ({
  browser,
}) => {
  const ada = await person(browser, owner);
  await openEditor(ada.page);
  await liveEditor(ada.page).click();
  await ada.page.keyboard.press("End");
  await ada.page.keyboard.press("Enter");
  await ada.page.keyboard.type("Refund status page");
  await selectText(ada.page, "Refund status page");
  await ada.page
    .getByRole("toolbar", { name: "Formatting" })
    .getByRole("button", { name: "Link", exact: true })
    .click();
  const address = ada.page.getByLabel("Link address");
  await address.fill("ftp://status.example.com");
  await address.press("Enter");
  await expect(ada.page.getByRole("alert")).toContainText(
    "Use a web or mail address",
  );
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await address.fill("status.example.com");
  await address.press("Enter");
  await expect(address).toBeHidden();
  await expect(
    liveEditor(ada.page).locator('a[href="https://status.example.com"]'),
  ).toHaveText("Refund status page");
  await expect(saved(ada.page)).toBeVisible();
  await ada.context.close();
});
