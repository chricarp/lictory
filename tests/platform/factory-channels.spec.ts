import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createAgent } from "@lictory/core/factory/agents";
import { createRunnerRegistration } from "@lictory/core/factory/runners";
import { setAutonomyPolicy } from "@lictory/core/claims/service";
import { defaultAutonomyPolicy } from "@lictory/core/claims/contracts";
import type { FakeScript } from "@lictory/runner/harness/fake";
import {
  currentRevision,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";

// The factory loop as one experience (docs/internals/factory.md#the-factory-loop):
// a person mentions an agent in a channel, a real `lictory-runner` (with the
// scripted harness) works on it, the live session card and the agent's
// answers arrive in the thread, the person steers by replying and approves
// in the thread. Dispatched work reports to the project's channel and asks
// its question there; resolving the discussion resumes the session.

const cli = join(process.cwd(), "apps", "runner", "src", "cli.ts");
let runner: ChildProcess | undefined;
let home: string | undefined;
let output = "";

test.afterEach(async () => {
  const child = runner;
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  runner = undefined;
  if (home) rmSync(home, { recursive: true, force: true });
  home = undefined;
  output = "";
});

// Registers and starts a runner for the organization with a script.
async function startRunner(
  seeded: Seeded,
  baseURL: string,
  script: FakeScript,
) {
  const { token } = await withDb((db) =>
    createRunnerRegistration(db, seeded.owner.id, seeded.organizationId, {
      personal: false,
    }),
  );
  home = mkdtempSync(join(tmpdir(), "lictory-runner-e2e-"));
  const scriptPath = join(home, "script.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  const env = { ...process.env, LICTORY_RUNNER_HOME: home };
  const registered = spawnSync(
    "bun",
    [cli, "register", "--url", baseURL, "--token", token, "--name", "loop"],
    { env, encoding: "utf8" },
  );
  expect(registered.status, registered.stderr + registered.stdout).toBe(0);
  runner = spawn("bun", [cli, "start", "--test-harness", scriptPath], { env });
  runner.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  runner.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
}

async function seedAgent(seeded: Seeded) {
  const handle = `forge${crypto.randomUUID().slice(0, 6)}`;
  const agent = await withDb((db) =>
    createAgent(db, seeded.owner.id, seeded.organizationId, {
      name: "Forge",
      handle,
      kind: "runner",
      harness: "claude-code",
      access: "write",
    }),
  );
  return { ...agent, handle };
}

async function seedChannel(seeded: Seeded, name: string) {
  const channelId = crypto.randomUUID();
  await seeded.command({
    type: "createChannel",
    channelId,
    kind: "public",
    name,
  });
  return channelId;
}

const thread = (page: Page) =>
  page.getByRole("complementary", { name: /thread/i });

test("a person asks an agent in a channel, steers it and approves in the thread @smoke", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const seeded = await seedWorkspace({
    name: "Loop",
    key: "LOP",
    users: ["Ada"],
  });
  const agent = await seedAgent(seeded);
  const channelId = await seedChannel(seeded, "builds");
  await startRunner(seeded, baseURL!, [
    { say: "Reading the task." },
    { waitForMessage: true },
    { ask: "Write CHANGES.md" },
    {
      writeFile: {
        path: "CHANGES.md",
        content: "# Changes\n\n- Refunds over the API.\n",
      },
    },
    { summary: "Added CHANGES.md describing refunds over the API." },
  ]);
  await signIn(page, seeded.owner.email);
  await page.goto(`/${seeded.slug}/channels/${channelId}`);

  // @handle becomes an agent mention as it is typed.
  const composer = page.getByLabel("Message #builds");
  await composer.click();
  await page.keyboard.type(`@${agent.handle} add a changelog for refunds`);
  await expect(
    composer.locator(`[data-type="mention"][data-kind="agent"]`),
  ).toBeVisible();
  await page.keyboard.press("Enter");

  // The session card answers in the message's thread, live.
  const message = page
    .locator("[data-message-id]")
    .filter({ hasText: "add a changelog for refunds" })
    .first();
  await message.getByRole("button", { name: /1 reply|replies/ }).click();
  const panel = thread(page);
  const card = panel.getByRole("region", { name: "Forge session" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Running")).toBeVisible();
  await expect(card.getByRole("link", { name: /Open session/ })).toBeVisible();

  // A reply by the person who asked steers the agent; its answer arrives.
  const reply = panel.getByLabel("Reply in thread");
  await reply.click();
  await page.keyboard.type("Mention the v2 API.");
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Got it: Mention the v2 API.")).toBeVisible();

  // It asks for approval in the thread; Ada approves there.
  const approval = panel.getByRole("region", {
    name: "Forge asks for approval",
  });
  await expect(approval.getByText("Write CHANGES.md")).toBeVisible();
  await expect(card.getByText("Waiting on a person")).toBeVisible();
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval.getByText(/Approved by Ada/)).toBeVisible();

  // The summary arrives as Forge's message and the card completes.
  await expect(
    panel
      .locator("[data-message-id]")
      .filter({ hasText: "Added CHANGES.md describing refunds over the API." })
      .first(),
  ).toBeVisible();
  await expect(card.getByText("Completed")).toBeVisible();
  expect(output).toContain("Session ");
});

test("dispatched work reports to the project's channel, asks there and resumes when answered", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const seeded = await seedWorkspace({
    name: "Dispatch",
    key: "DSP",
    users: ["Ada", "Bo"],
    disciplines: { 1: "Engineering" },
  });
  const [ada, bo] = seeded.users as [
    (typeof seeded.users)[number],
    (typeof seeded.users)[number],
  ];
  const agent = await seedAgent(seeded);
  const channelId = await seedChannel(seeded, "dispatch");
  const storyId = await seedItem(seeded, {
    type: "Story",
    title: "Refund retries",
    description:
      "## Behavior\n\nRefunds over the API reuse the original transaction ID.\n\n## Acceptance criteria\n\n- A retry never charges twice.",
  });
  const revision = await currentRevision(storyId);
  const reviewId = crypto.randomUUID();
  await seeded.command({
    type: "requestReview",
    workItemId: storyId,
    baseRevisionId: revision.id,
    reviewId,
    disciplineId: seeded.roster.disciplines.find(
      (d) => d.projectId === seeded.projectId && d.name === "Engineering",
    )!.id,
    userId: bo.id,
    required: true,
  });
  await seeded.command(
    {
      type: "decideReview",
      workItemId: storyId,
      baseRevisionId: revision.id,
      reviewId,
      decision: "approve",
    },
    bo.id,
  );
  await seeded.command({
    type: "acceptDeliveryScope",
    workItemId: storyId,
    baseRevisionId: revision.id,
  });
  await startRunner(seeded, baseURL!, [
    // The dispatcher activates the claim as the session starts.
    { sleep: 2_000 },
    {
      lictory: {
        tool: "askQuestion",
        arguments: {
          organizationId: "{{organizationId}}",
          claimId: "{{claimId}}",
          question: "Does a partial refund reuse the original ID too?",
          section: "Behavior",
          quote: "reuse the original transaction ID",
        },
      },
    },
    { waitForMessage: true },
    { summary: "Partial refunds reuse the ID; opened the pull request." },
  ]);
  // Build: the dispatcher starts Forge on the ready story.
  await withDb((db) =>
    setAutonomyPolicy(
      db,
      { userId: ada.id },
      {
        organizationId: seeded.organizationId,
        projectId: seeded.projectId,
        policy: {
          ...defaultAutonomyPolicy,
          level: "build",
          implementerAgentIds: [agent.id],
          reportingChannelId: channelId,
        },
      },
    ),
  );

  await signIn(page, ada.email);
  await page.goto(`/${seeded.slug}/channels/${channelId}`);
  // The session's card and Forge's question arrive in the channel.
  const card = page.getByRole("region", { name: "Forge session" }).first();
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card.getByText("DSP-1")).toBeVisible();
  const question = page
    .getByRole("region", { name: "Forge asks a question" })
    .first();
  await expect(
    question.getByText("Does a partial refund reuse the original ID too?"),
  ).toBeVisible({ timeout: 60_000 });

  // Bo answers in the anchored discussion and resolves it.
  await signIn(page, bo.email);
  await page.goto(`/${seeded.slug}/channels/${channelId}`);
  await question
    .getByRole("link", { name: "Answer in the discussion" })
    .click();
  await expect(page).toHaveURL(/thread=/);
  const discussion = page
    .locator("article, li, section")
    .filter({ hasText: "Does a partial refund reuse the original ID too?" })
    .last();
  await discussion
    .getByRole("button", { name: "Resolve", exact: true })
    .click();

  // The session resumes and completes; the card says so.
  await page.goto(`/${seeded.slug}/channels/${channelId}`);
  await expect(
    page.getByRole("region", { name: "Forge asks a question" }).first(),
  ).toContainText("Question resolved");
  await expect(card.getByText("Completed")).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText(/Partial refunds reuse the ID/)).toBeVisible();
});
