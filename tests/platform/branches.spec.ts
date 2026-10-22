import { test, expect, type Page } from "@playwright/test";
import { consentStatePath } from "../consent-setup";
import { reloadWhenSaved, waitUntilSaved } from "../helpers/sync-helpers";
import { controlZeroConnection } from "../helpers/zero-socket";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory, executeMutation } from "@lictory/core/domain/service";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { inApp } from "../helpers/app-urls";

const password = "Branch-test-password-123!";
// A retry runs in a new worker that seeds again; each worker gets its own users.
const run = crypto.randomUUID().slice(0, 8);
const authorEmail = `branch-author-${run}@example.test`;
const reviewerEmail = `branch-reviewer-${run}@example.test`;
let itemUrl: string;
let workItemId: string;
const initial =
  "# Behavior\n\nRetries reuse the transaction ID.\n\n## Acceptance criteria\n\n- [ ] Late responses return within 60 seconds.";
const integration = initial.replace(
  "the transaction ID",
  "a stable transaction ID",
);

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client, { schema: s });
    const authorId = crypto.randomUUID();
    const reviewerId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const slug = `branches-${organizationId.slice(0, 8)}`;
    const hash = await hashPassword(password);
    for (const [id, name, email, handle] of [
      [authorId, "Branch Author", authorEmail, `branch_author_${run}`],
      [reviewerId, "Branch QA", reviewerEmail, `branch_qa_${run}`],
    ]) {
      await db.insert(s.user).values({
        id: id!,
        name: name!,
        email: email!,
        handle,
        emailVerified: true,
      });
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: id!,
        accountId: id!,
        providerId: "credential",
        password: hash,
      });
    }
    await db.insert(s.organization).values({
      id: organizationId,
      name: "Branch regressions",
      slug,
      createdAt: new Date(),
    });
    await db.insert(s.member).values([
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: authorId,
        role: "owner",
        createdAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: reviewerId,
        role: "member",
        createdAt: new Date(),
      },
    ]);
    await seedOrganization(db, organizationId);
    const command = (command: Command) =>
      executeMutation(
        db,
        { userId: authorId },
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command,
        },
      );
    await command({
      type: "createProject",
      projectId,
      name: "Branch scenarios",
      key: "BRN",
    });
    const roster = await directory(db, authorId, organizationId);
    await command({
      type: "setDisciplineMember",
      projectId,
      disciplineId: roster.disciplines.find((d) => d.name === "QA")!.id,
      userId: reviewerId,
      member: true,
    });
    await command({
      type: "updateProject",
      projectId,
      readinessPolicy: "block",
    });
    workItemId = crypto.randomUUID();
    await command({
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: roster.types.find((t) => t.name === "Story")!.id,
      parentId: null,
      title: "Retry policy",
      description: initial,
    });
    itemUrl = `/${slug}/brn/stories/BRN-1`;
  } finally {
    await client.end();
  }
});

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);
}
async function commit(page: Page, content: string, message: string) {
  await page
    .getByRole("textbox", { name: "Branch specification" })
    .fill(content);
  await page.getByRole("textbox", { name: "Commit message" }).fill(message);
  await page
    .getByRole("button", { name: "Commit changes", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Commit message" }),
  ).toHaveValue("");
}
async function createBranch(page: Page, name: string, from?: string) {
  await page.goto(itemUrl + "?branches=1");
  const source = page.getByRole("combobox", {
    name: "Branch from",
    exact: true,
  });
  await expect(source).toHaveText("main");
  await expect(source).toHaveCSS("height", "32px");
  await expect(
    page.getByRole("textbox", { name: "New branch name" }),
  ).toHaveCSS("height", "32px");
  const switcher = page.getByRole("combobox", { name: "Switch branch" });
  await expect(switcher).toHaveCSS("height", "32px");
  await expect(switcher).toHaveCSS(
    "border-radius",
    await page
      .getByRole("button", { name: "Create branch", exact: true })
      .evaluate((button) => getComputedStyle(button).borderRadius),
  );
  await source.click();
  await page.screenshot({ path: "/tmp/lictory-select-branch-overview.png" });
  await page.keyboard.press("Escape");
  await expect(source).toBeFocused();
  await page.getByRole("textbox", { name: "New branch name" }).fill(name);
  expect(
    await page
      .getByRole("textbox", { name: "New branch name" })
      .evaluate((e: HTMLInputElement) => e.checkValidity()),
  ).toBe(true);
  if (from) {
    await page
      .getByRole("combobox", { name: "Branch from", exact: true })
      .click();
    await page.getByRole("option", { name: from, exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  await expect(page).toHaveURL(/\?branch=/);
  await expect(
    page.getByRole("textbox", { name: "Branch specification" }),
  ).toBeVisible();
  return page.url();
}
async function openPR(
  page: Page,
  title: string,
  targetName = "integration/retries",
) {
  await page
    .getByRole("button", { name: "Open pull request", exact: true })
    .click();
  const target = page.getByRole("combobox", { name: "PR target branch" });
  await expect(target).toHaveText("main");
  await target.click();
  await page.getByRole("option", { name: targetName, exact: true }).click();
  await page.getByRole("textbox", { name: "Pull request title" }).fill(title);
  await page
    .getByRole("textbox", { name: "Pull request description" })
    .fill("Review the resulting retry policy.");
  await page
    .getByRole("button", { name: "Create pull request", exact: true })
    .click();
  await expect(page).toHaveURL(/\?pr=/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  return page.url();
}

test("readiness is checked before queueing, with one toast per attempt and none after refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.183" });
  await signIn(page, authorEmail);
  // Routes apply to connections opened afterwards: observe from page load.
  const zero = await controlZeroConnection(page);
  await page.goto(itemUrl);
  const properties = page
    .getByRole("heading", { name: "Properties", exact: true })
    .locator("..");
  await expect(properties).toBeVisible();
  const statusRequests = () =>
    zero
      .commands()
      .filter((c) => c.type === "updateWorkItem" && c.statusId !== undefined);
  await properties
    .getByRole("button", { name: "Status: Backlog", exact: true })
    .click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  await expect(
    page.locator('[data-slot="toast"]', { hasText: "Change not applied" }),
  ).toContainText("BRN-1 is not ready to start:");
  const notification = page.locator('[data-slot="toast"]', {
    hasText: "Change not applied",
  });
  await notification.hover();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const theme = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--popover)";
    probe.style.color = "var(--popover-foreground)";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const result = {
      background: style.backgroundColor,
      foreground: style.color,
    };
    probe.remove();
    return result;
  });
  await expect(notification).toHaveCSS("background-color", theme.background);
  await expect(notification).toHaveCSS("color", theme.foreground);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await expect(notification).not.toHaveCSS(
    "background-color",
    theme.background,
  );
  await expect(notification).not.toHaveCSS("color", theme.foreground);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(notification).toHaveCSS("background-color", theme.background);
  const desktopToast = await notification.boundingBox();
  expect(desktopToast!.x + desktopToast!.width).toBeCloseTo(1440 - 16, 0);
  await notification
    .getByRole("button", { name: "Close toast", exact: true })
    .click();
  await expect(notification).toHaveCount(0);
  await properties
    .getByRole("button", { name: "Status: Backlog", exact: true })
    .click();
  await page.getByRole("option", { name: /^In Progress/ }).click();
  await expect(notification).toHaveCount(1);
  await expect(notification).toBeVisible();
  await notification.hover();
  await expect(notification).toContainText("BRN-1 is not ready to start:");
  await notification
    .getByRole("button", { name: "Close toast", exact: true })
    .click();
  await expect(notification).toBeHidden();
  expect(statusRequests()).toHaveLength(0);

  await expect(
    properties.getByRole("button", { name: "Status: Backlog", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Everything is saved", exact: true })
    .click();
  const syncDialog = page.getByRole("dialog", { name: "Workspace sync" });
  await expect(syncDialog).toContainText("Your workspace is up to date");
  await expect(
    syncDialog.getByText(/BRN-1 is not ready to start:/),
  ).toBeHidden();
  await expect(syncDialog.getByText("Technical details")).toBeHidden();
  await expect(
    syncDialog.getByRole("button", { name: "Discard", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Priority: No priority", exact: true })
    .click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  await expect(
    page.getByText("set priority to", { exact: false }),
  ).toBeVisible();
  await reloadWhenSaved(page);
  await expect(
    page.getByRole("button", { name: "Priority: High", exact: true }),
  ).toBeVisible();
  await expect(
    properties.getByRole("button", { name: "Status: Backlog", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Everything is saved", exact: true })
    .click();
  await expect(syncDialog).toContainText("Your workspace is up to date");
  await expect(notification).toHaveCount(0);
  expect(statusRequests()).toHaveLength(0);
  await expect(
    syncDialog.getByText(/BRN-1 is not ready to start:/),
  ).toBeHidden();
  await page.keyboard.press("Escape");
});

test("a handled server rejection is forgotten and never replays its toast after refresh", async ({
  page,
}) => {
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.185" });
  await signIn(page, authorEmail);
  // Mutations travel over Zero's connection. Pointing the "urgent" change at
  // an item that does not exist makes the server reject it definitively,
  // exactly like a domain rejection of the real item. Routes apply to
  // connections opened afterwards, so the proxy is installed before loading.
  let rejectedId: string | undefined;
  let attempts = 0;
  const zero = await controlZeroConnection(page);
  await page.goto(itemUrl);
  const properties = page
    .getByRole("heading", { name: "Properties", exact: true })
    .locator("..");
  await expect(properties).toBeVisible();
  zero.rewrite((mutation) => {
    if (
      mutation.command.type === "updateWorkItem" &&
      mutation.command.priority === "urgent"
    ) {
      attempts++;
      rejectedId = mutation.id;
      mutation.command.workItemId = crypto.randomUUID();
    }
  });
  await properties
    .getByRole("button", { name: "Priority: High", exact: true })
    .click();
  await page.getByRole("option", { name: "Urgent", exact: true }).click();
  const notification = page.locator('[data-slot="toast"]', {
    hasText: "Change not applied",
  });
  await expect(notification).toHaveCount(1);
  await expect(
    properties.getByRole("button", { name: "Priority: High", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Everything is saved", exact: true }),
  ).toBeVisible();
  // Nothing about the rejected change is kept: a property change carries no
  // authored text to recover.
  expect(rejectedId).toBeDefined();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("lictory:recovery:"),
      ),
    ),
  ).toEqual([]);
  await page.reload();
  await expect(
    properties.getByRole("button", { name: "Priority: High", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Everything is saved", exact: true }),
  ).toBeVisible();
  await expect(notification).toHaveCount(0);
  expect(attempts).toBe(1);
  await properties
    .getByRole("button", { name: "Priority: High", exact: true })
    .click();
  await page.getByRole("option", { name: "Medium", exact: true }).click();
  await expect(
    page.getByText("set priority to", { exact: false }).last(),
  ).toBeVisible();
  await reloadWhenSaved(page);
  await expect(
    properties.getByRole("button", { name: "Priority: Medium", exact: true }),
  ).toBeVisible();
});

test("workspace sync explains automatic recovery and resumes when the connection returns", async ({
  page,
}) => {
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.184" });
  const zero = await controlZeroConnection(page);
  await signIn(page, authorEmail);
  await page.goto(itemUrl);
  const properties = page
    .getByRole("heading", { name: "Properties", exact: true })
    .locator("..");
  // Property controls are offered once the item's own rows have loaded.
  await expect(
    properties.getByRole("button", { name: /^Priority:/ }),
  ).toBeVisible();
  await waitUntilSaved(page);
  await zero.interrupt();
  await properties.getByRole("button", { name: /^Priority:/ }).click();
  await page.getByRole("option", { name: "Low", exact: true }).click();
  // Applied here at once, sent when the connection is back.
  await expect(
    properties.getByRole("button", { name: "Priority: Low", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reconnecting…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Workspace sync" });
  await expect(dialog).toContainText("trying again automatically");
  await expect(dialog).toContainText("1 change is waiting to be saved");
  await dialog.getByText("Technical details", { exact: true }).click();
  await expect(dialog).toContainText("The connection was interrupted");
  zero.restore();
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(dialog).toContainText("Everything is saved");
  await expect(dialog.getByText("Technical details")).toBeHidden();
  // Sent once, however often the connection was retried.
  expect(
    new Set(
      zero.pushed.filter((m) => m.command.priority === "low").map((m) => m.id),
    ).size,
  ).toBe(1);
  await page.keyboard.press("Escape");
  await reloadWhenSaved(page);
  await expect(
    properties.getByRole("button", { name: "Priority: Low", exact: true }),
  ).toBeVisible();
});

test("nested PRs preserve main, require review on conflicts, and support keeping or discarding complete snapshots", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.181" });
  await signIn(page, authorEmail);
  const parent = await createBranch(page, "integration/retries");
  await commit(page, integration, "Define stable retry IDs");
  const child = await createBranch(page, "qa/criterion", "integration/retries");
  await expect(
    page.getByRole("textbox", { name: "Branch specification" }),
  ).toHaveValue(integration);
  await commit(
    page,
    integration.replace("60 seconds", "30 seconds"),
    "Tighten timeout criterion",
  );
  const pr = await openPR(page, "Review tighter criterion");
  await page.getByRole("combobox", { name: "PR reviewing discipline" }).click();
  await page.getByRole("option", { name: "QA", exact: true }).click();
  await page
    .getByRole("button", { name: "Request required review", exact: true })
    .click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "QA approval is pending or stale." }),
  ).toBeVisible();
  const reviewerContext = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "192.0.2.182" },
    storageState: consentStatePath,
  });
  try {
    const reviewer = await reviewerContext.newPage();
    await signIn(reviewer, reviewerEmail);
    await reviewer.goto(pr);
    await reviewer
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(page.getByText("Decision by Branch QA")).toBeVisible();
    await page.goto(parent);
    await commit(
      page,
      integration.replace("60 seconds", "45 seconds"),
      "Concurrent target change",
    );
    await page.goto(pr);
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "The branches have merge conflicts." }),
    ).toBeVisible();
    await expect(
      page.getByText("Review required again", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Resolve conflicts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Keep all my changes", exact: true })
      .click();
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "The branches have merge conflicts." }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Merge pull request", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Merge pull request", exact: true })
      .click();
    await expect(
      page.getByText("Merged. The reviewed content is recorded", {
        exact: false,
      }),
    ).toBeVisible();
    await page.goto(parent);
    await expect(
      page.getByRole("textbox", { name: "Branch specification" }),
    ).toHaveValue(integration.replace("60 seconds", "30 seconds"));
    await expect(
      page.getByRole("button", { name: "Main · revision 1", exact: true }),
    ).toBeVisible();

    const discarded = await createBranch(
      page,
      "qa/discard",
      "integration/retries",
    );
    await commit(
      page,
      integration.replace("60 seconds", "15 seconds"),
      "A conflicting proposal to discard",
    );
    const discardPR = await openPR(page, "Discard conflicting proposal");
    await page.goto(parent);
    await commit(
      page,
      integration.replace("60 seconds", "20 seconds"),
      "Keep target timeout",
    );
    await page.goto(discardPR);
    await page
      .getByRole("button", { name: "Resolve conflicts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard my changes", exact: true })
      .click();
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "This branch has no changes to merge." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Merge pull request", exact: true }),
    ).toBeDisabled();
    await page.goto(discarded);
    await expect(
      page.getByRole("textbox", { name: "Branch specification" }),
    ).toHaveValue(integration.replace("60 seconds", "20 seconds"));
    await page.goto(discardPR);
    await page
      .getByRole("button", { name: "Delete pull request", exact: true })
      .click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\?branches=1$/);
    await page.goto(discarded);
    await page
      .getByRole("button", { name: "Delete branch", exact: true })
      .click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\?branches=1$/);
    // A second branch remains useful after its sibling was deleted.
    await page.goto(child);
    await expect(
      page.getByRole("textbox", { name: "Branch specification" }),
    ).toHaveValue(integration.replace("60 seconds", "30 seconds"));
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const db = drizzle(client);
      const revisions = await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, workItemId));
      expect(revisions).toHaveLength(1);
      expect(revisions[0]!.content).toBe(initial);
      const commits = await db
        .select()
        .from(s.specificationCommit)
        .where(eq(s.specificationCommit.workItemId, workItemId));
      expect(
        commits.filter((c) => c.parentIds.length > 1).length,
      ).toBeGreaterThanOrEqual(3);
    } finally {
      await client.end();
    }
    // Only a successful merge into main automatically removes the source.
    await page.goto(parent);
    const mainPR = await openPR(page, "Approve retry policy", "main");
    await expect(
      page.getByRole("button", { name: "Merge pull request", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("combobox", { name: "PR reviewing discipline" })
      .click();
    await page.getByRole("option", { name: "QA", exact: true }).click();
    await page
      .getByRole("button", { name: "Request required review", exact: true })
      .click();
    await reviewer.goto(mainPR);
    await reviewer
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Merge pull request", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Merge pull request", exact: true })
      .click();
    const deletion = page.getByRole("listitem").filter({
      hasText:
        "Lictory automatically deleted branch integration/retries after its pull request was merged into main",
    });
    await expect(deletion).toHaveCount(1);
    await expect(
      reviewer.getByRole("listitem").filter({
        hasText: "Lictory automatically deleted branch integration/retries",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Merged. The reviewed content is recorded", {
        exact: false,
      }),
    ).toContainText(
      "Lictory automatically deleted branch integration/retries.",
    );
    await page.reload();
    await expect(deletion).toHaveCount(1);
    await page.getByRole("combobox", { name: "Switch branch" }).click();
    await expect(
      page.getByRole("option", { name: "integration/retries", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: /^Commits/ }).click();
    await expect(
      page.getByText("Keep target timeout", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /^Conversation/ }).click();
    await deletion.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "/tmp/lictory-auto-delete-merged-branch.png",
      fullPage: true,
    });
    await page.goto(child);
    await expect(
      page.getByRole("textbox", { name: "Branch specification" }),
    ).toBeVisible();
  } finally {
    await reviewerContext.close();
  }
});
