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
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { id: "retry-heading", level: 2 },
          content: [{ type: "text", text: "Safe retries" }],
        },
        {
          type: "paragraph",
          attrs: { id: "retry-policy" },
          content: [
            {
              type: "text",
              text: "Reuse the transaction identifier after a timeout.",
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { id: "retry-reference" },
          content: [{ type: "pageRef", attrs: { pageId } }],
        },
      ],
    },
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
  await expect(
    page.getByText("No document changes between these versions."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revoke decision", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Review summary" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request required review", exact: true })
    .click();
  await page.getByRole("option", { name: /Page Reviewer/ }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Review summary" })
      .getByText("Page Reviewer", { exact: true }),
  ).toBeVisible();
  const summary = page.getByRole("complementary", { name: "Review summary" });
  await expect(summary.getByText("Pending", { exact: true })).toBeVisible();
  await expect(summary.getByText(/requested just now/)).toBeVisible();
  await expect(
    page.getByText("After · Proposed", { exact: true }).first(),
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
    reviewer
      .getByRole("complementary", { name: "Review summary" })
      .getByText("Approved", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Merge pull request", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Merge pull request", exact: true })
    .click();
  await expect(page.getByText(/Merged by Page Author/)).toBeVisible();
  await page.goto(`${url}/history`);
  const selectedVersion = page.getByRole("region", {
    name: "Selected version",
  });
  await expect(
    selectedVersion.getByRole("link", { name: "Recovery", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview this version", exact: true })
    .click();
  await expect(selectedVersion.getByRole("document")).toContainText(
    "Reuse the transaction identifier",
  );
  await page.getByRole("button", { name: "View changes", exact: true }).click();
  await expect(
    selectedVersion.getByRole("combobox", { name: "Compare with" }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page, "rendered version comparison");
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
  // On a branch, its own latest version is not offered for restoring; the
  // published version it started from is.
  const branchId = crypto.randomUUID();
  await capability(page, "proposePageChange", {
    pageId,
    branchId,
    pullRequestId: crypto.randomUUID(),
    title: "Branch title",
    markdown: "Branch instructions",
    message: "Branch proposal",
  });
  await page.goto(`${url}/history?branch=${branchId}`);
  const selected = page.getByRole("region", { name: "Selected version" });
  await expect(selected.getByRole("heading", { level: 2 })).toContainText(
    "Branch proposal",
  );
  await expect(
    page.getByRole("button", { name: "Restore this version", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Restore the version of/ }).click();
  await expect(selected.getByRole("heading", { level: 2 })).toContainText(
    "Restore the version of",
  );
  await expect(
    page.getByRole("button", { name: "Restore this version", exact: true }),
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

test("the comments count and panel follow the branch on screen and point to other branches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await signIn(page, seeded.owner.email);
  const spaceId = crypto.randomUUID(),
    pageId = crypto.randomUUID();
  const slug = `threads-${pageId.slice(0, 8)}`;
  await capability(page, "createSpace", {
    spaceId,
    name: "Threaded handbook",
    slug,
  });
  await capability(page, "createPage", { spaceId, pageId, title: "Timeouts" });
  const url = `/${seeded.slug}/spaces/${slug}/pages/${pageId}`;
  const branchId = crypto.randomUUID(),
    pullRequestId = crypto.randomUUID();
  await capability(page, "proposePageChange", {
    pageId,
    branchId,
    pullRequestId,
    branchName: "timeout-notes",
    title: "Timeouts",
    markdown: "Give up after thirty seconds.",
    message: "Propose a timeout",
  });
  const discuss = (
    body: string,
    extra: { branchId?: string; pullRequestId?: string; blocking?: boolean },
  ) => {
    const threadId = crypto.randomUUID();
    return seeded
      .command({
        type: "createPageThread",
        pageId,
        threadId,
        messageId: crypto.randomUUID(),
        anchor: { v: 1, kind: "page" },
        body,
        ...extra,
      })
      .then(() => threadId);
  };
  const onMain = await discuss("Main note about retries", {});
  await discuss("Branch note about timeouts", { branchId, blocking: true });
  // A pull request's discussion belongs to the pull request: no line
  // counts or lists it.
  await discuss("Review note on the pull request", { branchId, pullRequestId });

  const toggle = page.getByRole("button", { name: /^Comments:/ });
  const panel = page.getByRole("complementary", { name: "Page comments" });
  await page.goto(url);
  // Main counts and lists its own discussion, and opens the panel for it.
  await expect(toggle).toHaveText("1 discussion");
  await expect(toggle).toHaveAccessibleName(
    "Comments: 1 discussion on main, 1 open discussion on other branches",
  );
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    panel.getByRole("heading", { name: "Comments on main" }),
  ).toBeVisible();
  await expect(panel.getByText("Main note about retries")).toBeVisible();
  await expect(panel.getByText("Branch note about timeouts")).toHaveCount(0);
  await expect(panel.getByText("Review note on the pull request")).toHaveCount(
    0,
  );
  const toBranch = panel.getByRole("button", {
    name: "Show 1 open discussion (1 blocking) on timeout-notes",
  });
  await expect(toBranch).toBeVisible();

  // Resolving main's discussion empties main truthfully, without hiding
  // where the remaining discussion is.
  await seeded.command({ type: "resolvePageThread", threadId: onMain });
  await expect(toggle).toHaveText("Comments");
  await expect(toggle).toHaveAccessibleName(
    "Comments: No open discussions on main, 1 open discussion on other branches",
  );
  await expect(panel.getByText(/^No open discussions on main\./)).toBeVisible();
  await expect(panel.getByText("Show 1 resolved")).toBeVisible();
  await expectNoAccessibilityViolations(page, "page comments on main");

  // Switching from the panel moves the count and the list together.
  await toBranch.click();
  await expect(page).toHaveURL(new RegExp(`[?&]branch=${branchId}`));
  const heading = panel.getByRole("heading", {
    name: "Comments on timeout-notes",
  });
  await expect(heading).toBeFocused();
  await expect(toggle).toHaveText("1 discussion");
  await expect(toggle).toHaveAccessibleName(
    /^Comments: 1 discussion on timeout-notes, 1 blocking/,
  );
  await expect(panel.getByText("Branch note about timeouts")).toBeVisible();
  await expect(panel.getByText("Main note about retries")).toHaveCount(0);
  await expect(panel.getByText("Review note on the pull request")).toHaveCount(
    0,
  );
  await expect(panel.getByText("On other branches")).toHaveCount(0);

  // The branch menu says where discussions are before switching back.
  await page.getByRole("button", { name: "Branch: timeout-notes" }).click();
  const menu = page.getByRole("menu", { name: "Branches of this page" });
  await expect(menu.getByText("1 open discussion")).toBeVisible();
  await menu.getByRole("menuitemradio", { name: /^main/ }).click();
  await expect(page).not.toHaveURL(/[?&]branch=/);
  await expect(toggle).toHaveText("Comments");
  await expect(panel.getByText("Branch note about timeouts")).toHaveCount(0);
  await expect(toBranch).toBeVisible();
});
