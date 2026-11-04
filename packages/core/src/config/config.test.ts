import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { declarations } from "@lictory/core/config/declarations";
import { mailTransportRule } from "@lictory/core/config/mail";
import { checkConfiguration } from "@lictory/core/config/validate";

const rules = [mailTransportRule];

const generated = (seed: string) => seed.repeat(64).slice(0, 64);

// What deploy/compose.production.yaml gives the API and the worker, with the
// `generate` values filled the way deploy/provision/new-environment.sh does.
const production = {
  NODE_ENV: "production",
  LICTORY_ENVIRONMENT: "production",
  APP_VERSION: "1.2.3",
  DATABASE_URL: "postgresql://lictory_app:pw@postgres:5432/lictory",
  PLATFORM_URL: "https://app.lictory.com",
  SITE_URL: "https://lictory.com",
  BETTER_AUTH_SECRET: generated("a1"),
  DELIVERY_CREDENTIALS_KEY: generated("b2"),
  ZERO_QUERY_API_KEY: generated("c3"),
  ZERO_MUTATE_API_KEY: generated("c3"),
  RESEND_API_KEY: "re_live",
  RESEND_FROM_EMAIL: "Lictory <no-reply@email.lictory.com>",
  SMTP_HOST: "",
  SMTP_PORT: "",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  SMTP_FROM: "",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "lictory-files",
  R2_S3_ENDPOINT: "",
  OPENAI_API_KEY: "",
  LICTORY_AI_MODEL: "",
  MICROSOFT_CLIENT_ID: "674718cd-ca91-451c-84eb-02aa492d2b10",
  MICROSOFT_CLIENT_SECRET: "",
  MICROSOFT_TENANT_ID: "common",
  OAUTH_PROXY_URL: "",
  OAUTH_PROXY_SECRET: "",
  POSTHOG_PROJECT_TOKEN: "",
  POSTHOG_HOST: "",
  PORT: "3002",
};

void test("the production deployment's configuration starts the API and the worker", () => {
  for (const service of ["api", "worker"] as const)
    assert.deepEqual(checkConfiguration(service, production, rules), {
      problems: [],
      warnings: [],
    });
});

void test("the mail transport rule: no transport warns, a partial one is a problem", () => {
  const none = checkConfiguration(
    "worker",
    { ...production, RESEND_API_KEY: "", SMTP_SECURE: "maybe" },
    rules,
  );
  assert.equal(none.problems.length, 1, none.problems.join("\n"));
  assert.match(none.problems[0]!, /SMTP_SECURE must be true or false/);
  assert.ok(
    none.warnings.some((warning) =>
      warning.includes("Email is not configured"),
    ),
    none.warnings.join("\n"),
  );
  const partial = checkConfiguration(
    "worker",
    { ...production, RESEND_API_KEY: "", SMTP_HOST: "smtp.example.com" },
    rules,
  );
  assert.equal(partial.problems.length, 1, partial.problems.join("\n"));
  assert.match(partial.problems[0]!, /SMTP_FROM is required in production/);
});

void test("every problem is listed at once and secrets are never echoed", () => {
  const { problems } = checkConfiguration("api", {
    ...production,
    PLATFORM_URL: "",
    BETTER_AUTH_SECRET: "local-development-secret-change-before-production",
    ZERO_QUERY_API_KEY: "short-zero-key",
    ZERO_MUTATE_API_KEY: "",
    DELIVERY_CREDENTIALS_KEY: "generate",
    SMTP_PORT: "smtp",
  });
  const about = (name: string) =>
    problems.filter((problem) => problem.startsWith(`${name} `));
  assert.equal(problems.length, 6, problems.join("\n"));
  assert.match(about("PLATFORM_URL")[0]!, /required in production/);
  assert.match(about("BETTER_AUTH_SECRET")[0]!, /placeholder/);
  assert.match(about("ZERO_QUERY_API_KEY")[0]!, /shorter than 32 bytes/);
  assert.match(about("ZERO_MUTATE_API_KEY")[0]!, /required in production/);
  assert.match(about("DELIVERY_CREDENTIALS_KEY")[0]!, /placeholder/);
  assert.match(about("SMTP_PORT")[0]!, /whole number, got "smtp"/);
  const report = problems.join("\n");
  assert.ok(!report.includes("short-zero-key"));
  assert.ok(!report.includes("change-before-production"));
});

void test("a missing secret in production stops the service that needs it", () => {
  const withoutSecret = { ...production, BETTER_AUTH_SECRET: undefined };
  assert.match(
    checkConfiguration("api", withoutSecret).problems.join("\n"),
    /BETTER_AUTH_SECRET is required in production/,
  );
  // The worker only needs it to derive the delivery credentials key.
  assert.deepEqual(checkConfiguration("worker", withoutSecret).problems, []);
});

void test("existing deployments without DELIVERY_CREDENTIALS_KEY start with a warning", () => {
  for (const service of ["api", "worker"] as const) {
    const report = checkConfiguration(service, {
      ...production,
      DELIVERY_CREDENTIALS_KEY: "",
    });
    assert.deepEqual(report.problems, []);
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0]!, /DELIVERY_CREDENTIALS_KEY is not set/);
  }
});

void test("development needs only a database and checks no secrets", () => {
  const development = {
    DATABASE_URL: "postgresql://lictory:lictory@localhost:5432/lictory",
    BETTER_AUTH_SECRET: "local-development-secret-change-before-production",
  };
  for (const service of ["api", "worker"] as const)
    assert.deepEqual(checkConfiguration(service, development, rules), {
      problems: [],
      warnings: [],
    });
  assert.match(
    checkConfiguration("api", {}).problems.join("\n"),
    /DATABASE_URL is required/,
  );
  // Malformed values are still errors outside production.
  assert.match(
    checkConfiguration("worker", { ...development, WORKER_DB_POOL_MAX: "0" })
      .problems[0]!,
    /WORKER_DB_POOL_MAX must be a whole number of at least 1/,
  );
});

void test("the migration runner checks only its own settings", () => {
  assert.deepEqual(checkConfiguration("migrate", {}).problems, []);
  const { problems } = checkConfiguration("migrate", {
    DATABASE_MIGRATION_TARGET: "prod",
    MIGRATION_LOCK_WAIT_SECONDS: "soon",
    // Not read by the migration runner.
    SMTP_PORT: "smtp",
  });
  assert.equal(problems.length, 2, problems.join("\n"));
});

// ------------------------------------------------- declarations match code

const root = fileURLToPath(new URL("../../../../", import.meta.url));

// Runtime code: what the API, worker, migration runner, platform, website and
// the operator scripts below execute. Deliberately excluded: tests (`*.test.*`,
// `tests/`, `playwright.config.ts`), developer and CI tooling (`scripts/dev.ts`,
// `scripts/test-e2e.ts`, `scripts/load-test.ts`, `scripts/release.ts`, the
// `scripts/check-*` and report scripts, `drizzle.config.ts`) and deploy shell
// scripts, whose settings live in deploy/env/*.env.example.
const runtimeRoots = [
  "apps/api/src",
  "apps/worker/src",
  "apps/platform/src",
  "apps/marketing/src",
  "packages/core/src",
  "packages/ui/src",
  "packages/zero/src",
];
const runtimeFiles = [
  "apps/platform/vite.config.ts",
  "apps/marketing/next.config.ts",
  "scripts/migrate.ts",
  "scripts/edge-proxy.ts",
  "scripts/rebuild-projections.ts",
];
// Set by Vite itself, not by the environment.
const viteBuiltIns = new Set(["DEV", "PROD", "MODE", "SSR", "BASE_URL"]);

const readers = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  // env("X"), envInteger("X"), envBoolean("X"), setting("X", …),
  // milliseconds(env, "X"), value(env, "X"), the mailer's sender("X", …),
  // read(env, "X") and flag(env, "X", …) (storage and SSO settings) and
  // oneOf(env, "X", …) (the instance access policy)
  /\b(?:env|envInteger|envBoolean|setting|milliseconds|value|sender|read|flag|oneOf)\(\s*(?:[A-Za-z_]+\s*,\s*)?["']([A-Z][A-Z0-9_]*)["']/g,
  // Functions that take the environment as `env` or `source`.
  /(?<![.\w])(?:env|source)\.([A-Z][A-Z0-9_]*)\b/g,
];

function readsIn(text: string) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const names = new Set<string>();
  for (const pattern of readers)
    for (const match of code.matchAll(pattern)) {
      // `"process.env.X": …` in a bundler `define` sets X; it does not read it.
      if (/["'`]/.test(code[match.index - 1] ?? "")) continue;
      if (match[0].startsWith("import.meta") && viteBuiltIns.has(match[1]!))
        continue;
      names.add(match[1]!);
    }
  for (const match of code.matchAll(
    /\bconst\s*\{([^}]*)\}\s*=\s*process\.env\b/g,
  ))
    for (const name of match[1]!.split(",")) {
      const trimmed = name.trim().split(/[\s:=]/)[0]!;
      if (trimmed) names.add(trimmed);
    }
  return names;
}

function runtimeReads() {
  const files = [...runtimeFiles];
  for (const directory of runtimeRoots)
    for (const file of readdirSync(`${root}${directory}`, {
      recursive: true,
      encoding: "utf8",
    }))
      if (/\.(?:[cm]?tsx?|mjs)$/.test(file) && !/\.test\.[cm]?tsx?$/.test(file))
        files.push(`${directory}/${file}`);
  const reads = new Map<string, string[]>();
  for (const file of files)
    for (const name of readsIn(readFileSync(`${root}${file}`, "utf8")))
      reads.set(name, [...(reads.get(name) ?? []), file]);
  return reads;
}

void test("the scan recognizes every way runtime code reads the environment", () => {
  assert.deepEqual(
    [
      ...readsIn(`
        // process.env.COMMENTED
        const a = process.env.DIRECT;
        const b = process.env["INDEXED"];
        const c = import.meta.env.VITE_READ ?? import.meta.env.DEV;
        const d = env("HELPER") ?? envInteger("INTEGER", source);
        const h = envBoolean("FLAG");
        const e = milliseconds(
          env,
          "MULTILINE",
          1,
        );
        const f = env.PARAMETER ?? source.SOURCE;
        const { DESTRUCTURED, OTHER } = process.env;
        const g = { "process.env.DEFINED": "1" };
      `),
    ].sort(),
    [
      "DESTRUCTURED",
      "DIRECT",
      "FLAG",
      "HELPER",
      "INDEXED",
      "INTEGER",
      "MULTILINE",
      "OTHER",
      "PARAMETER",
      "SOURCE",
      "VITE_READ",
    ],
  );
});

void test("every variable runtime code reads is declared, and every declaration is read", () => {
  const reads = runtimeReads();
  const declared = new Set(declarations.map((d) => d.name));
  assert.equal(declared.size, declarations.length, "duplicate declaration");
  const undeclared = [...reads]
    .filter(([name]) => !declared.has(name))
    .map(([name, files]) => `${name} (${files.join(", ")})`);
  assert.deepEqual(
    undeclared,
    [],
    "Declare these in packages/core/src/config/declarations.ts and run bun run config:docs",
  );
  const unread = [...declared].filter((name) => !reads.has(name));
  assert.deepEqual(unread, [], "Declared but never read by runtime code");
});
