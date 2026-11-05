import { test, expect, type APIRequestContext } from "@playwright/test";
import { consentStatePath } from "../consent-setup";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { inApp, platformOrigin } from "../helpers/app-urls";
import { clientAddress } from "../helpers/client-address";

async function invitationMail(request: APIRequestContext, email: string) {
  const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
  let id: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(`${mailpit}/api/v1/search`, {
        params: { query: `to:${email} subject:"invited you"` },
      });
      id = ((await response.json()) as { messages: { ID: string }[] })
        .messages[0]?.ID;
      return Boolean(id);
    })
    .toBe(true);
  const response = await request.get(`${mailpit}/api/v1/message/${id}`);
  return (await response.json()) as { Text: string; HTML: string };
}

test("email and username invitations deliver tailored emails and preserve joining through signup @smoke", async ({
  page,
  context,
  browser,
  request,
}) => {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client);
  const suffix = crypto.randomUUID().slice(0, 8);
  const password = "Invitation-test-password-123";
  const owner = {
    id: crypto.randomUUID(),
    name: "Invite Admin",
    email: `admin-${suffix}@example.test`,
    handle: `admin_${suffix}`,
  };
  const existing = {
    id: crypto.randomUUID(),
    name: "Existing Teammate",
    email: `existing-${suffix}@example.test`,
    handle: `teammate_${suffix}`,
  };
  const newEmail = `new-${suffix}@example.test`;
  const organizationId = crypto.randomUUID();
  try {
    for (const user of [owner, existing]) {
      await db.insert(s.user).values({ ...user, emailVerified: true });
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(password),
      });
    }
    await db.insert(s.organization).values({
      id: organizationId,
      name: "Invitation Studio",
      slug: `invitation-${suffix}`,
      createdAt: new Date(),
    });
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: owner.id,
      role: "owner",
      createdAt: new Date(),
    });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(inApp);
    const anonymous = await request.post("/api/invitations", {
      headers: { Origin: platformOrigin },
      data: { organizationId, recipient: existing.handle },
    });
    expect(anonymous.status()).toBe(401);
    const crossOrigin = await context.request.post("/api/invitations", {
      headers: { Origin: "https://other.example" },
      data: { organizationId, recipient: existing.handle },
    });
    expect(crossOrigin.status()).toBe(403);
    const invite = (recipient: string, org = organizationId) =>
      context.request.post("/api/invitations", {
        headers: { Origin: platformOrigin },
        data: { organizationId: org, recipient },
      });
    expect((await invite(existing.handle, crypto.randomUUID())).ok()).toBe(
      false,
    );
    expect((await invite("@missing_username")).status()).toBe(404);
    expect((await invite("invalid@email")).status()).toBe(400);
    const existingResponse = await invite(`@${existing.handle.toUpperCase()}`);
    expect(existingResponse.ok()).toBe(true);
    const existingInvite = (await existingResponse.json()) as {
      id: string;
      email?: string;
    };
    expect(existingInvite.email).toBeUndefined();
    const existingMail = await invitationMail(request, existing.email);
    expect(existingMail.Text).toContain(
      "Your Lictory account is ready to join.",
    );
    const existingUrl = /Review invitation: (https?:\/\/\S+)/.exec(
      existingMail.Text,
    )![1]!;
    expect(new URL(existingUrl).pathname).toBe("/sign-in");
    // A resend reuses the invitation instead of creating another pending record.
    expect(
      ((await (await invite(existing.email)).json()) as { id: string }).id,
    ).toBe(existingInvite.id);
    expect(
      await db
        .select()
        .from(s.invitation)
        .where(
          and(
            eq(s.invitation.organizationId, organizationId),
            eq(s.invitation.email, existing.email),
          ),
        ),
    ).toHaveLength(1);
    const newResponse = await invite(newEmail);
    expect(newResponse.ok()).toBe(true);
    const newInvite = (await newResponse.json()) as { id: string };
    const newMail = await invitationMail(request, newEmail);
    expect(newMail.Text).toContain("verify your email");
    expect(newMail.Text).not.toContain(
      "Your Lictory account is ready to join.",
    );
    const signupUrl = /Create account and join: (https?:\/\/\S+)/.exec(
      newMail.Text,
    )![1]!;
    expect(new URL(signupUrl).pathname).toBe("/sign-up");
    expect(new URL(signupUrl).searchParams.get("callbackUrl")).toBe(
      `/invitation?id=${newInvite.id}`,
    );
    const joining = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
      storageState: consentStatePath,
    });
    try {
      const teammate = await joining.newPage();
      await teammate.goto(signupUrl);
      // The link keeps the invitation's context: the page says why the
      // account is being created and starts with the invited address.
      await expect(
        teammate.getByText("Create your account to accept your invitation."),
      ).toBeVisible();
      await expect(teammate.getByLabel("Work email")).toHaveValue(newEmail);
      await teammate.getByLabel("Full name").fill("New Teammate");
      await teammate.getByLabel("Password", { exact: true }).fill(password);
      await teammate
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(
        teammate.getByRole("heading", { name: "Check your inbox" }),
      ).toBeVisible();
      const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
      let verification: string | undefined;
      await expect
        .poll(async () => {
          const search = await request.get(`${mailpit}/api/v1/search`, {
            params: {
              query: `to:${newEmail} subject:"Verify your Lictory email"`,
            },
          });
          const id = ((await search.json()) as { messages: { ID: string }[] })
            .messages[0]?.ID;
          if (id) {
            const mail = await request.get(`${mailpit}/api/v1/message/${id}`);
            verification = /Verify email: (https?:\/\/\S+)/.exec(
              ((await mail.json()) as { Text: string }).Text,
            )?.[1];
          }
          return Boolean(verification);
        })
        .toBe(true);
      await teammate.goto(verification!);
      await teammate
        .getByRole("button", { name: "Continue to your invitation" })
        .click();
      await expect(
        teammate.getByRole("heading", { name: "Choose your handle" }),
      ).toBeVisible();
      await teammate
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await expect(
        teammate.getByRole("heading", { name: "Join Invitation Studio" }),
      ).toBeVisible();
      await teammate.getByRole("button", { name: "Accept invitation" }).click();
      await expect(teammate).toHaveURL(new RegExp(`/invitation-${suffix}$`));
      const [registered] = await db
        .select()
        .from(s.user)
        .where(eq(s.user.email, newEmail));
      expect(
        await db
          .select()
          .from(s.member)
          .where(
            and(
              eq(s.member.organizationId, organizationId),
              eq(s.member.userId, registered!.id),
            ),
          ),
      ).toHaveLength(1);
      const denied = await joining.request.post("/api/invitations", {
        headers: { Origin: platformOrigin },
        data: { organizationId, recipient: existing.handle },
      });
      expect(denied.status()).toBe(403);
    } finally {
      await joining.close();
    }
  } finally {
    await client.end();
  }
});
