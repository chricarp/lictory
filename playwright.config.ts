import { resolve } from "node:path";
import { defineConfig, type ReporterDescription } from "@playwright/test";
import { consentStatePath } from "./tests/consent-setup";

// Browser workflows run against production builds started by
// scripts/test-e2e.ts: the platform behind a local stand-in for the production
// edge proxy (SPA assets, API, Zero), the marketing site on its own origin and
// the documentation's static export behind its Cloudflare Worker.
const platformURL = process.env.E2E_PLATFORM_URL ?? "http://localhost:3001";
const marketingURL = process.env.E2E_MARKETING_URL ?? "http://localhost:3101";
const docsURL = process.env.E2E_DOCS_URL ?? "http://localhost:3201";

// A CI shard runs only the files scripts/e2e-selection.ts assigned to it.
const shardFiles = process.env.E2E_FILES
  ? (JSON.parse(process.env.E2E_FILES) as string[]).map(
      (file) =>
        new RegExp(`${resolve(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    )
  : undefined;
const reporter: ReporterDescription[] = process.env.CI
  ? [["github"], ["list"]]
  : [["list"]];
// Durations for balancing shards (E2E_UPDATE_TIMINGS in scripts/test-e2e.ts).
if (process.env.E2E_JSON_REPORT)
  reporter.push(["json", { outputFile: process.env.E2E_JSON_REPORT }]);

/** A worker count ("3") or a share of the cores ("50%"). */
function workers(value: string | undefined) {
  if (!value?.trim()) return undefined;
  return value.trim().endsWith("%") ? value.trim() : Number(value);
}

export default defineConfig({
  globalSetup: "./tests/consent-setup.ts",
  // Test files run side by side; the tests inside a file keep their order and
  // may build on each other. No two files share a person, handle or
  // organization (unique or randomized per file), and sign-in rate limits are
  // per worker (tests/helpers/client-address.ts). CI runners have two cores;
  // a contributor's machine uses half of its cores. E2E_WORKERS overrides both.
  workers: workers(process.env.E2E_WORKERS) ?? (process.env.CI ? 2 : "50%"),
  // One CI retry absorbs runner timing noise; a pass on retry is still
  // reported as flaky so the underlying race gets fixed, not hidden.
  retries: process.env.CI ? 1 : 0,
  // Report each test as it finishes so a hanging test is visible in CI logs.
  reporter,
  timeout: 90_000,
  ...(shardFiles && { testMatch: shardFiles }),
  // A broken step should fail in seconds, not consume the whole test timeout
  // (twice, with the retry). Known-slow waits pass their own timeout.
  expect: { timeout: 15_000 },
  // Separate per port offset: Playwright empties this directory on start.
  outputDir: `/tmp/lictory-playwright-results${process.env.E2E_PORT_OFFSET ? `-${process.env.E2E_PORT_OFFSET}` : ""}`,
  use: {
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    storageState: consentStatePath,
  },
  projects: [
    {
      name: "platform",
      testDir: "./tests/platform",
      use: { baseURL: platformURL },
    },
    {
      name: "marketing",
      testDir: "./tests/marketing",
      use: { baseURL: marketingURL },
    },
    {
      name: "docs",
      testDir: "./tests/docs",
      use: { baseURL: docsURL },
    },
  ],
});
