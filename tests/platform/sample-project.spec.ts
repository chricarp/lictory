import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { discussionsToggle, openDiscussions } from "../helpers/discussions";
import { useClientAddress } from "../helpers/client-address";
import { seedWorkspace, signIn, withDb } from "../helpers/seed";

// Sign-in is rate limited per client address: this page authenticates from
// its own.
test.beforeEach(async ({ page }) => {
  await useClientAddress(page);
});

// "N / M checks", from the item's readiness panel.
async function passedChecks(page: Page) {
  const counter = page.getByText(/^\d+ \/ \d+ checks$/).first();
  await expect(counter).toBeVisible();
  const [, passed, total] =
    /^(\d+) \/ (\d+)/.exec((await counter.textContent()) ?? "") ?? [];
  return { passed: Number(passed), total: Number(total) };
}

test("a person alone creates the sample project, resolves its blocking discussion and sees readiness update", async ({
  page,
}) => {
  // A fresh organization after onboarding: one administrator, one empty
  // project, nobody else.
  const seeded = await seedWorkspace({
    name: "Solo",
    key: "SOLO",
    users: ["Ada Evaluator"],
  });
  await signIn(page, seeded.owner.email);
  await page.goto(seeded.projectPath("/proposals"));
  await expect(
    page.getByRole("heading", { name: "Start with a proposal" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Explore a sample project" }).click();
  await expect(page).toHaveURL(/\/sample\/items\/SAMPLE-1$/);
  const banner = page.getByRole("note", { name: "Sample project" });
  await expect(banner).toContainText("You created everything here");
  await expect(
    page.getByText("Retry failed card payments").first(),
  ).toBeVisible();

  // Readiness shows what is missing.
  const before = await passedChecks(page);
  expect(before.passed).toBeLessThan(before.total);

  // The blocking discussion is anchored to the sentence it questions.
  await openDiscussions(page);
  const panel = page.getByRole("complementary", { name: "Discussions" });
  const thread = panel.getByRole("article", {
    name: "Blocking discussion by Ada Evaluator",
  });
  await expect(thread).toContainText("idempotency key");
  await expect(
    page.locator("[data-spec-root] mark[data-threads]"),
  ).toContainText(["Every retry reuses the original payment request."]);

  // Resolving it passes the blocking-discussion check; the Product
  // approval is still missing, because nothing in the sample is approved.
  await thread.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(thread).toHaveCount(0);
  await discussionsToggle(page).click();
  await expect(discussionsToggle(page)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect
    .poll(async () => (await passedChecks(page)).passed)
    .toBe(before.passed + 1);
  const after = await passedChecks(page);
  expect(after.passed).toBeLessThan(after.total);

  // Nothing was approved by anyone, and the person is the only member.
  await withDb(async (db) => {
    const sample = (
      await db
        .select()
        .from(s.project)
        .where(eq(s.project.organizationId, seeded.organizationId))
    ).find((p) => p.sample);
    expect(sample?.key).toBe("SAMPLE");
    expect(
      await db
        .select()
        .from(s.approval)
        .where(eq(s.approval.organizationId, seeded.organizationId)),
    ).toHaveLength(0);
  });

  // Archiving the sample takes the person back to their own project, which
  // no longer offers a new sample.
  await banner.getByRole("button", { name: "Archive sample" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${seeded.projectPath("/proposals")}$`),
  );
  await expect(
    page.getByRole("heading", { name: "Start with a proposal" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Explore a sample project" }),
  ).toHaveCount(0);
});
