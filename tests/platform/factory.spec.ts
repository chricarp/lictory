import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { seedWorkspace, signIn } from "../helpers/seed";
import { fillMarkdown } from "../helpers/editor";

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
  // Inside the desktop app (its preload's bridge, recorded): an agent
  // waiting on the person raises the dock badge until it is answered.
  await page.addInitScript(() => {
    const badges: number[] = [];
    Object.assign(window, {
      desktopBadges: badges,
      lictoryDesktop: {
        platform: "linux",
        version: "0.0.0-test",
        notify: () => undefined,
        setBadge: (count: number) => badges.push(count),
        setOrganizationName: () => undefined,
        onNavigate: () => () => undefined,
      },
    });
  });
  const badge = () =>
    page.evaluate(
      () =>
        (window as unknown as { desktopBadges: number[] }).desktopBadges.at(
          -1,
        ) ?? 0,
    );
  await signIn(page, seeded.owner.email);

  // Add a runner: the dialog shows a one-time token in the commands.
  await page.goto(`/${seeded.slug}/factory/runners`);
  // The Factory's own tabs (the sidebar has the same destinations).
  const tabs = page.getByRole("navigation", { name: "Factory" });
  await expect(
    tabs.getByRole("link", { name: "Runners", exact: true }),
  ).toHaveAttribute("aria-current", "page");
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
  // The one-time token is valid for an hour, and says so.
  await expect(dialog.getByText(/expires in 60 minutes/)).toBeVisible();
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
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  // Its row opens what the runner reported: machine, version, isolation.
  const runnerRow = page.getByRole("button", {
    name: "e2e-runner",
    exact: true,
  });
  await runnerRow.click();
  await expect(runnerRow).toHaveAttribute("aria-expanded", "true");
  const detail = page.locator("[data-runner-detail]");
  await expect(detail.getByText("Isolation")).toBeVisible();
  await expect(detail.getByText(/in its own git worktree/)).toBeVisible();
  await expect(detail.getByText("No sessions on it yet.")).toBeVisible();
  await runnerRow.click();
  await expect(detail).toBeHidden();

  // Create an agent the person owns.
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
  // No code host is connected: the dialog says, before it starts, that
  // what the agent changes will not be kept.
  await expect(
    start.getByText(
      "No repository: it works in a scratch workspace, and files it changes are discarded when the session ends.",
    ),
  ).toBeVisible();
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

  // Steer it with a message, in the shared rich composer.
  const steer = await fillMarkdown(
    page,
    "Message the agent",
    "Mention the v2 API.",
  );
  await steer.press("Enter");
  await expect(
    transcript.getByText("Got it: Mention the v2 API."),
  ).toBeVisible();

  // It asks for an approval; the session waits on the person.
  await expect(
    page.locator("[data-page-header]").getByText("Waiting on you"),
  ).toBeVisible();
  const session = page.url();
  // The sidebar counts it, and Home lists the question with everything else
  // waiting on me; it opens the session, where it is answered.
  await expect(
    page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("link", { name: "Factory", exact: true }),
  ).toHaveAccessibleDescription(/1 waiting on you, from an agent/);
  await expect.poll(badge).toBe(1);
  await page.goto(`/${seeded.slug}`);
  const asks = page.getByRole("region", { name: "Waiting on you" });
  await expect(asks).toBeVisible();
  // The session is listed once: it waits on me, so it is not also "at work".
  await expect(
    page.getByRole("region", { name: /^Agents (at work|waiting)/ }),
  ).toBeHidden();
  // A request is reviewed with its context before it can be approved.
  await expect(asks.getByText(/Run the database migration/)).toBeVisible();
  // The row names the exact action, not only the agent's title for it.
  await expect(asks.getByText("$ bun run db:migrate")).toBeVisible();
  await expect(asks.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await asks.getByRole("button", { name: "Review" }).click();
  await expect(asks.getByRole("button", { name: "Approve" })).toBeVisible();
  await asks
    .getByRole("link", { name: "Add a changelog for refunds." })
    .click();
  await expect(page).toHaveURL(session);
  // The request waits above the composer, with its context.
  await page
    .getByRole("region", { name: "Waiting on you" })
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(
    transcript.getByText(/approved “Run the database migration”/),
  ).toBeVisible();
  await expect(
    transcript.getByText("Approved: Run the database migration."),
  ).toBeVisible();
  await expect.poll(badge).toBe(0);

  // It completes with its summary; nothing is left to steer. With no
  // repository the file it wrote was discarded, so the outcome reads as
  // work not kept, and the summary as the agent's report.
  await expect(
    page
      .locator("[data-page-header]")
      .getByText("Work not kept", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The agent reports it is done, but its work was not kept"),
  ).toBeVisible();
  await expect(
    page.getByText(/the file it changed was discarded with its scratch/),
  ).toBeVisible();
  await expect(
    page.getByText("Added CHANGES.md describing refunds over the API.").first(),
  ).toBeVisible();
  await expect(page.getByText("CHANGES.md").first()).toBeVisible();
  await expect(page.getByLabel("Message the agent")).toBeHidden();

  // The overview shows it among recent sessions, and so does the Sessions
  // list, narrowed by where sessions stand. (The workspace announcer's live
  // region also says "Forge finished …", so the session is found as a link.)
  await page.getByRole("link", { name: "Back to the Factory" }).click();
  await expect(
    page.getByRole("link", { name: "Add a changelog for refunds." }),
  ).toBeVisible();
  await tabs.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(page).toHaveURL(/\/factory\/sessions$/);
  await page.getByRole("radio", { name: "Completed" }).click();
  await expect(
    page.getByRole("link", { name: "Add a changelog for refunds." }),
  ).toBeVisible();
  // Every row says who ran it, who started it and for how long.
  const row = page
    .locator("[data-list-row]")
    .filter({ hasText: "Add a changelog for refunds." });
  await expect(row.getByText(/^ran \d+(s|m)/)).toBeVisible();
  await expect(row.getByText(/^Started /).last()).toBeVisible();
  await page.getByRole("radio", { name: "Failed" }).click();
  await expect(page.getByText("No failed sessions")).toBeVisible();
  // The runner's log says how the session ended, not only that it did.
  await expect
    .poll(() => output)
    .toMatch(
      /Session \S+ completed after .+ \(no repository linked: nothing pushed\)\./,
    );
});
