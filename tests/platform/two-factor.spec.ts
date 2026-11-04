import { createHmac } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { inApp, platformOrigin } from "../helpers/app-urls";
import {
  newPerson,
  password,
  seedWorkspace,
  signIn,
  withDb,
} from "../helpers/seed";

// RFC 6238 (TOTP, SHA-1, 6 digits, 30 s) from the base32 setup key shown in
// Account settings: the same code an authenticator app would show.
function totp(base32Secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

// Rate limits are per client address: each step signs in from its own.
const person = (browser: Browser) => newPerson(browser);

// Turns on two-factor in Account settings and returns the setup key and the
// backup codes shown once.
async function enrollTotp(page: Page) {
  const section = page.locator("section#two-factor");
  await section
    .getByRole("button", { name: "Set up authenticator app" })
    .click();
  await section.getByLabel("Confirm with your password").fill(password);
  await section.getByRole("button", { name: "Continue" }).click();
  await expect(
    section.getByRole("img", {
      name: "QR code to scan with your authenticator app",
    }),
  ).toBeVisible();
  const secret = (await section
    .getByTestId("two-factor-setup-key")
    .textContent())!.trim();
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await section.getByLabel("Code from your app").fill(totp(secret));
  await section.getByRole("button", { name: "Turn on" }).click();
  await expect(
    section.getByText("Two-factor authentication is on."),
  ).toBeVisible();
  const codes = await section
    .getByRole("list", { name: "Backup codes" })
    .getByRole("listitem")
    .allTextContents();
  expect(codes).toHaveLength(10);
  await section
    .getByRole("button", { name: "I saved my backup codes" })
    .click();
  await expect(section.getByText("On", { exact: true })).toBeVisible();
  return { secret, codes };
}

async function submitPassword(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("two-factor enrollment, sign-in with a code or a backup code, and turning it off", async ({
  browser,
}) => {
  const seeded = await seedWorkspace({
    name: "Factor",
    key: "TFA",
    users: ["Tess"],
  });
  const email = seeded.owner.email;

  const first = await person(browser);
  await signIn(first.page, email);
  await first.page.goto("/account");
  const { secret, codes } = await enrollTotp(first.page);
  await first.context.close();

  // The password alone no longer signs in: the code from the app does.
  const second = await person(browser);
  await submitPassword(second.page, email);
  const code = second.page.getByLabel("Authentication code");
  await expect(code).toBeFocused();
  await expect(second.page).toHaveURL(/\/sign-in/);
  await code.fill("000000" === totp(secret) ? "111111" : "000000");
  await second.page.getByRole("button", { name: "Verify" }).click();
  await expect(second.page.getByRole("alert")).toContainText(
    "That code is not valid",
  );
  await code.fill(totp(secret));
  await second.page.getByRole("button", { name: "Verify" }).click();
  await expect(second.page).toHaveURL(inApp);
  await second.context.close();

  // A backup code works once.
  const third = await person(browser);
  await submitPassword(third.page, email);
  await third.page
    .getByRole("button", { name: "Use a backup code instead" })
    .click();
  await third.page.getByLabel("Backup code").fill(codes[0]!);
  await third.page.getByRole("button", { name: "Verify" }).click();
  await expect(third.page).toHaveURL(inApp);

  // Turning it off needs the password; the next sign-in is password-only.
  await third.page.goto("/account");
  const section = third.page.locator("section#two-factor");
  await section.getByRole("button", { name: "Turn off" }).click();
  await section.getByLabel("Confirm with your password").fill(password);
  await section.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(
    section.getByText("Two-factor authentication is off."),
  ).toBeVisible();
  await expect(section.getByText("Off", { exact: true })).toBeVisible();
  await third.context.close();

  const fourth = await person(browser);
  await signIn(fourth.page, email);
  await fourth.context.close();
  const [row] = await withDb((db) =>
    db
      .select({ enabled: s.user.twoFactorEnabled })
      .from(s.user)
      .where(eq(s.user.id, seeded.owner.id)),
  );
  expect(row?.enabled).toBe(false);
});

test("an organization that requires two-factor asks members to enroll before opening it", async ({
  browser,
}) => {
  const seeded = await seedWorkspace({
    name: "Guarded",
    key: "GRD",
    users: ["Olive", "Milo"],
  });
  const [owner, member] = seeded.users as [
    (typeof seeded.users)[0],
    (typeof seeded.users)[0],
  ];

  // The owner cannot require it before having it.
  const admin = await person(browser);
  await signIn(admin.page, owner.email);
  await admin.page.goto(`/${seeded.slug}/settings/security`);
  const requirement = admin.page.getByRole("switch", {
    name: "Require two-factor authentication",
  });
  await expect(requirement).toBeDisabled();
  await expect(
    admin.page.getByText("before requiring it, so you are not locked out"),
  ).toBeVisible();
  await admin.page.goto("/account");
  await enrollTotp(admin.page);
  await admin.page.goto(`/${seeded.slug}/settings/security`);
  await expect(requirement).toBeEnabled();
  await requirement.click();
  await expect(requirement).toHaveAttribute("aria-checked", "true");
  await expect(
    admin.page.getByText("1 member has not turned it on yet"),
  ).toBeVisible();

  // The member signs in and is asked to enroll instead of seeing the
  // organization; the server refuses its data directly too.
  const held = await person(browser);
  await signIn(held.page, member.email);
  await held.page.goto(`/${seeded.slug}`);
  await expect(
    held.page.getByRole("heading", {
      name: "Turn on two-factor authentication",
    }),
  ).toBeVisible();
  const refused = await held.page.request.post(
    "/api/capabilities/getWorkspace",
    {
      data: { organizationId: seeded.organizationId },
      headers: { origin: platformOrigin },
    },
  );
  expect(refused.status()).toBe(403);
  expect(
    ((await refused.json()) as { error: { kind?: string } }).error.kind,
  ).toBe("two_factor_required");

  await held.page
    .getByRole("link", { name: "Set up two-factor authentication" })
    .click();
  await expect(held.page).toHaveURL(/\/account\?returnTo=/);
  await enrollTotp(held.page);
  await held.page.getByRole("link", { name: "Back" }).click();
  await expect(held.page).toHaveURL(new RegExp(`/${seeded.slug}`));
  await expect(
    held.page.getByRole("heading", {
      name: "Turn on two-factor authentication",
    }),
  ).toHaveCount(0);
  const allowed = await held.page.request.post(
    "/api/capabilities/getWorkspace",
    {
      data: { organizationId: seeded.organizationId },
      headers: { origin: platformOrigin },
    },
  );
  expect(allowed.status()).toBe(200);

  // The administrator sees everyone enrolled and can stop requiring it.
  await admin.page.reload();
  await expect(
    admin.page.getByText("Every member has two-factor authentication."),
  ).toBeVisible();
  await requirement.click();
  await expect(requirement).toHaveAttribute("aria-checked", "false");
  await admin.context.close();
  await held.context.close();
});

test("passkeys are added, sign in, and are removed", async ({ browser }) => {
  const seeded = await seedWorkspace({
    name: "Keyed",
    key: "KEY",
    users: ["Petra"],
  });
  const { context, page } = await person(browser);
  // Chromium's virtual authenticator stands in for a platform passkey.
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await signIn(page, seeded.owner.email);
  await page.goto("/account");
  const section = page.locator("section#passkeys");
  await expect(section.getByText("No passkeys yet.")).toBeVisible();
  await section.getByLabel("Passkey name").fill("Test laptop");
  await section.getByRole("button", { name: "Add passkey" }).click();
  await expect(section.getByText("Passkey added.")).toBeVisible();
  await expect(section.getByText("Test laptop")).toBeVisible();

  await context.clearCookies();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(inApp);

  await page.goto("/account");
  await section
    .getByRole("button", { name: "Remove passkey Test laptop" })
    .click();
  await expect(section.getByText("No passkeys yet.")).toBeVisible();
  await context.close();
});
