import { test, expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { createWorkspace } from "../helpers/onboarding-helpers";
import { inApp } from "../helpers/app-urls";

const email = "context-admin@example.test";
const password = "Local-test-password-123";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.241" });
});
test.beforeAll(async () => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(s.user)
    .values({
      id,
      name: "Casey Context",
      email,
      emailVerified: true,
      handle: "casey_context",
    })
    .onConflictDoNothing()
    .returning({ id: s.user.id });
  if (inserted.length)
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  await client.end();
});

test("an administrator curates versioned Lictory Intelligence Context per scope", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Context Co",
    project: "Checkout",
    key: "CHK",
  });
  await page
    .getByRole("link", { name: "Organization settings", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Lictory Intelligence", exact: true })
    .click();

  const section = page.locator("#intelligence-context");
  await expect(section).toContainText("No organization context yet");

  // A written note.
  await section.getByRole("button", { name: "Write note" }).click();
  await section.getByLabel("Title").fill("Payments glossary");
  await section
    .getByLabel("Context content")
    .fill("A **charge** moves money from a customer to the merchant.");
  await section.getByRole("button", { name: "Add note" }).click();
  const note = section.getByRole("button", { name: /^Payments glossary/ });
  await expect(note).toContainText("v1");

  // Editing adds a version; the earlier one stays readable.
  await note.click();
  await section.getByRole("button", { name: "Edit", exact: true }).click();
  await section
    .getByLabel("Context content")
    .fill("A **charge** moves money from a customer. Refunds reverse it.");
  await section.getByRole("button", { name: "Save new version" }).click();
  await expect(note).toContainText("v2");
  await expect(section).toContainText("Refunds reverse it.");
  await section.getByRole("button", { name: "History (2)" }).click();
  await section.getByRole("button", { name: /^v1/ }).click();
  await expect(section).toContainText("Viewing version 1");
  await expect(section).toContainText(
    "A charge moves money from a customer to the merchant.",
  );
  await note.click();

  // An uploaded document becomes Markdown.
  await section.getByRole("button", { name: "Upload document" }).click();
  await section.getByLabel("Document").setInputFiles({
    name: "limits.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("currency,limit\nEUR,1000\n"),
  });
  await expect(section.getByLabel("Title")).toHaveValue("limits");
  await section.getByRole("button", { name: "Upload", exact: true }).click();
  const doc = section.getByRole("button", { name: /^limits/ });
  await expect(doc).toContainText("limits.csv");
  await doc.click();
  await expect(section.getByRole("table")).toContainText("EUR");

  // Archiving is reversible.
  await section.getByRole("button", { name: "Archive" }).click();
  await expect(doc).toHaveCount(0);
  await section.getByRole("button", { name: "Show archived (1)" }).click();
  await expect(doc).toContainText("Archived");

  // Each project and team has its own context.
  await section.getByRole("combobox", { name: "Context scope" }).click();
  await page.getByRole("option", { name: "Project · Checkout" }).click();
  await expect(section).toContainText("No project context yet");
  await expect(note).toHaveCount(0);
});
