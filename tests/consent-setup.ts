import { chromium, type FullConfig } from "@playwright/test";

// Browser tests record "Reject All" once so the consent banner does not cover
// the flows under test. Consent behaviour itself is covered in consent.spec.ts.
export const consentStatePath = "/tmp/lictory-playwright-consent.json";

export default async function consentSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Reject All" }).click();
  await page.waitForFunction(() => document.cookie.includes("c15t="));
  await page.context().storageState({ path: consentStatePath });
  await browser.close();
}
