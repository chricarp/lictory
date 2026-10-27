import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  ChatMessage,
  ChatRunState,
} from "@lictory/core/intelligence/chat/shared";
import {
  openChat,
  saveMessages,
  updateChat,
  getChatSnapshot,
} from "@lictory/core/intelligence/chat/store";
import { writeChatMessage } from "@lictory/core/intelligence/chat/runs";
import { platformOrigin } from "../helpers/app-urls";
import { seedWorkspace, signIn, withDb } from "../helpers/seed";

const question = {
  title: "Refund scope",
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
};
const row = (page: Page) =>
  page
    .getByRole("navigation", { name: "Conversations" })
    .getByRole("link", { name: /Refund limits/ });

async function seed() {
  const seeded = await seedWorkspace({
    name: "Background Lab",
    key: "BGL",
    users: ["Bea Background"],
  });
  const owner = {
    organizationId: seeded.organizationId,
    userId: seeded.owner.id,
  };
  const chatId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const assistant: ChatMessage = {
    id: assistantId,
    role: "assistant",
    parts: [{ type: "text", text: "Checking refund behavior…" }],
  };
  await withDb(async (db) => {
    await openChat(db, owner, chatId);
    await saveMessages(db, owner, chatId, [
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "Draft refund limits" }],
      },
      assistant,
    ]);
    await updateChat(db, owner, chatId, { title: "Refund limits" });
    // Stand in for the model worker, without live AI credentials. A long lease
    // keeps the suite's real worker from taking this controlled execution.
    await db.insert(s.intelligenceChatRun).values({
      id: runId,
      chatId,
      assistantId,
      position: 1,
      checkpoint: assistant,
      status: "running",
      leaseToken: crypto.randomUUID(),
      leaseUntil: new Date(Date.now() + 600_000),
    });
  });
  const save = (
    status: ChatRunState,
    message: ChatMessage,
    error: string | null = null,
  ) =>
    withDb(async (db) => {
      await db.transaction(async (tx) => {
        await writeChatMessage(tx, chatId, 1, message);
        await tx
          .update(s.intelligenceChatRun)
          .set({ status, checkpoint: message, error, updatedAt: new Date() })
          .where(eq(s.intelligenceChatRun.id, runId));
      });
      return getChatSnapshot(db, owner, chatId);
    });
  const asking = {
    ...assistant,
    parts: [
      { type: "step-start" },
      {
        type: "tool-askQuestions",
        toolCallId: "scope-question",
        state: "input-available",
        input: question,
      },
    ],
  } as ChatMessage;
  return { seeded, owner, chatId, runId, assistant, asking, save };
}

test("navigation, reload and a second device retain working, waiting and completed conversations", async ({
  page,
  context,
  browser,
}) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.175" });
  const f = await seed();
  await signIn(page, f.seeded.owner.email);
  await page.goto(`/${f.seeded.slug}/intelligence/${f.chatId}`);
  await expect(row(page).getByRole("status")).toHaveText("Working");
  await expect(
    page.getByText("Checking refund behavior…", { exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Workspace" });
  await navigation.getByRole("link", { name: "Inbox", exact: true }).click();
  await f.save("waiting", f.asking);
  await navigation.getByRole("link", { name: "Litto" }).click();
  await expect(row(page).getByRole("status")).toHaveText(
    "Waiting for your input",
  );
  await row(page).click();
  await page.reload();
  await expect(page.getByText("Refund scope", { exact: true })).toBeVisible();

  const otherContext = await browser.newContext();
  await otherContext.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.176" });
  const other = await otherContext.newPage();
  try {
    await signIn(other, f.seeded.owner.email);
    await other.goto(`/${f.seeded.slug}/intelligence/${f.chatId}`);
    await expect(
      other.getByText("Refund scope", { exact: true }),
    ).toBeVisible();
    // Simulate the worker's answer to this targeted response. The GETs on
    // both devices remain real, and must pick up committed state themselves.
    await page.route("**/api/intelligence/chat", async (route) => {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      expect(input.response).toEqual({
        toolCallId: "scope-question",
        output: { dismissed: true },
      });
      expect(input.message).toBeUndefined();
      expect(input.requestId).toEqual(expect.any(String));
      const completed = {
        ...f.asking,
        parts: [
          { type: "step-start" },
          {
            type: "tool-askQuestions",
            toolCallId: "scope-question",
            state: "output-available",
            input: question,
            output: { dismissed: true },
          },
          { type: "text", text: "Refund scope saved." },
        ],
      } as ChatMessage;
      await route.fulfill({
        status: 202,
        json: await f.save("completed", completed),
      });
    });
    await page.getByRole("button", { name: "Dismiss questions" }).click();
    await expect(
      page.getByText("Refund scope saved.", { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByText("Refund scope saved.", { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "Dismiss questions" }),
    ).toHaveCount(0);
    await other.reload();
    await expect(
      other.getByText("Refund scope saved.", { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByText("Draft refund limits", { exact: true }),
    ).toHaveCount(1);
    await page.screenshot({
      path: "/tmp/lictory-litto-durable-completed.png",
      fullPage: true,
    });
  } finally {
    await otherContext.close();
  }
});

test("a saved failure remains actionable after refresh and Stop works through the API", async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.177" });
  const f = await seed();
  await signIn(page, f.seeded.owner.email);
  await page.goto(`/${f.seeded.slug}/intelligence/${f.chatId}`);
  await expect(row(page).getByRole("status")).toHaveText("Working");
  const stopped = await page.request.post(
    `/api/intelligence/chats/${f.chatId}/stop?organizationId=${f.owner.organizationId}`,
    { data: { runId: f.runId }, headers: { Origin: platformOrigin } },
  );
  expect(stopped.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (await withDb((db) => getChatSnapshot(db, f.owner, f.chatId))).run
          ?.status,
    )
    .toBe("canceled");
  await expect(row(page).getByText("Working", { exact: true })).toHaveCount(0);
  await f.save("waiting", f.asking);
  await expect(
    page.getByRole("button", { name: "Cancel this turn", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel this turn", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Dismiss questions" }),
  ).toHaveCount(0);
  expect(
    (await withDb((db) => getChatSnapshot(db, f.owner, f.chatId))).run?.status,
  ).toBe("canceled");
  await f.save(
    "failed",
    f.assistant,
    "The worker was interrupted repeatedly. Retry to continue.",
  );
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "worker was interrupted repeatedly" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(row(page).getByRole("status")).toHaveText(
    /needs attention|failed|stopped/i,
  );
});
