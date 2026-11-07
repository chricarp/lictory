import { test, expect, type Page } from "@playwright/test";
import { fillMarkdown } from "../helpers/editor";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  type Seeded,
} from "../helpers/seed";
import { clientAddress } from "../helpers/client-address";
import { discussionsToggle } from "../helpers/discussions";

// Reviewing a specification borrows the page's reading tools: discussions
// beside the text in document order with their passages marked, threads
// whose text changed pointing at the revision they were written on,
// word-level changes between revisions, and one history of versions.

let seeded: Seeded;
const title = "Retry card payments";
const first = `# Behavior

Retries reuse the original transaction ID.

Late answers are reconciled against the first attempt.

## Failure behavior

A timeout after 30 seconds is reported to the customer.

## Rollout

Enable for ten percent of merchants first.
`;

test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Spec review",
    key: "REV",
    users: ["Ada Product", "Ben Engineer"],
  });
});

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

async function seedSpec(text = first) {
  const workItemId = await seedItem(seeded, { title, description: text });
  return workItemId;
}

async function discuss(
  workItemId: string,
  thread: { section: string; quote?: string; body: string; blocking?: boolean },
) {
  const revision = await currentRevision(workItemId);
  const threadId = crypto.randomUUID();
  await seeded.command({
    type: "createThread",
    workItemId,
    baseRevisionId: revision.id,
    threadId,
    messageId: crypto.randomUUID(),
    body: thread.body,
    section: thread.section,
    quote: thread.quote,
    blocking: thread.blocking ?? false,
  });
  return threadId;
}

async function revise(workItemId: string, content: string, summary: string) {
  const revision = await currentRevision(workItemId);
  await seeded.command({
    type: "updateSpecification",
    workItemId,
    baseRevisionId: revision.id,
    title,
    content,
    summary,
  });
}

// The item's number in its project, from the seeded order.
let number = 0;
async function open(page: Page, text?: string) {
  const workItemId = await seedSpec(text);
  number += 1;
  return { workItemId, path: seeded.itemPath(number) };
}

// Selects `text` in the specification reader the way a mouse does.
async function selectInSpecification(page: Page, text: string) {
  await page.evaluate((wanted) => {
    const root = document.querySelector("[data-spec-root]")!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(wanted);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error(`"${wanted}" is not in the specification`);
  }, text);
}

const panelOf = (page: Page) =>
  page.getByRole("complementary", { name: "Discussions" });
const marked = (page: Page) =>
  page.locator("[data-spec-root] mark[data-threads]");

test("anchored discussions sit beside the text in document order, marked, and resolve and reopen without losing messages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { workItemId, path } = await open(page);
  // Written in the opposite order of the text, plus one on the whole text.
  await discuss(workItemId, {
    section: "Failure behavior",
    quote: "reported to the customer",
    body: "Through which channel?",
    blocking: true,
  });
  await discuss(workItemId, {
    section: "",
    body: "Who owns the rollout?",
  });
  await discuss(workItemId, {
    section: "Behavior",
    quote: "original transaction ID",
    body: "Also for partial captures?",
  });
  await signIn(page, seeded.owner.email);
  await page.goto(path);
  const toggle = discussionsToggle(page);
  await expect(toggle).toHaveAccessibleName(
    "3 discussions, 1 blocking readiness",
  );
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Passages are marked in the text even with the panel closed.
  await expect(marked(page)).toHaveText([
    "original transaction ID",
    "reported to the customer",
  ]);
  // Clicking a marked passage opens its discussion.
  await marked(page).first().click();
  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const cards = panel.getByRole("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Also for partial captures?");
  await expect(cards.nth(1)).toContainText("Through which channel?");
  await expect(cards.nth(1)).toHaveAccessibleName(
    "Blocking discussion by Ada Product",
  );
  await expect(cards.nth(2)).toContainText("Who owns the rollout?");
  await expect(panel.getByText("On the whole specification")).toBeVisible();
  await expect(
    panel.getByText("Blocking discussions hold readiness"),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page, "specification discussions", {
    include: "[data-discussions]",
  });
  await expectNoAccessibilityViolations(page, "marked specification", {
    include: "[data-spec-root]",
  });

  // Alt+Arrow keys move between threads.
  await cards.nth(0).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(cards.nth(1)).toBeFocused();

  // Reply, then resolve: the thread folds away and its passage is no
  // longer marked; reopening brings both back with every message.
  const thread = cards.nth(0);
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await fillMarkdown(page, "Reply", "Yes, partial captures too.");
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread).toContainText("Yes, partial captures too.");
  await thread.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(marked(page)).toHaveText(["reported to the customer"]);
  await panel.getByRole("button", { name: "Show 1 resolved" }).click();
  const resolved = panel.getByRole("article", { name: /Discussion by/ }).last();
  await expect(resolved).toContainText("2 messages");
  await resolved
    .getByRole("button", { name: /Expand resolved discussion/ })
    .click();
  await expect(resolved).toContainText("Yes, partial captures too.");
  await resolved.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(marked(page)).toHaveText([
    "original transaction ID",
    "reported to the customer",
  ]);
  await expect(panel.getByRole("article")).toHaveCount(3);
  await expect(panel.getByRole("article").first()).toContainText(
    "Yes, partial captures too.",
  );

  // A new discussion on selected text, from the keyboard shortcut: it
  // lands in document order between the two marked passages.
  await selectInSpecification(page, "reconciled against the first attempt");
  await page.keyboard.press("Control+Alt+m");
  const composer = await fillMarkdown(
    page,
    "Comment on selection",
    "Which attempt is the first one?",
  );
  await composer.press("Control+Enter");
  await expect(panel.getByRole("article")).toHaveCount(4);
  await expect(panel.getByRole("article").nth(1)).toContainText(
    "Which attempt is the first one?",
  );
  await expect(marked(page)).toHaveText([
    "original transaction ID",
    "reconciled against the first attempt",
    "reported to the customer",
  ]);
  // The choice to keep the panel open is remembered.
  await page.reload();
  await expect(panelOf(page)).toBeVisible();
});

test("a discussion whose text changed says so and opens the revision it was written on", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { workItemId, path } = await open(page);
  await discuss(workItemId, {
    section: "Behavior",
    quote: "Retries reuse the original transaction ID.",
    body: "What about refunds?",
  });
  await discuss(workItemId, {
    section: "Rollout",
    quote: "ten percent of merchants",
    body: "Which merchants?",
  });
  await revise(
    workItemId,
    first
      .replace(
        "Retries reuse the original transaction ID.",
        "Retries create a new transaction ID.",
      )
      .replace(/## Rollout[\s\S]*$/, ""),
    "New IDs, no rollout plan",
  );
  await signIn(page, seeded.owner.email);
  await page.goto(path);
  await discussionsToggle(page).click();
  const panel = panelOf(page);
  const changed = panel.getByRole("article").filter({
    hasText: "What about refunds?",
  });
  await expect(changed).toContainText(
    "The quoted text changed since revision 1",
  );
  const removed = panel.getByRole("article").filter({
    hasText: "Which merchants?",
  });
  await expect(removed).toContainText("Original text removed since revision 1");
  // Neither is attached to other text.
  await expect(marked(page)).toHaveCount(0);
  await changed
    .getByRole("button", { name: "revision 1", exact: true })
    .click();
  await expect(page).toHaveURL(/[?&]history=/);
  const shown = page.getByRole("article", { name: "Revision 1" });
  await expect(shown).toBeVisible();
  await expect(shown.locator("mark")).toHaveText(
    "Retries reuse the original transaction ID.",
  );
  await page.getByRole("button", { name: "Close history" }).click();
  await expect(page).not.toHaveURL(/history=/);
});

test("changes between revisions mark only the words that changed, and any two revisions compare", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { workItemId, path } = await open(page);
  const second = first.replace(
    "original transaction ID",
    "first transaction ID",
  );
  await revise(workItemId, second, "Name the first ID");
  await revise(
    workItemId,
    second.replace("ten percent", "five percent"),
    "Smaller rollout",
  );
  await signIn(page, seeded.owner.email);
  await page.goto(path);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page).toHaveURL(/[?&]history=/);
  const selected = page.getByRole("region", { name: "Selected revision" });
  await expect(selected.getByRole("heading", { level: 2 }).first()).toHaveText(
    "Revision 3 · Smaller rollout",
  );
  // Revision 2 → 3: one edited block, only "ten" → "five" marked.
  await expect(selected.locator("ins")).toHaveText(["five"]);
  await expect(selected.locator("del")).toHaveText(["ten"]);
  await expect(selected.getByText("1 block changed")).toBeVisible();
  // Long unchanged runs fold; the full text reads straight through.
  await expect(selected.getByText(/unchanged blocks?$/)).toBeVisible();
  await expect(
    selected.getByText("A timeout after 30 seconds is reported"),
  ).toBeHidden();
  await selected.getByRole("button", { name: "Show full text" }).click();
  await expect(
    selected.getByText("A timeout after 30 seconds is reported"),
  ).toBeVisible();
  await expect(selected.locator("ins")).toHaveText(["five"]);

  // Compare revision 3 with revision 1: both edits, word by word.
  await selected.getByRole("combobox", { name: "Compare with" }).click();
  await page.getByRole("option", { name: "Compare with revision 1" }).click();
  await expect(selected.locator("ins")).toHaveText(["first", "five"]);
  await expect(selected.locator("del")).toHaveText(["original", "ten"]);
  await expect(page).toHaveURL(/[?&]compare=/);

  // Versions list who changed what, and reading one shows its full text.
  const versions = page.getByRole("region", { name: "Versions" });
  await expect(versions.getByRole("button")).toHaveCount(3);
  await expect(versions.getByRole("button").first()).toContainText("Current");
  await versions.getByRole("button", { name: /r1/ }).click();
  await expect(page.getByRole("article", { name: "Revision 1" })).toContainText(
    "Retries reuse the original transaction ID.",
  );
  // The same history holds branches and pull requests.
  await page
    .getByRole("navigation", { name: "Specification history" })
    .getByRole("button", { name: "Branches & pull requests" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Branches & pull requests" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Specification history" })
    .getByRole("button", { name: "Versions" })
    .click();
  await expect(versions).toBeVisible();
});

test("on a phone the discussions open as a sheet that closes with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { workItemId, path } = await open(page);
  await discuss(workItemId, {
    section: "Behavior",
    quote: "original transaction ID",
    body: "Also for partial captures?",
  });
  await signIn(page, seeded.owner.email);
  await page.goto(path);
  const toggle = discussionsToggle(page);
  await toggle.click();
  const sheet = page.getByRole("dialog", { name: "Discussions" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("article")).toContainText(
    "Also for partial captures?",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  // Escape in a composer cancels the reply only; the sheet stays open.
  await sheet.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = await fillMarkdown(sheet, "Reply", "Partial captures too");
  await reply.press("Escape");
  await expect(sheet.getByRole("textbox", { name: "Reply" })).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeFocused();
});
