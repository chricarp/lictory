import { expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { signedIn } from "./app-urls";
import { useClientAddress } from "./client-address";

// The people of the workspace, shell and native delivery workflows. Each
// person belongs to the tests of one file, so the files can run side by side;
// the tests inside a file may build on what an earlier one left behind.
export const password = "Local-test-password-123";
export const people = {
  project: ["Alex Morgan", "project@example.test", "alex_morgan"],
  reviewer: ["Riley Chen", "engineer@example.test", "riley_chen"],
  // Taylor has no handle yet, so signing in must pass the handle step.
  multiOrg: ["Taylor Rivera", "multi-org@example.test", null],
  loading: ["Jordan Lee", "loading@example.test", "jordan_lee"],
  revisit: ["Casey Park", "revisit@example.test", "casey_park"],
  // Native delivery scenarios create their own organizations: they must not
  // depend on another test having created one (the smoke tier runs them alone).
  delivery: ["Sam Ortiz", "delivery@example.test", "sam_ortiz"],
  panes: ["Robin Hale", "panes@example.test", "robin_hale"],
} as const;

/** Creates these people with a password, unless they already exist. */
export async function seedPeople(...names: (keyof typeof people)[]) {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const db = drizzle(client);
    for (const name of names) {
      const [fullName, email, handle] = people[name];
      const id = crypto.randomUUID();
      // A worker restarted after a failure re-runs this hook on the same database.
      const inserted = await db
        .insert(s.user)
        .values({ id, name: fullName, email, emailVerified: true, handle })
        .onConflictDoNothing()
        .returning({ id: s.user.id });
      if (!inserted.length) continue;
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: await hashPassword(password),
      });
    }
  } finally {
    await client.end();
  }
}

export async function signIn(
  page: Page,
  loginEmail: string = people.project[1],
) {
  // Its own client address: sign-in is rate limited per address.
  await useClientAddress(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(loginEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(signedIn);
  // Dev-mode compilation can delay hydration; interact only once scripts settled.
  await page.waitForLoadState("networkidle");
}
