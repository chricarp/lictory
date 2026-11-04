import { test, expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { newPerson, seedWorkspace, signIn, withDb } from "../helpers/seed";

const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";

// An owner schedules the organization's deletion: it locks for everyone at
// once, members are told by email, the owner can still export and cancels.
test("an owner schedules the organization's deletion, members see it locked and are emailed, and the owner cancels", async ({
  browser,
  request,
}) => {
  const seeded = await seedWorkspace({
    name: "Sunset Labs",
    key: "SUN",
    users: ["Olive", "Mo"],
  });
  const [owner, member] = [seeded.owner, seeded.users[1]!];

  const ownerSession = await newPerson(browser);
  const page = ownerSession.page;
  await signIn(page, owner.email);
  await page.goto(`/${seeded.slug}/settings/delete`);
  const section = page.locator("section#delete-organization");
  await expect(
    section.getByText("There is no recent export.", { exact: false }),
  ).toBeVisible();
  await expect(
    section.getByRole("link", { name: "Go to Data export" }),
  ).toHaveAttribute("href", `/${seeded.slug}/settings/export`);
  const confirm = section.getByLabel(`Type ${seeded.slug} to confirm`);
  const scheduleButton = section.getByRole("button", {
    name: "Schedule deletion",
  });
  await confirm.fill("Sunset Labs");
  await expect(scheduleButton).toBeDisabled();
  await confirm.fill(seeded.slug);
  await scheduleButton.click();

  // The organization locks at once; the owner keeps exports and can cancel.
  const lockedTitle = page.getByRole("heading", {
    name: /Sunset Labs is scheduled for deletion on /,
  });
  await expect(lockedTitle).toBeVisible();
  await expect(page.getByText("Olive scheduled it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export data" })).toBeEnabled();

  // A member sees the same notice, without the owner's controls, and is
  // told by email.
  const memberSession = await newPerson(browser);
  await signIn(memberSession.page, member.email);
  await memberSession.page.goto(`/${seeded.slug}`);
  await expect(
    memberSession.page.getByRole("heading", {
      name: /Sunset Labs is scheduled for deletion on /,
    }),
  ).toBeVisible();
  await expect(
    memberSession.page.getByText("ask an owner to cancel the deletion", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    memberSession.page.getByRole("button", { name: "Cancel deletion" }),
  ).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const response = await request.get(`${mailpit}/api/v1/search`, {
          params: {
            query: `to:${member.email} subject:"scheduled Sunset Labs for deletion"`,
          },
        });
        return ((await response.json()) as { messages: unknown[] }).messages
          .length;
      },
      { timeout: 30_000 },
    )
    .toBe(1);

  // The server refuses the locked organization, and Better Auth's own
  // immediate delete is not available.
  const direct = await page.request.post("/api/auth/organization/delete", {
    data: { organizationId: seeded.organizationId },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(direct.status()).toBe(404);
  // Nobody is invited into a locked organization.
  const invite = await page.request.post(
    "/api/auth/organization/invite-member",
    {
      data: {
        organizationId: seeded.organizationId,
        email: `late-${seeded.slug}@example.test`,
        role: "member",
      },
      headers: { origin: new URL(page.url()).origin },
    },
  );
  expect(invite.status()).toBe(400);
  expect(await invite.text()).toContain("scheduled for deletion");

  // The owner cancels: the organization opens again for everyone.
  await page.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(lockedTitle).toHaveCount(0);
  await expect(
    memberSession.page.getByRole("heading", {
      name: /Sunset Labs is scheduled for deletion on /,
    }),
  ).toHaveCount(0);
  const [scheduled] = await withDb((db) =>
    db
      .select()
      .from(s.organizationDeletion)
      .where(eq(s.organizationDeletion.organizationId, seeded.organizationId)),
  );
  expect(scheduled).toBeUndefined();
  const audited = await withDb((db) =>
    db
      .select({ action: s.auditEvent.action })
      .from(s.auditEvent)
      .where(
        and(
          eq(s.auditEvent.organizationId, seeded.organizationId),
          eq(s.auditEvent.actorId, owner.id),
        ),
      ),
  );
  expect(audited.map((a) => a.action)).toEqual(
    expect.arrayContaining([
      "organization.deletion_scheduled",
      "organization.deletion_cancelled",
    ]),
  );

  await ownerSession.context.close();
  await memberSession.context.close();
});
