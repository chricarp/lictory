import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { richEditor } from "../helpers/editor";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
} from "../helpers/seed";

// Wording hints (packages/core/src/editor/wording-hints.ts): while a
// specification is edited, phrases in its Acceptance criteria that a tester
// cannot check are underlined, the phrase under the caret is explained in
// one line, and the hint can be dismissed on this device. Hints are advice:
// no discussion, revision or readiness result comes from them, and they
// need no AI.

const SPEC = [
  "# Intent",
  "",
  "Checkout should feel fast.",
  "",
  "## Acceptance criteria",
  "",
  "- Search results appear quickly.",
  "- Retries reuse the transaction ID.",
].join("\n");

const hints = (page: Page) =>
  page.locator("[data-markdown-editor] .wording-hint");

async function caretIn(page: Page, phrase: string) {
  await hints(page).filter({ hasText: phrase }).click();
}

test("acceptance criteria hint at unmeasurable wording while editing, dismissibly and without side effects", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const seeded = await seedWorkspace({
    name: "Wording hints",
    key: "WORD",
    users: ["Ada Owner"],
  });
  const workItemId = await seedItem(seeded, {
    title: "Search checkout",
    description: SPEC,
  });
  await signIn(page, seeded.users[0]!.email);
  await page.goto(seeded.itemPath(1));
  await expect(
    page.getByRole("heading", { name: "Search checkout", level: 1 }),
  ).toBeVisible();
  // Readers see no hints.
  await expect(page.locator(".wording-hint")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = await richEditor(page, "Specification");
  // Only the Acceptance criteria section: "fast" in the intent is not hinted.
  await expect(hints(page)).toHaveText(["quickly"]);
  const line = page.getByTestId("wording-hint");
  await expect(line).toHaveCount(0);

  await caretIn(page, "quickly");
  await expect(line).toContainText(
    "“quickly” can't pass or fail a test: state the expected value, limit or behavior.",
  );

  // Dismiss, undo, dismiss again.
  await line.getByRole("button", { name: "Dismiss" }).click();
  await expect(hints(page)).toHaveCount(0);
  await expect(line).toContainText("dismissed on this device");
  await line.getByRole("button", { name: "Undo" }).click();
  await expect(hints(page)).toHaveText(["quickly"]);
  await caretIn(page, "quickly");
  await line.getByRole("button", { name: "Dismiss" }).click();
  await expect(hints(page)).toHaveCount(0);
  await expect(line).toContainText("dismissed on this device");

  // Typing a new criterion hints at it as it is written.
  // Caret at the end of the last criterion. Keys can arrive before the
  // browser's selectionchange, and ProseMirror would act on the caret it
  // had before; the "dismissed" line goes away once ProseMirror has the new
  // selection.
  await editor.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent !== "Retries reuse the transaction ID.") continue;
      window.getSelection()!.collapse(node, node.textContent.length);
      return;
    }
    throw new Error("The last criterion is not in the editor.");
  });
  await expect(line).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Timeout behavior: TBD");
  await expect(hints(page)).toHaveText(["TBD"]);
  await page.keyboard.press("ArrowLeft");
  await expect(line).toContainText("“TBD” marks something undecided");

  // Hints are never content, discussions or revisions.
  await expect(page.getByTestId("draft-save-state")).toHaveText(/Draft saved/);
  expect((await currentRevision(workItemId)).number).toBe(1);
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(page.getByText("Revision 2 ·").first()).toBeVisible();
  const saved = await currentRevision(workItemId);
  expect(saved.content).toBe(`${SPEC}\n- Timeout behavior: TBD`);
  const threads = await withDb((db) =>
    db.select().from(s.thread).where(eq(s.thread.workItemId, workItemId)),
  );
  expect(threads).toEqual([]);

  // The dismissal stays on this device; the new hint is still shown.
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await richEditor(page, "Specification");
  await expect(hints(page)).toHaveText(["TBD"]);
});
