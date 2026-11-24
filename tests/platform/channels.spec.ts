import { test, expect } from "@playwright/test";
import { newPerson, seedWorkspace, signIn } from "../helpers/seed";
import { fillMarkdown, richEditor } from "../helpers/editor";

// Lictory Channels end to end: a channel is created, a message reaches a
// second person live, a thread reply mentions the author, the mention lands
// in the author's inbox and the message is promoted into a proposal that
// links back to the conversation.

test("a conversation in a channel becomes a proposal @smoke", async ({
  page,
  browser,
}) => {
  const seeded = await seedWorkspace({
    name: "Channels",
    key: "CHN",
    users: ["Ada Product", "Ben Engineer"],
    disciplines: { 1: "Engineering" },
  });
  const [ada, ben] = seeded.users;
  await signIn(page, ada!.email);
  await page.goto(`/${seeded.slug}/channels`);
  await page.getByRole("button", { name: "New channel" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New channel" });
  await dialog.getByLabel("Name").fill("Payments Team");
  await expect(dialog.getByText("Will be #payments-team")).toBeVisible();
  await dialog.getByRole("button", { name: "Create channel" }).click();
  await expect(page).toHaveURL(/\/channels\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "payments-team", level: 1 }),
  ).toBeVisible();
  const channelUrl = page.url();
  // The sidebar lists the joined channel.
  await expect(
    page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name: "payments-team" }),
  ).toBeVisible();

  // Ben opens it, reads it and joins.
  const second = await newPerson(browser);
  await signIn(second.page, ben!.email);
  await second.page.goto(channelUrl);
  await second.page
    .getByRole("button", { name: "Join channel" })
    .first()
    .click();
  const benComposer = await richEditor(second.page, "Message #payments-team");
  await expect(benComposer).toBeVisible();

  // Ada posts; Ben sees it without reloading.
  const composer = await fillMarkdown(
    page,
    "Message #payments-team",
    "Customers want refunds over the API",
  );
  await composer.press("Enter");
  const log = page.getByRole("log", { name: "Messages in #payments-team" });
  await expect(
    log.getByText("Customers want refunds over the API"),
  ).toBeVisible();
  const benLog = second.page.getByRole("log", {
    name: "Messages in #payments-team",
  });
  const benMessage = benLog
    .locator("[data-message-id]")
    .filter({ hasText: "Customers want refunds over the API" });
  await expect(benMessage).toBeVisible();

  // Ben replies in the thread and mentions Ada.
  await benMessage.hover();
  await benMessage.getByRole("button", { name: "Reply in thread" }).click();
  await expect(second.page).toHaveURL(/\?thread=/);
  const thread = second.page.getByRole("complementary", { name: "Thread" });
  const reply = await fillMarkdown(
    thread,
    "Reply in thread",
    `Partial refunds too, @[Ada Product](mention:${ada!.id})?`,
  );
  await reply.press("Enter");
  await expect(thread.getByText(/Partial refunds too/)).toBeVisible();

  // Ada sees the reply count live and the mention in her inbox.
  const adaMessage = log
    .locator("[data-message-id]")
    .filter({ hasText: "Customers want refunds over the API" });
  await expect(
    adaMessage.getByRole("button", { name: /1 reply/ }),
  ).toBeVisible();
  await page.goto(`/${seeded.slug}/inbox`);
  await expect(
    page.getByText("Ben Engineer mentioned you in #payments-team"),
  ).toBeVisible({ timeout: 20_000 });

  // Ada promotes the message (with its thread) into a proposal.
  await page.goto(channelUrl);
  await adaMessage.hover();
  await adaMessage.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Promote to proposal" }).click();
  const promote = page.getByRole("dialog", { name: "Promote to proposal" });
  await expect(promote.getByLabel("Title")).toHaveValue(
    "Customers want refunds over the API",
  );
  await promote.getByLabel("Title").fill("Refunds over the API");
  await promote.getByRole("button", { name: "Create proposal" }).click();
  await expect(promote).toBeHidden();
  // The card in the thread links the new proposal; Ben sees it too.
  await adaMessage.getByRole("button", { name: /2 replies/ }).click();
  const adaThread = page.getByRole("complementary", { name: "Thread" });
  // Exactly one proposal, however the dialog was submitted.
  await expect(adaThread.getByText("Proposal created")).toHaveCount(1);
  await expect(adaThread.getByText(/CHN-1/)).toBeVisible();
  await expect(
    second.page
      .getByRole("complementary", { name: "Thread" })
      .getByText("Proposal created"),
  ).toBeVisible();
  // The proposal quotes the conversation and links back to it.
  await page.goto(seeded.itemPath(1));
  await expect(page.getByText("Refunds over the API").first()).toBeVisible();
  await expect(
    page.getByText("Customers want refunds over the API").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "view the conversation" }),
  ).toHaveAttribute("href", /\/channels\/[0-9a-f-]{36}\?/);
  await second.context.close();
});
