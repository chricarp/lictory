import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { seedDefaultRoles } from "../src/sync/server/roles";
import { createSyncService, directory } from "../src/sync/server/service";
import { PROTOCOL, type Command } from "../src/sync/shared/protocol";

const password = "Branch-test-password-123!";
const authorEmail = "branch-author@example.test";
const reviewerEmail = "branch-reviewer@example.test";
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
      [authorId, "Branch Author", authorEmail, "branch_author"],
      [reviewerId, "Branch QA", reviewerEmail, "branch_qa"],
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
    await seedDefaultRoles(db, organizationId, authorId);
    const [qa] = await db
      .select()
      .from(s.organizationRole)
      .where(
        and(
          eq(s.organizationRole.organizationId, organizationId),
          eq(s.organizationRole.name, "QA"),
        ),
      );
    await db
      .insert(s.organizationRoleMember)
      .values({ organizationId, roleId: qa!.id, userId: reviewerId });
    const service = createSyncService(db);
    const command = (command: Command) =>
      service.mutate(authorId, {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command,
      });
    await command({
      type: "createProject",
      projectId,
      name: "Branch scenarios",
      key: "BRN",
    });
    const roster = await directory(db, authorId, organizationId);
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
    itemUrl = `/app/${slug}/brn/stories/BRN-1`;
  } finally {
    await client.end();
  }
});

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
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
  await page.getByRole("textbox", { name: "New branch name" }).fill(name);
  expect(
    await page
      .getByRole("textbox", { name: "New branch name" })
      .evaluate((e: HTMLInputElement) => e.checkValidity()),
  ).toBe(true);
  if (from)
    await page
      .getByLabel("Branch from", { exact: true })
      .selectOption({ label: from });
  await page
    .getByRole("button", { name: "Create branch", exact: true })
    .click();
  await expect(page).toHaveURL(/\?branch=/);
  await expect(
    page.getByRole("textbox", { name: "Branch specification" }),
  ).toBeVisible();
  return page.url();
}
async function openPR(page: Page, title: string) {
  await page
    .getByRole("button", { name: "Open pull request", exact: true })
    .click();
  const mainId = await page
    .getByLabel("PR target branch")
    .locator("option", { hasText: /^main$/ })
    .getAttribute("value");
  expect(mainId).not.toBeNull();
  await expect(page.getByLabel("PR target branch")).toHaveValue(mainId!);
  await page
    .getByLabel("PR target branch")
    .selectOption({ label: "integration/retries" });
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
  await page.getByLabel("PR reviewer role").selectOption({ label: "QA" });
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
      .getByRole("button", { name: "Resolve PR conflicts", exact: true })
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
      .getByRole("button", { name: "Resolve PR conflicts", exact: true })
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
  } finally {
    await reviewerContext.close();
  }
});
