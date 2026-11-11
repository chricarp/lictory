import { expect, test, type APIRequestContext } from "@playwright/test";

// The laptop trial (deploy/try.sh) as an evaluator meets it: the administrator
// it printed signs in, realtime sync answers, and email reaches Mailpit. The
// checks avoid wording, so main's test also holds against the latest stable
// release's images (tests/try/playwright.config.ts).
const email = process.env.LICTORY_TRY_EMAIL ?? "admin@example.com";
const password = process.env.LICTORY_TRY_PASSWORD ?? "";
const mailUrl = process.env.LICTORY_TRY_MAIL_URL ?? "http://localhost:8025";
// The inbox asks for the password try.sh generated (LICTORY_TRY_MAIL_PASSWORD
// in the trial's .env), as it holds password-reset links.
const mailPassword = process.env.LICTORY_TRY_MAIL_PASSWORD ?? "";
// The organization try.sh creates (LICTORY_ORGANIZATION, default Evaluation).
const organization =
  process.env.LICTORY_TRY_ORGANIZATION_HANDLE ?? "evaluation";

test("the first administrator signs in and the workspace syncs", async ({
  page,
}) => {
  expect(password, "LICTORY_TRY_PASSWORD").not.toBe("");
  const sync = page.waitForEvent("websocket", {
    predicate: (socket) => new URL(socket.url()).pathname.startsWith("/zero/"),
    timeout: 60_000,
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Signing in passes through "/" before the app settles: on the handle step
  // of a first sign-in (the suggestion is prefilled), or in the organization.
  const home = (url: URL) =>
    url.pathname === `/${organization}` ||
    url.pathname.startsWith(`/${organization}/`);
  await page.waitForURL((url) => url.pathname === "/welcome" || home(url));
  if (new URL(page.url()).pathname === "/welcome")
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(home);
  // Zero's first message after the handshake proves the proxy, zero-cache
  // and the API's query endpoint work for this session.
  const socket = await sync;
  await socket.waitForEvent("framereceived", { timeout: 60_000 });
  expect(socket.isClosed()).toBe(false);
});

test("email reaches the Mailpit inbox, which asks for its password", async ({
  request,
  baseURL,
}) => {
  // Password-reset links land here: without the password the inbox refuses.
  const anonymous = await request.get(`${mailUrl}/api/v1/messages`);
  expect(anonymous.status()).toBe(401);
  const before = await inbox(request);
  const reset = await request.post("/api/auth/request-password-reset", {
    headers: { origin: new URL(baseURL ?? "http://localhost").origin },
    data: { email, redirectTo: "/reset-password" },
  });
  expect(reset.ok(), await reset.text()).toBe(true);
  // The worker or the API delivers through SMTP to mailpit:1025.
  await expect
    .poll(() => inbox(request), { timeout: 60_000 })
    .toBeGreaterThan(before);
});

async function inbox(request: APIRequestContext) {
  expect(mailPassword, "LICTORY_TRY_MAIL_PASSWORD").not.toBe("");
  const response = await request.get(
    `${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    {
      headers: {
        authorization: `Basic ${Buffer.from(`lictory:${mailPassword}`).toString("base64")}`,
      },
    },
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { messages_count: number };
  return body.messages_count;
}
