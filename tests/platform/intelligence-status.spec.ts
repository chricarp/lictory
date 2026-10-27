import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { ChatMessage } from "@lictory/core/intelligence/chat/shared";
import {
  openChat,
  saveMessages,
  updateChat,
  getChatSnapshot,
} from "@lictory/core/intelligence/chat/store";
import { seedWorkspace, signIn, withDb } from "../helpers/seed";

// The conversation list shows which conversations are still working and which
// wait for the person, including unread replies completed in the background.

const question = (title: string) => ({
  title,
  questions: [
    {
      id: "scope",
      prompt: "Which flows are in scope?",
      description: null,
      kind: "text",
      options: [],
      allowOther: false,
      required: true,
    },
  ],
});

const row = (page: Page, title: string) =>
  page
    .getByRole("navigation", { name: "Conversations" })
    .getByRole("link", { name: new RegExp(title) });

for (const [index, outcome] of (
  ["waiting", "unread", "viewed", "failed"] as const
).entries()) {
  test(`the conversation list tracks ${outcome} responses after processing`, async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `192.0.2.${171 + index}`,
    });
    const seeded = await seedWorkspace({
      name: "Status Lab",
      key: "STA",
      users: ["Sam Status"],
    });
    const owner = {
      organizationId: seeded.organizationId,
      userId: seeded.owner.id,
    };
    const runId = crypto.randomUUID();
    const [asking, other] = [crypto.randomUUID(), crypto.randomUUID()];
    await withDb(async (db) => {
      await openChat(db, owner, other);
      await saveMessages(db, owner, other, [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Hello" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "Hi" }] },
      ]);
      await updateChat(db, owner, other, { title: "Greeting" });
      await openChat(db, owner, asking);
      await saveMessages(db, owner, asking, [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "Draft refund limits" }],
        },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "tool-askQuestions",
              toolCallId: "q1",
              state: "input-available",
              input: question("Refund scope"),
            },
          ],
        } as unknown as ChatMessage,
      ]);
      await updateChat(db, owner, asking, { title: "Refund limits" });
      const found = await getChatSnapshot(db, owner, asking);
      await db.insert(s.intelligenceChatRun).values({
        id: runId,
        chatId: asking,
        assistantId: "a1",
        position: 1,
        checkpoint: found.messages.at(-1),
        status: "waiting",
      });
    });

    // The assistant's reply is held until the test releases it.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/intelligence/chat", async (route) => {
      expect(
        (route.request().postDataJSON() as { response: unknown }).response,
      ).toEqual({
        toolCallId: "q1",
        output: { dismissed: true },
      });
      await withDb(async (db) => {
        await db
          .update(s.intelligenceChatRun)
          .set({
            status: "running",
            leaseToken: crypto.randomUUID(),
            leaseUntil: new Date(Date.now() + 600_000),
            updatedAt: new Date(),
          })
          .where(eq(s.intelligenceChatRun.id, runId));
      });
      await held;
      const reply = "The refund limits are ready for review.";
      const assistant = {
        id: "a1",
        role: "assistant",
        parts:
          outcome === "waiting"
            ? [
                { type: "step-start" },
                {
                  type: "tool-askQuestions",
                  toolCallId: "q2",
                  state: "input-available",
                  input: question("Refund currency"),
                },
              ]
            : [{ type: "text", text: reply }],
      } as ChatMessage;
      const snapshot = await withDb(async (db) => {
        await saveMessages(db, owner, asking, [
          {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "Draft refund limits" }],
          },
          assistant,
        ]);
        await db
          .update(s.intelligenceChatRun)
          .set({
            status:
              outcome === "failed"
                ? "failed"
                : outcome === "waiting"
                  ? "waiting"
                  : "completed",
            checkpoint: assistant,
            error: outcome === "failed" ? "The provider is unavailable." : null,
            updatedAt: new Date(),
          })
          .where(eq(s.intelligenceChatRun.id, runId));
        return getChatSnapshot(db, owner, asking);
      });
      await route.fulfill({ status: 202, json: snapshot });
    });

    await signIn(page, seeded.owner.email);
    await page.goto(`/${seeded.slug}/intelligence`);

    // Known from the stored transcript, before the conversation is opened.
    await expect(row(page, "Refund limits").getByRole("status")).toHaveText(
      "Waiting for your input",
    );
    await expect(row(page, "Greeting").getByRole("status")).toHaveCount(0);

    await row(page, "Refund limits").click();
    await page.getByRole("button", { name: "Dismiss questions" }).click();

    // The person moves on while the answer is still being worked on.
    if (outcome !== "viewed") {
      await row(page, "Greeting").click();
      await expect(page).toHaveURL(new RegExp(`/intelligence/${other}$`));
    }
    await expect(row(page, "Refund limits").getByRole("status")).toHaveText(
      "Working",
    );

    release();
    const status = row(page, "Refund limits").getByRole("status");
    if (outcome === "viewed") {
      await expect(
        page.getByText("The refund limits are ready for review.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(status).toHaveText("Completed");
      await row(page, "Greeting").click();
      await expect(status).toHaveText("Completed");
    } else {
      await expect(status).toHaveText(
        outcome === "waiting"
          ? "Waiting for your input"
          : outcome === "failed"
            ? "Stopped with an error"
            : "Unread response",
      );
    }
    await expect(row(page, "Greeting").getByRole("status")).toHaveCount(0);

    if (outcome === "unread") {
      // Unread completion survives both filtering the list and reloading it.
      const search = page.getByRole("textbox", {
        name: "Search conversations",
      });
      await search.fill("Greeting");
      await expect(row(page, "Refund limits")).toHaveCount(0);
      await search.clear();
      await expect(status).toHaveText("Unread response");
      await page.reload();
      await expect(status).toHaveText("Unread response");
      await page.screenshot({
        path: test.info().outputPath("unread-completion.png"),
      });
      await row(page, "Refund limits").click();
      await expect(
        page.getByText("The refund limits are ready for review.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(status).toHaveText("Completed");
      await row(page, "Greeting").click();
      await page.reload();
      await expect(status).toHaveText("Completed");
    }
  });
}
