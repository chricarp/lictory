import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { inApp } from "../helpers/app-urls";
import {
  newPerson,
  password,
  seedWorkspace,
  signIn,
  withDb,
} from "../helpers/seed";

// Deleting an account anonymizes it: the person can no longer sign in, and
// what they wrote stays, attributed to their name as a former member.
test("a member with history deletes their account; their work stays attributed", async ({
  browser,
}) => {
  const seeded = await seedWorkspace({
    name: "Erasure",
    key: "ERA",
    users: ["Olive", "Ada"],
    // Ada writes specifications.
    disciplines: { 1: "Product" },
  });
  const [owner, ada] = [seeded.owner, seeded.users[1]!];
  const workItemId = crypto.randomUUID();
  await seeded.command(
    {
      type: "createWorkItem",
      projectId: seeded.projectId,
      workItemId,
      typeId: seeded.typeId("Story"),
      parentId: null,
      title: "Safe retries",
      description: "Avoid duplicate payments after a timeout.",
    },
    ada.id,
  );

  // The only owner is told what to do first.
  const ownerSession = await newPerson(browser);
  await signIn(ownerSession.page, owner.email);
  await ownerSession.page.goto("/account#delete");
  const ownerSection = ownerSession.page.locator("section#delete");
  await ownerSection.getByRole("button", { name: "Delete account…" }).click();
  await ownerSection.getByLabel("Confirm with your password").fill(password);
  await ownerSection
    .getByRole("button", { name: "Delete permanently" })
    .click();
  await expect(
    ownerSection.getByText("You are the only owner of Erasure."),
  ).toBeVisible();

  // The member deletes theirs.
  const member = await newPerson(browser);
  await signIn(member.page, ada.email);
  await member.page.goto("/account#delete");
  const section = member.page.locator("section#delete");
  await section.getByRole("button", { name: "Delete account…" }).click();
  await section.getByLabel("Confirm with your password").fill(password);
  await section.getByRole("button", { name: "Delete permanently" }).click();
  await expect(member.page).toHaveURL(/\/sign-in/);

  // The old email and password no longer sign in.
  await member.page.getByLabel("Email", { exact: true }).fill(ada.email);
  await member.page.getByLabel("Password", { exact: true }).fill(password);
  await member.page
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    member.page.getByText("Invalid email or password", { exact: false }),
  ).toBeVisible();
  await expect(member.page).not.toHaveURL(inApp);

  const [row] = await withDb((db) =>
    db.select().from(s.user).where(eq(s.user.id, ada.id)),
  );
  expect(row!.deletedAt).not.toBeNull();
  expect(row!.email).not.toBe(ada.email);
  expect(row!.name).toBe("Ada");

  // The specification still shows who wrote it.
  await ownerSession.page.goto(seeded.itemPath(1));
  await expect(
    ownerSession.page.getByText("Revision 1 · Ada (former member)").first(),
  ).toBeVisible();

  await ownerSession.context.close();
  await member.context.close();
});
