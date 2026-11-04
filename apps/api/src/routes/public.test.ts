import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { documentRoutes } from "@lictory/api/routes/public";

// One build, two installations: the SPA document takes its site URL, legal
// links and analytics settings from the environment of the process serving it.
const saved = { ...process.env };
let directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lictory-document-"));
  await writeFile(
    path.join(directory, "index.html"),
    "<html><head><!--app-head--></head><body></body></html>",
  );
  process.env.PLATFORM_DIST_DIR = directory;
});
after(async () => {
  process.env = saved;
  await rm(directory, { recursive: true, force: true });
});

function configOf(html: string) {
  const match =
    /<script type="application\/json" id="lictory-config">(.*?)<\/script>/s.exec(
      html,
    );
  assert.ok(match, "the document carries the runtime configuration");
  return JSON.parse(match[1]!) as unknown;
}

async function documentFor(env: Record<string, string>) {
  Object.assign(process.env, env);
  const response = await documentRoutes().request(
    `${env.PLATFORM_URL}/acme/items/PAY-1`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.text();
}

void test("the same build serves each installation its own origins and analytics", async () => {
  const first = await documentFor({
    PLATFORM_URL: "https://work.first.example",
    SITE_URL: "https://first.example",
    LEGAL_TERMS_URL: "https://first.example/terms",
    LEGAL_PRIVACY_URL: "https://first.example/privacy",
    POSTHOG_PROJECT_TOKEN: "phc_first",
    POSTHOG_HOST: "https://eu.i.posthog.com",
    ANALYTICS_CONSENT: "strict",
  });
  assert.deepEqual(configOf(first), {
    siteUrl: "https://first.example",
    legal: {
      termsUrl: "https://first.example/terms",
      privacyUrl: "https://first.example/privacy",
    },
    analytics: {
      projectToken: "phc_first",
      host: "https://eu.i.posthog.com",
      consent: "strict",
    },
  });
  assert.match(first, /content="https:\/\/first\.example\/og\/item"/);

  const second = await documentFor({
    PLATFORM_URL: "https://lictory.second.example",
    SITE_URL: "",
    LEGAL_TERMS_URL: "",
    LEGAL_PRIVACY_URL: "",
    POSTHOG_PROJECT_TOKEN: "",
    POSTHOG_HOST: "",
  });
  assert.deepEqual(configOf(second), {
    siteUrl: "https://lictory.second.example",
    legal: { termsUrl: null, privacyUrl: null },
    analytics: null,
  });
  assert.ok(!second.includes("first.example"));
});
