import { test, expect, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { fillMarkdown, richEditor } from "../helpers/editor";
import {
  currentRevision,
  newPerson,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
} from "../helpers/seed";

// Live co-editing of specification drafts
// (docs/internals/specification-drafts.md): the people who may edit a line
// type into one shared draft with names and carets, edits are saved as they
// type, and only "Save revision" makes a revision, through the same review
// rules as before.

const BEHAVIOR = "# Behavior\n\nRetries reuse the transaction ID.";

async function openItem(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
}

async function edit(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  return richEditor(page, "Specification");
}

const saveState = (page: Page) => page.getByTestId("draft-save-state");

test("two people edit one specification draft live and one saves the revision both wrote", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    name: "Live specs",
    key: "LSPEC",
    users: ["Ada Owner", "Ben Writer", "Cleo Reviewer"],
    disciplines: { 1: "Product", 2: "Engineering" },
  });
  const workItemId = await seedItem(seeded, {
    title: "Settlement retries",
    description: BEHAVIOR,
  });
  // Engineering approved revision 1; QA has not decided, so main is not
  // protected yet.
  const first = await currentRevision(workItemId);
  const base = { workItemId, baseRevisionId: first.id };
  const engineering = seeded.roster.disciplines.find(
    (d) => d.projectId === seeded.projectId && d.name === "Engineering",
  )!.id;
  const qa = seeded.roster.disciplines.find(
    (d) => d.projectId === seeded.projectId && d.name === "QA",
  )!.id;
  const reviewId = crypto.randomUUID();
  await seeded.command({
    type: "requestReview",
    ...base,
    reviewId,
    disciplineId: engineering,
    userId: seeded.users[2]!.id,
    required: true,
  });
  await seeded.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: qa,
    userId: null,
    required: true,
  });
  await seeded.command(
    { type: "decideReview", ...base, reviewId, decision: "approve" },
    seeded.users[2]!.id,
  );

  const ada = await newPerson(browser);
  const ben = await newPerson(browser);
  try {
    await signIn(ada.page, seeded.users[0]!.email);
    await signIn(ben.page, seeded.users[1]!.email);
    await openItem(ada.page, seeded.itemPath(1), "Settlement retries");
    await openItem(ben.page, seeded.itemPath(1), "Settlement retries");
    const adaEditor = await edit(ada.page);
    const benEditor = await edit(ben.page);
    await expect(ada.page.getByText("Ben Writer is editing")).toBeVisible();
    await expect(ben.page.getByText("Ada Owner is editing")).toBeVisible();
    await expect(ada.page.getByText("based on revision 1")).toBeVisible();

    // Ben rewrites the paragraph; Ada sees it as he types.
    await fillMarkdown(
      ben.page,
      "Specification",
      "# Behavior\n\nRetries reuse the transaction ID for 24 hours.",
    );
    await expect(adaEditor).toContainText("for 24 hours");
    // Ada adds a sentence at the end; each sees the other's named caret.
    await adaEditor.click();
    await ada.page.keyboard.press("ControlOrMeta+End");
    await ada.page.keyboard.type(" Late callbacks are ignored.");
    await expect(benEditor).toContainText("Late callbacks are ignored.");
    await benEditor.click();
    await expect(
      ada.page.locator(".collaboration-carets__label", {
        hasText: "Ben Writer",
      }),
    ).toBeVisible();
    await expect(
      ben.page.locator(".collaboration-carets__label", {
        hasText: "Ada Owner",
      }),
    ).toBeVisible();
    await expect(saveState(ada.page)).toHaveText(/Draft saved/);
    await expect(saveState(ben.page)).toHaveText(/Draft saved/);
    await expect(
      ada.page.getByText("Not saved as a revision yet"),
    ).toBeVisible();
    // Typing is never a revision.
    expect((await currentRevision(workItemId)).number).toBe(1);

    // Saving says what it does to approvals, as before.
    await expect(
      ada.page.getByText("Existing approvals are marked outdated", {
        exact: false,
      }),
    ).toBeVisible();
    await ada.page
      .getByRole("textbox", { name: "Change summary" })
      .fill("Bound retries to a day");
    await ada.page.getByRole("button", { name: /Save revision 2/ }).click();
    await expect(ada.page.getByText("Revision 2 ·").first()).toBeVisible();
    const second = await currentRevision(workItemId);
    expect(second.number).toBe(2);
    expect(second.content).toBe(
      "# Behavior\n\nRetries reuse the transaction ID for 24 hours. Late callbacks are ignored.",
    );
    // Ben keeps editing the same draft, now based on revision 2.
    await expect(ben.page.getByText("based on revision 2")).toBeVisible();
    await expect(ben.page.getByText("Same as revision 2")).toBeVisible();
    await expect(benEditor).toContainText("Late callbacks are ignored.");
    // Engineering's approval of revision 1 is outdated; review is asked
    // again on revision 2.
    const approvals = await withDb((db) =>
      db
        .select({ status: s.approval.status })
        .from(s.approval)
        .where(
          and(
            eq(s.approval.workItemId, workItemId),
            eq(s.approval.revisionId, first.id),
          ),
        ),
    );
    expect(approvals.map((a) => a.status)).toEqual(["stale"]);
  } finally {
    await Promise.all([ada.context.close(), ben.context.close()]);
  }
});

test("a revision saved another way replaces the draft and keeps my text on this device; losing the discipline closes the editor", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    name: "Replaced specs",
    key: "RSPEC",
    users: ["Ada Owner", "Ben Writer"],
    disciplines: { 1: "Product" },
  });
  const workItemId = await seedItem(seeded, {
    title: "Payout schedule",
    description: "# Behavior\n\nPayouts run daily.",
  });
  const ben = await newPerson(browser);
  try {
    await signIn(ben.page, seeded.users[1]!.email);
    await openItem(ben.page, seeded.itemPath(1), "Payout schedule");
    await edit(ben.page);
    await fillMarkdown(
      ben.page,
      "Specification",
      "# Behavior\n\nPayouts run weekly on Fridays.",
    );
    await expect(saveState(ben.page)).toHaveText(/Draft saved/);
    // The reader tells editors the draft holds unsaved changes.
    await ben.page.getByRole("button", { name: "Close editor" }).click();
    await expect(
      ben.page.getByRole("button", { name: "Draft not saved as a revision" }),
    ).toBeVisible();
    await ben.page
      .getByRole("button", { name: "Draft not saved as a revision" })
      .click();
    await expect(await richEditor(ben.page, "Specification")).toContainText(
      "weekly on Fridays",
    );

    // Ada saves revision 2 through the API: the draft starts again from
    // it, and Ben's text stays on his device until he decides.
    const first = await currentRevision(workItemId);
    await seeded.command({
      type: "updateSpecification",
      workItemId,
      baseRevisionId: first.id,
      title: "Payout schedule",
      content: "# Behavior\n\nPayouts run hourly.",
    });
    const kept = ben.page.getByRole("status", {
      name: "Unsaved text kept on this device",
    });
    await expect(kept).toContainText(
      "This draft was replaced while you had changes it did not keep.",
      { timeout: 30_000 },
    );
    await expect(kept).toContainText("Payouts run weekly on Fridays.");
    const editor = await richEditor(ben.page, "Specification");
    await expect(editor).toContainText("Payouts run hourly.");
    await expect(ben.page.getByText("based on revision 2")).toBeVisible();
    // Nothing was merged silently.
    expect((await currentRevision(workItemId)).content).toBe(
      "# Behavior\n\nPayouts run hourly.",
    );
    // Putting it back is an ordinary edit, made only when asked.
    await kept.getByRole("button", { name: "Insert at end" }).click();
    await expect(editor).toContainText("Payouts run weekly on Fridays.");
    await expect(kept).toHaveCount(0);

    // Leaving Product takes away editing: the editor closes.
    await seeded.command({
      type: "setDisciplineMember",
      projectId: seeded.projectId,
      disciplineId: seeded.roster.disciplines.find(
        (d) => d.projectId === seeded.projectId && d.name === "Product",
      )!.id,
      userId: seeded.users[1]!.id,
      member: false,
    });
    await expect(
      ben.page.getByText("You can no longer edit this specification draft."),
    ).toBeVisible({ timeout: 45_000 });
  } finally {
    await ben.context.close();
  }
});

test("edits typed offline stay in the editor and are saved after reconnecting", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    name: "Offline specs",
    key: "OSPEC",
    users: ["Ada Owner"],
  });
  const workItemId = await seedItem(seeded, {
    title: "Refund window",
    description: "Refunds are accepted for 30 days.",
  });
  const ada = await newPerson(browser);
  try {
    await signIn(ada.page, seeded.users[0]!.email);
    await openItem(ada.page, seeded.itemPath(1), "Refund window");
    const editor = await edit(ada.page);
    await expect(saveState(ada.page)).toHaveText(/Draft saved/);
    await ada.context.setOffline(true);
    await expect(
      saveState(ada.page).filter({ hasText: /^Offline/ }),
    ).toBeVisible();
    await editor.click();
    await ada.page.keyboard.press("ControlOrMeta+End");
    await ada.page.keyboard.type(" Written while offline.");
    await expect(editor).toContainText("Written while offline.");
    await ada.context.setOffline(false);
    await expect(saveState(ada.page)).toHaveText(/Draft saved/, {
      timeout: 30_000,
    });
    await ada.page.getByRole("button", { name: /Save revision 2/ }).click();
    await expect(ada.page.getByText("Revision 2 ·").first()).toBeVisible();
    expect((await currentRevision(workItemId)).content).toBe(
      "Refunds are accepted for 30 days. Written while offline.",
    );
  } finally {
    await ada.context.close();
  }
});

test("Markdown edited as text is saved with the revision, merged with what others typed meanwhile, and kept when not applied", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const seeded = await seedWorkspace({
    name: "Source specs",
    key: "SSPEC",
    users: ["Ada Owner", "Ben Writer"],
    disciplines: { 1: "Product" },
  });
  const workItemId = await seedItem(seeded, {
    title: "Capture retries",
    description:
      "# Behavior\n\nRetries reuse the transaction ID.\n\n## Failure\n\nTimeouts are retried once.",
  });
  const ada = await newPerson(browser);
  const ben = await newPerson(browser);
  const source = (page: Page) =>
    page.getByRole("textbox", {
      name: "Specification (Markdown)",
      exact: true,
    });
  const toolbar = (page: Page) =>
    page.getByRole("toolbar", { name: "Specification formatting" });
  const asMarkdown = async (page: Page) => {
    await toolbar(page)
      .getByRole("button", { name: "Edit as Markdown" })
      .click();
    await expect(source(page)).toBeVisible();
  };
  try {
    await signIn(ada.page, seeded.users[0]!.email);
    await signIn(ben.page, seeded.users[1]!.email);
    await openItem(ada.page, seeded.itemPath(1), "Capture retries");
    await openItem(ben.page, seeded.itemPath(1), "Capture retries");
    await edit(ada.page);
    const benEditor = await edit(ben.page);

    // Ada edits one paragraph as Markdown; meanwhile Ben changes another.
    await asMarkdown(ada.page);
    const text = await source(ada.page).inputValue();
    await source(ada.page).fill(
      text.replace("transaction ID.", "transaction ID for a day."),
    );
    await expect(ada.page.getByText("Markdown not applied yet")).toBeVisible();
    await fillMarkdown(
      ben.page,
      "Specification",
      "# Behavior\n\nRetries reuse the transaction ID.\n\n## Failure\n\nTimeouts are retried twice.",
    );
    await expect(saveState(ben.page)).toHaveText(/Draft saved/);
    // Saving straight from the Markdown applies it first: both changes are
    // in the revision, nothing of Ben's is overwritten.
    await ada.page.getByRole("button", { name: /Save revision 2/ }).click();
    await expect(ada.page.getByText("Revision 2 ·").first()).toBeVisible();
    expect((await currentRevision(workItemId)).content).toBe(
      "# Behavior\n\nRetries reuse the transaction ID for a day.\n\n## Failure\n\nTimeouts are retried twice.",
    );
    await expect(benEditor).toContainText("for a day");

    // Both change the same paragraph: nothing is chosen silently.
    await edit(ada.page);
    await asMarkdown(ada.page);
    await source(ada.page).fill(
      (await source(ada.page).inputValue()).replace("twice", "three times"),
    );
    await fillMarkdown(
      ben.page,
      "Specification",
      "# Behavior\n\nRetries reuse the transaction ID for a day.\n\n## Failure\n\nTimeouts are never retried.",
    );
    await expect(saveState(ben.page)).toHaveText(/Draft saved/);
    await toolbar(ada.page)
      .getByRole("button", { name: "Edit formatted text" })
      .click();
    const conflict = ada.page.getByRole("alert").filter({
      hasText: "Someone changed the same part of the specification",
    });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText("never retried");
    await expect(conflict).toContainText("three times");
    await conflict.getByRole("button", { name: "Keep my version" }).click();
    const adaEditor = await richEditor(ada.page, "Specification");
    await expect(adaEditor).toContainText("retried three times");
    await expect(adaEditor).not.toContainText("never retried");
    await expect(benEditor).toContainText("retried three times");

    // "Close editor" applies the Markdown; the reader says the draft is not
    // a revision yet.
    await asMarkdown(ada.page);
    await source(ada.page).fill(
      `${await source(ada.page).inputValue()}\n\nLate callbacks are ignored.`,
    );
    await ada.page.getByRole("button", { name: "Close editor" }).click();
    await expect(
      ada.page.getByRole("button", { name: "Draft not saved as a revision" }),
    ).toBeVisible();
    await expect(benEditor).toContainText("Late callbacks are ignored.");

    // Markdown never applied (the tab reloads) is kept on this device.
    await edit(ada.page);
    await asMarkdown(ada.page);
    await source(ada.page).fill(
      `${await source(ada.page).inputValue()}\n\nRefunds are out of scope.`,
    );
    await expect
      .poll(() =>
        ada.page.evaluate(() =>
          Object.keys(localStorage).some((key) =>
            (localStorage.getItem(key) ?? "").includes(
              "Refunds are out of scope.",
            ),
          ),
        ),
      )
      .toBe(true);
    ada.page.on("dialog", (dialog) => void dialog.accept());
    await ada.page.reload();
    await edit(ada.page);
    const kept = ada.page.getByRole("status", {
      name: "Unsaved text kept on this device",
    });
    await expect(kept).toContainText(
      "Markdown you edited as text was not applied to the draft.",
    );
    await expect(kept).toContainText("Refunds are out of scope.");
    expect((await currentRevision(workItemId)).content).not.toContain(
      "Refunds are out of scope.",
    );
  } finally {
    await Promise.all([ada.context.close(), ben.context.close()]);
  }
});
