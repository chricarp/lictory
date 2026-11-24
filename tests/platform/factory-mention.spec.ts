import { test, expect } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { createAgent } from "@lictory/core/factory/agents";
import { richEditor } from "../helpers/editor";
import { seedWorkspace, signIn, withDb } from "../helpers/seed";

// Asking an agent in a channel keeps words with the people who wrote them
// (docs/internals/factory.md#sessions-in-channels): a typed or picked
// `@handle` is one mention (never "@@forge"), the session's title is the
// person's words, and the transcript shows the channel context Lictory adds
// as its own folded event, by channel name, never under the person's name.

test("a typed or picked agent mention is stored once, and the session shows the person's words apart from Lictory's context", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Mentions",
    key: "MEN",
    users: ["Ada"],
  });
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
    name: "builds",
  });
  await signIn(page, seeded.owner.email);
  await page.goto(`/${seeded.slug}/channels/${channelId}`);
  const composer = await richEditor(page, "Message #builds");

  // Typed through: "@handle" then a space becomes the mention.
  await composer.click();
  await page.keyboard.type(`@${handle}`);
  await page.keyboard.type(" draft the refund webhook docs");
  await expect(
    composer.locator(`[data-type="mention"][data-kind="agent"]`),
  ).toHaveCount(1);
  await expect(composer).not.toContainText("@@");
  await page.keyboard.press("Enter");

  // Picked from the suggestions.
  await composer.click();
  await page.keyboard.type(`@${handle.slice(0, 5)}`);
  await page.getByRole("option", { name: /Forge/ }).first().click();
  await page.keyboard.type("list the open refunds");
  await expect(
    composer.locator(`[data-type="mention"][data-kind="agent"]`),
  ).toHaveCount(1);
  await page.keyboard.press("Enter");

  for (const words of [
    "draft the refund webhook docs",
    "list the open refunds",
  ]) {
    const message = page
      .locator("[data-message-id]")
      .filter({ hasText: words })
      .first();
    await expect(message).toContainText(`@${handle}`);
    await expect(message).not.toContainText("@@");
  }

  // Both started sessions; their titles are the person's words.
  await expect
    .poll(
      () =>
        withDb((db) =>
          db
            .select({ title: s.agentSession.title })
            .from(s.agentSession)
            .where(eq(s.agentSession.organizationId, seeded.organizationId))
            .then((rows) => rows.map((r) => r.title).sort()),
        ),
      { timeout: 15_000 },
    )
    .toEqual([
      `@${handle} draft the refund webhook docs`,
      `@${handle} list the open refunds`,
    ]);
  const [session] = await withDb((db) =>
    db
      .select()
      .from(s.agentSession)
      .where(eq(s.agentSession.organizationId, seeded.organizationId))
      .orderBy(asc(s.agentSession.createdAt))
      .limit(1),
  );

  // The transcript: the person's message is exactly their words; the
  // channel context is Lictory's, folded, by name.
  await page.goto(`/${seeded.slug}/factory/sessions/${session!.id}`);
  await expect(
    page.getByRole("heading", {
      name: `@${handle} draft the refund webhook docs`,
    }),
  ).toBeVisible();
  await expect(page.getByText("Started by Ada")).toBeVisible();
  // The heading and the person's message, which holds nothing else.
  await expect(
    page.getByText(`@${handle} draft the refund webhook docs`, { exact: true }),
  ).toHaveCount(2);
  const context = page.getByRole("button", {
    name: /Context Forge received/,
  });
  await expect(context).toBeVisible();
  await context.click();
  await expect(page.getByText(/asked in a thread of #builds/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(channelId);
  await expect(page.locator("main")).not.toContainText(
    "You were asked in a Lictory channel thread (channel",
  );
});
