// Browser workflows against production builds and an isolated, migrated
// database. Starts the API, worker, zero-cache, the edge proxy (platform
// origin), the marketing server and the documentation (its static export
// behind the production Cloudflare Worker, in wrangler's local runtime), runs
// Playwright, then stops everything
// and drops the database and its replication slots, also on failure.
// Usage: bun run test:e2e [playwright args]   (E2E_SKIP_BUILD=1 reuses builds)
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
// E2E_PORT_OFFSET lets several checkouts run browser tests side by side.
const offset = Number(process.env.E2E_PORT_OFFSET ?? 0);
const ports = {
  edge: 3001 + offset,
  api: 3002 + offset,
  workerHealth: 3003 + offset,
  marketing: 3101 + offset,
  docs: 3201 + offset,
  docsInspector: 9301 + offset,
  zero: 4858 + offset * 10,
  zeroChangeStreamer: 4859 + offset * 10,
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

// Application settings shared by the API and the worker. Integrations stay
// disabled; placeholder OAuth clients let tests reach provider redirects.
const appEnv = {
  ...process.env,
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
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
  MICROSOFT_CLIENT_ID: "e2e-microsoft-client-id",
  MICROSOFT_CLIENT_SECRET: "e2e-microsoft-client-secret",
  MICROSOFT_TENANT_ID: "common",
  // Company SSO only against the local Dex (tests/platform/sso.spec.ts), and
  // only when it is requested; never a developer's own identity provider.
  ...oidcEnv(process.env.E2E_OIDC_ISSUER?.trim()),
  PASSWORD_LOGIN_ENABLED: "",
  ZERO_QUERY_API_KEY: "e2e-zero-query-key",
  ZERO_MUTATE_API_KEY: "e2e-zero-mutate-key",
};

// The build or Playwright process in the foreground, stopped on interruption.
let foreground: ChildProcess | undefined;
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
  try {
    if (foreground?.pid) process.kill(-foreground.pid, "SIGTERM");
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
    foreground = child;
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
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
    if (stopping) return;
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
async function stopAll() {
  stopping = true;
  await Promise.all(
    children.map(
      ({ child }) =>
        new Promise<void>((resolve) => {
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
        }),
    ),
  );
}

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
    await run(
      "bun",
      ["run", "--filter", "@lictory/platform", "build"],
      buildEnv,
    );
    await run("bun", ["run", "--filter", "@lictory/api", "build"], buildEnv);
    if (workerAvailable)
      await run(
        "bun",
        ["run", "--filter", "@lictory/worker", "build"],
        buildEnv,
      );
    // The website is built with a placeholder PostHog project so its consent
    // banner can be tested; its relay path does not exist on the test server,
    // so nothing loads or leaves the machine. The platform, API and worker
    // run without analytics (tests/platform/analytics-off.spec.ts).
    await run("bun", ["run", "--filter", "@lictory/marketing", "build"], {
      ...buildEnv,
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_e2e_placeholder",
      NEXT_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:9",
      // A synthetic operator, never a developer's own legal details.
      LICTORY_LEGAL_NAME: "Example Operator",
      LICTORY_LEGAL_EMAIL: "privacy@example.org",
      LICTORY_LEGAL_ADDRESS: "",
      LICTORY_LEGAL_REGISTRATION: "",
    });
    await run("bun", ["run", "--filter", "@lictory/docs", "build"], {
      ...buildEnv,
      SITE_URL: docsUrl,
    });
  }

  start("api", "node", ["apps/api/dist/index.js"], {
    ...appEnv,
    PORT: String(ports.api),
    PLATFORM_DIST_DIR: "apps/platform/dist",
  });
  if (workerAvailable)
    start("worker", "node", ["apps/worker/dist/index.js"], {
      ...appEnv,
      WORKER_HEALTH_PORT: String(ports.workerHealth),
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
  await waitFor("edge", `${platformUrl}/sign-in`);
  await waitFor("marketing", `${siteUrl}/`);
  await waitFor("docs", `${docsUrl}/`);

  const child = spawn(
    "bunx",
    ["playwright", "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        DATABASE_URL: url,
        E2E_PLATFORM_URL: platformUrl,
        E2E_MARKETING_URL: siteUrl,
        E2E_DOCS_URL: docsUrl,
      },
    },
  );
  foreground = child;
  process.exitCode = await new Promise<number>((resolve) =>
    child.on("exit", (code) => resolve(code ?? 1)),
  );
  if (crashed.length) {
    console.error(
      `${crashed.join(", ")} exited during the run; the results are invalid.`,
    );
    process.exitCode = 1;
  }
} finally {
  if (interrupted) process.exitCode = 130;
  await stopAll();
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
}
