import { test, expect, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, desc, eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { paths } from "@lictory/core/lib/paths";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory, executeMutation } from "@lictory/core/domain/service";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { consentStatePath } from "../consent-setup";
import { inApp } from "../helpers/app-urls";
import { useClientAddress } from "../helpers/client-address";

// The recipe from the readiness guide: QA signs off a Story's acceptance
// criteria before it is ready, and a new revision needs a new sign-off.

const password = "Qa-sign-off-password-123!";
// A retry runs in a new worker that seeds again; each worker gets its own users.
const run = crypto.randomUUID().slice(0, 8);
const adminEmail = `qa-signoff-admin-${run}@example.test`;
const qaEmail = `qa-signoff-qa-${run}@example.test`;
let slug: string;
let organizationId: string;
let adminId: string;
let qaId: string;
let qaDisciplineId: string;
let workItemId: string;

const signOffLabel = "Acceptance criteria are complete and testable";
const ready =
  "All checks pass for this revision. The specification is ready for delivery; readiness does not accept, schedule or start the work.";

async function withDb<T>(
  work: (db: ReturnType<typeof drizzle<typeof s>>) => Promise<T>,
) {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await work(drizzle(client, { schema: s }));
  } finally {
    await client.end();
  }
}

const command = (
  db: ReturnType<typeof drizzle<typeof s>>,
  c: Command,
  actor = adminId,
) =>
  executeMutation(
    db,
    { userId: actor },
    { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command: c },
  );

test.beforeAll(async () => {
  await withDb(async (db) => {
    adminId = crypto.randomUUID();
    qaId = crypto.randomUUID();
    organizationId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    slug = `qa-signoff-${organizationId.slice(0, 8)}`;
    const hash = await hashPassword(password);
    for (const [id, name, email, handle] of [
      [adminId, "Ada Admin", adminEmail, `ada_${run}`],
      [qaId, "Quinn QA", qaEmail, `quinn_${run}`],
    ] as const) {
      await db
        .insert(s.user)
        .values({ id, name, email, handle, emailVerified: true });
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hash,
      });
    }
    await db.insert(s.organization).values({
      id: organizationId,
      name: "QA sign-off",
      slug,
      createdAt: new Date(),
    });
    await db.insert(s.member).values([
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: adminId,
        role: "owner",
        createdAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        organizationId,
        userId: qaId,
        role: "member",
        createdAt: new Date(),
      },
    ]);
    await seedOrganization(db, organizationId);
    await command(db, {
      type: "createProject",
      projectId,
      name: "Payments",
      key: "PAY",
    });
    const roster = await directory(db, adminId, organizationId);
    qaDisciplineId = roster.disciplines.find(
      (d) => d.projectId === projectId && d.name === "QA",
    )!.id;
    await command(db, {
      type: "setDisciplineMember",
      projectId,
      disciplineId: qaDisciplineId,
      userId: qaId,
      member: true,
    });
    // PAY-1 has acceptance criteria and no review yet: under Lictory's
    // defaults it is not ready.
    workItemId = crypto.randomUUID();
    await command(db, {
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: roster.types.find((t) => t.name === "Story")!.id,
      parentId: null,
      title: "Partial refunds",
      description:
        "# Behavior\n\nRefund part of a settled payment.\n\n## Acceptance criteria\n\n- [ ] Refunds never exceed the settled amount.",
    });
  });
});

async function signIn(page: Page, email: string) {
  // Its own client address: sign-in is rate limited per address.
  await useClientAddress(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);
}

async function signedIn(browser: Browser, email: string) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: consentStatePath,
  });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

// Ready main is protected, so the next revision arrives through a pull
// request that QA reviews and Ada merges.
async function reviseThroughPullRequest() {
  await withDb(async (db) => {
    const branchOf = (id: string) =>
      db
        .select()
        .from(s.specificationBranch)
        .where(
          and(
            eq(s.specificationBranch.organizationId, organizationId),
            eq(s.specificationBranch.id, id),
          ),
        )
        .then((rows) => rows[0]!);
    const [revision] = await db
      .select()
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.workItemId, workItemId))
      .orderBy(desc(s.specificationRevision.number))
      .limit(1);
    const branchId = crypto.randomUUID();
    await command(db, {
      type: "createBranch",
      workItemId,
      baseRevisionId: revision!.id,
      branchId,
      name: "refund-currency",
    });
    // The first branch command records main.
    const [main] = await db
      .select()
      .from(s.specificationBranch)
      .where(
        and(
          eq(s.specificationBranch.organizationId, organizationId),
          eq(s.specificationBranch.workItemId, workItemId),
          eq(s.specificationBranch.name, "main"),
        ),
      );
    await command(db, {
      type: "commitBranch",
      workItemId,
      branchId,
      baseCommitId: (await branchOf(branchId)).headId,
      title: revision!.title,
      content: `${revision!.content}\n- [ ] Refunds use the currency of the original payment.`,
      message: "Refunds keep the original currency",
    });
    const pullRequestId = crypto.randomUUID();
    await command(db, {
      type: "createPullRequest",
      workItemId,
      pullRequestId,
      sourceId: branchId,
      targetId: main!.id,
      title: "Refund currency",
      description: "Refunds keep the original currency.",
      draft: false,
    });
    await command(db, {
      type: "requestPullRequestReview",
      workItemId,
      pullRequestId,
      disciplineId: qaDisciplineId,
      userId: qaId,
      required: true,
    });
    const [review] = await db
      .select()
      .from(s.pullRequestReview)
      .where(
        and(
          eq(s.pullRequestReview.organizationId, organizationId),
          eq(s.pullRequestReview.pullRequestId, pullRequestId),
        ),
      );
    const heads = {
      sourceHeadId: (await branchOf(branchId)).headId,
      targetHeadId: (await branchOf(main!.id)).headId,
    };
    await command(
      db,
      {
        type: "decidePullRequest",
        workItemId,
        pullRequestId,
        reviewId: review!.id,
        ...heads,
        decision: "approve",
      },
      qaId,
    );
    await command(db, {
      type: "mergePullRequest",
      workItemId,
      pullRequestId,
      ...heads,
    });
  });
}

test("the QA sign-off recipe is published like any change; QA's sign-off makes a Story ready and a new revision needs a new one", async ({
  page,
  browser,
}) => {
  await signIn(page, adminEmail);
  await page.goto(paths.projectSettings(slug, "PAY", "readiness"));
  const card = page.locator("#definition");
  await card.getByRole("tab", { name: "Story" }).click();
  await expect(card.getByText("A Story is ready when…")).toBeVisible();

  // QA's sign-off replaces the formal review for Stories in this project.
  await card
    .getByRole("switch", { name: "At least one required review is requested" })
    .click();
  await card
    .getByRole("switch", {
      name: "Every required review approved the current revision",
    })
    .click();
  await card.getByRole("button", { name: "Require QA sign-off" }).click();
  // The recipe edits the draft only: both checks appear as new rules.
  await expect(
    card.getByRole("textbox", { name: "Required section" }),
  ).toHaveValue("Acceptance criteria");
  await expect(
    card.getByRole("textbox", { name: "Sign-off name" }),
  ).toHaveValue(signOffLabel);
  await expect(
    card.getByRole("button", { name: "Anyone with a discipline: QA" }),
  ).toBeVisible();
  await expect(card.getByText("4 changes to Story")).toBeVisible();
  // Applied once, it is not offered again.
  await expect(
    card.getByRole("button", { name: "Require QA sign-off" }),
  ).toHaveCount(0);
  await expect(card.getByText("Version 2 ·")).toHaveCount(0);

  // The preview shows what publishing would do before anything changes.
  await card.getByRole("button", { name: "Review changes…" }).click();
  await expect(card.getByText("Publish version 2?")).toBeVisible();
  await expect(
    card.getByText("Story: It has a non-empty “Acceptance criteria” section"),
  ).toBeVisible();
  await expect(card.getByText(`Story: ${signOffLabel}`)).toBeVisible();
  await expect(card.getByText("will need more work")).toBeVisible();
  await expect(card.getByText(`1 fail “${signOffLabel}”`)).toBeVisible();
  await card
    .getByRole("textbox", { name: "Change summary" })
    .fill("QA signs off acceptance criteria");
  await card.getByRole("button", { name: "Publish version 2" }).click();
  await expect(card.getByText(/^Version 2 · Ada Admin/)).toBeVisible();

  // Ada is not in QA: the Story waits for QA's sign-off.
  await page.goto(`/${slug}/pay/items/PAY-1`);
  await expect(page.getByText("3 / 4 checks")).toBeVisible();
  await expect(page.getByText(signOffLabel)).toBeVisible();
  await expect(page.getByText("Signed off by QA.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign off", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(ready)).toHaveCount(0);

  // Quinn (QA) signs off revision 1, and the Story becomes ready.
  const qa = await signedIn(browser, qaEmail);
  await qa.page.goto(`/${slug}/pay/items/PAY-1`);
  await expect(qa.page.getByText("3 / 4 checks")).toBeVisible();
  await qa.page.getByRole("button", { name: "Sign off", exact: true }).click();
  await expect(qa.page.getByText(/Signed off by Quinn QA/)).toBeVisible();
  await expect(qa.page.getByText(ready)).toBeVisible();
  await expect(page.getByText("4 / 4 checks")).toBeVisible();

  // Revision 2 changes the criteria QA confirmed: the sign-off no longer
  // counts and the Story is not ready until QA confirms the new text.
  await reviseThroughPullRequest();
  await qa.page.reload();
  await expect(
    qa.page.getByText(
      "Signed off on revision 1. Sign off again for revision 2.",
    ),
  ).toBeVisible();
  await expect(qa.page.getByText("3 / 4 checks")).toBeVisible();
  await expect(qa.page.getByText(ready)).toHaveCount(0);
  await qa.page.getByRole("button", { name: "Sign off", exact: true }).click();
  await expect(qa.page.getByText(ready)).toBeVisible();
  await qa.page.reload();
  await expect(qa.page.getByText("4 / 4 checks")).toBeVisible();
  await qa.context.close();
});
