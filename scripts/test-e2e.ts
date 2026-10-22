// Browser workflows against production builds and an isolated, migrated
// database. Starts the API, worker, zero-cache, the edge proxy (platform
// origin) and the marketing server, runs Playwright, then stops everything
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
const ports = {
  edge: 3001,
  api: 3002,
  marketing: 3101,
  zero: 4858,
  zeroChangeStreamer: 4859,
};
const platformUrl = `http://localhost:${ports.edge}`;
const siteUrl = `http://localhost:${ports.marketing}`;

const name = `lictory_e2e_${crypto.randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${name}`;
const url = databaseUrl.toString();
const replicaDir = mkdtempSync(join(tmpdir(), "lictory-e2e-zero-"));
const children: { name: string; child: ChildProcess }[] = [];
const workerAvailable = existsSync("apps/worker/build.mjs");

// Application settings shared by the API and the worker. Integrations stay
// disabled; placeholder OAuth clients let tests reach provider redirects.
const appEnv = {
  ...process.env,
  NODE_ENV: "production",
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
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "",
  VITE_POSTHOG_PROJECT_TOKEN: "",
  SMTP_HOST: process.env.SMTP_HOST ?? "localhost",
  SMTP_PORT: process.env.SMTP_PORT ?? "1025",
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
  MICROSOFT_CLIENT_ID: "e2e-microsoft-client-id",
  MICROSOFT_CLIENT_SECRET: "e2e-microsoft-client-secret",
  MICROSOFT_TENANT_ID: "common",
  ZERO_API_KEY: "e2e-zero-api-key",
};

function run(command: string, args: string[], env = appEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
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
    if (!stopping) console.error(`[${label}] exited (${code ?? signal})`);
  });
  children.push({ name: label, child });
  return child;
}

async function waitFor(label: string, check: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
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
      NODE_ENV: "production",
      VITE_SITE_URL: siteUrl,
      NEXT_PUBLIC_PLATFORM_URL: platformUrl,
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
    await run(
      "bun",
      ["run", "--filter", "@lictory/marketing", "build"],
      buildEnv,
    );
  }

  start("api", "node", ["apps/api/dist/index.js"], {
    ...appEnv,
    PORT: String(ports.api),
    PLATFORM_DIST_DIR: "apps/platform/dist",
  });
  if (workerAvailable)
    start("worker", "node", ["apps/worker/dist/index.js"], appEnv);
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
    ZERO_QUERY_API_KEY: appEnv.ZERO_API_KEY,
    ZERO_MUTATE_API_KEY: appEnv.ZERO_API_KEY,
    ZERO_ENABLE_CRUD_MUTATIONS: "false",
    ZERO_AUTH_REVALIDATE_INTERVAL_SECONDS: "10",
    ZERO_ADMIN_PASSWORD: "e2e-zero-admin",
    ZERO_LOG_LEVEL: "warn",
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

  await waitFor("api", `http://localhost:${ports.api}/readyz`);
  await waitFor("zero-cache", `http://localhost:${ports.zero}/keepalive`);
  await waitFor("edge", `${platformUrl}/sign-in`);
  await waitFor("marketing", `${siteUrl}/`);

  const child = spawn(
    "bunx",
    ["playwright", "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: url,
        E2E_PLATFORM_URL: platformUrl,
        E2E_MARKETING_URL: siteUrl,
      },
    },
  );
  process.exitCode = await new Promise<number>((resolve) =>
    child.on("exit", (code) => resolve(code ?? 1)),
  );
} finally {
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
