import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { paths } from "../src/lib/paths";
const email = "project@example.test";
const reviewerEmail = "engineer@example.test";
const multiOrgEmail = "multi-org@example.test";
const password = "Local-test-password-123";
test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  for (const [name, mail] of [
    ["Alex Morgan", email],
    ["Riley Chen", reviewerEmail],
    ["Taylor Rivera", multiOrgEmail],
  ] as const) {
    const id = crypto.randomUUID();
    // A worker restarted after a failure re-runs this hook on the same database.
    const inserted = await db
      .insert(s.user)
      .values({ id, name, email: mail, emailVerified: true })
      .onConflictDoNothing()
      .returning({ id: s.user.id });
    if (!inserted.length) continue;
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

test("an existing member can create and switch to another organization", async ({
  page,
}) => {
  await signIn(page, multiOrgEmail);
  await page.getByLabel("Organization name").fill("First Team");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(
    page.getByRole("heading", { name: "Add your first project" }),
  ).toBeVisible();
  const firstOrganization = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "First Team" }).click();
  await page.getByRole("link", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/app\/new-organization$/);
  await page.getByLabel("Organization name").fill("Second Team");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(
    page.getByRole("heading", { name: "Add your first project" }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe(firstOrganization);

  await page.getByRole("button", { name: "Second Team" }).click();
  await page.getByRole("button", { name: "First Team" }).click();
  await expect(page).toHaveURL(new RegExp(`${firstOrganization}$`));
});
async function signIn(page: Page, loginEmail = email) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(loginEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
  // Dev-mode compilation can delay hydration; interact only once scripts settled.
  await page.waitForLoadState("networkidle");
}

test("account settings load outside an organization with an older session", async ({
  page,
}) => {
  await signIn(page);

  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const [user] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(eq(s.user.email, email));
  await db
    .update(s.session)
    .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000) })
    .where(eq(s.session.userId, user!.id));
  await client.end();

  await page.goto("/app/account");

  await expect(page).toHaveURL(/\/app\/account$/);
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 active session", { exact: true }),
  ).toBeVisible();
});

test("epic and story refinement: create, review, block, suggest, approve, stale, ready", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  // Onboarding: organization, then project with a key.
  await page.getByLabel("Organization name").fill("Northstar");
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await page.getByLabel("Project name").fill("Payments");
  await expect(page.getByLabel("Key")).toHaveValue("PAYM");
  await page.getByLabel("Key").fill("PAY");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pay\/epics$/);
  const workspacePath = new URL(page.url()).pathname;

  // Personal settings leave the organization shell without losing the return
  // destination.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(page).toHaveURL(
    `http://localhost:3001${paths.account(workspacePath)}`,
  );
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(`http://localhost:3001${workspacePath}`);

  // 1. Create an Epic through quick create (keyboard: c).
  await page.keyboard.press("c");
  await page
    .getByRole("dialog", { name: /^Create/ })
    .getByRole("button", { name: /^Type:/ })
    .click();
  await page.getByRole("option", { name: /^Epic/ }).click();
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

  // 3. Create a Story from the dialog, searching and linking its Epic inline.
  await page.keyboard.press("c");
  await page
    .getByRole("dialog", { name: /^Create/ })
    .getByRole("button", { name: /^Type:/ })
    .click();
  await page.getByRole("option", { name: /^Story/ }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Define cancellation API");
  const epicCombobox = page.getByRole("combobox", { name: "Epic: None" });
  await epicCombobox.fill("Partial");
  await page.getByRole("option", { name: /Partial cancellation/ }).click();
  const description = page.getByRole("textbox", { name: "Description" });
  const initialDescriptionHeight = await description.evaluate(
    (textarea) => textarea.getBoundingClientRect().height,
  );
  await description.fill(
    Array.from(
      { length: 24 },
      (_, index) =>
        `Behavior note ${index + 1}: preserve cancellation context.`,
    ).join("\n"),
  );
  await expect
    .poll(() =>
      description.evaluate(
        (textarea) => textarea.getBoundingClientRect().height,
      ),
    )
    .toBeGreaterThan(initialDescriptionHeight);
  expect(
    await description.evaluate((textarea) =>
      Math.ceil(textarea.getBoundingClientRect().height),
    ),
  ).toBeLessThanOrEqual(320);
  await page
    .getByRole("dialog", { name: "Create story" })
    .getByRole("button", { name: "Create Story", exact: true })
    .click();
  await expect(
    page.getByText("Story “Define cancellation API” created"),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Create story" })
    .getByRole("button", { name: "Close" })
    .last()
    .click();

  // Create a second Story inline within the Epic.
  await page.getByRole("button", { name: "Add story" }).click();
  await page
    .getByRole("textbox", { name: "New story title" })
    .fill("Handle provider callback");
  await page.keyboard.press("Enter");
  await expect(page.getByText("PAY-2")).toBeVisible();
  await expect(page.getByText("PAY-3")).toBeVisible();
  await expect(page.getByText("0/2 ready")).toBeVisible();

  // Reorder stories: drag handle is keyboard-accessible (Alt+Arrow).
  await page
    .getByRole("button", { name: /Reorder Handle provider callback/ })
    .focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(async () =>
      (await page.locator("section ul li a").allTextContents()).slice(0, 2),
    )
    .toEqual(["Handle provider callback", "Define cancellation API"]);

  // 4. Open a Story without losing context (Epic stays in breadcrumb).
  await page.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(page).toHaveURL(/\/pay\/stories\/PAY-2\?epic=[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Partial cancellation");
  const epicFilter = new URL(page.url()).searchParams.get("epic");
  expect(epicFilter).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Handle provider callback" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/pay/stories/PAY-3\\?epic=${epicFilter}$`),
  );
  await page.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/pay/stories/PAY-2\\?epic=${epicFilter}$`),
  );

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
    .getByRole("combobox", { name: /^Assignee:/ })
    .first()
    .click();
  await page.getByRole("option", { name: /Alex Morgan \(me\)/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Assignee: Alex Morgan" }).first(),
  ).toBeVisible();
  // Refinement is the specification's lifecycle, separate from the team's
  // delivery status.
  await page
    .getByRole("button", { name: /^Refinement:/ })
    .first()
    .click();
  await page.getByRole("option", { name: "In refinement" }).click();
  await expect(
    page.getByRole("button", { name: "Refinement: In refinement" }).first(),
  ).toBeVisible();

  // Labels and milestone (non-material properties) with inline creation.
  await page.getByRole("button", { name: "Labels" }).first().click();
  await page.getByRole("button", { name: "New label" }).click();
  await page.getByRole("textbox", { name: "Label name" }).fill("payments");
  await page.getByRole("radio", { name: "purple" }).click();
  await page.getByRole("button", { name: "Create label" }).click();
  await expect(
    page.getByText("payments", { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Milestone:/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New milestone" }).click();
  await page
    .getByRole("textbox", { name: "Milestone name" })
    .fill("Q3 release");
  await page.getByRole("button", { name: "Create milestone" }).click();
  await expect(
    page.getByRole("button", { name: "Milestone: Q3 release" }).first(),
  ).toBeVisible();

  // Write the story specification with acceptance criteria.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  const specificationEditor = page.getByRole("textbox", {
    name: "Specification",
  });
  await specificationEditor.evaluate((textarea: HTMLTextAreaElement) => {
    const start = textarea.value.indexOf("POST");
    textarea.setSelectionRange(start, start + 4);
  });
  const specificationToolbar = specificationEditor
    .locator("..")
    .getByRole("toolbar", { name: "Markdown formatting" });
  await specificationToolbar.getByRole("button", { name: "Bold (⌘B)" }).click();
  await expect(specificationEditor).toHaveValue(/\*\*POST\*\*/);
  await specificationToolbar.getByRole("button", { name: "Bold (⌘B)" }).click();
  await expect(specificationEditor).not.toHaveValue(/\*\*POST\*\*/);
  await specificationToolbar
    .getByRole("button", { name: "Preview Markdown" })
    .click();
  await expect(page.getByRole("heading", { name: "Behavior" })).toBeVisible();
  await page.getByRole("button", { name: "Continue writing" }).click();
  await page.getByRole("button", { name: /Save revision 2/ }).click();
  await expect(
    page.getByText("Duplicate callbacks do not create duplicate cancellations"),
  ).toBeVisible();

  // Invite the engineer so they can review.
  await page.getByRole("link", { name: "Organization settings" }).click();
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

  // The administrator gives the engineer the Engineering role. Until then the
  // new member holds no role and cannot even be asked to review.
  await page.reload();
  await expect(page.getByText("Riley Chen")).toBeVisible();
  await page.getByRole("button", { name: "Add person to Engineering" }).click();
  await page.getByRole("option", { name: /Riley Chen/ }).click();
  await expect(
    page.getByRole("button", { name: "Remove Riley Chen from Engineering" }),
  ).toBeVisible();

  // 6. Request Engineering review from the story page.
  const storyUrl =
    "/app/" +
    page.url().split("/app/")[1]!.split("/")[0] +
    "/pay/stories/PAY-2";
  await page.goto(storyUrl);
  await page.getByRole("button", { name: "Request review" }).click();
  await expect(
    page.getByRole("button", { name: "Reviewer role" }),
  ).toContainText("Engineering");
  await page.getByRole("button", { name: "Reviewer", exact: true }).click();
  await page.getByRole("option", { name: /Riley Chen/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Request review" })
    .click();
  await expect(page.getByText("Requested", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refinement: In review" }).first(),
  ).toBeVisible();

  // 18. Reviewer uses Needs my review; row shows the request.
  await reviewer.goto(storyUrl.replace(/\/stories\/PAY-2$/, "/reviews"));
  await expect(
    reviewer.getByRole("link", { name: "Define cancellation API" }),
  ).toBeVisible();
  await reviewer.getByRole("link", { name: "Define cancellation API" }).click();
  await expect(reviewer).toHaveURL(/\/stories\/PAY-2$/);

  // Presence: both are on PAY-2, so each sees the other.
  await expect(page.getByTitle("Riley Chen", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    reviewer.getByTitle("Alex Morgan", { exact: true }).first(),
  ).toBeVisible({ timeout: 15_000 });

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
  // Engineering cannot edit directly or change properties: no Edit button, and
  // the status control is read-only.
  await expect(
    reviewer.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(reviewer.getByRole("button", { name: /^Status:/ })).toHaveCount(
    0,
  );
  await expect(
    reviewer.getByRole("button", { name: /^Refinement:/ }),
  ).toHaveCount(0);
  await reviewer.getByRole("button", { name: "Suggest", exact: true }).click();
  await reviewer
    .getByRole("textbox", { name: "Proposed specification" })
    .fill(
      "# Behavior\n\nPOST /cancellations accepts a partial amount.\n\nLate provider responses are reconciled against the original transaction ID.\n\n## Acceptance criteria\n\n- [ ] Duplicate callbacks do not create duplicate cancellations",
    );
  await reviewer
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Define cancellation timeout behavior");
  await reviewer
    .getByRole("textbox", { name: "Description" })
    .fill(
      "Make timeout behavior explicit.\n\nReview how late provider responses are reconciled.",
    );
  await reviewer.getByRole("button", { name: "Open for review" }).click();
  // The suggestion is reviewed like a pull request: the author asks the owner
  // (Product: edits and reviews) to review; nobody can merge before approval.
  await expect(reviewer).toHaveURL(/\?suggestion=/);
  await expect(reviewer.getByText("Open for review").first()).toBeVisible();
  await expect(
    reviewer.getByText(/Review how late provider responses are reconciled/),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "Edit proposal" }).click();
  await reviewer
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Clarify cancellation timeouts and retries");
  await reviewer
    .getByRole("textbox", { name: "Description" })
    .fill(
      "Define what happens after the client times out.\n\nReview late provider responses and duplicate callbacks.",
    );
  await reviewer.getByRole("button", { name: /^Save/ }).click();
  await expect(
    reviewer.getByRole("heading", {
      name: "Clarify cancellation timeouts and retries",
    }),
  ).toBeVisible();
  await expect(
    reviewer.getByText(
      /Review late provider responses and duplicate callbacks/,
    ),
  ).toBeVisible();
  await reviewer.getByRole("button", { name: "Add reviewer" }).click();
  await reviewer.getByRole("option", { name: /Alex Morgan/ }).click();
  await expect(reviewer.getByText("0 / 1 approved v1")).toBeVisible();
  await page.getByText("Clarify cancellation timeouts and retries").click();
  await expect(
    page.getByRole("button", { name: /Merge as revision 3/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Approve v1" }).click();
  await expect(page.getByText("1 / 1 approved v1")).toBeVisible();
  await expect(reviewer.getByText("Approved · ready to merge")).toBeVisible();
  await page.getByRole("button", { name: /Merge as revision 3/ }).click();
  await expect(page.getByText(/Merged as revision 3/).first()).toBeVisible();
  await page.getByRole("button", { name: "Specification" }).click();
  await expect(page.getByText("Revision 3 ·").first()).toBeVisible();
  await page.getByRole("button", { name: /Show 1 merged or closed/ }).click();
  await expect(page.getByText(/Merged as revision 3/)).toBeVisible();

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
    page.getByRole("button", { name: "Refinement: Ready" }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(
      "All checks pass; this specification is ready for development.",
    ),
  ).toBeVisible();

  // 17. Navigate quickly between stories via keyboard in the split view.
  await page.goto(storyUrl.replace(/\/PAY-2$/, ""));
  await page.getByRole("link", { name: "Define cancellation API" }).hover();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stories\/PAY-(2|3)$/);
  // URL-persisted filters: filter by label, reload, filter still applied.
  await page.goto(storyUrl.replace(/\/PAY-2$/, "?label=") + "");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Labels" }).click();
  await page.getByRole("option", { name: "payments" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/label=/);
  await expect(
    page.getByRole("link", { name: "Define cancellation API" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Handle provider callback" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Handle provider callback" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Define cancellation API" }),
  ).toBeVisible();
  // Cross-project identifier route.
  await page.goto(storyUrl.replace(/\/pay\/stories\/PAY-2$/, "/items/PAY-1"));
  await expect(page).toHaveURL(/\/pay\/epics\/PAY-1$/);
  await page.keyboard.press("Meta+k");
  await page.getByRole("textbox", { name: "Search" }).fill("PAY-1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/epics\/PAY-1$/);
  await expect(page.getByText("1/2 ready")).toBeVisible();

  // 19. Offline queue survives reload; reconnect propagates.
  await page.goto(storyUrl);
  await expect(
    page.getByRole("toolbar", { name: "Markdown formatting" }),
  ).toBeVisible();
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
  await page
    .getByRole("button", {
      name: /Everything is saved|Saving|could not be saved|Offline|Sync failed/,
    })
    .click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(
    reviewer.getByText("Pending comment survives reload"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Everything is saved" }),
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

test("native delivery: plan a sprint, move cards on the board, readiness gates starting, complete with carry-over", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, multiOrgEmail);
  await page.getByRole("button", { name: /First Team|Second Team/ }).click();
  await page.getByRole("link", { name: "Create organization" }).click();
  await page.getByLabel("Organization name").fill("Delivery Co");
  await page.getByRole("button", { name: "Create organization" }).click();
  await page.getByLabel("Project name").fill("Checkout");
  await page.getByLabel("Key").fill("CHK");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chk\/epics$/);

  // A Task (plain work) and a Story (specification) through quick create.
  for (const [type, title] of [
    ["Task", "Add payment method column"],
    ["Story", "Save a card for later"],
  ] as const) {
    await page.keyboard.press("c");
    await page
      .getByRole("dialog", { name: /^Create/ })
      .getByRole("button", { name: /^Type:/ })
      .click();
    await page.getByRole("option", { name: new RegExp(`^${type}`) }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
    await page
      .getByRole("button", { name: `Create ${type}`, exact: true })
      .click();
    await expect(page.getByText(`${type} “${title}” created`)).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // Plan: create a sprint and drag both items into it, then start it.
  await page.getByRole("link", { name: "Backlog & sprints" }).click();
  await page.getByRole("button", { name: "New sprint" }).click();
  const sprint = page.locator("section[aria-label='Iteration']").first();
  await expect(sprint.getByText("Iteration 1")).toBeVisible();
  for (const title of ["Add payment method column", "Save a card for later"]) {
    await page.locator("[data-row]", { hasText: title }).dragTo(sprint);
    await expect(sprint.getByText(title)).toBeVisible();
  }
  await sprint.getByRole("button", { name: "Start" }).click();
  await expect(sprint.getByText("Active", { exact: true })).toBeVisible();

  // Board: a second member session sees the same board state.
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.getByRole("link", { name: "Board" }).click();
  const column = (name: string) =>
    page.locator("div.w-\\[272px\\]").filter({
      has: page.locator("span.truncate", {
        hasText: new RegExp(`^${name}$`),
      }),
    });
  await page
    .locator("[data-card]", { hasText: "Add payment method column" })
    .dragTo(column("In Progress"));
  await expect(
    column("In Progress").getByText("Add payment method column"),
  ).toBeVisible();
  // Warn (default): the Story starts, and the early start is surfaced.
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("In Progress"));
  await expect(
    page.getByText(/started before its specification is ready/),
  ).toBeVisible();
  await page.reload();
  await expect(
    column("In Progress").getByText("Save a card for later"),
  ).toBeVisible();

  // Block: the team now requires a ready specification to start work.
  await page.getByRole("button", { name: "Team settings" }).click();
  await page.getByRole("radio", { name: /Block/ }).click();
  await page.getByRole("link", { name: /board$/ }).click();
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("Todo"));
  await expect(column("Todo").getByText("Save a card for later")).toBeVisible();
  await page
    .locator("[data-card]", { hasText: "Save a card for later" })
    .dragTo(column("In Progress"));
  await expect(page.getByText(/requires a ready specification/)).toBeVisible();
  await expect(column("Todo").getByText("Save a card for later")).toBeVisible();

  // Finish the task, complete the sprint, carry the story to the backlog.
  await page
    .locator("[data-card]", { hasText: "Add payment method column" })
    .dragTo(column("Done"));
  await expect(
    column("Done").getByText("Add payment method column"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Backlog & sprints" }).click();
  await page.getByRole("button", { name: "Complete" }).click();
  await page.getByRole("option", { name: "Backlog" }).click();
  const backlog = page.locator("section[aria-label='Backlog']");
  await expect(backlog.getByText("Save a card for later")).toBeVisible();
  await page.getByRole("link", { name: /Iteration 1/ }).click();
  await expect(page.getByRole("heading", { name: "Burndown" })).toBeVisible();
  await expect(page.getByText("Carried over")).toBeVisible();
});
