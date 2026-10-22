import { test, expect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import sharp from "sharp";
import * as s from "@lictory/core/db/schema";
import { platformOrigin, signedIn } from "../helpers/app-urls";
import { consentStatePath } from "../consent-setup";
import { createWorkspace } from "../helpers/onboarding-helpers";

const password = "Local-test-password-123";
const providerImage = "https://photos.example.test/provider.png";
async function withDb<T>(run: (db: ReturnType<typeof drizzle>) => Promise<T>) {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    return await run(drizzle(client));
  } finally {
    await client.end();
  }
}
async function createUser(social: boolean) {
  const id = crypto.randomUUID();
  const email = `photo-${id}@example.test`;
  await withDb(async (db) => {
    await db.insert(s.user).values({
      id,
      name: "Morgan Photo",
      email,
      emailVerified: true,
      handle: `p_${id.replaceAll("-", "").slice(0, 12)}`,
      image: social ? providerImage : null,
    });
    await db.insert(s.account).values({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
    if (social)
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: `google-${id}`,
        providerId: "google",
      });
  });
  return { id, email };
}
async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(signedIn);
}
async function loaded(page: Page, selector: string) {
  await expect
    .poll(() =>
      page
        .locator(selector)
        .first()
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);
}

async function choosePhoto(
  page: Page,
  photo: { name: string; mimeType: string; buffer: Buffer },
) {
  const picker = page.waitForEvent("filechooser");
  await page
    .locator("section#profile")
    .getByRole("button", { name: /^(Upload|Change) photo$/ })
    .click();
  await (await picker).setFiles(photo);
  await expect(
    page.locator("section#profile").getByRole("button", { name: "Save photo" }),
  ).toBeVisible();
}

for (const social of [false, true]) {
  test(`${social ? "social" : "password"} users preview, replace and remove their photo before joining a workspace`, async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": social ? "192.0.2.221" : "192.0.2.220",
    });
    const user = await createUser(social);
    const png = await sharp({
      create: { width: 400, height: 200, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await page.route(providerImage, (route) =>
      route.fulfill({ contentType: "image/png", body: png }),
    );
    await signIn(page, user.email);
    await page.goto("/account");
    const profile = page.locator("section#profile");
    if (social) {
      await expect(profile.locator(`img[src="${providerImage}"]`)).toHaveCount(
        1,
      );
      await loaded(page, `section#profile img`);
      // A provider-only account after sign-in: personal settings do not depend on a password.
      await withDb((db) =>
        db
          .delete(s.account)
          .where(eq(s.account.userId, user.id))
          .then(async () => {
            await db.insert(s.account).values({
              id: crypto.randomUUID(),
              userId: user.id,
              accountId: `google-${user.id}`,
              providerId: "google",
            });
          }),
      );
    } else await expect(profile.locator("img")).toHaveCount(0);
    await choosePhoto(page, {
      name: "photo.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(profile).toContainText("not saved yet");
    await expect(profile.locator('img[src^="blob:"]')).toHaveCount(1);
    await profile.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      profile.getByRole("button", { name: "Save photo" }),
    ).toHaveCount(0);
    await choosePhoto(page, {
      name: "photo.png",
      mimeType: "image/png",
      buffer: png,
    });
    await profile.getByRole("button", { name: "Save photo" }).click();
    await expect(profile).toContainText("Profile photo updated.");
    await expect(profile.locator('img[src^="/api/users/"]')).toHaveCount(1);
    await loaded(page, "section#profile img");
    const first = await profile.locator("img").getAttribute("src");
    await page.reload();
    await expect(profile.locator("img")).toHaveAttribute("src", first!);
    const denied = await page.request.post("/api/auth/update-user", {
      data: { image: "https://example.test/unvalidated.png" },
      headers: { Origin: platformOrigin },
    });
    expect(denied.status()).toBe(400);
    const crossOrigin = await page.request.delete("/api/profile/photo", {
      headers: { Origin: "https://other.example.test" },
    });
    expect(crossOrigin.status()).toBe(403);
    await choosePhoto(page, {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("corrupt"),
    });
    await profile.getByRole("button", { name: "Save photo" }).click();
    await expect(profile.getByRole("alert")).toContainText("JPEG, PNG or WebP");
    await profile.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(profile.locator("img")).toHaveAttribute("src", first!);
    const blue = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    await choosePhoto(page, {
      name: "replacement.png",
      mimeType: "image/png",
      buffer: blue,
    });
    await profile.getByRole("button", { name: "Save photo" }).click();
    await expect(profile.locator("img")).not.toHaveAttribute("src", first!);
    await expect(
      profile.getByRole("button", { name: "Remove photo" }),
    ).toBeVisible();
    await profile.getByRole("button", { name: "Remove photo" }).click();
    await expect(profile).toContainText("Your initials will be shown.");
    await expect(profile.locator("img")).toHaveCount(0);
    await page.reload();
    await expect(profile.locator("img")).toHaveCount(0);
    expect((await page.request.get(first!)).status()).toBe(404);
  });
}

test("a saved photo appears in the workspace and online collaborators refresh it", async ({
  page,
  browser,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.222" });
  const owner = await createUser(false);
  const colleague = await createUser(false);
  await signIn(page, owner.email);
  await page
    .getByRole("button", { name: "Create a workspace", exact: false })
    .click();
  await createWorkspace(page, {
    organization: "Photo team",
    project: "Photo project",
    key: "PHT",
  });
  const workspaceUrl = page.url();
  const orgId = await withDb(
    async (db) =>
      (
        await db.select().from(s.member).where(eq(s.member.userId, owner.id))
      )[0]!.organizationId,
  );
  await withDb((db) =>
    db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      userId: colleague.id,
      role: "member",
      createdAt: new Date(),
    }),
  );
  const second = await browser.newContext({
    storageState: consentStatePath,
  });
  const reviewer = await second.newPage();
  try {
    await signIn(reviewer, colleague.email);
    await reviewer.goto(
      workspaceUrl.replace(/\/pht\/epics$/, "/settings/members"),
    );
    // Keep a separate signed-in workspace view open while personal settings change.
    await page.goto("/account");
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await choosePhoto(page, {
      name: "photo.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.locator("section#profile")).toContainText(
      "Profile photo updated.",
    );
    await expect(
      reviewer.locator(`img[src*="/api/users/${owner.id}/photo"]`).first(),
    ).toBeVisible();
    await loaded(reviewer, `img[src*="/api/users/${owner.id}/photo"]`);
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(
      reviewer.locator(`img[src*="/api/users/${owner.id}/photo"]`),
    ).toHaveCount(0);
    await page.goto(workspaceUrl);
    await expect(
      page.locator(`img[src*="/api/users/${owner.id}/photo"]`),
    ).toHaveCount(0);
  } finally {
    await second.close();
  }
});
