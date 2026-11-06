import { test, expect, type Page } from "@playwright/test";
import { seedWorkspace, signIn, type Seeded } from "../helpers/seed";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import { clientAddress } from "../helpers/client-address";

let seeded: Seeded;
async function capability<T>(
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
test.beforeAll(async () => {
  seeded = await seedWorkspace({
    name: "Knowledge",
    key: "KN",
    users: ["Page Author", "Page Reviewer"],
  });
});
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

test("reviewed page: inspect result, request independent review, approve, merge and inspect history", async ({
  page,
  browser,
}) => {
  await signIn(page, seeded.owner.email);
  const spaceId = crypto.randomUUID(),
    pageId = crypto.randomUUID();
  await capability(page, "createSpace", {
    spaceId,
    name: "Reviewed handbook",
    slug: `reviewed-${pageId.slice(0, 8)}`,
    publishing: "reviewed",
  });
  await capability(page, "createPage", { spaceId, pageId, title: "Recovery" });
  const url = `/${seeded.slug}/spaces/reviewed-${pageId.slice(0, 8)}/pages/${pageId}`;
  await page.goto(`${url}/history?view=branches`);
  await page.getByLabel("Branch name").fill("recovery-notes");
  await page
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "recovery-notes", exact: true }),
  ).toBeVisible();
  const branchId = crypto.randomUUID(),
    pullRequestId = crypto.randomUUID();
  await capability(page, "proposePageChange", {
    pageId,
    branchId,
    pullRequestId,
    branchName: "safe-retries",
    title: "Recovery",
    markdown:
      "## Safe retries\n\nReuse the transaction identifier after a timeout.",
    message: "Define retry behavior",
  });
  await page.goto(
    `/${seeded.slug}/spaces/reviewed-${pageId.slice(0, 8)}/pull-requests`,
  );
  await page.getByRole("link", { name: /Define retry behavior/ }).click();
  await page.goto(`${url}/history?view=pulls&pr=${pullRequestId}`);
  await expect(
    page.getByRole("region", { name: "Resulting document diff" }),
  ).toContainText("Reuse the transaction identifier");
  await page
    .getByRole("button", { name: "Request required review", exact: true })
    .click();
  await page.getByRole("option", { name: /Page Reviewer/ }).click();
  await expect(
    page.getByText("Page Reviewer · Required", { exact: true }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page, "page pull request");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Resulting changes", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 900 });
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await signIn(reviewer, seeded.users[1]!.email);
  await reviewer.goto(`${url}/history?view=pulls&pr=${pullRequestId}`);
  await reviewer.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    reviewer.getByText("Page Reviewer: Approved this result", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Merge pull request", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Merge pull request", exact: true })
    .click();
  await expect(page.getByText(/Merged by Page Author/)).toBeVisible();
  await page.goto(`${url}/history`);
  await expect(
    page.getByRole("button", { name: /Published Approved/ }),
  ).toBeVisible();
  await page.goto(url);
  await expect(
    page.getByText("Reuse the transaction identifier after a timeout.", {
      exact: true,
    }),
  ).toBeVisible();
  await reviewerContext.close();
});

test("direct page: restoring an old version creates a new published commit", async ({
  page,
}) => {
  await signIn(page, seeded.owner.email);
  const spaceId = crypto.randomUUID(),
    pageId = crypto.randomUUID();
  const slug = `direct-${pageId.slice(0, 8)}`;
  await capability(page, "createSpace", {
    spaceId,
    name: "Direct handbook",
    slug,
  });
  await capability(page, "createPage", {
    spaceId,
    pageId,
    title: "Original title",
  });
  const url = `/${seeded.slug}/spaces/${slug}/pages/${pageId}`;
  const pullRequestId = crypto.randomUUID();
  await capability(page, "proposePageChange", {
    pageId,
    branchId: crypto.randomUUID(),
    pullRequestId,
    title: "New title",
    markdown: "New instructions",
    message: "Update instructions",
  });
  await page.goto(`${url}/history?view=pulls&pr=${pullRequestId}`);
  await page
    .getByRole("button", { name: "Merge pull request", exact: true })
    .click();
  await expect(page.getByText(/Merged by/)).toBeVisible();
  await page.goto(`${url}/history`);
  await page.getByRole("button", { name: /Original title/ }).click();
  await page
    .getByRole("button", { name: "Restore this version", exact: true })
    .click();
  // A different session moves main after the person opened the confirmation.
  const concurrentPr = crypto.randomUUID();
  await capability(page, "proposePageChange", {
    pageId,
    branchId: crypto.randomUUID(),
    pullRequestId: concurrentPr,
    title: "Concurrent title",
    markdown: "New concurrent instructions",
    message: "Concurrent publication",
  });
  const inspected = await capability<{
    ours: { headCommitId: string };
    theirs: { headCommitId: string };
  }>(page, "previewPageMerge", { pullRequestId: concurrentPr });
  await seeded.command({
    type: "mergePagePullRequest",
    pullRequestId: concurrentPr,
    inspectedSourceHead: inspected.ours.headCommitId,
    inspectedTargetHead: inspected.theirs.headCommitId,
  });
  await expect(
    page.getByRole("heading", { level: 1, name: /Concurrent title/ }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore version", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "changed since you looked at it",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore this version", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restore version", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Original title", exact: true }),
  ).toBeVisible();
});

test("sync overlapping changes explicitly before merging the remaining proposal", async ({
  page,
}) => {
  await signIn(page, seeded.owner.email);
  const spaceId = crypto.randomUUID(),
    pageId = crypto.randomUUID();
  const slug = `conflict-${pageId.slice(0, 8)}`;
  await capability(page, "createSpace", {
    spaceId,
    name: "Conflict handbook",
    slug,
  });
  await capability(page, "createPage", {
    spaceId,
    pageId,
    title: "Retry policy",
  });
  const url = `/${seeded.slug}/spaces/${slug}/pages/${pageId}`;
  const blockId = crypto.randomUUID();
  const auditBlockId = crypto.randomUUID();
  const document = (text: string, extra = false) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: blockId },
        content: [{ type: "text", text }],
      },
      {
        type: "paragraph",
        attrs: { id: auditBlockId },
        content: [
          {
            type: "text",
            text: extra ? "Keep the audit trail." : "Record audit events.",
          },
        ],
      },
    ],
  });
  const propose = async (text: string, extra = false) => {
    const branchId = crypto.randomUUID(),
      pullRequestId = crypto.randomUUID();
    await capability(page, "proposePageChange", {
      pageId,
      branchId,
      pullRequestId,
      title: "Retry policy",
      content: document(text, extra),
      message: text,
    });
    return { branchId, pullRequestId };
  };
  const merge = async (pullRequestId: string) => {
    await page.goto(`${url}/history?view=pulls&pr=${pullRequestId}`);
    await page
      .getByRole("button", { name: "Merge pull request", exact: true })
      .click();
    await expect(page.getByText(/Merged by/)).toBeVisible();
  };
  await merge((await propose("Original retry policy")).pullRequestId);
  const first = await propose("Retry once.");
  const second = await propose("Retry twice.", true);
  await merge(first.pullRequestId);
  await page.goto(`${url}/history?view=pulls&pr=${second.pullRequestId}`);
  await page
    .getByRole("button", { name: "Resolve conflicts", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Retry twice.", { exact: true })).toBeVisible();
  await dialog.getByLabel("Use theirs", { exact: true }).check();
  await expectNoAccessibilityViolations(page, "page conflict resolution");
  await dialog
    .getByRole("button", { name: "Sync branch", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Merge pull request", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Merge pull request", exact: true })
    .click();
  await expect(page.getByText(/Merged by/)).toBeVisible();
  await page.goto(url);
  await expect(page.getByText("Retry once.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Keep the audit trail.", { exact: true }),
  ).toBeVisible();
});
