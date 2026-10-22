import { chromium, type FullConfig } from "@playwright/test";

// Browser tests record "Reject All" once per origin (platform and marketing)
// so the consent banner does not cover the flows under test. Consent
// behaviour itself is covered in tests/marketing/consent.spec.ts.
export const consentStatePath = "/tmp/lictory-playwright-consent.json";

export default async function consentSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  for (const project of config.projects) {
    const baseURL = project.use.baseURL;
    if (!baseURL) continue;
    const page = await context.newPage();
    await page.goto(
      new URL(
        project.name === "platform" ? "/sign-in" : "/",
        baseURL,
      ).toString(),
    );
    await page.getByRole("button", { name: "Reject All" }).click();
    await page.waitForFunction(() => document.cookie.includes("c15t="));
    await page.close();
  }
  await context.storageState({ path: consentStatePath });
  await browser.close();
}
