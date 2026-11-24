import { test, expect, type Page } from "@playwright/test";
import { seedWorkspace, signIn } from "../helpers/seed";
import { fillMarkdown } from "../helpers/editor";
import { FAKE_SLACK_APP } from "../../scripts/e2e-fakes/slack";

// Lictory Channels synced with Slack, against the browser suite's Slack
// (scripts/e2e-fakes/slack.ts): an administrator connects the organization's
// Slack app, a channel is linked to a Slack channel, a Slack message appears
// live, a reply written in Lictory reaches Slack in its thread, and an edit
// made in Slack updates the message, which Lictory never offers to edit.

const fakeSlack = () => {
  const url = process.env.E2E_FAKE_SLACK_URL;
  if (!url)
    throw new Error("E2E_FAKE_SLACK_URL is set by scripts/test-e2e.ts.");
  return url;
};
async function slack<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${fakeSlack()}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`fake Slack ${path}: ${response.status}`);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// The browser leaves for Slack's authorize page; the fake answers it with
// the redirect back to Lictory, as Slack does after "Allow".
async function routeSlackAuthorize(page: Page) {
  await page.route("https://slack.com/oauth/v2/authorize**", async (route) => {
    const url = new URL(route.request().url());
    const answer = await fetch(`${fakeSlack()}${url.pathname}${url.search}`, {
      redirect: "manual",
    });
    await route.fulfill({
      status: 302,
      headers: { location: answer.headers.get("location") ?? "/" },
    });
  });
}

type SlackMessage = {
  ts: string;
  text: string;
  thread_ts?: string;
  username?: string;
};

test("a channel synced with Slack shows both sides of one conversation @smoke", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Slack sync",
    key: "SLK",
    users: ["Ada Admin"],
  });
  const [ada] = seeded.users;
  const run = seeded.slug.split("-").at(-1)!.toUpperCase();
  const slackChannel = `C0E2E${run}`;
  await slack("/__fake/slack/events-url", {
    url: `${process.env.E2E_PLATFORM_URL}/api/slack/events/${seeded.organizationId}`,
  });
  await slack("/__fake/slack/people", {
    id: "UADA",
    name: "Ada Admin",
    email: ada!.email,
  });
  await slack("/__fake/slack/people", {
    id: "UINES",
    name: "Ines Agency",
    email: "ines@agency.test",
  });
  await slack("/__fake/slack/channels", {
    id: slackChannel,
    name: `general-${run.toLowerCase()}`,
  });

  // Connect: save the app created from the manifest, then install it.
  await signIn(page, ada!.email);
  await routeSlackAuthorize(page);
  await page.goto(`/${seeded.slug}/settings/integrations`);
  const section = page.locator("#slack");
  await expect(section.getByLabel("Slack app manifest")).toContainText(
    `/api/slack/events/${seeded.organizationId}`,
  );
  await section.getByLabel("App ID").fill(FAKE_SLACK_APP.appId);
  await section.getByLabel("Client ID").fill(FAKE_SLACK_APP.clientId);
  await section.getByLabel("Client Secret").fill(FAKE_SLACK_APP.clientSecret);
  await section.getByLabel("Signing Secret").fill(FAKE_SLACK_APP.signingSecret);
  await section.getByRole("button", { name: "Save app" }).click();
  await expect(section.getByText("Not installed yet")).toBeVisible();
  await section.getByRole("button", { name: "Install in Slack" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${seeded.slug}/settings/integrations`),
  );
  await expect(section.getByText("Connected", { exact: true })).toBeVisible();
  await expect(section.getByText(FAKE_SLACK_APP.teamName)).toBeVisible();

  // Link a new channel to the Slack channel.
  await page.goto(`/${seeded.slug}/channels`);
  await page.getByRole("button", { name: "New channel" }).first().click();
  const create = page.getByRole("dialog", { name: "New channel" });
  await create.getByLabel("Name").fill("launch");
  await create.getByRole("button", { name: "Create channel" }).click();
  await expect(
    page.getByRole("heading", { name: "launch", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Channel actions" }).click();
  await page.getByRole("menuitem", { name: "Link to Slack channel…" }).click();
  const link = page.getByRole("dialog", { name: "Link to a Slack channel" });
  await link.getByRole("combobox", { name: "Slack channel" }).click();
  await page
    .getByRole("option", { name: `general-${run.toLowerCase()}` })
    .click();
  await link.getByRole("button", { name: "Link channel" }).click();
  await expect(link).toBeHidden();
  await expect(page.getByTestId("slack-sync-status")).toHaveAccessibleName(
    `Synced with #general-${run.toLowerCase()} in Slack`,
  );

  // Someone in Slack writes: it appears live, marked as Slack's.
  const { ts } = await slack<{ ts: string }>("/__fake/slack/say", {
    channel: slackChannel,
    user: "UINES",
    text: "Launch checklist is *ready*",
  });
  const log = page.getByRole("log", { name: "Messages in #launch" });
  const fromSlack = log
    .locator("[data-message-id]")
    .filter({ hasText: "Launch checklist is" });
  await expect(fromSlack).toBeVisible({ timeout: 20_000 });
  await expect(fromSlack.getByText("Ines Agency (Slack)")).toBeVisible();
  await expect(fromSlack.locator("strong", { hasText: "ready" })).toBeVisible();

  // Only Slack edits it: Lictory offers no edit or delete.
  await fromSlack.hover();
  await fromSlack.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Edit message" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Delete message" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A reply in Lictory reaches Slack, in the same thread, as Ada.
  await fromSlack.hover();
  await fromSlack.getByRole("button", { name: "Reply in thread" }).click();
  const thread = page.getByRole("complementary", { name: "Thread" });
  const reply = await fillMarkdown(
    thread,
    "Reply in thread",
    "Shipping it **today**",
  );
  await reply.press("Enter");
  await expect(thread.getByText("Shipping it")).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await slack<SlackMessage[]>(
            `/__fake/slack/messages?channel=${slackChannel}`,
          )
        ).find((m) => m.thread_ts === ts && m.text === "Shipping it *today*")
          ?.username ?? null,
      { timeout: 30_000 },
    )
    .toBe("Ada Admin");

  // An edit in Slack updates the message in Lictory.
  await slack("/__fake/slack/edit", {
    channel: slackChannel,
    ts,
    text: "Launch checklist is ready, two items left",
  });
  await expect(
    log.getByText("Launch checklist is ready, two items left"),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(fromSlack.getByText("(edited)")).toBeVisible();
});
