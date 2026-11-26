import { test, expect } from "@playwright/test";
import { newPerson, seedWorkspace, signIn } from "../helpers/seed";
import { fillMarkdown, richEditor } from "../helpers/editor";
import { controlZeroConnection } from "../helpers/zero-socket";

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
  // The palette jumps to it from anywhere.
  await page.goto(`/${seeded.slug}`);
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search" }).fill("payments");
  await palette.getByRole("option", { name: /#payments-team/ }).click();
  await expect(page).toHaveURL(channelUrl);

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
  // Screen readers hear it on Ben's page, once; Ada sent it, so hers is
  // quiet.
  await expect(second.page.locator("[data-announcer]")).toContainText(
    "Ada Product: Customers want refunds over the API",
  );
  await expect(page.locator("[data-announcer]")).not.toContainText(
    "Customers want refunds",
  );

  // Ben replies in the thread, from the keyboard: the message's actions
  // are one tab stop that focus reveals, and arrow keys move inside it.
  const actions = benMessage.getByRole("toolbar", { name: "Message actions" });
  await actions.getByRole("button").first().focus();
  await expect(actions).toBeVisible();
  await second.page.keyboard.press("End");
  await second.page.keyboard.press("ArrowLeft");
  await expect(
    actions.getByRole("button", { name: "Reply in thread" }),
  ).toBeFocused();
  await second.page.keyboard.press("Enter");
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
  await page.goto(`/${seeded.slug}/inbox?view=updates`);
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

test("a message sent while the connection is down says it is not sent yet, then is delivered", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Channels offline",
    key: "CHO",
    users: ["Ada Product"],
  });
  await signIn(page, seeded.users[0]!.email);
  const zero = await controlZeroConnection(page);
  await page.goto(`/${seeded.slug}/channels`);
  await page.getByRole("button", { name: "New channel" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New channel" });
  await dialog.getByLabel("Name").fill("Ops");
  await dialog.getByRole("button", { name: "Create channel" }).click();
  await expect(
    page.getByRole("heading", { name: "ops", level: 1 }),
  ).toBeVisible();
  const log = page.getByRole("log", { name: "Messages in #ops" });
  await richEditor(page, "Message #ops");

  // The connection drops: the composer says so, and a message sent now says
  // in words that it has not reached anyone yet.
  await zero.interrupt();
  const note = page.locator("[data-connection-note]");
  await expect(note).toHaveText(
    /Reconnecting… Messages you send now are delivered/,
  );
  const composer = await fillMarkdown(page, "Message #ops", "Deploy paused");
  await composer.press("Enter");
  const message = log
    .locator("[data-message-id]")
    .filter({ hasText: "Deploy paused" });
  await expect(message).toBeVisible();
  await expect(message.locator('[data-delivery="waiting"]')).toHaveText(
    "Not sent yet: it’s delivered when the connection is back",
  );

  // Back: the message is delivered and the notes go away.
  zero.restore();
  await expect(message.locator("[data-delivery]")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(note).toHaveCount(0);
  await expect(message).not.toHaveAttribute("data-pending");
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("a tap on a message shows its actions, and promoting it is reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await seedWorkspace({
      name: "Channels touch",
      key: "CHT",
      users: ["Ada Product"],
    });
    const channelId = crypto.randomUUID();
    await seeded.command({
      type: "createChannel",
      channelId,
      kind: "public",
      name: "payments",
      topic: "Refunds",
    });
    await seeded.command(
      { type: "joinChannel", channelId },
      seeded.users[0]!.id,
    );
    await signIn(page, seeded.users[0]!.email);
    await page.goto(`/${seeded.slug}/channels/${channelId}`);
    const composer = await fillMarkdown(
      page,
      "Message #payments",
      "Partners want refunds over the API",
    );
    await composer.press("Enter");
    const message = page
      .getByRole("log", { name: "Messages in #payments" })
      .locator("[data-message-id]")
      .filter({ hasText: "Partners want refunds over the API" });
    const actions = message.getByRole("toolbar", { name: "Message actions" });
    // No hover on a phone: the actions stay out of the way until the
    // message is tapped.
    await expect(actions).toHaveCSS("opacity", "0");
    await message.getByText("Partners want refunds over the API").tap();
    await expect(actions).toHaveCSS("opacity", "1");
    await actions.getByRole("button", { name: "More actions" }).tap();
    await page.getByRole("menuitem", { name: "Promote to proposal" }).tap();
    await expect(
      page.getByRole("dialog", { name: "Promote to proposal" }),
    ).toBeVisible();
  });
});
