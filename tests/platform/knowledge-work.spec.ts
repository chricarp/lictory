import { test, expect, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  currentRevision,
  newPerson,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import { clientAddress } from "../helpers/client-address";

// Work surfaces of knowledge links (docs/internals/knowledge-links.md):
// the item's Knowledge section, attaching pages, proposing a page update,
// context pages on delivery surfaces and page reviews in the Inbox.

let seeded: Seeded;
test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Knowledge work",
    key: "KW",
    users: ["Olivia Owner", "Rhea Reader"],
    settings: { iterationMode: "manual" },
  });
  await seeded.command({
    type: "setProjectMember",
    projectId: seeded.projectId,
    userId: seeded.users[1]!.id,
    role: "member",
  });
});
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

async function capability<T = Record<string, string>>(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await page.request.post(`/api/capabilities/${name}`, {
    headers: { origin: new URL(page.url()).origin },
    data: { organizationId: seeded.organizationId, ...input },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}

type Node = Record<string, unknown>;
const text = (value: string): Node => ({ type: "text", text: value });
const block = (type: string, id: string, ...content: Node[]): Node => ({
  type,
  attrs: type === "heading" ? { id, level: 2 } : { id },
  content,
});
const itemRef = (workItemId: string, key: string): Node => ({
  type: "workItemRef",
  attrs: { workItemId, key },
});

async function space(
  page: Page,
  name: string,
  options: Record<string, unknown> = {},
) {
  const spaceId = crypto.randomUUID();
  const slug = `${name.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-${spaceId.slice(0, 6)}`;
  await capability(page, "createSpace", {
    spaceId,
    name,
    slug,
    home: { projectId: seeded.projectId },
    ...options,
  });
  return { spaceId, slug };
}

// Creates a page and publishes `content` on it (a proposal merged into main).
async function publishedPage(
  page: Page,
  spaceId: string,
  title: string,
  content?: Node[],
) {
  const pageId = crypto.randomUUID();
  await capability(page, "createPage", { spaceId, pageId, title });
  if (content) {
    const pullRequestId = crypto.randomUUID();
    const proposed = await capability(page, "proposePageChange", {
      pageId,
      branchId: crypto.randomUUID(),
      pullRequestId,
      title,
      content: { type: "doc", content },
      message: `Write ${title}`,
    });
    const head = await capability(page, "getPage", { pageId });
    await capability(page, "mergePagePullRequest", {
      pullRequestId,
      inspectedSourceHead: proposed.commitId,
      inspectedTargetHead: head.commitId,
    });
  }
  return pageId;
}

const knowledge = (page: Page) =>
  page.getByRole("region", { name: "Knowledge", exact: true });

test("an item lists the pages about it, attaches one with undo and hides restricted pages from others", async ({
  page,
  browser,
}) => {
  await signIn(page, seeded.owner.email);
  const itemId = await seedItem(seeded, { title: "Retry failed captures" });
  const key = "KW-1";
  const open = await space(page, "Payments handbook space");
  const secret = await space(page, "Security notes", {
    accessMode: "restricted",
  });
  const handbook = await publishedPage(
    page,
    open.spaceId,
    "Payments handbook",
    [
      block("heading", "h-intro", text("Overview")),
      ...Array.from({ length: 12 }, (_, i) =>
        block("paragraph", `filler-${i}`, text(`Background paragraph ${i}.`)),
      ),
      block("heading", "h-retries", text("Retries")),
      block(
        "paragraph",
        "p-retry",
        text("Retries follow "),
        itemRef(itemId, key),
        text(" and reuse the idempotency key."),
      ),
    ],
  );
  await publishedPage(page, secret.spaceId, "Incident secrets", [
    block("paragraph", "p-secret", text("See "), itemRef(itemId, key)),
  ]);
  await publishedPage(page, open.spaceId, "Refund runbook");

  await page.goto(seeded.itemPath(1));
  const section = knowledge(page);
  await expect(section).toContainText("Payments handbook");
  await expect(section).toContainText("Mentioned in latest under “Retries”");
  await expect(section).toContainText("reuse the idempotency key");
  await expect(section).toContainText("Incident secrets");

  // Attach the runbook as a runbook, detach it, undo.
  await section.getByRole("button", { name: "Attach page" }).click();
  const attach = page.getByRole("dialog");
  await attach
    .getByPlaceholder("Search pages by title or space")
    .fill("Refund");
  await attach.getByRole("option", { name: /Refund runbook/ }).click();
  await attach.getByRole("radio", { name: /Runbook/ }).check();
  await attach
    .getByRole("button", { name: "Attach page", exact: true })
    .click();
  const runbookRow = section.getByRole("listitem").filter({
    hasText: "Refund runbook",
  });
  await expect(runbookRow).toContainText("Runbook");
  await expectNoAccessibilityViolations(page, "item knowledge");
  await runbookRow.hover();
  await runbookRow
    .getByRole("button", { name: "Detach “Refund runbook”" })
    .click();
  await expect(runbookRow).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(runbookRow).toContainText("Runbook");

  // The list counts readable pages about the item.
  await page.goto(seeded.projectPath("/items"));
  await expect(
    page.getByRole("link", { name: "3 pages about this item" }),
  ).toBeVisible();

  // Opening a mention lands on its block.
  await page.goto(seeded.itemPath(1));
  await knowledge(page)
    .getByRole("link", { name: "Payments handbook", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/pages/${handbook}#block-p-retry$`));
  await expect(page.locator('[data-id="p-retry"]')).toBeInViewport();

  // Someone who cannot read the restricted space sees neither its page nor
  // a count that includes it.
  const reader = await newPerson(browser);
  await signIn(reader.page, seeded.users[1]!.email);
  await reader.page.goto(seeded.itemPath(1));
  const theirs = knowledge(reader.page);
  await expect(theirs).toContainText("Payments handbook");
  await expect(theirs).toContainText("Refund runbook");
  await expect(theirs).not.toContainText("Incident secrets");
  await reader.page.goto(seeded.projectPath("/items"));
  await expect(
    reader.page.getByRole("link", { name: "2 pages about this item" }),
  ).toBeVisible();
  await reader.context.close();
});

test("proposing a page update opens a branch in the editor and the item follows its pull request", async ({
  page,
}) => {
  await signIn(page, seeded.owner.email);
  const itemId = await seedItem(seeded, { title: "Partial refund limits" });
  const { number } = await withDb(async (db) => {
    const [row] = await db
      .select({ number: s.workItem.number })
      .from(s.workItem)
      .where(eq(s.workItem.id, itemId));
    return row!;
  });
  const handbook = await space(page, "Refunds handbook", {
    publishing: "reviewed",
  });
  const pageId = await publishedPage(page, handbook.spaceId, "Refund policy", [
    block(
      "paragraph",
      "p-approval",
      text("Refunds over half the amount need approval."),
    ),
  ]);

  // Work created from the page shows where it came from.
  const { commitId } = await capability(page, "getPage", { pageId });
  await capability(page, "createWorkItem", {
    projectId: seeded.projectId,
    workItemId: crypto.randomUUID(),
    typeId: seeded.typeId("Story"),
    parentId: null,
    title: "Approval for large refunds",
    description: "",
    source: {
      pageId,
      commitId,
      quote: "Refunds over half the amount need approval.",
    },
  });
  await page.goto(seeded.itemPath(number + 1));
  await expect(knowledge(page)).toContainText(
    "Refunds over half the amount need approval.",
  );
  await expect(
    knowledge(page).getByRole("link", { name: "Open source" }),
  ).toHaveAttribute(
    "href",
    new RegExp(`/pages/${pageId}\\?commit=${commitId}`),
  );

  await page.goto(seeded.itemPath(number));
  await expect(knowledge(page)).toContainText("appear in this list");
  await knowledge(page)
    .getByRole("button", { name: "Propose page update" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("option", { name: /Refund policy/ }).click();
  await expect(dialog).toContainText("published after review");
  await expect(dialog.getByLabel("Branch name")).toHaveValue(
    `kw-${number}-partial-refund-limits`,
  );
  await dialog
    .getByRole("button", { name: "Create branch and edit", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}\\?branch=`));
  await expect(page.getByRole("textbox").first()).toBeVisible();

  await page.goto(seeded.itemPath(number));
  const proposal = knowledge(page)
    .getByRole("listitem")
    .filter({ hasText: "Refund policy" });
  await expect(proposal).toContainText(`kw-${number}-partial-refund-limits`);
  await expect(proposal).toContainText("Not proposed yet");
  // A change proposed with the item as its origin (as Litto proposes
  // one) is listed with its open pull request.
  const revision = await currentRevision(itemId);
  await capability(page, "proposePageChange", {
    pageId,
    branchId: crypto.randomUUID(),
    pullRequestId: crypto.randomUUID(),
    branchName: "refund-limits-wording",
    title: "Refund policy",
    content: {
      type: "doc",
      content: [block("paragraph", "p-1", text("Partial refunds are capped."))],
    },
    message: "Document partial refunds",
    origin: { workItemId: itemId, revisionId: revision.id },
  });
  const reviewed = knowledge(page)
    .getByRole("listitem")
    .filter({ hasText: "refund-limits-wording" });
  await expect(reviewed).toContainText("In review");
});

test("a knowledge row opens each version the item relies on, never the latest in a pin's place", async ({
  page,
}) => {
  await signIn(page, seeded.owner.email);
  const itemId = await seedItem(seeded, { title: "Settle refunds in batches" });
  const { number } = await withDb(async (db) => {
    const [row] = await db
      .select({ number: s.workItem.number })
      .from(s.workItem)
      .where(eq(s.workItem.id, itemId));
    return row!;
  });
  const key = `KW-${number}`;
  const guides = await space(page, "Settlement guides");
  // v2 mentions the item; v3 is published after it.
  const pageId = await publishedPage(page, guides.spaceId, "Batch settlement", [
    block("heading", "h-batches", text("Batches")),
    block(
      "paragraph",
      "p-batch",
      text("Batches close at 18:00, see "),
      itemRef(itemId, key),
    ),
  ]);
  const v2 = (await capability(page, "getPage", { pageId })).commitId!;
  const pullRequestId = crypto.randomUUID();
  const proposed = await capability(page, "proposePageChange", {
    pageId,
    branchId: crypto.randomUUID(),
    pullRequestId,
    title: "Batch settlement",
    content: {
      type: "doc",
      content: [
        block("heading", "h-batches", text("Batches")),
        block(
          "paragraph",
          "p-batch",
          text("Batches close at 20:00, see "),
          itemRef(itemId, key),
        ),
      ],
    },
    message: "Later cut-off",
  });
  await capability(page, "mergePagePullRequest", {
    pullRequestId,
    inspectedSourceHead: proposed.commitId,
    inspectedTargetHead: v2,
  });
  const v3 = (await capability(page, "getPage", { pageId })).commitId!;
  expect(v3).not.toBe(v2);
  // Attached at v2, and the specification cites v3.
  await capability(page, "attachPage", {
    workItemId: itemId,
    attachmentId: crypto.randomUUID(),
    pageId,
    purpose: "design",
    commitId: v2,
  });
  const revision = await currentRevision(itemId);
  await seeded.command({
    type: "updateSpecification",
    workItemId: itemId,
    baseRevisionId: revision.id,
    title: "Settle refunds in batches",
    content: `# Behavior\n\nFollow [Batch settlement](page:${pageId}@${v3}).`,
  });

  await page.goto(seeded.itemPath(number));
  const row = knowledge(page)
    .getByRole("listitem")
    .filter({ hasText: "Batch settlement" });
  await expect(row).toContainText("Mentioned in latest under “Batches”");
  await expect(row).toContainText("Attached at v2");
  await expect(row).toContainText("Revision 2 cites v3");
  // Each target is explicit: the mention opens the latest at its block,
  // each pin its own version.
  await expect(
    row.getByRole("link", {
      name: /where it mentions .* in its latest version/,
    }),
  ).toHaveAttribute("href", new RegExp(`/pages/${pageId}#block-p-batch$`));
  await expect(
    row.getByRole("link", { name: "Open version 2 of “Batch settlement”" }),
  ).toHaveAttribute("href", new RegExp(`/pages/${pageId}\\?commit=${v2}$`));
  await expect(
    row.getByRole("link", { name: "Open version 3 of “Batch settlement”" }),
  ).toHaveAttribute("href", new RegExp(`/pages/${pageId}\\?commit=${v3}$`));
  await row
    .getByRole("link", { name: "Open version 2 of “Batch settlement”" })
    .click();
  await expect(page).toHaveURL(new RegExp(`\\?commit=${v2}`));
  await expect(page.getByText("18:00").first()).toBeVisible();
});

test("delivery surfaces keep context pages and an iteration gets notes", async ({
  page,
}) => {
  await signIn(page, seeded.owner.email);
  await seedItem(seeded, { title: "Capture retries in the sprint" });
  const handbook = await space(page, "Delivery handbook");
  await publishedPage(page, handbook.spaceId, "Release checklist");

  // Board: add a project context page.
  await page.goto(seeded.projectPath("/board?iteration=all"));
  await page.getByRole("button", { name: /^Context pages of/ }).click();
  await page
    .getByRole("button", { name: /^Add a page to/ })
    .first()
    .click();
  await page.getByRole("option", { name: /Release checklist/ }).click();
  await expect(
    page.getByRole("button", { name: /^Context pages of .*: 1$/ }),
  ).toBeVisible();

  // Backlog: the same project list, and a sprint with notes.
  await page.goto(seeded.projectPath("/backlog"));
  const backlogContext = page.getByRole("button", {
    name: /^Context pages of Knowledge work project: 1$/,
  });
  await backlogContext.click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Release checklist" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New sprint" }).click();
  await page
    .getByRole("button", { name: /^Context pages of Sprint 1$/ })
    .click();
  await page
    .getByRole("button", { name: "Create iteration notes", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Title")).toHaveValue("Sprint 1 notes");
  await form.getByLabel("Space").selectOption({ label: "Delivery handbook" });
  await form.getByRole("button", { name: "Create and open" }).click();
  await expect(page).toHaveURL(/\/pages\/[^?/]+$/);
  await expect(page.getByText("Retrospective").first()).toBeVisible();

  // The iteration report lists its pages.
  const iterationId = await withDb(async (db) => {
    const [row] = await db
      .select({ id: s.iteration.id })
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.projectId, seeded.projectId),
          eq(s.iteration.number, 1),
        ),
      );
    return row!.id;
  });
  await page.goto(seeded.projectPath(`/iterations/${iterationId}`));
  await expect(
    page.getByRole("region", { name: "Pages" }).getByRole("link", {
      name: "Sprint 1 notes",
    }),
  ).toBeVisible();
});

test("Inbox To do asks for a page review until it is given", async ({
  page,
  browser,
}) => {
  await signIn(page, seeded.owner.email);
  const reviewed = await space(page, "Reviewed guides", {
    publishing: "reviewed",
  });
  const pageId = await publishedPage(page, reviewed.spaceId, "Chargebacks");
  const pullRequestId = crypto.randomUUID();
  await capability(page, "proposePageChange", {
    pageId,
    branchId: crypto.randomUUID(),
    pullRequestId,
    title: "Chargebacks",
    content: {
      type: "doc",
      content: [block("paragraph", "p-1", text("Respond within 7 days."))],
    },
    message: "Chargeback deadlines",
  });
  await capability(page, "requestPageReview", {
    pullRequestId,
    userId: seeded.users[1]!.id,
    required: true,
  });

  const reader = await newPerson(browser);
  await signIn(reader.page, seeded.users[1]!.email);
  await reader.page.goto(`/${seeded.slug}/inbox?view=todo`);
  const entry = reader.page.getByRole("link", { name: /Review requested/ });
  await expect(entry).toContainText("Chargebacks");
  await expect(entry).toContainText("Page");
  await entry.click();
  await reader.page
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(
    reader.page
      .getByRole("complementary", { name: "Review summary" })
      .getByText("Approved", { exact: true }),
  ).toBeVisible();
  await reader.page.goto(`/${seeded.slug}/inbox?view=todo`);
  await expect(
    reader.page.getByRole("link", { name: /Chargebacks/ }),
  ).toHaveCount(0);

  // The author is told the approved change can be merged.
  await page.goto(`/${seeded.slug}/inbox?view=todo`);
  await expect(
    page.getByRole("link", { name: /Ready to merge/ }),
  ).toContainText("Chargebacks");
  await reader.context.close();
});
