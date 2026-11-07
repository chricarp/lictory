import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { clientAddress } from "../helpers/client-address";
import { seedWorkspace, signIn } from "../helpers/seed";

// The AI provider as people see it, against the browser suite's scripted
// provider (scripts/e2e-fakes/openai.ts). The suite configures it the way an
// existing installation does: OPENAI_API_KEY with the SDK's OPENAI_BASE_URL.
// Members learn where their content goes (never the endpoint); an instance
// administrator sees the endpoint and checks the connection, which sends only
// synthetic content. Dictation is not offered: text goes through a custom
// base URL, not OpenAI itself, so audio would need the operator's explicit
// choice. See docs/operations/ai-providers.md.

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
});

test("members see where content goes and an instance administrator checks the provider", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const run = crypto.randomUUID().slice(0, 6);
  const seeded = await seedWorkspace({
    name: `Provider ${run}`,
    key: "PRV",
    users: [`Ada Operator ${run}`],
  });
  await seeded.command({ type: "setAiPolicy", enabled: true });
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

  // Organization settings: the destination and model, not the endpoint.
  await page.goto(`/${seeded.slug}/settings/intelligence`);
  const settings = page.locator("#ai");
  await expect(
    settings.getByText("OpenAI, which is asked not to store requests."),
  ).toBeVisible();
  await expect(settings.getByText("e2e-scripted")).toBeVisible();
  await expect(settings.getByText("Not offered on this server.")).toBeVisible();
  await expect(settings.getByText(/127\.0\.0\.1|localhost/)).toHaveCount(0);

  // No microphone in Litto's composer without configured dictation.
  await page.goto(`/${seeded.slug}/intelligence`);
  await expect(page.getByRole("textbox").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Dictate/ })).toHaveCount(0);

  // The admin console: provider, endpoint, model and the live check.
  await page.goto("/admin");
  const provider = page.locator("#ai-provider");
  await expect(
    provider.getByRole("heading", { name: "AI provider" }),
  ).toBeVisible();
  await expect(provider.getByText("OpenAI", { exact: true })).toBeVisible();
  await expect(provider.getByText("OpenAI Responses API")).toBeVisible();
  await expect(
    provider.getByText(/^http:\/\/127\.0\.0\.1:\d+\/v1$/),
  ).toBeVisible();
  await expect(provider.getByText("Key from OPENAI_API_KEY.")).toBeVisible();
  await expect(provider.getByText("e2e-scripted")).toBeVisible();
  await expect(provider.getByText("e2e-scripted-ai-key")).toHaveCount(0);

  const before = await sentToProvider();
  await provider.getByRole("button", { name: "Check connection" }).click();
  await expect(
    provider.getByText(
      /This provider and model work with Lictory Intelligence/,
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(provider.getByLabel("Passed")).toHaveCount(3);
  await expect(provider.getByText("Structured output")).toBeVisible();
  await expect(provider.getByText("Streamed tool call")).toBeVisible();
  await expect(provider.getByText("Answer after a tool result")).toBeVisible();

  // Only synthetic content reached the provider: nothing of the workspace.
  const sent = (await sentToProvider()).slice(before.length);
  expect(sent.length).toBe(3);
  for (const request of sent) {
    expect(request.body).toContain("DEMO-1");
    expect(request.body).not.toContain(seeded.slug);
    expect(request.body).not.toContain(owner.email);
  }

  // A second check right away is refused instead of calling the provider.
  await provider.getByRole("button", { name: "Check connection" }).click();
  await expect(provider.getByText(/was just checked/)).toBeVisible();
  expect((await sentToProvider()).length).toBe(before.length + 3);
});

async function sentToProvider() {
  const response = await fetch(
    `${process.env.E2E_SCRIPTED_AI_URL}/__scripted-ai/requests`,
  );
  return (await response.json()) as { at: string; body: string }[];
}
