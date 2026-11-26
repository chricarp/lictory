import { test, expect } from "@playwright/test";
import {
  FAKE_GITHUB_SITE,
  FAKE_GITHUB_TOKEN,
} from "../../scripts/e2e-fakes/code-hosts";
import { clientAddress } from "../helpers/client-address";
import { newPerson, seedItem, seedWorkspace, signIn } from "../helpers/seed";

// The Code module end to end (docs/internals/code-hosts.md), against the
// browser suite's stand-in for GitHub Enterprise Server
// (scripts/e2e-fakes/code-hosts.ts, through the real GitHub adapter): an
// administrator connects the host and gets the webhook secret once, links a
// repository to the project, a pull request naming PAY-1 is opened on the
// host and its webhook makes it appear on the item, its checks go green, and
// an engineer merges it from Lictory for the head they saw.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
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

test("@smoke a pull request naming an item shows on it, goes green and is merged from Lictory", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const seeded = await seedWorkspace({
    name: "Code loop",
    key: "PAY",
    users: ["Ada Owner", "Ben Engineer"],
    disciplines: { 1: "Engineering" },
  });
  await seedItem(seeded, { type: "Task", title: "Refunds over the API" });
  const repository = `acme/pay-${crypto.randomUUID().slice(0, 8)}`;
  await github("/__fake/repos", { fullName: repository });

  const ada = await newPerson(browser);
  const ben = await newPerson(browser);
  try {
    await signIn(ada.page, seeded.owner.email);
    await signIn(ben.page, seeded.users[1]!.email);

    // An administrator connects GitHub with a fine-grained token.
    await ada.page.goto(`/${seeded.slug}/settings/code`);
    await ada.page.getByRole("button", { name: "Connect a host" }).click();
    await ada.page.getByRole("radio", { name: "Fine-grained token" }).click();
    await ada.page.getByLabel("Host address").fill(FAKE_GITHUB_SITE);
    await ada.page.getByLabel("Token", { exact: true }).fill(FAKE_GITHUB_TOKEN);
    await ada.page.getByRole("button", { name: "Verify and connect" }).click();
    // The webhook secret is shown once, to paste into the host.
    await expect(
      ada.page.getByText("the secret is shown only once"),
    ).toBeVisible();
    const details = ada.page.locator("code");
    const webhookUrl = (await details.nth(0).textContent())!;
    const secret = (await details.nth(1).textContent())!;
    expect(webhookUrl).toMatch(/\/api\/code\/webhooks\/[0-9a-f-]{36}$/);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    await github("/__fake/hooks", { url: webhookUrl, secret });
    await expect(ada.page.getByText("as @lictory-bot")).toBeVisible();

    // The project administrator links the repository to the project.
    await ada.page.getByRole("button", { name: "Link a repository" }).click();
    await ada.page.getByLabel("Find a repository").fill(repository);
    await ada.page.getByRole("button", { name: "Search", exact: true }).click();
    await ada.page.getByRole("radio", { name: repository }).check();
    await ada.page.getByRole("button", { name: "Link to project" }).click();
    await expect(
      ada.page.getByRole("link", { name: repository }),
    ).toBeVisible();

    // Someone opens a pull request on GitHub naming PAY-1.
    await github(`/__fake/repos/${repository}/pulls`, {
      head: "pay-1-refunds",
      title: "PAY-1: refunds over the API",
      body: "Reuses the original transaction id.",
    });
    await github(`/__fake/repos/${repository}/pulls/1/checks`, {
      name: "ci",
      state: "pending",
    });

    // The engineer sees it on the item, live, with its checks running.
    await ben.page.goto(seeded.itemPath(1));
    const code = ben.page.locator("[data-item-code]");
    await expect(
      code.getByRole("link", { name: "#1 PAY-1: refunds over the API" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      code.getByRole("img", { name: "Checks running" }),
    ).toBeVisible();
    await expect(code.getByText("pay-1-refunds")).toBeVisible();

    // CI finishes on the host; the item follows without a reload.
    await github(`/__fake/repos/${repository}/pulls/1/checks`, {
      name: "ci",
      state: "success",
    });
    await expect(code.getByRole("img", { name: "Checks passed" })).toBeVisible({
      timeout: 30_000,
    });

    // The engineer merges it from its page, for the head they see.
    await code
      .getByRole("link", { name: "#1 PAY-1: refunds over the API" })
      .click();
    await expect(
      ben.page.getByRole("heading", { name: "PAY-1: refunds over the API" }),
    ).toBeVisible();
    await expect(ben.page.getByText("Ready to merge")).toBeVisible();
    // Nothing blocks it, but nobody reviewed it: the summary says so.
    await expect(
      ben.page.getByText(
        "Nothing blocks merging into main, but nobody approved it.",
      ),
    ).toBeVisible();
    // Opening the files view reads them from the host.
    await ben.page.getByRole("tab", { name: "Files changed" }).click();
    await expect(ben.page.getByText("src/refunds.ts")).toBeVisible();
    await ben.page.getByRole("tab", { name: "Conversation" }).click();
    await ben.page.getByRole("button", { name: "Merge", exact: true }).click();
    await ben.page.getByRole("button", { name: /^Merge [0-9a-f]{7}$/ }).click();
    await expect(ben.page.getByText("Merged", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const pulls = (await github(`/__fake/repos/${repository}/pulls`)) as {
      state: string;
    }[];
    expect(pulls[0]?.state).toBe("merged");

    // Back on the item, the pull request shows as merged.
    await ben.page.goto(seeded.itemPath(1));
    await expect(
      ben.page.locator("[data-item-code]").getByRole("img", { name: "Merged" }),
    ).toBeVisible();
  } finally {
    await ada.context.close();
    await ben.context.close();
  }
});
