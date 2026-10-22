import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { paths } from "@lictory/core/lib/paths";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory, executeMutation } from "@lictory/core/domain/service";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";

const password = "Readiness-test-password-123!";
// A retry runs in a new worker that seeds again; each worker gets its own users.
const run = crypto.randomUUID().slice(0, 8);
const adminEmail = `readiness-admin-${run}@example.test`;
let slug: string;

test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client, { schema: s });
    const adminId = crypto.randomUUID();
    const qaId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    slug = `readiness-${organizationId.slice(0, 8)}`;
    const hash = await hashPassword(password);
    for (const [id, name, email, handle] of [
      [adminId, "Ada Admin", adminEmail, `ada_${run}`],
      [qaId, "Quinn QA", `readiness-qa-${run}@example.test`, `quinn_${run}`],
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
      name: "Readiness checks",
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
    const command = (c: Command, actor = adminId) =>
      executeMutation(
        db,
        { userId: actor },
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command: c,
        },
      );
    await command({
      type: "createProject",
      projectId,
      name: "Payments",
      key: "PAY",
    });
    const roster = await directory(db, adminId, organizationId);
    const qa = roster.disciplines.find(
      (d) => d.projectId === projectId && d.name === "QA",
    )!.id;
    await command({
      type: "setDisciplineMember",
      projectId,
      disciplineId: qa,
      userId: qaId,
      member: true,
    });
    const story = roster.types.find((t) => t.name === "Story")!.id;
    const create = async (title: string, description: string) => {
      const workItemId = crypto.randomUUID();
      await command({
        type: "createWorkItem",
        projectId,
        workItemId,
        typeId: story,
        parentId: null,
        title,
        description,
      });
      const [revision] = await db
        .select()
        .from(s.specificationRevision)
        .where(eq(s.specificationRevision.workItemId, workItemId));
      return { workItemId, baseRevisionId: revision!.id };
    };
    // PAY-1 is ready under Lictory's defaults and has no acceptance criteria.
    const ready = await create(
      "Safe retries",
      "# Behavior\n\nRetries reuse the transaction ID.",
    );
    const reviewId = crypto.randomUUID();
    await command({
      type: "requestReview",
      ...ready,
      reviewId,
      disciplineId: qa,
      userId: qaId,
      required: true,
    });
    await command(
      { type: "decideReview", ...ready, reviewId, decision: "approve" },
      qaId,
    );
    // PAY-2 waits on a review the new checks no longer require.
    const waiting = await create(
      "Partial refunds",
      "# Behavior\n\nRefund part of a settled payment.\n\n## Acceptance criteria\n\n- [ ] Refunds never exceed the settled amount.",
    );
    await command({
      type: "requestReview",
      ...waiting,
      reviewId: crypto.randomUUID(),
      disciplineId: qa,
      userId: qaId,
      required: true,
    });
  } finally {
    await client.end();
  }
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("project administrators edit the Definition of Ready per type, review its impact and publish a version; ready work keeps the rules it met", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(paths.projectSettings(slug, "PAY", "readiness"));
  const card = page.locator("#definition");
  await expect(
    card.getByText(/Lictory’s defaults · not edited yet/),
  ).toBeVisible();
  await card.getByRole("tab", { name: "Story" }).click();
  await expect(card.getByText("A Story is ready when…")).toBeVisible();

  // Stories trade the review checks for their own definition of ready.
  await card
    .getByRole("switch", { name: "At least one required review is requested" })
    .click();
  await card
    .getByRole("switch", {
      name: "Every required review approved the current revision",
    })
    .click();
  await card.getByRole("button", { name: "Require a section" }).click();
  await expect(
    card.getByRole("textbox", { name: "Required section" }),
  ).toHaveValue("Acceptance criteria");
  await card.getByRole("button", { name: "Add a sign-off" }).click();
  await expect(
    card.getByRole("textbox", { name: "Sign-off name" }),
  ).toHaveValue("Designs attached");
  await expect(card.getByText("4 changes to Story")).toBeVisible();
  await page.screenshot({ path: "/tmp/lictory-readiness-editor.png" });

  // Reviewing shows what publishing does to real items before it happens.
  await card.getByRole("button", { name: "Review changes…" }).click();
  await expect(card.getByText("Publish version 2?")).toBeVisible();
  await expect(
    card.getByText("ready or done item keeps version 1"),
  ).toBeVisible();
  await expect(card.getByText("will need more work")).toBeVisible();
  await expect(card.getByText("1 fail “Designs attached”")).toBeVisible();
  await card
    .getByRole("textbox", { name: "Change summary" })
    .fill("Stories need acceptance criteria and designs");
  await page.screenshot({ path: "/tmp/lictory-readiness-review.png" });
  await card.getByRole("button", { name: "Publish version 2" }).click();
  await expect(card.getByText(/^Version 2 · Ada Admin/)).toBeVisible();
  const history = page.locator("#history");
  await expect(
    history.getByText(/Stories need acceptance criteria and designs/),
  ).toBeVisible();
  await expect(
    history.getByText(
      "+ Story: It has a non-empty “Acceptance criteria” section",
    ),
  ).toBeVisible();

  // PAY-1 was ready, so it keeps the rules it met.
  await page.goto(`/app/${slug}/pay/stories/PAY-1`);
  await expect(
    page.getByText(/Kept on Definition of Ready version 1/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "All checks pass; this specification is ready for development.",
    ),
  ).toBeVisible();

  // PAY-2 follows the new rules: only the sign-off is missing.
  await page.goto(`/app/${slug}/pay/stories/PAY-2`);
  await expect(page.getByText("3 / 4 checks")).toBeVisible();
  await expect(
    page.getByText("It has a non-empty “Acceptance criteria” section"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign off", exact: true }).click();
  await expect(page.getByText(/Signed off by Ada Admin/)).toBeVisible();
  await expect(
    page.getByText(
      "All checks pass; this specification is ready for development.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/lictory-readiness-item.png" });
  await page.reload();
  await expect(page.getByText("4 / 4 checks")).toBeVisible();
});
