import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createAgent } from "@lictory/core/factory/agents";
import { createRunnerRegistration } from "@lictory/core/factory/runners";
import {
  setAutonomyPolicy,
  setDefinitionOfDone,
} from "@lictory/core/claims/service";
import { defaultAutonomyPolicy } from "@lictory/core/claims/contracts";
import { installFactoryLoop } from "@lictory/core/factory/loop";
import { installCodeLoop } from "@lictory/core/code/loop";
import type { FakeScript } from "@lictory/runner/harness/fake";
import {
  FAKE_GITHUB_SITE,
  FAKE_GITHUB_TOKEN,
} from "../../scripts/e2e-fakes/code-hosts";
import { clientAddress } from "../helpers/client-address";
import {
  currentRevision,
  newPerson,
  seedItem,
  seedWorkspace,
  signIn,
  withDb,
  type Seeded,
} from "../helpers/seed";

// The whole code loop (docs/internals/code-hosts.md#the-code-loop), with a
// real lictory-runner (scripted harness) and the suite's stand-in for
// GitHub serving a real git repository: an agreed story in a Build project
// is dispatched to Forge, which works in the project's repository and
// pushes; its branch becomes a pull request on the item and in the
// session's thread; fake CI goes green and Hawk, the reviewer agent,
// approves the head; Bo merges and the item is Done with the delivered
// revision. On Autopilot, Lictory merges by itself under the policy.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

const cli = join(process.cwd(), "apps", "runner", "src", "cli.ts");
let runner: ChildProcess | undefined;
let home: string | undefined;
let output = "";

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus)
    console.log(`[runner output]\n${output}`);
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

// The people working on GitHub (the fake's own side).
const github = async (path: string, body?: unknown) => {
  const response = await fetch(`${process.env.E2E_FAKE_GITHUB_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, await response.clone().text()).toBeTruthy();
  return response.status === 204 ? null : ((await response.json()) as unknown);
};

// One script for the runner: Forge implements, Hawk reviews the head its
// prompt names.
const script: FakeScript = [
  {
    ifPrompt: {
      matches: "^Review pull request",
      then: [
        { say: "Reading the change." },
        {
          lictory: {
            tool: "reviewCodePullRequest",
            arguments: {
              organizationId: "{{organizationId}}",
              pullRequestId: "{{pullRequestId}}",
              expectedHeadSha: "{{headSha}}",
              decision: "approve",
              body: "Retries reuse the original transaction id; covered by a test.",
            },
          },
        },
        { summary: "Approved the head commit." },
      ],
      else: [
        // The dispatcher activates the claim as the session starts.
        { sleep: 1_000 },
        {
          writeFile: {
            path: "src/refunds.ts",
            content:
              "export const refund = (original: { transactionId: string }) => original.transactionId;\n",
          },
        },
        { summary: "Refunds reuse the original transaction id." },
      ],
    },
  },
];

async function startRunner(seeded: Seeded, baseURL: string) {
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
    [cli, "register", "--url", baseURL, "--token", token, "--name", "code"],
    { env, encoding: "utf8" },
  );
  expect(registered.status, registered.stderr + registered.stdout).toBe(0);
  runner = spawn("bun", [cli, "start", "--test-harness", scriptPath], { env });
  runner.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  runner.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
}

// An administrator connects the fake GitHub and links the repository to the
// project, as in code.spec.ts.
async function connectGitHub(page: Page, seeded: Seeded, repository: string) {
  await page.goto(`/${seeded.slug}/settings/code`);
  await page.getByRole("button", { name: "Connect a host" }).click();
  await page.getByRole("radio", { name: "Fine-grained token" }).click();
  await page.getByLabel("Host address").fill(FAKE_GITHUB_SITE);
  await page.getByLabel("Token", { exact: true }).fill(FAKE_GITHUB_TOKEN);
  await page.getByRole("button", { name: "Verify and connect" }).click();
  await expect(page.getByText("the secret is shown only once")).toBeVisible();
  const details = page.locator("code");
  const webhookUrl = (await details.nth(0).textContent())!;
  const secret = (await details.nth(1).textContent())!;
  await github("/__fake/hooks", { url: webhookUrl, secret });
  await page.getByRole("button", { name: "Link a repository" }).click();
  await page.getByLabel("Find a repository").fill(repository);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("radio", { name: repository }).check();
  await page.getByRole("button", { name: "Link to project" }).click();
  await expect(page.getByRole("link", { name: repository })).toBeVisible();
}

// A project on `level` with Forge implementing and Hawk reviewing, a ready
// story, and the runner started.
async function factoryWithCode(
  page: Page,
  baseURL: string,
  level: "build" | "autopilot",
) {
  const seeded = await seedWorkspace({
    name: level === "build" ? "Refund Works" : "Refund Autopilot",
    key: "RFD",
    users: ["Ada", "Bo"],
    disciplines: { 1: "Engineering" },
  });
  const [ada, bo] = seeded.users as [
    (typeof seeded.users)[number],
    (typeof seeded.users)[number],
  ];
  const repository = `acme/refunds-${crypto.randomUUID().slice(0, 8)}`;
  await github("/__fake/repos", { fullName: repository, git: true });
  await signIn(page, ada.email);
  await connectGitHub(page, seeded, repository);

  const suffix = crypto.randomUUID().slice(0, 6);
  const forge = await withDb((db) =>
    createAgent(db, ada.id, seeded.organizationId, {
      name: "Forge",
      handle: `forge${suffix}`,
      kind: "runner",
      harness: "claude-code",
      access: "write",
    }),
  );
  const hawk = await withDb((db) =>
    createAgent(db, bo.id, seeded.organizationId, {
      name: "Hawk",
      handle: `hawk${suffix}`,
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
    name: "refunds",
  });
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
  await startRunner(seeded, baseURL);
  // The policy checks its agents through the Factory's directory, which the
  // API installs at start; this process installs the loops the same way.
  await withDb(async (db) => {
    installFactoryLoop(db);
    installCodeLoop(db);
    if (level === "build")
      await setDefinitionOfDone(
        db,
        { userId: ada.id },
        {
          organizationId: seeded.organizationId,
          projectId: seeded.projectId,
          checks: [
            { id: "merged", kind: "pull_request_merged" },
            { id: "ci", kind: "checks_passed" },
            { id: "review", kind: "code_review_approved" },
          ],
        },
      );
    await setAutonomyPolicy(
      db,
      { userId: ada.id },
      {
        organizationId: seeded.organizationId,
        projectId: seeded.projectId,
        policy: {
          ...defaultAutonomyPolicy,
          level,
          implementerAgentIds: [forge.id],
          reviewerAgentId: hawk.id,
          reportingChannelId: channelId,
        },
      },
    );
  });
  return { seeded, ada, bo, repository, channelId };
}

// The dispatched session's card in the channel links its pull request, and
// Forge says it opened it.
async function pullRequestInThread(
  page: Page,
  seeded: Seeded,
  channelId: string,
) {
  await page.goto(`/${seeded.slug}/channels/${channelId}`);
  const card = page.getByRole("article", { name: /^Forge session/ }).first();
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card.getByText("RFD-1").first()).toBeVisible();
  // Named by its number and state, not only "Pull request".
  await expect(
    card.getByRole("link", { name: /^Pull request #\d+ (open|merged)$/ }),
  ).toBeVisible({ timeout: 120_000 });
  await page
    .locator("[data-message-id]")
    .filter({ has: card })
    .first()
    .getByRole("button", { name: /\d+ repl/ })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: /thread/i })
      .getByText(/Opened pull request #1 RFD-1: Refund retries/),
  ).toBeVisible({ timeout: 30_000 });
}

test("a dispatched session's pull request goes green, the reviewer agent approves it and a person's merge delivers the item", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  const { seeded, bo, repository, channelId } = await factoryWithCode(
    page,
    baseURL!,
    "build",
  );
  await pullRequestInThread(page, seeded, channelId);

  // The pull request is on the item, from Forge's branch.
  await page.goto(seeded.itemPath(1));
  const code = page.locator("[data-item-code]");
  const link = code.getByRole("link", { name: "#1 RFD-1: Refund retries" });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(code.getByText(/^lictory\/rfd-1-refund-retries-/)).toBeVisible();
  const pulls = (await github(`/__fake/repos/${repository}/pulls`)) as {
    head: string;
    author: string;
  }[];
  expect(pulls).toHaveLength(1);
  expect(pulls[0]?.head).toMatch(/^lictory\/rfd-1-refund-retries-/);

  // Before CI reports, the CI check waits: no check is no evidence.
  const done = page.getByRole("region", { name: "Definition of Done" });
  await expect(
    done.getByText(/The code host has reported no checks for the head commit/),
  ).toBeVisible({ timeout: 30_000 });

  // CI goes green on the host; Hawk's review session approves the head.
  await github(`/__fake/repos/${repository}/pulls/1/checks`, {
    name: "ci",
    state: "success",
  });
  await expect(done.getByText("Hawk approved the head commit")).toBeVisible({
    timeout: 120_000,
  });
  await expect(done.getByText("2 / 3 checks")).toBeVisible({
    timeout: 120_000,
  });
  await expect(done.getByText("1 required check passed.")).toBeVisible();

  // Build: Bo merges, from the pull request's page, the head he sees.
  const second = await newPerson(browser);
  try {
    await signIn(second.page, bo.email);
    await second.page.goto(seeded.itemPath(1));
    await second.page
      .locator("[data-item-code]")
      .getByRole("link", { name: "#1 RFD-1: Refund retries" })
      .click();
    // The agent's review shows beside it, with the person it acts for.
    const reviews = second.page.getByRole("region", {
      name: "Reviews in Lictory",
    });
    await expect(reviews).toContainText("Hawk");
    await expect(reviews).toContainText("via Bo");
    // The merge box counts the same evidence: CI and Hawk's approval.
    const box = second.page.locator("[data-merge-box]");
    await expect(box.getByText("Checks passed.")).toBeVisible();
    await expect(box.getByText(/^Approved at /)).toBeVisible();
    await expect(box.getByText(/By Hawk via Bo/)).toBeVisible();
    // Allowed by the policy, and said plainly in the headline a person
    // reads before merging: only an agent read the code.
    await expect(
      box.getByText(
        /^Checks passed and it merges cleanly into main\. Only an agent approved it \(Hawk via Bo[^)]*\): no person has reviewed this code\.$/,
      ),
    ).toBeVisible();
    await second.page
      .getByRole("button", { name: "Merge", exact: true })
      .click();
    await second.page
      .getByRole("button", { name: /^Merge [0-9a-f]{7}$/ })
      .click();
    await expect(second.page.getByText("Merged", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    // The header names Bo, who merged it, not the agent that opened it.
    const header = second.page.locator("[data-pull-request-header]");
    await expect(header).toContainText(/Bo\s*merged into/);
    await expect(header).toContainText(/opened by.*Forge/);
  } finally {
    await second.context.close();
  }

  // The item is Done by evidence, with the revision it delivered, and
  // keeps that evidence; its history names who merged and who reviewed.
  await page.goto(seeded.itemPath(1));
  await expect(page.getByText("Delivered revision 1")).toBeVisible({
    timeout: 30_000,
  });
  await expect(done.getByText("3 / 3 checks")).toBeVisible();
  await expect(page.getByText(/merged pull request #1/).first()).toBeVisible();
  await expect(
    page.getByText(/Hawk via Bo .*approved pull request #1/).first(),
  ).toBeVisible();
  // The runner's log names the outcome and the branch it pushed.
  expect(output).toMatch(
    /Session \S+ completed after .+; pushed branch \S+, which Lictory opens or updates a pull request for\./,
  );
});

test("on Autopilot Lictory merges the approved, green pull request itself under the policy", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(420_000);
  const { seeded, repository, channelId } = await factoryWithCode(
    page,
    baseURL!,
    "autopilot",
  );
  await pullRequestInThread(page, seeded, channelId);

  // Hawk approves, but CI has not reported: Autopilot waits, and the pull
  // request page says what for.
  await page.goto(seeded.itemPath(1));
  await expect(
    page.getByText(/Hawk via Bo .*approved pull request #1/).first(),
  ).toBeVisible({ timeout: 120_000 });
  const done = page.getByRole("region", { name: "Definition of Done" });
  await expect(
    done.getByText(/The code host has reported no checks for the head commit/),
  ).toBeVisible();
  const before = (await github(`/__fake/repos/${repository}/pulls`)) as {
    state: string;
  }[];
  expect(before[0]?.state).toBe("open");
  await page
    .locator("[data-item-code]")
    .getByRole("link", { name: "#1 RFD-1: Refund retries" })
    .click();
  await expect(page.locator("[data-autopilot-waits]")).toContainText(
    "the code host has reported no checks for this commit yet",
  );

  await github(`/__fake/repos/${repository}/pulls/1/checks`, {
    name: "ci",
    state: "success",
  });

  // Nobody merges: Autopilot does, once CI passed and Hawk approved.
  await page.goto(seeded.itemPath(1));
  await expect(page.getByText("Delivered revision 1")).toBeVisible({
    timeout: 180_000,
  });
  const pulls = (await github(`/__fake/repos/${repository}/pulls`)) as {
    state: string;
    comments: { body: string }[];
  }[];
  expect(pulls[0]?.state).toBe("merged");
  expect(pulls[0]?.comments.map((c) => c.body).join("\n")).toContain(
    "Autopilot · policy set by Ada",
  );
  await page
    .locator("[data-item-code]")
    .getByRole("link", { name: "#1 RFD-1: Refund retries" })
    .click();
  const merged = page.getByRole("region", { name: "Merged" });
  await expect(
    merged.getByText(/by Autopilot · policy set by Ada/),
  ).toBeVisible();
  // What the merge rested on stays on the page.
  await expect(merged.getByText("Checks passed.")).toBeVisible();
  // The header names Autopilot as the merger, and the agent as the opener.
  const header = page.locator("[data-pull-request-header]");
  await expect(header).toContainText(/Autopilot\s*merged into/);
  await expect(header).toContainText(/opened by.*Forge/);
});
