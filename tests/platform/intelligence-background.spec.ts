import { test, expect, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  AskQuestionsInput,
  AskQuestionsOutput,
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
import { clientAddress } from "../helpers/client-address";

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
} satisfies AskQuestionsInput;
const row = (page: Page) =>
  page
    .getByRole("navigation", { name: "Conversations" })
    .getByRole("link", { name: /Refund limits/ });

async function seed(input: AskQuestionsInput = question) {
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
        input,
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
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
  const f = await seed();
  await signIn(page, f.seeded.owner.email);
  await page.goto(`/${f.seeded.slug}/intelligence/${f.chatId}`);
  await expect(row(page)).toBeVisible();
  await expect(row(page).getByRole("status")).toHaveCount(0);
  await expect(
    page.getByText("Checking refund behavior…", { exact: true }),
  ).toBeVisible();
  // The open conversation suppresses its activity icon; background rows still
  // expose the run state when the reader navigates away.
  await page.goto(`/${f.seeded.slug}/intelligence`);
  await expect(row(page).getByRole("status")).toHaveText("Working");
  await row(page).click();
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
  await otherContext.setExtraHTTPHeaders({
    "x-forwarded-for": clientAddress(),
  });
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

async function expectContained(card: Locator) {
  await expect(card).toBeVisible();
  // Check text itself as well as element boxes: clipping overflow would hide
  // this regression without making the questions and answers readable.
  await expect
    .poll(() =>
      card.evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
              return false;
          }
        }
        return root.scrollWidth <= root.clientWidth + 1;
      }),
    )
    .toBe(true);
}

test("long questions and answers remain readable before submission and in saved history", async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const longUrl = `https://example.test/specifications/${"archive-policy-".repeat(20)}`;
  const prompt =
    "These epics contain substantive product specifications and four child items, rather than empty placeholders. Should we archive all of the active work, including the requirements that engineering and QA have already reviewed, or retain those specifications for a follow-up review?";
  const label =
    "Proceed — archive all 63 active items, preserving their specifications, revisions, approvals and discussion history so the team can restore them later if needed.";
  const answer = `Retain the reviewed specifications and their child items until the team has agreed on the replacement behavior.\nReference: ${longUrl}`;
  const input: AskQuestionsInput = {
    title:
      "Confirm the scope of archiving LICT-111 and LICT-112 and explain how the team should handle their existing specifications and delivery work",
    questions: [
      {
        ...question.questions[0]!,
        kind: "single",
        prompt,
        description: `Review the archive policy before deciding: ${longUrl}`,
        options: [{ value: "archive", label, description: longUrl }],
      },
      {
        ...question.questions[0]!,
        id: "reason",
        prompt: `What should we preserve, and why? Include any relevant policy from ${longUrl}`,
      },
    ],
  };
  const output: AskQuestionsOutput = {
    answers: [
      {
        id: "scope",
        values: ["archive"],
        labels: [label],
        text: null,
        skipped: false,
      },
      { id: "reason", values: [], labels: [], text: answer, skipped: false },
    ],
  };
  const f = await seed(input);
  await f.save("waiting", f.asking);
  await page.route("**/api/intelligence/chat", async (route) => {
    expect(
      (route.request().postDataJSON() as { response: unknown }).response,
    ).toEqual({ toolCallId: "scope-question", output });
    const completed: ChatMessage = {
      ...f.assistant,
      parts: [
        {
          type: "tool-askQuestions",
          toolCallId: "scope-question",
          state: "output-available",
          input,
          output,
        },
        { type: "text", text: "Archive scope recorded for review." },
      ],
    };
    await route.fulfill({
      status: 202,
      json: await f.save("completed", completed),
    });
  });
  await signIn(page, f.seeded.owner.email);
  await page.goto(`/${f.seeded.slug}/intelligence/${f.chatId}`);
  const questionnaire = page.getByRole("group", { name: input.title });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectContained(questionnaire);
  }
  await questionnaire.getByText(label, { exact: true }).click();
  const text = questionnaire.getByRole("textbox");
  await expect(text).toBeVisible();
  await expectContained(questionnaire);
  await text.fill(answer);
  await questionnaire.getByRole("button", { name: "Previous" }).click();
  await expect(questionnaire.getByRole("radio")).toBeChecked();
  await questionnaire
    .getByRole("button", { name: "Next", exact: true })
    .click();
  await expect(text).toHaveValue(answer);
  await questionnaire.getByRole("button", { name: "Submit answers" }).click();
  await expect(
    page.getByText("Archive scope recorded for review.", { exact: true }),
  ).toBeVisible();

  // The saved record is also used inside the collapsed activity transcript.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.getByRole("button", { name: /Worked/ }).click();
    const record = page.locator("dl").filter({ hasText: prompt }).locator("..");
    await expectContained(record);
    await expect(record.locator("dt")).toHaveText(
      input.questions.map((q) => q.prompt),
    );
    await expect(record.locator("dd")).toHaveText([label, answer]);
    for (const pair of await record.locator("dl > div").all()) {
      const questionBounds = await pair.locator("dt").boundingBox();
      const answerBounds = await pair.locator("dd").boundingBox();
      expect(answerBounds!.y).toBeGreaterThanOrEqual(
        questionBounds!.y + questionBounds!.height,
      );
      expect(answerBounds!.width).toBeGreaterThanOrEqual(
        questionBounds!.width - 1,
      );
    }
    await record.screenshot({
      path: test.info().outputPath(`long-answers-${width}.png`),
    });
  }
});

test("a saved failure remains actionable after refresh and Stop works through the API", async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
  const f = await seed();
  await signIn(page, f.seeded.owner.email);
  await page.goto(`/${f.seeded.slug}/intelligence/${f.chatId}`);
  await expect(row(page)).toBeVisible();
  await expect(row(page).getByRole("status")).toHaveCount(0);
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
  await expect(row(page).getByRole("status")).toHaveCount(0);
});
