// Browser workflows against production builds and an isolated, migrated
// database. Starts the API, worker, collaboration service, zero-cache, the
// edge proxy (platform origin, including /collaboration), the marketing
// server and the documentation (its static export behind the production
// Cloudflare Worker, in wrangler's local runtime), runs Playwright, then
// stops everything and drops the database and its replication slots, also on
// failure.
// Usage: bun run test:e2e [playwright args]   (E2E_SKIP_BUILD=1 reuses builds)
//
// E2E_SHARD=2/4 runs the second of four shards balanced by recorded duration
// (scripts/e2e-selection.ts); E2E_UPDATE_TIMINGS=1 records this run's
// durations for that balance. The applications build concurrently, and the
// documentation is built and served only when the selected tests include it.
//
// External services are local stand-ins (scripts/e2e-fakes): a Jira Cloud
// site and, for the workflows of Lictory Intelligence (*.ai.spec.ts), a
// scripted AI provider. Those workflows run last, against the API and worker
// restarted with the provider configured: every other workflow keeps a
// server without AI, as a default installation has.
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  listTests,
  parseShard,
  shardFiles,
  updateTimings,
} from "./e2e-selection";
import { FAKE_JIRA_SITE, startFakeJira } from "./e2e-fakes/jira";
import { startScriptedAi } from "./e2e-fakes/openai";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
// E2E_PORT_OFFSET lets several checkouts run browser tests side by side.
const offset = Number(process.env.E2E_PORT_OFFSET ?? 0);
const ports = {
  edge: 3001 + offset,
  api: 3002 + offset,
  workerHealth: 3003 + offset,
  collaboration: 3004 + offset,
  marketing: 3101 + offset,
  docs: 3201 + offset,
  docsInspector: 9301 + offset,
  zero: 4858 + offset * 10,
  zeroChangeStreamer: 4859 + offset * 10,
  fakeJira: 3005 + offset,
  scriptedAi: 3006 + offset,
};
const platformUrl = `http://localhost:${ports.edge}`;
const siteUrl = `http://localhost:${ports.marketing}`;
const docsUrl = `http://localhost:${ports.docs}`;

const name = `lictory_e2e_${crypto.randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${name}`;
const url = databaseUrl.toString();
const replicaDir = mkdtempSync(join(tmpdir(), "lictory-e2e-zero-"));
const children: { name: string; child: ChildProcess }[] = [];
const workerAvailable = existsSync("apps/worker/build.mjs");
const collaborationAvailable = existsSync("apps/collaboration/build.mjs");

// The API discovers the provider when it starts, so Dex must already run.
function oidcEnv(issuer: string | undefined) {
  return {
    OIDC_ISSUER: issuer ?? "",
    OIDC_CLIENT_ID: issuer ? "lictory-local" : "",
    OIDC_CLIENT_SECRET: issuer ? "lictory-local-dex-secret" : "",
    OIDC_SCOPES: "",
    OIDC_DISPLAY_NAME: issuer ? "Acme SSO" : "",
    OIDC_AUTO_CREATE_USERS: "",
  };
}

// Application settings shared by the API, the worker and the collaboration
// service. Integrations stay disabled; placeholder OAuth clients let tests
// reach provider redirects.
// Never a developer's own AI provider, endpoint or key: every AI setting is
// cleared, then each phase configures the scripted provider explicitly.
const aiSettings = Object.keys(process.env).filter(
  (name) =>
    name.startsWith("LICTORY_AI_") ||
    name.startsWith("LICTORY_TRANSCRIPTION_") ||
    name.startsWith("OPENAI_") ||
    name === "LICTORY_HOST_MODEL_SERVER",
);
const inherited = { ...process.env };
for (const name of aiSettings) delete inherited[name];
const parentEnv = { ...process.env };
for (const name of aiSettings) delete parentEnv[name];
const appEnv = {
  ...inherited,
  NODE_ENV: "production" as const,
  DATABASE_URL: url,
  DATABASE_URL_UNPOOLED: url,
  PLATFORM_URL: platformUrl,
  SITE_URL: siteUrl,
  BETTER_AUTH_SECRET:
    "e2e-local-only-secret-with-at-least-thirty-two-characters",
  // Never inherit a developer's live OAuth proxy or its shared secret.
  OAUTH_PROXY_URL: "",
  OAUTH_PROXY_SECRET: "",
  OAUTH_PROXY_TRUSTED_ORIGINS: "",
  RESEND_API_KEY: "",
  // Production requires an explicit key before Jira can be connected (the
  // fake Jira site in tests/platform/knowledge-handoff.spec.ts).
  DELIVERY_CREDENTIALS_KEY: "e2e-delivery-credentials-key-local-only",
  // No AI provider, except for the workflows of Lictory Intelligence (the
  // scripted provider below).
  OPENAI_API_KEY: "",
  // No file storage: the suite checks that attachments explain they are
  // unavailable, even when a developer's .env points S3_* at MinIO.
  S3_ENDPOINT: "",
  S3_REGION: "",
  S3_BUCKET: "",
  S3_ACCESS_KEY_ID: "",
  S3_SECRET_ACCESS_KEY: "",
  S3_FORCE_PATH_STYLE: "",
  R2_ACCOUNT_ID: "",
  R2_ACCESS_KEY_ID: "",
  R2_SECRET_ACCESS_KEY: "",
  R2_BUCKET_NAME: "",
  R2_S3_ENDPOINT: "",
  // The installation's own legal notices (synthetic): sign-up links to them.
  LEGAL_TERMS_URL: `${siteUrl}/terms-of-service`,
  LEGAL_PRIVACY_URL: `${siteUrl}/privacy`,
  // Analytics stay off: no browser or server event leaves the test machine.
  POSTHOG_PROJECT_TOKEN: "",
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "",
  SMTP_HOST: process.env.SMTP_HOST ?? "localhost",
  SMTP_PORT: process.env.SMTP_PORT ?? "1025",
  // Production requires an explicit sender.
  SMTP_FROM: "Lictory <no-reply@lictory.local>",
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
  MICROSOFT_CLIENT_ID: "e2e-microsoft-client-id",
  MICROSOFT_CLIENT_SECRET: "e2e-microsoft-client-secret",
  MICROSOFT_TENANT_ID: "common",
  // Company SSO only against the local Dex (tests/platform/sso.spec.ts), and
  // only when it is requested; never a developer's own identity provider.
  ...oidcEnv(process.env.E2E_OIDC_ISSUER?.trim()),
  PASSWORD_LOGIN_ENABLED: "",
  // Browser workflows sign up and create organizations themselves. The
  // self-hosted defaults (invitations only, organizations by instance
  // administrators) are proven by apps/api/src/api.test.ts.
  LICTORY_SIGNUP_MODE: "open",
  LICTORY_ALLOWED_EMAIL_DOMAINS: "",
  LICTORY_ORGANIZATION_CREATION: "everyone",
  // Production startup validation requires at least 32 bytes. The shared
  // prefix is what the client bundle scan looks for.
  ZERO_QUERY_API_KEY: "e2e-zero-api-key-for-query-local-only",
  ZERO_MUTATE_API_KEY: "e2e-zero-api-key-for-mutate-local-only",
};

// The builds or the Playwright process in the foreground, stopped on
// interruption or when a concurrent build fails.
const foreground = new Set<ChildProcess>();
let interrupted: NodeJS.Signals | undefined;
// Services that exited while they were needed: every later result is invalid.
const crashed: string[] = [];
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = signal;
    console.error(`${signal}: stopping the services and dropping ${name}.`);
    stopForeground();
  });

// Foreground processes get their own process group (like services), so
// stopping one also stops what its package-manager wrapper spawned.
function stopForeground() {
  for (const child of foreground)
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = appEnv) {
  if (interrupted)
    return Promise.reject(new Error(`Interrupted (${interrupted}).`));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      detached: true,
    });
    foreground.add(child);
    child.on("exit", (code) => {
      foreground.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

// Runs independent steps side by side; the first failure stops the others.
async function together(steps: (() => Promise<void>)[]) {
  try {
    await Promise.all(steps.map((step) => step()));
  } catch (error) {
    stopForeground();
    throw error;
  }
}

function start(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  // Each service runs in its own process group so that stopping it also stops
  // the processes it spawned (package-manager wrappers do not forward signals).
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env,
    detached: true,
  });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => `[${label}] ${line}`)
      .join("\n");
  // Logs are kept quiet unless E2E_VERBOSE is set; errors always surface.
  child.stdout?.on(
    "data",
    (c: Buffer) => process.env.E2E_VERBOSE && console.log(prefix(c)),
  );
  child.stderr?.on("data", (c: Buffer) => console.error(prefix(c)));
  child.on("exit", (code, signal) => {
    if (stopping || retired.has(child)) return;
    console.error(`[${label}] exited (${code ?? signal})`);
    // Fail fast instead of letting every remaining test time out against it.
    crashed.push(label);
    stopForeground();
  });
  children.push({ name: label, child });
  return child;
}

async function waitFor(label: string, check: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (interrupted) throw new Error(`Interrupted (${interrupted}).`);
    if (crashed.length)
      throw new Error(
        `${crashed.join(", ")} exited before ${label} was ready.`,
      );
    try {
      const response = await fetch(check);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline)
      throw new Error(`${label} did not become ready at ${check}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let stopping = false;
// Services stopped on purpose during the run (restarted with another
// configuration): their exit is not a crash.
const retired = new Set<ChildProcess>();

// A stale server on one of these ports would silently answer instead of the
// build under test.
async function assertPortsFree() {
  const { createConnection } = await import("node:net");
  for (const port of Object.values(ports))
    for (const host of ["127.0.0.1", "::1"]) {
      const busy = await new Promise<boolean>((resolve) => {
        const socket = createConnection({ port, host });
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
      if (busy)
        throw new Error(
          `Port ${port} (${host}) is already in use; stop the process using it.`,
        );
    }
}
await assertPortsFree();
function stop(child: ChildProcess) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve();
    const signal = (name: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, name);
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => signal("SIGKILL"), 15_000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    signal("SIGTERM");
  });
}
async function stopAll() {
  stopping = true;
  await Promise.all(children.map(({ child }) => stop(child)));
}

const playwrightArgs = process.argv.slice(2);
const shard = parseShard(process.env.E2E_SHARD);
const listed = await listTests(playwrightArgs);
// The listing decides which services start and which workflows need the
// scripted AI provider.
if (!listed) throw new Error("The browser tests could not be listed.");
let files = [...listed.keys()];
if (shard) {
  files = shardFiles(listed, shard.index, shard.total);
  console.log(
    `Shard ${shard.index}/${shard.total}: ${files.length ? files.join(", ") : "no test files"}.`,
  );
  if (!files.length) process.exit(0);
}
if (!files.length) throw new Error("No browser tests match these arguments.");
// Workflows of Lictory Intelligence run after the others, against the API and
// worker restarted with the scripted AI provider: configured in their
// environment (*.ai.spec.ts, as existing installations do), or by an instance
// administrator in the admin console (*.ai-console.spec.ts, which starts
// with no AI settings at all and stores its own).
const needsAi = (file: string) => file.endsWith(".ai.spec.ts");
const configuresAi = (file: string) => file.endsWith(".ai-console.spec.ts");
const phases = [
  {
    ai: false,
    files: files.filter((file) => !needsAi(file) && !configuresAi(file)),
  },
  { ai: false, console: true, files: files.filter(configuresAi) },
  { ai: true, files: files.filter(needsAi) },
].filter((phase) => phase.files.length);
const projects = new Set(
  files.flatMap((file) => [...(listed.get(file)?.projects ?? [])]),
);
const docsNeeded = projects.has("docs");
if (!docsNeeded)
  console.log("No documentation tests selected: the docs site is not built.");
// File durations are recorded only from a complete run: a filtered or sharded
// run would record part of a file as all of it.
if (process.env.E2E_UPDATE_TIMINGS && (shard || playwrightArgs.length))
  throw new Error("E2E_UPDATE_TIMINGS needs the whole suite: no arguments.");
const reportDir = process.env.E2E_UPDATE_TIMINGS
  ? mkdtempSync(join(tmpdir(), "lictory-e2e-report-"))
  : undefined;

let fakeJira: Awaited<ReturnType<typeof startFakeJira>> | undefined;
let scriptedAi: Awaited<ReturnType<typeof startScriptedAi>> | undefined;
let aiEnv: (ai: boolean) => Record<string, string> = () => ({});
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
await admin`CREATE DATABASE ${admin(name)}`;
try {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();

  if (!process.env.E2E_SKIP_BUILD) {
    const buildEnv = {
      ...appEnv,
      API_ORIGIN: `http://localhost:${ports.api}`,
      NODE_ENV: "production" as const,
      NEXT_TELEMETRY_DISABLED: "1",
    };
    // Independent builds run side by side; the backend bundles take seconds,
    // the two Next.js sites most of the time.
    await together([
      async () => {
        await run(
          "bun",
          ["run", "--filter", "@lictory/platform", "build"],
          buildEnv,
        );
        await run(
          "bun",
          ["run", "--filter", "@lictory/api", "build"],
          buildEnv,
        );
        if (workerAvailable)
          await run(
            "bun",
            ["run", "--filter", "@lictory/worker", "build"],
            buildEnv,
          );
        if (collaborationAvailable)
          await run(
            "bun",
            ["run", "--filter", "@lictory/collaboration", "build"],
            buildEnv,
          );
      },
      // The website is built with a placeholder PostHog project so its consent
      // banner can be tested; its relay path does not exist on the test server,
      // so nothing loads or leaves the machine. The platform, API and worker
      // run without analytics (tests/platform/analytics-off.spec.ts).
      () =>
        run("bun", ["run", "--filter", "@lictory/marketing", "build"], {
          ...buildEnv,
          NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_e2e_placeholder",
          NEXT_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:9",
        }),
      async () => {
        if (docsNeeded)
          await run("bun", ["run", "--filter", "@lictory/docs", "build"], {
            ...buildEnv,
            SITE_URL: docsUrl,
          });
      },
    ]);
  }

  // Stand-ins for external services, local to this run (scripts/e2e-fakes).
  fakeJira = await startFakeJira(ports.fakeJira);
  scriptedAi = await startScriptedAi(ports.scriptedAi);
  // The API and the worker reach the fake Jira site through a preloaded
  // route that only this script passes; with `ai`, the scripted provider
  // through the AI SDK's OPENAI_BASE_URL.
  const scriptedAiKey = "e2e-scripted-ai-key";
  // The existing-installation configuration (an OpenAI key, the SDK's base
  // URL), so the browser suite keeps covering it.
  aiEnv = (ai: boolean): Record<string, string> =>
    ai
      ? {
          OPENAI_API_KEY: scriptedAiKey,
          OPENAI_BASE_URL: `${scriptedAi!.url}/v1`,
          LICTORY_AI_MODEL: "e2e-scripted",
        }
      : { OPENAI_API_KEY: "" };
  const backendEnv = (ai: boolean): NodeJS.ProcessEnv => ({
    ...appEnv,
    E2E_FAKE_ROUTES: JSON.stringify({ [FAKE_JIRA_SITE]: fakeJira!.url }),
    ...aiEnv(ai),
  });
  const preload = ["--import", "./scripts/e2e-fakes/route-fake-sites.ts"];
  let backend: ChildProcess[] = [];
  const startBackend = async (ai: boolean) => {
    for (const child of backend) retired.add(child);
    await Promise.all(backend.map(stop));
    backend = [
      start("api", "node", [...preload, "apps/api/dist/index.js"], {
        ...backendEnv(ai),
        PORT: String(ports.api),
        PLATFORM_DIST_DIR: "apps/platform/dist",
      }),
      ...(workerAvailable
        ? [
            start("worker", "node", [...preload, "apps/worker/dist/index.js"], {
              ...backendEnv(ai),
              WORKER_HEALTH_PORT: String(ports.workerHealth),
            }),
          ]
        : []),
    ];
  };
  await startBackend(phases[0]!.ai);
  // Live draft editing; browsers reach it through the edge proxy's
  // /collaboration route, exactly as in production.
  if (collaborationAvailable)
    start("collaboration", "node", ["apps/collaboration/dist/index.js"], {
      ...appEnv,
      COLLABORATION_PORT: String(ports.collaboration),
      COLLABORATION_HOST: "127.0.0.1",
    });
  start("zero", "node_modules/.bin/zero-cache", [], {
    ...process.env,
    ZERO_UPSTREAM_DB: url,
    ZERO_REPLICA_FILE: join(replicaDir, "replica.db"),
    ZERO_PORT: String(ports.zero),
    ZERO_CHANGE_STREAMER_PORT: String(ports.zeroChangeStreamer),
    ZERO_APP_PUBLICATIONS: "lictory_zero",
    ZERO_QUERY_URL: `http://localhost:${ports.api}/api/zero/query`,
    ZERO_MUTATE_URL: `http://localhost:${ports.api}/api/zero/mutate`,
    ZERO_QUERY_FORWARD_COOKIES: "true",
    ZERO_MUTATE_FORWARD_COOKIES: "true",
    ZERO_QUERY_API_KEY: appEnv.ZERO_QUERY_API_KEY,
    ZERO_MUTATE_API_KEY: appEnv.ZERO_MUTATE_API_KEY,
    ZERO_ENABLE_CRUD_MUTATIONS: "false",
    ZERO_AUTH_REVALIDATE_INTERVAL_SECONDS: "10",
    ZERO_ADMIN_PASSWORD: "e2e-zero-admin",
    ZERO_LOG_LEVEL: "warn",
    ZERO_ENABLE_TELEMETRY: "false",
  });
  start("edge", "bun", ["scripts/edge-proxy.ts"], {
    ...process.env,
    EDGE_PORT: String(ports.edge),
    API_ORIGIN: `http://localhost:${ports.api}`,
    ZERO_ORIGIN: `http://localhost:${ports.zero}`,
    COLLABORATION_ORIGIN: `http://127.0.0.1:${ports.collaboration}`,
    PLATFORM_DIST_DIR: "apps/platform/dist",
  });
  // Assemble the standalone server exactly as the production image does.
  const standalone = "apps/marketing/.next/standalone/apps/marketing";
  cpSync("apps/marketing/.next/static", `${standalone}/.next/static`, {
    recursive: true,
  });
  cpSync("apps/marketing/public", `${standalone}/public`, { recursive: true });
  start(
    "marketing",
    "node",
    ["apps/marketing/.next/standalone/apps/marketing/server.js"],
    {
      ...appEnv,
      PORT: String(ports.marketing),
      HOSTNAME: "127.0.0.1",
    },
  );

  if (docsNeeded)
    start(
      "docs",
      "node_modules/.bin/wrangler",
      [
        "dev",
        "--config",
        "apps/docs/wrangler.jsonc",
        "--ip",
        "127.0.0.1",
        "--port",
        String(ports.docs),
        "--inspector-port",
        String(ports.docsInspector),
        "--show-interactive-dev-session=false",
        "--log-level",
        "warn",
      ],
      { ...process.env, WRANGLER_SEND_METRICS: "false" },
    );

  await waitFor("api", `http://localhost:${ports.api}/readyz`);
  await waitFor("zero-cache", `http://localhost:${ports.zero}/keepalive`);
  if (collaborationAvailable)
    await waitFor(
      "collaboration",
      `http://127.0.0.1:${ports.collaboration}/readyz`,
    );
  await waitFor("edge", `${platformUrl}/sign-in`);
  await waitFor("marketing", `${siteUrl}/`);
  if (docsNeeded) await waitFor("docs", `${docsUrl}/`);

  let failed = false;
  for (const [index, phase] of phases.entries()) {
    if (index > 0) {
      console.log(
        `Restarting the API and worker ${phase.ai ? "with" : "without"} the scripted AI provider${"console" in phase ? " (configured in the admin console)" : ""} for ${phase.files.join(", ")}.`,
      );
      await startBackend(phase.ai);
      await waitFor("api", `http://localhost:${ports.api}/readyz`);
    }
    if (workerAvailable)
      await waitFor("worker", `http://127.0.0.1:${ports.workerHealth}/healthz`);
    const jsonReport = reportDir && join(reportDir, `report-${index}.json`);
    const child = spawn("bunx", ["playwright", "test", ...playwrightArgs], {
      stdio: "inherit",
      detached: true,
      env: {
        ...parentEnv,
        DATABASE_URL: url,
        E2E_PLATFORM_URL: platformUrl,
        E2E_MARKETING_URL: siteUrl,
        E2E_DOCS_URL: docsUrl,
        // The test's side of the fakes (what people do in Jira, what was
        // sent to the AI provider).
        E2E_FAKE_JIRA_URL: fakeJira.url,
        ...((phase.ai || "console" in phase) && {
          E2E_SCRIPTED_AI_URL: scriptedAi.url,
        }),
        // Tests seed through the domain writer, which records in each
        // organization's directory whether the server has an AI provider
        // (and which): the same answer as the API and worker of this phase.
        ...aiEnv(phase.ai),
        // This phase's files (playwright.config.ts restricts the run to them).
        E2E_FILES: JSON.stringify(phase.files),
        E2E_JSON_REPORT: jsonReport,
      },
    });
    foreground.add(child);
    const code = await new Promise<number>((resolve) =>
      child.on("exit", (exit) => resolve(exit ?? 1)),
    );
    if (code !== 0) failed = true;
    if (crashed.length || interrupted) break;
    if (code === 0 && jsonReport && existsSync(jsonReport))
      updateTimings(jsonReport);
  }
  process.exitCode = failed ? 1 : 0;
  if (crashed.length) {
    console.error(
      `${crashed.join(", ")} exited during the run; the results are invalid.`,
    );
    process.exitCode = 1;
  }
} finally {
  if (interrupted) process.exitCode = 130;
  await stopAll();
  await Promise.all([fakeJira?.close(), scriptedAi?.close()]);
  // zero-cache holds a logical replication slot in the test database; it must
  // go before the database can be dropped.
  await admin`
    SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots
    WHERE database = ${name} AND active_pid IS NOT NULL`;
  await admin`
    SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
    WHERE database = ${name}`;
  await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`;
  await admin.end();
  rmSync(replicaDir, { recursive: true, force: true });
  if (reportDir) rmSync(reportDir, { recursive: true, force: true });
}
