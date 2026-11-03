import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { documentRoutes } from "@lictory/api/routes/public";

// One build, two installations: the SPA document takes its site URL and
// analytics settings from the environment of the process serving it.
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
    POSTHOG_PROJECT_TOKEN: "phc_first",
    POSTHOG_HOST: "https://eu.i.posthog.com",
  });
  assert.deepEqual(configOf(first), {
    siteUrl: "https://first.example",
    analytics: { projectToken: "phc_first", host: "https://eu.i.posthog.com" },
  });
  // Link previews use the platform's own images, never the website's.
  assert.match(
    first,
    /property="og:image" content="https:\/\/work\.first\.example\/social\/item\.png"/,
  );

  const second = await documentFor({
    PLATFORM_URL: "https://lictory.second.example",
    SITE_URL: "",
    POSTHOG_PROJECT_TOKEN: "",
    POSTHOG_HOST: "",
  });
  // No website configured: the browser shows no links to one.
  assert.deepEqual(configOf(second), { siteUrl: null, analytics: null });
  assert.match(
    second,
    /property="og:image" content="https:\/\/lictory\.second\.example\/social\/item\.png"/,
  );
  assert.ok(!second.includes("first.example"));
});
