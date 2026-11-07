import { test, expect, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { clientAddress } from "../helpers/client-address";
import {
  currentRevision,
  newPerson,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";

// The whole loop between pages and work (docs/internals/knowledge-links.md):
// a page's text becomes a work item that remembers it, the specification
// cites the page at the version it was read, the work is reviewed and
// delivered, the page update is proposed from the item, reviewed from the
// Inbox and merged, and each side then shows the other. In a project that
// delivers externally the same links show the delivery tool's status and no
// native iteration controls; a page someone stops being allowed to read
// leaves every open surface.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

type Node = Record<string, unknown>;
const paragraph = (id: string, ...content: Node[]): Node => ({
  type: "paragraph",
  attrs: { id },
  content,
});
const text = (value: string): Node => ({ type: "text", text: value });
const doc = (...content: Node[]) =>
  ({ type: "doc", content }) as unknown as Record<string, never>;

const knowledge = (page: Page) =>
  page.getByRole("region", { name: "Knowledge", exact: true });
const liveEditor = (page: Page) =>
  page.locator('.page-document[contenteditable="true"]');

async function createSpace(
  seeded: Seeded,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const spaceId = crypto.randomUUID();
  const slug = `${name.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-${spaceId.slice(0, 6)}`;
  await seeded.command({
    type: "createSpace",
    spaceId,
    name,
    slug,
    home: { projectId: seeded.projectId },
    ...extra,
  });
  return { spaceId, slug };
}

async function createPage(
  seeded: Seeded,
  space: { spaceId: string; slug: string },
  title: string,
  ...content: Node[]
) {
  const pageId = crypto.randomUUID();
  await seeded.command({
    type: "createPage",
    spaceId: space.spaceId,
    pageId,
    title,
    content: doc(...content),
  });
  const commitId = await withDb(async (db) => {
    const [row] = await db
      .select({ head: s.pageBranch.headCommitId })
      .from(s.pageBranch)
      .where(
        and(eq(s.pageBranch.pageId, pageId), eq(s.pageBranch.isMain, true)),
      );
    return row!.head;
  });
  return {
    pageId,
    commitId,
    url: `/${seeded.slug}/spaces/${space.slug}/pages/${pageId}`,
  };
}

const itemByTitle = (seeded: Seeded, title: string) =>
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

async function selectText(page: Page, wanted: string) {
  await page.evaluate((value) => {
    const root = document.querySelector(".page-document");
    if (!root) throw new Error("No page content");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(value) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + value.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${value}" is not in the page`);
  }, wanted);
}

test("a page becomes reviewed, delivered work that proposes the page update back, and both sides show it", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const seeded = await seedWorkspace({
    name: "Refund loop",
    key: "LOOP",
    users: ["Ada Owner", "Ben Engineer"],
    disciplines: { 1: "Engineering" },
  });
  const ops = await createSpace(seeded, "Operations", {
    publishing: "reviewed",
  });
  const runbook = await createPage(
    seeded,
    ops,
    "Missing refund runbook",
    paragraph(
      "rule",
      text("Refunds above 500 EUR need a second approver from finance."),
    ),
  );
  const ada = await newPerson(browser);
  const ben = await newPerson(browser);
  try {
    await signIn(ada.page, seeded.users[0]!.email);
    await signIn(ben.page, seeded.users[1]!.email);

    // 1. Selected page text becomes a work item that remembers its source.
    await ada.page.goto(runbook.url);
    await expect(
      ada.page.getByRole("document", { name: /content/ }),
    ).toContainText("second approver");
    await selectText(ada.page, "need a second approver from finance");
    await ada.page
      .getByRole("group", { name: "Selected text" })
      .getByRole("button", { name: "Create work item" })
      .click();
    const dialog = ada.page.getByRole("dialog", { name: "Create work item" });
    await dialog
      .getByRole("textbox", { name: "Title" })
      .fill("Second approver for large refunds");
    await dialog.getByRole("button", { name: "Create work item" }).click();
    await ada.page
      .getByRole("dialog", { name: /created$/ })
      .getByRole("button", { name: "Done" })
      .click();
    const created = await itemByTitle(
      seeded,
      "Second approver for large refunds",
    );
    const key = `LOOP-${created.number}`;

    // 2. The specification cites the page at the version it was read.
    const first = await currentRevision(created.id);
    await seeded.command({
      type: "updateSpecification",
      workItemId: created.id,
      baseRevisionId: first.id,
      title: "Second approver for large refunds",
      content: `# Behavior\n\nLarge refunds follow [Missing refund runbook](page:${runbook.pageId}@${runbook.commitId}).`,
    });
    const cited = await currentRevision(created.id);

    // 3. Engineering reviews and approves that revision.
    const engineering = seeded.roster.disciplines.find(
      (d) => d.projectId === seeded.projectId && d.name === "Engineering",
    )!.id;
    const reviewId = crypto.randomUUID();
    const base = { workItemId: created.id, baseRevisionId: cited.id };
    await seeded.command({
      type: "requestReview",
      ...base,
      reviewId,
      disciplineId: engineering,
      userId: seeded.users[1]!.id,
      required: true,
    });
    await seeded.command(
      { type: "decideReview", ...base, reviewId, decision: "approve" },
      seeded.users[1]!.id,
    );

    await ada.page.goto(seeded.itemPath(created.number));
    const section = knowledge(ada.page);
    await expect(section).toContainText("Created from");
    await expect(section).toContainText("need a second approver from finance");
    await expect(
      section
        .getByRole("listitem")
        .filter({ hasText: "Missing refund runbook" }),
    ).toContainText(`Revision ${cited.number} cites v1`);
    await expect(
      ada.page.locator("[data-spec-root]").locator('[data-reference="page"]'),
    ).toHaveAttribute(
      "href",
      new RegExp(`/pages/${runbook.pageId}\\?commit=${runbook.commitId}$`),
    );
    // Native delivery: the item has an iteration.
    await expect(
      ada.page.getByRole("button", { name: /^Iteration:/ }).first(),
    ).toBeVisible();

    // 4. Delivered natively: its subtask is done.
    const taskId = crypto.randomUUID();
    await seeded.command({
      type: "createWorkItem",
      projectId: seeded.projectId,
      workItemId: taskId,
      typeId: seeded.typeId("Subtask"),
      parentId: created.id,
      title: "Check the second approver",
    });
    const done = seeded.roster.statuses.find(
      (x) => x.projectId === seeded.projectId && x.category === "done",
    )!;
    await seeded.command({
      type: "updateWorkItem",
      workItemId: taskId,
      statusId: done.id,
    });

    // 5. The page update is proposed from the item.
    await ada.page.reload();
    await knowledge(ada.page)
      .getByRole("button", { name: "Propose page update" })
      .click();
    const propose = ada.page.getByRole("dialog");
    await propose
      .getByRole("option", { name: /Missing refund runbook/ })
      .click();
    await propose
      .getByRole("textbox", { name: "What changes" })
      .fill("Document the finance approval time");
    await propose
      .getByRole("button", { name: "Create branch and edit", exact: true })
      .click();
    await expect(ada.page).toHaveURL(/[?&]branch=/);
    const branchId = new URL(ada.page.url()).searchParams.get("branch")!;
    await expect(liveEditor(ada.page)).toBeVisible();
    await expect(
      ada.page.getByTestId("draft-save-state").filter({ hasText: /^Saved$/ }),
    ).toBeVisible({ timeout: 20_000 });
    await liveEditor(ada.page).click();
    await ada.page.keyboard.press("ControlOrMeta+End");
    await ada.page.keyboard.press("Enter");
    await ada.page.keyboard.type("Finance approves within one business day.");
    await expect(
      ada.page.getByTestId("draft-save-state").filter({ hasText: /^Saved$/ }),
    ).toBeVisible();
    await ada.page.getByRole("button", { name: "Commit", exact: true }).click();
    await ada.page
      .getByRole("dialog", { name: "Commit to this branch" })
      .getByRole("button", { name: "Commit now" })
      .click();
    await expect(ada.page.getByText("Committed version 2")).toBeVisible();
    const pullRequestId = crypto.randomUUID();
    await seeded.command({
      type: "createPagePullRequest",
      pageId: runbook.pageId,
      pullRequestId,
      sourceBranchId: branchId,
      title: "Document the finance approval time",
    });
    await seeded.command({
      type: "requestPageReview",
      pullRequestId,
      userId: seeded.users[1]!.id,
      required: true,
    });

    // 6. The reviewer finds it in Inbox To do and approves it.
    await ben.page.goto(`/${seeded.slug}/inbox?view=todo`);
    const request = ben.page.getByRole("link", { name: /Review requested/ });
    await expect(request).toContainText("Missing refund runbook");
    await request.click();
    await ben.page
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(
      ben.page
        .getByRole("complementary", { name: "Review summary" })
        .getByText("Approved", { exact: true }),
    ).toBeVisible();

    // 7. The author merges it.
    await ada.page.goto(
      `${runbook.url}/history?view=pulls&pr=${pullRequestId}`,
    );
    await ada.page
      .getByRole("button", { name: "Merge pull request…", exact: true })
      .click();
    await ada.page
      .getByRole("group", { name: "Confirm merge" })
      .getByRole("button", { name: "Confirm merge", exact: true })
      .click();
    await expect(ada.page.getByText(/Merged by/)).toBeVisible();

    // 8. The item shows the merged change and keeps its cited version.
    await ada.page.goto(seeded.itemPath(created.number));
    const proposed = knowledge(ada.page)
      .getByRole("listitem")
      .filter({ hasText: "Missing refund runbook" })
      .filter({ hasText: "branch" });
    await expect(proposed).toContainText("Merged");
    const row = knowledge(ada.page)
      .getByRole("listitem")
      .filter({ hasText: `Revision ${cited.number} cites v1` });
    await expect(row).toContainText("Newer version v2 published");
    await expect(
      row.getByRole("link", { name: /^v1\W+open version 1/ }),
    ).toBeVisible();

    // 9. The page shows the work it led to.
    await ada.page.goto(runbook.url);
    await expect(
      ada.page.getByText("Finance approves within one business day."),
    ).toBeVisible();
    const work = ada.page.getByTestId("page-work");
    await expect(work.locator(`[data-work-row="${key}"]`)).toContainText(
      "Second approver for large refunds",
    );
  } finally {
    await Promise.all([ada.context.close(), ben.context.close()]);
  }
});

test("in a project delivered externally, links show the delivery tool's status and no native iteration controls", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Jira loop",
    key: "JLOOP",
    users: ["Eli External"],
    disciplines: { 0: "Product" },
    settings: { deliveryMode: "external" },
  });
  const workItemId = await seedItem(seeded, { title: "Invoice exports" });
  const space = await createSpace(seeded, "Finance handbook");
  const handbook = await createPage(
    seeded,
    space,
    "Invoice handbook",
    paragraph("p-exports", text("Exports follow "), {
      type: "workItemRef",
      attrs: { workItemId, key: "JLOOP-1" },
    }),
  );
  await signIn(page, seeded.owner.email);

  // The page: the chip and its card, and "Work on this page", say where
  // delivery happens.
  await page.goto(handbook.url);
  const chip = page
    .getByRole("document", { name: /content/ })
    .locator('[data-reference="item"]');
  await expect(chip).toContainText("Invoice exports");
  await chip.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "Not handed off to your delivery tool",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("page-work").locator('[data-work-row="JLOOP-1"]'),
  ).toContainText("Not handed off");

  // The item: its knowledge, and no native delivery controls.
  await page.goto(seeded.itemPath(1));
  await expect(knowledge(page)).toContainText("Invoice handbook");
  await expect(knowledge(page)).toContainText("Mentioned in latest");
  await expect(page.getByRole("button", { name: /^Iteration:/ })).toHaveCount(
    0,
  );
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await expect(rail.getByRole("link", { name: "Board" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /^Backlog/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Context pages of Sprint/ }),
  ).toHaveCount(0);
});

test("losing access to a restricted page removes it from an open item's knowledge and its chip card", async ({
  browser,
}) => {
  const seeded = await seedWorkspace({
    name: "Private loop",
    key: "PLOOP",
    users: ["Ada Owner", "Rhea Reader"],
  });
  const workItemId = await seedItem(seeded, { title: "Rotate signing keys" });
  const secret = await createSpace(seeded, "Security", {
    accessMode: "restricted",
  });
  const incident = await createPage(
    seeded,
    secret,
    "Key compromise playbook",
    paragraph("p-keys", text("Rotate after "), {
      type: "workItemRef",
      attrs: { workItemId, key: "PLOOP-1" },
    }),
  );
  await seeded.command({
    type: "setSpaceGrant",
    spaceId: secret.spaceId,
    userId: seeded.users[1]!.id,
    level: "view",
  });
  const revision = await currentRevision(workItemId);
  await seeded.command({
    type: "updateSpecification",
    workItemId,
    baseRevisionId: revision.id,
    title: "Rotate signing keys",
    content: `# Behavior\n\nFollow [the playbook](page:${incident.pageId}@${incident.commitId}).`,
  });
  const rhea = await newPerson(browser);
  try {
    await signIn(rhea.page, seeded.users[1]!.email);
    await rhea.page.goto(seeded.itemPath(1));
    const section = knowledge(rhea.page);
    await expect(section).toContainText("Key compromise playbook");
    const chip = rhea.page
      .locator("[data-spec-root]")
      .locator('[data-reference="page"]');
    await chip.focus();
    await expect(rhea.page.getByRole("tooltip")).toContainText("Security");
    await rhea.page.keyboard.press("Escape");

    // Ada removes Rhea's grant while the item stays open.
    await seeded.command({
      type: "setSpaceGrant",
      spaceId: secret.spaceId,
      userId: seeded.users[1]!.id,
      level: null,
    });
    await expect(section).not.toContainText("Key compromise playbook", {
      timeout: 20_000,
    });
    await expect(
      rhea.page.getByRole("button", { name: /^Knowledge \d/ }),
    ).toHaveCount(0);
    // The specification's own words stay (item content); the chip no
    // longer resolves the page and shows no card about it.
    await expect(chip).toContainText("the playbook");
    await expect(chip).toHaveAttribute("data-resolved", "false");
    await chip.focus();
    await expect(rhea.page.getByRole("tooltip")).toHaveCount(0);
    expect(await rhea.page.content()).not.toContain("Key compromise playbook");
  } finally {
    await rhea.context.close();
  }
});
