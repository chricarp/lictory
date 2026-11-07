import { test, expect, type Page } from "@playwright/test";
import {
  FAKE_JIRA_CREDENTIAL,
  FAKE_JIRA_SITE,
} from "../../scripts/e2e-fakes/jira";
import { clientAddress } from "../helpers/client-address";
import {
  capability,
  createPage,
  createSpace,
  itemRef,
  knowledgeSection,
  paragraph,
  text,
} from "../helpers/knowledge";
import {
  currentRevision,
  newPerson,
  seedItem,
  seedWorkspace,
  signIn,
} from "../helpers/seed";

// The page-to-work loop in a project that hands work off to Jira
// (docs/internals/knowledge-links.md, docs/internals/delivery.md#external-delivery),
// against the browser suite's stand-in for a Jira Cloud site
// (scripts/e2e-fakes/jira.ts, through the real Jira adapter): the
// specification cites a page at the version it was read, is approved and
// handed off; a lost answer to the issue create is retried without a second
// issue; Jira moves the issue and Lictory reads its status and assignee back
// into every place that shows the item, never offering native iteration
// controls; the page update is proposed from the item, reviewed from the
// Inbox and merged, and the item still cites the exact version it read.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

// The people working in Jira (the fake's own side).
const jira = async (path: string, body?: unknown) => {
  const response = await fetch(`${process.env.E2E_FAKE_JIRA_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, await response.clone().text()).toBeTruthy();
  return response.status === 204 ? null : ((await response.json()) as unknown);
};
type JiraIssue = {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  lictoryItemId: string | null;
};

const liveEditor = (page: Page) =>
  page.locator('.page-document[contenteditable="true"]');

test("a cited page leads to work handed off to Jira, whose status shows everywhere, and the page update is proposed back", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const seeded = await seedWorkspace({
    name: "Handoff loop",
    key: "HAND",
    users: ["Ada Owner", "Ben Engineer"],
    disciplines: { 1: "Engineering" },
    settings: { deliveryMode: "external" },
  });
  const jiraKey = `J${crypto
    .randomUUID()
    .replaceAll(/[^a-f]/g, "")
    .slice(0, 5)
    .toUpperCase()}X`;
  await jira("/__fake/projects", { key: jiraKey, name: "Payments delivery" });

  // Setup: the item, the runbook that mentions it (and lists the work it
  // references), and a specification citing the runbook's first version.
  const itemId = await seedItem(seeded, {
    title: "Second approver for large refunds",
  });
  const key = "HAND-1";
  const ops = await createSpace(seeded, "Payments runbooks", {
    publishing: "reviewed",
  });
  const runbook = await createPage(seeded, ops, "Refund runbook", [
    paragraph(
      "rule",
      text("Refunds above 500 EUR need a second approver from finance."),
    ),
    paragraph("owner", text("Tracked in "), itemRef(itemId, key), text(".")),
    { type: "workList", attrs: { id: "referenced", filter: "referenced" } },
  ]);
  const first = await currentRevision(itemId);
  await seeded.command({
    type: "updateSpecification",
    workItemId: itemId,
    baseRevisionId: first.id,
    title: "Second approver for large refunds",
    content: `# Behavior\n\nLarge refunds follow [Refund runbook](page:${runbook.pageId}@${runbook.commitId}).\n\n## Acceptance criteria\n\n- A refund above 500 EUR waits for a finance approver.`,
  });
  const cited = await currentRevision(itemId);
  const engineering = seeded.roster.disciplines.find(
    (d) => d.projectId === seeded.projectId && d.name === "Engineering",
  )!.id;
  await seeded.command({
    type: "requestReview",
    workItemId: itemId,
    baseRevisionId: cited.id,
    reviewId: crypto.randomUUID(),
    disciplineId: engineering,
    userId: seeded.users[1]!.id,
    required: true,
  });

  const ada = await newPerson(browser);
  const ben = await newPerson(browser);
  try {
    await signIn(ada.page, seeded.owner.email);
    await signIn(ben.page, seeded.users[1]!.email);

    // Setup: an administrator connects the Jira site and maps the project.
    await ada.page.goto(`/${seeded.slug}`);
    const { connectionId } = await capability<{ connectionId: string }>(
      ada.page,
      seeded.organizationId,
      "connectDelivery",
      {
        name: "Payments Jira",
        baseUrl: FAKE_JIRA_SITE,
        ...FAKE_JIRA_CREDENTIAL,
      },
    );
    const types = seeded.roster.types;
    const jiraType: Record<string, string> = {
      Epic: "10000",
      Story: "10001",
      Task: "10002",
      Bug: "10002",
      Subtask: "10003",
    };
    await capability(ada.page, seeded.organizationId, "setDeliveryTarget", {
      connectionId,
      projectId: seeded.projectId,
      projectKey: jiraKey,
      typeMapping: Object.fromEntries(
        types
          .filter((t) => jiraType[t.name])
          .map((t) => [t.id, jiraType[t.name]!]),
      ),
    });

    // 1. Engineering approves the revision that cites the page.
    await ben.page.goto(seeded.itemPath(1));
    await ben.page
      .getByRole("list", { name: "Requested reviews" })
      .getByRole("button", { name: `Approve revision ${cited.number}` })
      .click();
    await expect(
      ben.page
        .getByRole("list", { name: "Requested reviews" })
        .getByText("Approved", { exact: true }),
    ).toBeVisible();

    // 2. Hand-off: the answer to the issue create is lost (the issue exists
    // in Jira); retrying adopts that issue instead of creating a second one.
    await jira(`/__fake/projects/${jiraKey}/lose-next-create`, {});
    await ada.page.goto(seeded.projectPath("/handoff"));
    const ready = ada.page.getByRole("region", { name: "Ready to hand off" });
    await expect(ready).toContainText("Second approver for large refunds");
    await ready.getByRole("button", { name: "Hand off", exact: true }).click();
    const exportDialog = ada.page.getByRole("dialog", {
      name: "Export to Jira",
    });
    await exportDialog
      .getByRole("button", { name: "Export 1 item", exact: true })
      .click();
    await expect(exportDialog).toContainText("1 failed", { timeout: 30_000 });
    await expect(exportDialog).toContainText(
      "Jira returned an error (502). Try again later.",
    );
    await exportDialog
      .getByRole("button", { name: "Retry 1 item", exact: true })
      .click();
    await expect(exportDialog).toContainText(`Created ${jiraKey}-1`, {
      timeout: 30_000,
    });
    await exportDialog.getByRole("button", { name: "Done" }).click();
    const issues = (await jira(
      `/__fake/issues?project=${jiraKey}`,
    )) as JiraIssue[];
    expect(issues).toEqual([
      expect.objectContaining({
        key: `${jiraKey}-1`,
        summary: "Second approver for large refunds",
        lictoryItemId: itemId,
      }),
    ]);

    // 3. Work moves in Jira; Lictory reads it back on request.
    await jira(`/__fake/issues/${jiraKey}-1/progress`, {
      status: "In Review",
      category: "indeterminate",
      assignee: "Jo Jira",
    });
    await ada.page
      .getByRole("button", { name: "Refresh from Jira", exact: true })
      .click();
    await expect(
      ada.page.getByText("1 issue refreshed from Jira."),
    ).toBeVisible();

    // 4. The item: Jira's status and assignee, no native delivery controls.
    await ada.page.goto(seeded.itemPath(1));
    await expect(ada.page.getByText(`${jiraKey}-1`).first()).toBeVisible();
    await expect(ada.page.getByText("In Review").first()).toBeVisible();
    await expect(ada.page.getByText("Assignee in Jira:")).toContainText(
      "Jo Jira",
    );
    await expect(
      ada.page.getByRole("button", { name: /^Iteration:/ }),
    ).toHaveCount(0);
    await expect(
      knowledgeSection(ada.page)
        .getByRole("listitem")
        .filter({ hasText: "Refund runbook" }),
    ).toContainText(`Revision ${cited.number} cites v1`);

    // 5. The page: its chip card, the work list block and "Work on this
    // page" say what Jira says, with no iteration.
    await ada.page.goto(runbook.url);
    const content = ada.page.getByRole("document", { name: /content/ });
    const chip = content.locator('[data-reference="item"]').first();
    await expect(chip).toContainText("Second approver for large refunds");
    await chip.focus();
    const card = ada.page.getByRole("tooltip");
    await expect(card).toContainText("In Review in Jira");
    await expect(card).toContainText("Jo Jira");
    await expect(card).not.toContainText(/Sprint|Cycle|Iteration/);
    await ada.page.keyboard.press("Escape");
    const list = ada.page
      .getByTestId("work-list")
      .filter({ hasText: "Work referenced on this page" });
    await expect(list.locator(`[data-work-row="${key}"]`)).toContainText(
      "In Review in Jira",
    );
    const work = ada.page.getByTestId("page-work");
    await expect(work.locator(`[data-work-row="${key}"]`)).toContainText(
      "In Review in Jira",
    );
    await expect(work).not.toContainText("Not handed off");

    // 6. The page update is proposed from the item.
    await ada.page.goto(seeded.itemPath(1));
    await knowledgeSection(ada.page)
      .getByRole("button", { name: "Propose page update" })
      .click();
    const propose = ada.page.getByRole("dialog");
    await propose.getByRole("option", { name: /Refund runbook/ }).click();
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

    // Its pull request, with Engineering as the required reviewer.
    await ada.page.goto(`${runbook.url}/history?view=pulls`);
    // Its title is the change named when the branch was opened.
    await ada.page.getByLabel("Source branch").selectOption(branchId);
    await expect(ada.page.getByLabel("Title", { exact: true })).toHaveValue(
      "Document the finance approval time",
    );
    await ada.page
      .getByRole("button", { name: "Create pull request", exact: true })
      .click();
    await expect(ada.page).toHaveURL(/[?&]pr=/);
    await ada.page
      .getByRole("button", { name: "Request required review", exact: true })
      .click();
    await ada.page.getByRole("option", { name: /Ben Engineer/ }).click();

    // 7. The reviewer finds it in Inbox To do and approves it.
    await ben.page.goto(`/${seeded.slug}/inbox?view=todo`);
    const request = ben.page.getByRole("link", { name: /Review requested/ });
    await expect(request).toContainText("Refund runbook");
    await expect(request).toContainText("Document the finance approval time");
    await request.click();
    await ben.page
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(
      ben.page
        .getByRole("complementary", { name: "Review summary" })
        .getByText("Approved", { exact: true }),
    ).toBeVisible();

    // 8. The author merges it.
    await ada.page.reload();
    await ada.page
      .getByRole("button", { name: "Merge pull request…", exact: true })
      .click();
    await ada.page
      .getByRole("group", { name: "Confirm merge" })
      .getByRole("button", { name: "Confirm merge", exact: true })
      .click();
    await expect(ada.page.getByText(/Merged by/)).toBeVisible();

    // 9. The item shows the merged change, still cites the exact version it
    // read, and Jira still owns its delivery status.
    await ada.page.goto(seeded.itemPath(1));
    const proposed = knowledgeSection(ada.page)
      .getByRole("listitem")
      .filter({ hasText: "Refund runbook" })
      .filter({ hasText: "branch" });
    await expect(proposed).toContainText("Merged");
    const row = knowledgeSection(ada.page)
      .getByRole("listitem")
      .filter({ hasText: `Revision ${cited.number} cites v1` });
    await expect(row).toContainText("Newer version v2 published");
    await expect(
      row.getByRole("link", { name: /^v1\W+open version 1/ }),
    ).toHaveAttribute(
      "href",
      new RegExp(`/pages/${runbook.pageId}\\?commit=${runbook.commitId}$`),
    );
    await expect(ada.page.getByText("In Review").first()).toBeVisible();
    await expect(
      ada.page.getByRole("button", { name: /^Iteration:/ }),
    ).toHaveCount(0);
    // Nothing was handed off twice.
    expect(await jira(`/__fake/issues?project=${jiraKey}`)).toHaveLength(1);
  } finally {
    await Promise.all([ada.context.close(), ben.context.close()]);
  }
});
