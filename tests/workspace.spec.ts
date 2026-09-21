import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
const email = "product@example.test";
const reviewerEmail = "engineer@example.test";
const password = "Local-test-password-123";
test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  for (const [name, mail] of [
    ["Alex Morgan", email],
    ["Riley Chen", reviewerEmail],
  ] as const) {
    const id = crypto.randomUUID();
    await db
      .insert(s.user)
      .values({ id, name, email: mail, emailVerified: true });
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  }
  await client.end();
});
async function signIn(page: Page, loginEmail = email) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email", { exact: true }).fill(loginEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
  // Dev-mode compilation can delay hydration; interact only once scripts settled.
  await page.waitForLoadState("networkidle");
}
test("epic and story refinement: create, review, block, suggest, approve, stale, ready", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  // Onboarding: organization, then product with a key.
  await page.getByLabel("Organization name").fill("Northstar");
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await page.getByLabel("Product name").fill("Payments");
  await expect(page.getByLabel("Key")).toHaveValue("PAYM");
  await page.getByLabel("Key").fill("PAY");
  await page
    .getByRole("button", { name: "Create product", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pay\/epics$/);

  // 1. Create an Epic through quick create (keyboard: c).
  await page.keyboard.press("c");
  await page.getByRole("radio", { name: "Epic" }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Partial cancellation");
  await page.getByRole("button", { name: "Create & open" }).click();
  await expect(page).toHaveURL(/\/pay\/epics\/PAY-1$/);
  await expect(
    page.getByRole("heading", { name: "Partial cancellation" }),
  ).toBeVisible();

  // 2. Edit Epic content (creates revision 2).
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill(
      "# Intent\n\nMerchants need to cancel part of a settled transaction.\n\n## Behavior\n\nCancellation reuses the original transaction ID.",
    );
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(page.getByText("Revision 2 ·").first()).toBeVisible();

  // 3. Create Stories inline within the Epic.
  await page.getByRole("button", { name: "Add story" }).click();
  await page
    .getByRole("textbox", { name: "New story title" })
    .fill("Define cancellation API");
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "New story title" })
    .fill("Handle provider callback");
  await page.keyboard.press("Enter");
  await expect(page.getByText("PAY-2")).toBeVisible();
  await expect(page.getByText("PAY-3")).toBeVisible();
  await expect(page.getByText("0/2 ready")).toBeVisible();

  // 4. Open a Story without losing context (Epic stays in breadcrumb).
  await page.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(page).toHaveURL(/\/pay\/stories\/PAY-2$/);
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Partial cancellation");

  // 5. Inline status/priority/owner.
  await page
    .getByRole("button", { name: /^Priority:/ })
    .first()
    .click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(
    page.getByRole("button", { name: "Priority: High" }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Assignee:/ })
    .first()
    .click();
  await page.getByRole("option", { name: /Alex Morgan \(me\)/ }).click();
  await expect(
    page.getByRole("button", { name: "Assignee: Alex Morgan" }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Status:/ })
    .first()
    .click();
  await page.getByRole("option", { name: "In refinement" }).click();
  await expect(
    page.getByRole("button", { name: "Status: In refinement" }).first(),
  ).toBeVisible();

  // Write the story specification with acceptance criteria.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(
    page.getByText("Duplicate callbacks do not create duplicate cancellations"),
  ).toBeVisible();

  // Invite the engineer so they can review.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Teammate email").fill(reviewerEmail);
  await page.getByRole("button", { name: "Create link" }).click();
  const invitation = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await signIn(reviewer, reviewerEmail);
  await reviewer.goto(invitation);
  await reviewer.getByRole("button", { name: "Accept invitation" }).click();
  await expect(reviewer).toHaveURL(/\/app\/northstar/);

  // 6. Request Engineering review from the story page.
  const storyUrl =
    "/app/" +
    page.url().split("/app/")[1]!.split("/")[0] +
    "/pay/stories/PAY-2";
  await page.goto(storyUrl);
  await page.getByRole("button", { name: "Request review" }).click();
  await page.getByRole("button", { name: "Reviewer" }).click();
  await page.getByRole("option", { name: /Riley Chen/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Request review" })
    .click();
  await expect(page.getByText("Requested", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Status: In review" }).first(),
  ).toBeVisible();

  // 18. Reviewer uses Needs my review; row shows the request.
  await reviewer.goto(storyUrl.replace(/\/stories\/PAY-2$/, "/reviews"));
  await expect(
    reviewer.getByRole("link", { name: "Define cancellation API" }),
  ).toBeVisible();
  await reviewer.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(reviewer).toHaveURL(/\/stories\/PAY-2$/);

  // 7-8. Reviewer opens a blocking discussion anchored to the text; owner replies.
  await reviewer
    .getByRole("textbox", { name: "Start a discussion" })
    .fill("What happens when the provider answers after the client timeout?");
  await reviewer.getByText("Blocks readiness").click();
  await reviewer
    .getByRole("button", { name: "Post blocking discussion" })
    .click();
  await expect(
    page.getByText(
      "What happens when the provider answers after the client timeout?",
    ),
  ).toBeVisible();
  await expect(page.getByText("1 open · 1 blocking")).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Reply" })
    .fill(
      "Late answers are acknowledged and reconciled against the original ID.",
    );
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(
    reviewer.getByText(
      "Late answers are acknowledged and reconciled against the original ID.",
    ),
  ).toBeVisible();

  // 9-11. Reviewer proposes a suggestion; owner accepts it → revision 3.
  await reviewer.getByRole("button", { name: "Suggest", exact: true }).click();
  await reviewer
    .getByRole("textbox", { name: "Proposed specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount.\n\nLate provider responses are reconciled against the original transaction ID.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  await reviewer
    .getByRole("textbox", { name: "Rationale" })
    .fill("Make timeout behavior explicit");
  await reviewer.getByRole("button", { name: "Propose change" }).click();
  await expect(page.getByText("Make timeout behavior explicit")).toBeVisible();
  await page.getByRole("button", { name: "Accept suggestion" }).click();
  await expect(page.getByText("Revision 3 ·").first()).toBeVisible();
  await page.getByRole("button", { name: /Show 1 decided/ }).click();
  await expect(page.getByText(/Accepted as revision 3/)).toBeVisible();

  // 12. Reviewer approves revision 3.
  await reviewer.getByRole("button", { name: "Approve revision 3" }).click();
  await expect(page.getByText("1 / 1 approved")).toBeVisible();

  // 13-14. Owner changes the specification → approval becomes outdated.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount up to the settled total.\n\nLate provider responses are reconciled against the original transaction ID.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  await page
    .getByRole("textbox", { name: "Change summary" })
    .fill("Bound the amount");
  await page.getByRole("button", { name: /Save revision 4/ }).click();
  await expect(page.getByText("0 / 1 approved")).toBeVisible();
  await page.getByRole("button", { name: /earlier approval/ }).click();
  await expect(page.getByText(/approved revision 3 · outdated/)).toBeVisible();
  // Reviewer sees what changed since their approval.
  await expect(
    reviewer.getByText(/Changed since you last looked: revision 3 → 4/),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "View changes" }).click();
  await expect(
    reviewer.getByText("up to the settled total").first(),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "Close comparison" }).click();

  // 15-16. Resolve the blocking discussion, approve again → readiness passes → Ready.
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("0 open")).toBeVisible();
  await reviewer.getByRole("button", { name: "Approve revision 4" }).click();
  await expect(page.getByText("1 / 1 approved")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Status: Ready" }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("All checks pass; this item is ready for development."),
  ).toBeVisible();

  // 17. Navigate quickly between stories via keyboard in the split view.
  await page.goto(storyUrl.replace(/\/PAY-2$/, ""));
  await page.getByRole("link", { name: "Define cancellation API" }).hover();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stories\/PAY-(2|3)$/);
  await page.keyboard.press("Meta+k");
  await page.getByRole("textbox", { name: "Search" }).fill("PAY-1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/epics\/PAY-1$/);
  await expect(page.getByText("1/2 ready")).toBeVisible();

  // 19. Offline queue survives reload; reconnect propagates.
  await page.goto(storyUrl);
  await page.route("**/api/sync**", (route) =>
    route.abort("internetdisconnected"),
  );
  await page
    .getByRole("textbox", { name: "Start a discussion" })
    .fill("Pending comment survives reload");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Pending comment survives reload")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Pending comment survives reload")).toBeVisible();
  await page.unroute("**/api/sync**");
  await page.getByRole("status", { name: /Synchronization/ }).click();
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(
    reviewer.getByText("Pending comment survives reload"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("status", { name: /Synchronization: Synced/ }),
  ).toBeVisible({ timeout: 30_000 });

  // Inbox for the owner mentions the item; archive/restore round trip.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(reviewer.getByText("Archived", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(reviewer.getByText("Archived", { exact: true })).toHaveCount(0);
  // History keeps both transitions.
  await expect(reviewer.getByText("restored this item")).toBeVisible();

  await page.screenshot({
    path: "/tmp/lictory-story-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/lictory-story-mobile.png" });
  await reviewerContext.close();
});
