import { test, expect, type Page } from "@playwright/test";
import { appAlert } from "../helpers/live-regions";
import { paths } from "@lictory/core/lib/paths";
import { expectNoAccessibilityViolations } from "../helpers/accessibility";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";
import { createAgent } from "@lictory/core/factory/agents";
import { clientAddress } from "../helpers/client-address";
import { openDiscussions } from "../helpers/discussions";

// Automated WCAG 2.2 AA checks (axe-core) on the main flows: account pages,
// specification review, native delivery, settings, channels and the
// Factory. A new serious or critical
// violation fails the suite; see docs/internals/accessibility.md.

// Each test signs in from its own client address: sign-in is rate limited per
// address, and these tests run back to back.
test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
  // Scan settled pages, not frames of an entrance animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function seed(key: string) {
  const seeded = await seedWorkspace({
    name: `Access ${key}`,
    key,
    users: ["Ari Product", "Eve Engineer"],
    disciplines: { 0: "Product", 1: "Engineering" },
    settings: { iterationMode: "manual" },
  });
  const workItemId = await seedItem(seeded, {
    title: "Partial refunds",
    description:
      "# Behavior\n\nA refund may cover part of a payment.\n\n" +
      "# Acceptance criteria\n\n- The refunded amount never exceeds the payment.",
  });
  return { seeded, workItemId };
}

function engineering(seeded: Seeded) {
  return seeded.roster.disciplines.find(
    (d) => d.projectId === seeded.projectId && d.name === "Engineering",
  )!.id;
}

async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
}

test("account pages meet WCAG 2.2 AA automated checks", async ({ page }) => {
  for (const [path, heading] of [
    ["/sign-in", /sign in/i],
    ["/sign-up", /create/i],
    ["/forgot-password", /reset|password/i],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await settled(page);
    await expectNoAccessibilityViolations(page, path);
  }
  // Errors are announced next to the form they belong to.
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("nobody@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Not-the-password-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(appAlert(page)).toBeVisible();
  await expectNoAccessibilityViolations(page, "sign-in with an error");
});

test("specification review meets WCAG 2.2 AA automated checks", async ({
  page,
}) => {
  const { seeded, workItemId } = await seed("AXR");
  const revision = await currentRevision(workItemId);
  const base = { workItemId, baseRevisionId: revision.id };
  // An engineer is asked to review and raises a blocking concern.
  await seeded.command({
    type: "requestReview",
    ...base,
    reviewId: crypto.randomUUID(),
    disciplineId: engineering(seeded),
    userId: seeded.users[1]!.id,
    required: true,
  });
  await seeded.command(
    {
      type: "createThread",
      ...base,
      threadId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      body: "What happens when two partial refunds race?",
      blocking: true,
      section: "Behavior",
    },
    seeded.users[1]!.id,
  );

  await signIn(page, seeded.users[1]!.email);
  await page.goto(seeded.itemPath(1));
  await expect(
    page.getByRole("heading", { name: "Partial refunds", level: 1 }),
  ).toBeVisible();
  // The discussions beside the specification, its passage marked.
  await openDiscussions(page);
  await expect(
    page.getByText("What happens when two partial refunds race?"),
  ).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "specification under review");

  // The queues that lead to it (proposals is empty: the story is refining).
  for (const path of ["/proposals", "/refinement", "/reviews", "/items"]) {
    await page.goto(seeded.projectPath(path));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await settled(page);
    await expectNoAccessibilityViolations(page, path);
  }
});

test("board and backlog meet WCAG 2.2 AA automated checks", async ({
  page,
}) => {
  const { seeded, workItemId } = await seed("AXB");
  const taskId = await seedItem(seeded, {
    type: "Task",
    title: "Add a refunds column",
  });
  const iterationId = crypto.randomUUID();
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  await seeded.command({
    type: "createIteration",
    projectId: seeded.projectId,
    iterationId,
    name: null,
    goal: "Refunds are safe to ship",
    startsAt: day(0),
    endsAt: day(13),
  });
  for (const id of [workItemId, taskId])
    await seeded.command({
      type: "updateWorkItem",
      workItemId: id,
      iterationId,
    });
  await seeded.command({
    type: "startIteration",
    projectId: seeded.projectId,
    iterationId,
  });
  await seedItem(seeded, { type: "Bug", title: "Refund email is late" });

  await signIn(page, seeded.owner.email);
  await page.goto(seeded.projectPath("/board"));
  await expect(page.getByText("Add a refunds column")).toBeVisible();
  await expect(page.getByText("Partial refunds")).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "board");

  await page.goto(seeded.projectPath("/backlog"));
  await expect(page.getByText("Refund email is late")).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "backlog");
});

test("settings meet WCAG 2.2 AA automated checks", async ({ page }) => {
  const { seeded } = await seed("AXS");
  await signIn(page, seeded.owner.email);

  await page.goto(paths.account());
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "account settings");

  for (const section of [
    "general",
    "members",
    "projects",
    "types",
    "integrations",
    "intelligence",
  ]) {
    await page.goto(paths.settings(seeded.slug, section));
    await expect(
      page.getByRole("heading", { name: "Organization settings" }),
    ).toBeVisible();
    await settled(page);
    await expectNoAccessibilityViolations(
      page,
      `organization settings: ${section}`,
    );
  }
  const key = seeded.projectPath().split("/").at(-1)!;
  for (const section of [
    "general",
    "members",
    "disciplines",
    "teams",
    "workflow",
    "planning",
    "delivery",
    "readiness",
    "labels",
    "context",
  ]) {
    await page.goto(paths.projectSettings(seeded.slug, key, section));
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }),
    ).toBeVisible();
    await settled(page);
    await expectNoAccessibilityViolations(page, `project settings: ${section}`);
  }
});

test("channels and the factory meet WCAG 2.2 AA automated checks", async ({
  page,
}) => {
  const { seeded } = await seed("AXF");
  await signIn(page, seeded.owner.email);
  const channelId = crypto.randomUUID();
  await seeded.command({
    type: "createChannel",
    channelId,
    kind: "public",
    name: "payments",
    topic: "Refunds and payouts",
  });
  await withDb((db) =>
    createAgent(db, seeded.owner.id, seeded.organizationId, {
      name: "Forge",
      handle: `forge${crypto.randomUUID().slice(0, 6)}`,
      avatar: "🛠️",
      kind: "runner",
      harness: "claude-code",
      access: "write",
    }),
  );

  await page.goto(paths.channels(seeded.slug));
  await expect(
    page
      .getByRole("list", { name: "Channels" })
      .getByRole("link", { name: "payments" }),
  ).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "channels index");

  await page.goto(paths.channel(seeded.slug, channelId));
  await expect(
    page.getByRole("heading", { name: "payments", level: 1 }),
  ).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "channel");

  // No runner yet: the Factory is one setup path; its agents and runners.
  await page.goto(paths.factory(seeded.slug));
  await expect(page.getByText("Set up the factory")).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "factory setup");
  for (const [tab, text] of [
    ["agents", "Forge"],
    ["runners", "No runners yet"],
  ] as const) {
    await page.goto(`${paths.factory(seeded.slug)}/${tab}`);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await settled(page);
    await expectNoAccessibilityViolations(page, `factory ${tab}`);
  }
});
