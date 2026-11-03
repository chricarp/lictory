import { chromium, type FullConfig } from "@playwright/test";

// Browser tests record "Reject All" on the website so its consent banner does
// not cover the flows under test. The platform runs without analytics in
// browser tests and shows no banner (tests/platform/analytics-off.spec.ts);
// the documentation has no analytics at all.
// Consent behaviour itself is covered in tests/marketing/consent.spec.ts.
// Checkouts running side by side (E2E_PORT_OFFSET) keep their own files.
const suffix = process.env.E2E_PORT_OFFSET
  ? `-${process.env.E2E_PORT_OFFSET}`
  : "";
export const consentStatePath = `/tmp/lictory-playwright-consent${suffix}.json`;

export default async function consentSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  for (const project of config.projects) {
    const baseURL = project.use.baseURL;
    if (!baseURL || project.name !== "marketing") continue;
    const page = await context.newPage();
    await page.goto(new URL("/", baseURL).toString());
    // Cookies are shared across ports on localhost: an origin may already
    // have the choice recorded by the previous one.
    const reject = page.getByRole("button", { name: "Reject All" });
    if (!(await page.evaluate(() => document.cookie.includes("c15t=")))) {
      await reject.click();
      await page.waitForFunction(() => document.cookie.includes("c15t="));
    }
    await page.close();
  }
  await context.storageState({ path: consentStatePath });
  await browser.close();
}
