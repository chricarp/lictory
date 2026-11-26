import { test, expect, type Browser, type Page } from "@playwright/test";

// lictory.com/download: every file of the newest stable release under its
// version-free name, plain links that work without JavaScript, and the
// download for the visitor's computer promoted when the browser says which.
const latest = "https://github.com/chricarp/lictory/releases/latest/download/";
const files = [
  "Lictory-mac-universal.dmg",
  "Lictory-windows-setup.exe",
  "Lictory-linux-x64.AppImage",
  "Lictory-linux-arm64.AppImage",
  "lictory_amd64.deb",
  "lictory_arm64.deb",
  "lictory-runner-darwin-arm64",
  "lictory-runner-darwin-x64",
  "lictory-runner-linux-x64",
  "lictory-runner-linux-arm64",
  "lictory-runner-windows-x64.exe",
  "lictory-runner-windows-arm64.exe",
  "lictory-runner-install.sh",
  "lictory-runner-install.ps1",
  "SHA256SUMS",
  "SHA256SUMS.sigstore.json",
];

async function expectEveryDownload(page: Page) {
  const hrefs = await page
    .locator("main a[href]")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const file of files) expect(hrefs).toContain(`${latest}${file}`);
  // Nothing names a version, so the page never goes stale.
  for (const href of hrefs.filter((href) => href?.includes("/releases/")))
    expect(href).toMatch(
      /^https:\/\/github\.com\/chricarp\/lictory\/releases(\/latest(\/download\/[\w.-]+)?)?$/,
    );
  expect(hrefs).toContain(
    "https://github.com/chricarp/lictory/releases/latest",
  );
  const main = page.getByRole("main");
  await expect(main).toContainText(
    `curl -fsSLO ${latest}lictory-runner-install.sh && sh lictory-runner-install.sh`,
  );
  await expect(main).toContainText(
    `irm ${latest}lictory-runner-install.ps1 | iex`,
  );
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every download is a plain link and each system can be chosen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/download");
    await expect(
      page.getByRole("heading", { level: 1, name: "Download Lictory" }),
    ).toBeVisible();
    const hero = page.getByRole("region", {
      name: "Download the desktop app",
    });
    await expect(hero).toHaveAttribute("data-system", "pending");
    await expect(hero.getByText("Choose your system")).toBeVisible();
    for (const [name, file] of [
      ["macOS", "Lictory-mac-universal.dmg"],
      ["Windows", "Lictory-windows-setup.exe"],
      ["Linux", "Lictory-linux-x64.AppImage"],
    ])
      await expect(
        hero.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", `${latest}${file}`);
    await expect(hero.getByRole("link", { name: /^Download for/ })).toHaveCount(
      0,
    );
    await expectEveryDownload(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
  });
});

type Visitor = {
  name: string;
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
  /** Chromium's User-Agent Client Hints; absent in Safari and Firefox. */
  userAgentData?: {
    platform: string;
    mobile: boolean;
    architecture: string;
    bitness: string;
  };
};

/** A browser context that reports `visitor`'s system, as its browser would. */
async function visit(browser: Browser, visitor: Visitor) {
  const context = await browser.newContext({
    userAgent: visitor.userAgent,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript((visitor: Visitor) => {
    const define = (name: string, value: unknown) =>
      Object.defineProperty(Navigator.prototype, name, {
        get: () => value,
        configurable: true,
      });
    define("platform", visitor.platform);
    define("maxTouchPoints", visitor.maxTouchPoints ?? 0);
    const data = visitor.userAgentData;
    define(
      "userAgentData",
      data && {
        platform: data.platform,
        mobile: data.mobile,
        brands: [],
        getHighEntropyValues: () => Promise.resolve(data),
      },
    );
  }, visitor);
  return context;
}

const computers: (Visitor & { button: string; file: string })[] = [
  {
    name: "Safari on a Mac with Apple silicon (it reports MacIntel)",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
    platform: "MacIntel",
    button: "Download for macOS",
    file: "Lictory-mac-universal.dmg",
  },
  {
    name: "Chrome on Windows arm64",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    platform: "Win32",
    userAgentData: {
      platform: "Windows",
      mobile: false,
      architecture: "arm",
      bitness: "64",
    },
    button: "Download for Windows",
    file: "Lictory-windows-setup.exe",
  },
  {
    // The reduced User-Agent string says x86_64; the client hint is right.
    name: "Chrome on Linux arm64",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    platform: "Linux aarch64",
    userAgentData: {
      platform: "Linux",
      mobile: false,
      architecture: "arm",
      bitness: "64",
    },
    button: "Download for Linux (arm64)",
    file: "Lictory-linux-arm64.AppImage",
  },
  {
    name: "Firefox on Linux x64",
    userAgent:
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
    platform: "Linux x86_64",
    button: "Download for Linux",
    file: "Lictory-linux-x64.AppImage",
  },
];

for (const visitor of computers)
  test(`${visitor.name} is offered ${visitor.file} first, and every other download`, async ({
    browser,
    baseURL,
  }) => {
    const context = await visit(browser, visitor);
    const page = await context.newPage();
    // The visitor's browser asks no one but this site: no GitHub API call
    // decides what to offer.
    const origins = new Set<string>();
    page.on("request", (request) => origins.add(new URL(request.url()).origin));
    await page.goto("/download");
    const hero = page.getByRole("region", {
      name: "Download the desktop app",
    });
    const primary = hero.getByRole("link", {
      name: visitor.button,
      exact: true,
    });
    await expect(primary).toHaveAttribute("href", `${latest}${visitor.file}`);
    await expect(hero.getByRole("link", { name: /^Download for/ })).toHaveCount(
      1,
    );
    await expect(hero).toContainText(visitor.file);
    await expectEveryDownload(page);
    await page.waitForLoadState("networkidle");
    expect([...origins]).toEqual([new URL(baseURL!).origin]);
    await context.close();
  });

test("a phone is told the desktop app is for computers and still sees every download", async ({
  browser,
}) => {
  const context = await visit(browser, {
    name: "Chrome on Android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
    userAgentData: {
      platform: "Android",
      mobile: true,
      architecture: "",
      bitness: "",
    },
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/download");
  const hero = page.getByRole("region", { name: "Download the desktop app" });
  await expect(hero).toHaveAttribute("data-system", "mobile");
  await expect(hero).toContainText("The desktop app is for computers");
  await expect(hero.getByRole("link", { name: /^Download for/ })).toHaveCount(
    0,
  );
  await expectEveryDownload(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "Desktop app" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
  await context.close();
});

test("Download is in the navigation, the sitemap and llms.txt", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  // A click before React hydrates "/" leaves its canonical link behind.
  await page.waitForLoadState("networkidle");
  const nav = page.getByRole("navigation", { name: "Sections", exact: true });
  await nav.getByRole("link", { name: "Download", exact: true }).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(
    nav.getByRole("link", { name: "Download", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/download$/,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Mobile sections" })
      .getByRole("link", { name: "Download", exact: true }),
  ).toHaveAttribute("href", "/download");

  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "/download</loc>",
  );
  expect(await (await request.get("/llms.txt")).text()).toMatch(
    /\[Download Lictory\]\(https?:\/\/[^/]+\/download\)/,
  );
});

for (const width of [960, 1100])
  test(`the header fits Download beside every section at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/download");
    const nav = page.getByRole("navigation", { name: "Sections", exact: true });
    await expect(nav.getByRole("link", { name: "Download" })).toBeVisible();
    const boxes = await page.evaluate(() =>
      [".header-logo", ".desktop-nav", ".header-account", ".header-inner"].map(
        (selector) => {
          const box = document.querySelector(selector)!.getBoundingClientRect();
          return { left: box.left, right: box.right };
        },
      ),
    );
    const [logo, links, account, header] = boxes as {
      left: number;
      right: number;
    }[] as [
      { left: number; right: number },
      { left: number; right: number },
      { left: number; right: number },
      { left: number; right: number },
    ];
    expect(logo.right).toBeLessThanOrEqual(links.left);
    expect(links.right).toBeLessThanOrEqual(account.left);
    expect(account.right).toBeLessThanOrEqual(header.right);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
