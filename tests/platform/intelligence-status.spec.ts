import { test, expect, type Page } from "@playwright/test";
import type { ChatMessage } from "@lictory/core/intelligence/chat/shared";
import {
  openChat,
  saveMessages,
  updateChat,
} from "@lictory/core/intelligence/chat/store";
import { seedWorkspace, signIn, withDb } from "../helpers/seed";

// The conversation list shows which conversations are still working and which
// wait for the person, including the ones they are not looking at.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.171" });
});

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

test("the conversation list shows work in progress and conversations waiting for an answer", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    name: "Status Lab",
    key: "STA",
    users: ["Sam Status"],
  });
  const owner = {
    organizationId: seeded.organizationId,
    userId: seeded.owner.id,
  };
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
  });

  // The assistant's reply is held until the test releases it.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/intelligence/chat", async (route) => {
    await held;
    const chunks = [
      { type: "start" },
      { type: "start-step" },
      {
        type: "tool-input-available",
        toolCallId: "q2",
        toolName: "askQuestions",
        input: question("Refund currency"),
      },
      { type: "finish-step" },
      { type: "finish" },
    ];
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`,
    });
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
  await row(page, "Greeting").click();
  await expect(page).toHaveURL(new RegExp(`/intelligence/${other}$`));
  await expect(row(page, "Refund limits").getByRole("status")).toHaveText(
    "Working",
  );

  // The answer stops on a new question: the list says so.
  release();
  await expect(row(page, "Refund limits").getByRole("status")).toHaveText(
    "Waiting for your input",
  );
  await expect(row(page, "Greeting").getByRole("status")).toHaveCount(0);
});
