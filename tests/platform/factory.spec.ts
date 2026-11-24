import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { seedWorkspace, signIn } from "../helpers/seed";

// The Factory end to end: a person registers a real `lictory-runner`
// process (running the scripted test harness), creates an agent, starts a
// session, watches it work live, steers it with a message, answers its
// approval request and sees it complete.

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
});

test("a person runs an agent on their own runner, steers it and approves what it asks @smoke", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const seeded = await seedWorkspace({
    name: "Factory",
    key: "FAC",
    users: ["Ada"],
  });
  await signIn(page, seeded.owner.email);

  // Add a runner: the dialog shows a one-time token in the commands.
  await page.goto(`/${seeded.slug}/factory/runners`);
  await expect(
    page.getByRole("heading", { name: "Runners", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add runner" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a runner" });
  await dialog.getByRole("button", { name: /Organization runner/ }).click();
  await dialog
    .getByRole("button", { name: "Create registration token" })
    .click();
  const commands = await dialog
    .getByLabel("Install and register commands")
    .textContent();
  const token = /lrt_[\w-]+/.exec(commands ?? "")?.[0];
  expect(token, commands ?? "").toBeTruthy();
  await dialog.getByRole("button", { name: "Done" }).click();

  // Register and start the real runner with the scripted harness.
  home = mkdtempSync(join(tmpdir(), "lictory-runner-e2e-"));
  const env = { ...process.env, LICTORY_RUNNER_HOME: home };
  const registered = spawnSync(
    "bun",
    [
      cli,
      "register",
      "--url",
      baseURL!,
      "--token",
      token!,
      "--name",
      "e2e-runner",
    ],
    { env, encoding: "utf8" },
  );
  expect(registered.status, registered.stderr + registered.stdout).toBe(0);
  runner = spawn("bun", [cli, "start", "--test-harness", "default"], { env });
  runner.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  runner.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  await expect(page.getByText("e2e-runner")).toBeVisible();
  await expect(page.getByText("Online")).toBeVisible();

  // Create an agent the person owns.
  // The Factory's own tabs (the sidebar has the same destinations).
  const tabs = page.getByRole("navigation", { name: "Factory" });
  await tabs.getByRole("link", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "New agent" }).first().click();
  const agentDialog = page.getByRole("dialog", { name: "New agent" });
  await agentDialog.getByLabel("Name", { exact: true }).fill("Forge");
  await expect(agentDialog.getByLabel("Handle", { exact: true })).toHaveValue(
    "forge",
  );
  await agentDialog.getByRole("button", { name: "Create agent" }).click();
  await expect(agentDialog).toBeHidden();
  await expect(page.getByText("@forge")).toBeVisible();

  // Start a session from the overview.
  await tabs.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Start session" }).click();
  const start = page.getByRole("dialog", { name: "Start an agent session" });
  await start
    .getByLabel("What should it do?")
    .fill("Add a changelog for refunds.");
  await start.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/factory\/sessions\//);

  // The transcript fills in live: the runner claims it and the agent works.
  const transcript = page.getByRole("list", { name: "Session transcript" });
  await expect(
    transcript.getByText("Add a changelog for refunds."),
  ).toBeVisible();
  await expect(
    transcript.getByText("e2e-runner claimed the session."),
  ).toBeVisible();
  await expect(
    transcript.getByText("Reading the task and the repository."),
  ).toBeVisible();
  await expect(transcript.getByText("$ npm test")).toBeVisible();
  await expect(
    transcript.getByText("Ready for your instructions."),
  ).toBeVisible();

  // Steer it with a message.
  await page.getByLabel("Message the agent").fill("Mention the v2 API.");
  await page.getByLabel("Message the agent").press("Enter");
  await expect(
    transcript.getByText("Got it: Mention the v2 API."),
  ).toBeVisible();

  // It asks for an approval; the session waits on the person.
  await expect(page.getByText("Waiting on a person")).toBeVisible();
  const session = page.url();
  // The sidebar counts it, and Home lists the question; it opens the
  // session, where it is answered.
  await expect(
    page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("link", { name: "Overview" }),
  ).toHaveAccessibleDescription(/1 agent session waiting on you/);
  await page.goto(`/${seeded.slug}`);
  const asks = page.getByRole("region", { name: "Agents ask you" });
  await expect(asks).toBeVisible();
  // The session is listed once: it waits on me, so it is not also "at work".
  await expect(
    page.getByRole("region", { name: "Agents at work" }),
  ).toBeHidden();
  // A request is reviewed with its context before it can be approved.
  await expect(asks.getByText(/Run the database migration/)).toBeVisible();
  await expect(asks.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await asks.getByRole("button", { name: "Review" }).click();
  await expect(asks.getByRole("button", { name: "Approve" })).toBeVisible();
  await asks
    .getByRole("link", { name: "Add a changelog for refunds." })
    .click();
  await expect(page).toHaveURL(session);
  await transcript.getByRole("button", { name: "Approve" }).click();
  await expect(
    transcript.getByText(/approved “Run the database migration”/),
  ).toBeVisible();
  await expect(
    transcript.getByText("Approved: Run the database migration."),
  ).toBeVisible();

  // It completes with its summary; nothing is left to steer.
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Added CHANGES.md describing refunds over the API.").first(),
  ).toBeVisible();
  await expect(page.getByText("CHANGES.md").first()).toBeVisible();
  await expect(page.getByLabel("Message the agent")).toBeHidden();

  // The overview shows it among recent sessions.
  await page.getByRole("link", { name: "Back to the Factory" }).click();
  await expect(page.getByText("Add a changelog for refunds.")).toBeVisible();
  expect(output).toContain("Session ");
});
