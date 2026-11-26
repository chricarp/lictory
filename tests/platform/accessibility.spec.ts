import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { createRunnerRegistration } from "@lictory/core/factory/runners";
import {
  FAKE_GITHUB_SITE,
  FAKE_GITHUB_TOKEN,
} from "../../scripts/e2e-fakes/code-hosts";
import { richEditor } from "../helpers/editor";
import { createPage, createSpace, paragraph, text } from "../helpers/knowledge";
import { clientAddress } from "../helpers/client-address";
import { openDiscussions } from "../helpers/discussions";

// Automated WCAG 2.2 AA checks (axe-core) on the main flows: account pages,
// specification review, native delivery, settings, Home and the Inbox,
// channels with an agent's thread, the Factory (light and dark), Code and a
// space page. A new serious or critical
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
  // Every field says what is wrong next to it and keeps saying it; the
  // first field to fix takes focus and is described by its message.
  await page.goto("/sign-up");
  await page.getByLabel("Work email").fill("not-an-email");
  await page.getByRole("button", { name: "Create account" }).click();
  const name = page.getByLabel("Full name");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Full name is required.");
  await expect(page.getByLabel("Work email")).toHaveAccessibleDescription(
    "Enter an email address like name@company.com.",
  );
  await expect(page.getByText("3 fields need attention.")).toBeVisible();
  await expectNoAccessibilityViolations(page, "sign-up with field errors");
  // A fixed field drops its message as soon as it is valid.
  await name.fill("Alex Example");
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Full name is required.")).toHaveCount(0);
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
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Organization settings" }),
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
  // An empty state under the page header is not a second page title.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await settled(page);
  await expectNoAccessibilityViolations(page, "factory setup");
  for (const [tab, text] of [
    ["agents", "Forge"],
    ["runners", "No runners yet"],
  ] as const) {
    await page.goto(`${paths.factory(seeded.slug)}/${tab}`);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await settled(page);
    await expectNoAccessibilityViolations(page, `factory ${tab}`);
  }
});

// Registers and starts a runner whose scripted agent asks for approval, so
// the conversation, the Factory and the person's queues all hold a live
// request (see factory-channels.spec.ts for the loop itself).
const cli = join(process.cwd(), "apps", "runner", "src", "cli.ts");
let runner: ChildProcess | undefined;
let runnerHome: string | undefined;

test.afterEach(async () => {
  const child = runner;
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  runner = undefined;
  if (runnerHome) rmSync(runnerHome, { recursive: true, force: true });
  runnerHome = undefined;
});

async function startRunner(seeded: Seeded, baseURL: string) {
  const { token } = await withDb((db) =>
    createRunnerRegistration(db, seeded.owner.id, seeded.organizationId, {
      personal: false,
    }),
  );
  runnerHome = mkdtempSync(join(tmpdir(), "lictory-runner-axe-"));
  const script = join(runnerHome, "script.json");
  writeFileSync(
    script,
    JSON.stringify([
      { say: "Reading the refunds module." },
      { ask: "Write CHANGES.md" },
      { summary: "Added CHANGES.md." },
    ]),
  );
  const env = { ...process.env, LICTORY_RUNNER_HOME: runnerHome };
  const registered = spawnSync(
    "bun",
    [cli, "register", "--url", baseURL, "--token", token, "--name", "axe"],
    { env, encoding: "utf8" },
  );
  expect(registered.status, registered.stderr + registered.stdout).toBe(0);
  runner = spawn("bun", [cli, "start", "--test-harness", script], { env });
}

test("the shell, a conversation with an agent session, the Factory and the person's queues meet WCAG 2.2 AA automated checks, light and dark", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { seeded } = await seed("AXA");
  const [ari, eve] = seeded.users as [
    (typeof seeded.users)[number],
    (typeof seeded.users)[number],
  ];
  const handle = `forge${crypto.randomUUID().slice(0, 6)}`;
  await withDb((db) =>
    createAgent(db, seeded.owner.id, seeded.organizationId, {
      name: "Forge",
      handle,
      kind: "runner",
      harness: "claude-code",
      access: "write",
    }),
  );
  const channelId = crypto.randomUUID();
  await seeded.command({
    type: "createChannel",
    channelId,
    kind: "public",
    name: "payments",
    topic: "Refunds and payouts",
  });
  for (const user of [ari, eve])
    await seeded.command({ type: "joinChannel", channelId }, user.id);
  await startRunner(seeded, baseURL!);
  await signIn(page, seeded.owner.email);

  // A conversation: people talk, then ask the agent in a thread.
  await page.goto(paths.channel(seeded.slug, channelId));
  const composer = await richEditor(page, "Message #payments");
  await composer.click();
  await page.keyboard.type("Refunds go out on Friday.");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`@${handle} add a changelog for refunds`);
  await expect(
    composer.locator(`[data-type="mention"][data-kind="agent"]`),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  const asked = page
    .locator("[data-message-id]")
    .filter({ hasText: "add a changelog for refunds" })
    .first();
  await asked.getByRole("button", { name: /repl(y|ies)/ }).click();
  const thread = page.getByRole("complementary", { name: /thread/i });
  const card = thread.getByRole("article", { name: /^Forge session/ });
  await expect(card.getByRole("button", { name: "Approve" })).toBeVisible({
    timeout: 60_000,
  });
  const threadPath = `${paths.channel(seeded.slug, channelId)}?thread=${await asked.getAttribute("data-message-id")}`;
  const sessionPath = await card
    .getByRole("link", { name: /Open session/ })
    .getAttribute("href");

  const scan = async (state: string) => {
    await settled(page);
    await expectNoAccessibilityViolations(page, state);
  };
  const surfaces = async (scheme: "light" | "dark") => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(threadPath);
    await expect(card.getByRole("button", { name: "Approve" })).toBeVisible();
    await scan(`${scheme}: channel with a thread holding an agent's request`);

    await page.goto(paths.channels(seeded.slug));
    await expect(
      page.getByRole("list", { name: "Channels" }).getByRole("link", {
        name: "payments",
      }),
    ).toBeVisible();
    await scan(`${scheme}: channels index`);

    await page.goto(`/${seeded.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Write CHANGES.md").first()).toBeVisible();
    await scan(`${scheme}: home`);

    await page.goto(`/${seeded.slug}/inbox`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scan(`${scheme}: inbox`);

    await page.goto(paths.factory(seeded.slug));
    const needs = page.getByRole("region", { name: "Needs you" });
    await expect(needs.getByText("Write CHANGES.md")).toBeVisible();
    await scan(`${scheme}: factory overview`);
    // The request opened in place, with its context.
    await needs.getByRole("button", { name: "Review" }).first().click();
    await expect(needs.getByRole("button", { name: "Approve" })).toBeVisible();
    await scan(`${scheme}: factory overview with a request open`);

    await page.goto(`${paths.factory(seeded.slug)}/agents`);
    await expect(
      page.getByText("Forge", { exact: true }).first(),
    ).toBeVisible();
    await scan(`${scheme}: factory agents`);

    await page.goto(sessionPath!);
    await expect(page.getByText("Write CHANGES.md").first()).toBeVisible();
    await scan(`${scheme}: agent session`);
  };
  await surfaces("light");
  await surfaces("dark");
});

test("a code pull request and a space page meet WCAG 2.2 AA automated checks", async ({
  page,
}) => {
  test.slow();
  const { seeded } = await seed("AXC");
  const repository = `acme/axe-${crypto.randomUUID().slice(0, 8)}`;
  const github = async (path: string, body: unknown) => {
    const response = await fetch(`${process.env.E2E_FAKE_GITHUB_URL}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(response.ok, await response.clone().text()).toBeTruthy();
  };
  await github("/__fake/repos", { fullName: repository });
  await signIn(page, seeded.owner.email);

  await page.goto(`/${seeded.slug}/settings/code`);
  await page.getByRole("button", { name: "Connect a host" }).click();
  await page.getByRole("radio", { name: "Fine-grained token" }).click();
  await page.getByLabel("Host address").fill(FAKE_GITHUB_SITE);
  await page.getByLabel("Token", { exact: true }).fill(FAKE_GITHUB_TOKEN);
  await page.getByRole("button", { name: "Verify and connect" }).click();
  await expect(page.getByText("the secret is shown only once")).toBeVisible();
  const details = page.locator("code");
  await github("/__fake/hooks", {
    url: await details.nth(0).textContent(),
    secret: await details.nth(1).textContent(),
  });
  await expect(page.getByText("as @lictory-bot")).toBeVisible();
  await page.getByRole("button", { name: "Link a repository" }).click();
  await page.getByLabel("Find a repository").fill(repository);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("radio", { name: repository }).check();
  await page.getByRole("button", { name: "Link to project" }).click();
  await expect(page.getByRole("link", { name: repository })).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "code host settings");

  await github(`/__fake/repos/${repository}/pulls`, {
    head: "axc-1-refunds",
    title: "AXC-1: partial refunds",
    body: "Caps a refund at the payment.",
  });
  await github(`/__fake/repos/${repository}/pulls/1/checks`, {
    name: "ci",
    state: "failure",
  });
  await page.goto(`/${seeded.slug}/code`);
  const pull = page.getByRole("link", { name: /AXC-1: partial refunds/ });
  await expect(pull.first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await expectNoAccessibilityViolations(page, "code index");
  await pull.first().click();
  await expect(
    page.getByRole("heading", { name: "AXC-1: partial refunds" }),
  ).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "code pull request");
  await page.getByRole("tab", { name: "Files changed" }).click();
  await expect(page.getByText("src/refunds.ts").first()).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "code pull request files");

  // The item the pull request delivers, with its Code panel.
  await page.goto(seeded.itemPath(1));
  await expect(
    page.locator("[data-item-code]").getByRole("link", {
      name: /AXC-1: partial refunds/,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await settled(page);
  await expectNoAccessibilityViolations(page, "item with a pull request");

  const space = await createSpace(seeded, "Payments handbook");
  const runbook = await createPage(seeded, space, "Refund runbook", [
    paragraph("p1", text("Refunds go out on Fridays.")),
  ]);
  await page.goto(paths.spacePage(seeded.slug, space.slug, runbook.pageId));
  await expect(page.getByText("Refunds go out on Fridays.")).toBeVisible();
  await settled(page);
  await expectNoAccessibilityViolations(page, "space page");
});
