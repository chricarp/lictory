import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { clientAddress } from "../helpers/client-address";
import { seedWorkspace, signIn } from "../helpers/seed";

// An instance administrator connects an AI provider in the admin console, on
// a server whose environment configures none (scripts/test-e2e.ts runs
// *.ai-console.spec.ts that way). The provider is the browser suite's
// scripted one (scripts/e2e-fakes/openai.ts) behind a custom base URL, for
// text and for dictation by recorded clips; Chromium's fake microphone
// speaks into the composer. See docs/operations/ai-providers.md.

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

const provider = () => `${process.env.E2E_SCRIPTED_AI_URL}/v1`;

async function choose(page: Page, select: string, option: string) {
  await page.getByRole("combobox", { name: select }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function sentToProvider() {
  const response = await fetch(
    `${process.env.E2E_SCRIPTED_AI_URL}/__scripted-ai/requests`,
  );
  return (await response.json()) as { at: string; body: string }[];
}

test("an instance administrator connects a provider in the console, tests it, saves it, and members dictate", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const run = crypto.randomUUID().slice(0, 6);
  const seeded = await seedWorkspace({
    name: `Console AI ${run}`,
    key: "CAI",
    users: [`Ines Operator ${run}`],
  });
  const owner = seeded.users[0]!;
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await drizzle(client, { schema: s })
      .update(s.user)
      .set({ instanceAdmin: true })
      .where(eq(s.user.id, owner.id));
  } finally {
    await client.end();
  }
  await signIn(page, owner.email);

  await page.goto("/admin/ai");
  await expect(
    page.getByRole("heading", { name: "Language model" }),
  ).toBeVisible();

  // Text: OpenAI's protocol through a custom endpoint (a gateway).
  await choose(page, "Language model provider", "OpenAI");
  const text = page.locator("#ai-provider");
  await text
    .getByLabel("Base URL (optional)", { exact: true })
    .fill(provider());
  await text
    .getByLabel("Model (optional)", { exact: true })
    .fill("e2e-scripted");
  await text.getByLabel("API key", { exact: true }).fill("e2e-console-key");

  // Dictation by recorded clips with the same vendor: its key and endpoint
  // are reused.
  await choose(page, "Dictation provider", "OpenAI");
  const dictation = page.locator("#ai-dictation");
  await expect(
    dictation.getByText(/Same vendor as the language model/),
  ).toBeVisible();

  // Test before saving: synthetic content through every feature.
  const before = (await sentToProvider()).length;
  await page.getByRole("button", { name: "Test before saving" }).click();
  const result = page.getByRole("status", { name: "Test result" });
  await expect(
    result.getByText(/These providers work with Lictory Intelligence/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(result.getByLabel("Passed", { exact: true })).toHaveCount(4);
  const tested = (await sentToProvider()).slice(before);
  expect(tested.some((r) => r.body === "[audio clip]")).toBe(true);
  for (const r of tested) expect(r.body).not.toContain(seeded.slug);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^Saved\. The API and workers/)).toBeVisible();
  // The key is stored, never shown again.
  await expect(text.getByText("Stored")).toBeVisible();
  await expect(text.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.getByText("e2e-console-key")).toHaveCount(0);

  // The organization turns it on and sees where content goes.
  await page.goto(`/${seeded.slug}/settings/intelligence`);
  const settings = page.locator("#ai");
  await settings
    .getByRole("switch", { name: "Allow Lictory Intelligence" })
    .click();
  await expect(
    settings.getByText(/OpenAI models through an endpoint chosen by/),
  ).toBeVisible();
  await expect(
    settings.getByText(/Short clips go through this server to OpenAI/),
  ).toBeVisible();

  // Dictation: the fake microphone's tone is a clip; its words arrive.
  await page.goto(`/${seeded.slug}/intelligence`);
  const dictate = page.getByRole("button", { name: /^Dictate/ });
  await expect(dictate).toBeVisible();
  await dictate.click();
  const composer = page.getByRole("textbox", { name: "Message Litto" });
  await expect(composer).toHaveValue(
    /Retry a failed card payment at most three times\./,
    {
      timeout: 20_000,
    },
  );
  await page.getByRole("button", { name: /Stop dictation/ }).click();
  await expect(page.getByRole("button", { name: /^Dictate/ })).toBeVisible();
});
