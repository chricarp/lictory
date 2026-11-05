// Verifies that a PostgreSQL server (a managed provider or your own) runs
// Lictory, end to end, in a disposable database. Run from a checkout on a
// machine that can reach the server and run Docker:
//
//   DATABASE_ADMIN_URL='postgresql://admin:…@host:5432/postgres?sslmode=verify-full' \
//     [NODE_EXTRA_CA_CERTS=/path/to/provider-ca.pem] \
//     bun scripts/verify-external-database.ts
//
// With the administrator connection (a role that may create roles and
// databases, never stored) it creates `lictory_pgverify_<random>` roles and
// databases, checks every requirement, applies the migrations, starts the
// pinned zero-cache image against it, changes an unreplicated and a
// replicated table to observe how Zero handles schema changes, then drops
// everything it created (VERIFY_KEEP=1 keeps it). The summary is what
// docs/operations/external-database.md#providers records for a provider.
//
// VERIFY_DOCKER_NETWORK=host lets zero-cache reach a server on localhost.
// Never point it at a database that holds data: it only creates and drops its
// own objects, but the administrator role could do more.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  checkDatabaseCompatibility,
  compatible,
  formatReport,
} from "@lictory/core/db/compatibility";
import { describeUrl } from "@lictory/core/db/connection-rules";
import { applyGrants, setupDatabase } from "@lictory/core/db/database-roles";
import { env } from "@lictory/core/lib/env";

const adminUrl = env("DATABASE_ADMIN_URL");
if (!adminUrl) {
  console.error(
    "Set DATABASE_ADMIN_URL to an administrator connection (a role with CREATEROLE and CREATEDB).",
  );
  process.exit(64);
}
const admin = describeUrl(adminUrl);
const sslmode = admin.sslmode ?? "verify-full";
const prefix = `lictory_pgverify_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
const secret = () => crypto.randomUUID().replaceAll("-", "");
const roleUrl = (role: string, database: string) => {
  const url = new URL(adminUrl);
  url.username = `${prefix}_${role}`;
  url.password = secret();
  url.pathname = `/${database}`;
  url.searchParams.set("sslmode", sslmode);
  return url.toString();
};
const zeroPassword = secret();
const withPassword = (url: string, password: string) => {
  const parsed = new URL(url);
  parsed.password = password;
  return parsed.toString();
};
const urls = {
  migration: roleUrl("owner", prefix),
  app: roleUrl("app", prefix),
  monitoring: roleUrl("ops", prefix),
  zero: withPassword(roleUrl("zero", prefix), zeroPassword),
  zeroCvr: withPassword(roleUrl("zero", `${prefix}_zero`), zeroPassword),
};
const zeroImage =
  /rocicorp\/zero:[\w.-]+@sha256:[a-f0-9]{64}/.exec(
    readFileSync("deploy/compose.production.yaml", "utf8"),
  )?.[0] ?? "rocicorp/zero:1.11.3";
const summary: string[] = [
  `Server: ${admin.host}:${admin.port}, sslmode=${sslmode}`,
];
const quiet = { max: 1, onnotice: () => undefined };

function docker(args: string[], extra: Record<string, string> = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    env: { ...process.env, ...extra },
  });
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const running = () =>
  docker(["inspect", "-f", "{{.State.Running}}", prefix]).stdout.trim() ===
  "true";
const logs = (since?: string) => {
  const result = docker(["logs", ...(since ? ["--since", since] : []), prefix]);
  return result.stdout + result.stderr;
};

async function startZero() {
  const ca = env("NODE_EXTRA_CA_CERTS");
  const variables = {
    ZERO_UPSTREAM_DB: urls.zero,
    ZERO_CVR_DB: urls.zeroCvr,
    ZERO_CHANGE_DB: urls.zeroCvr,
  };
  const result = docker(
    [
      "run",
      "-d",
      "--name",
      prefix,
      ...(env("VERIFY_DOCKER_NETWORK")
        ? ["--network", env("VERIFY_DOCKER_NETWORK")!]
        : []),
      ...(ca
        ? [
            "-v",
            `${ca}:/run/lictory/database-ca.pem:ro`,
            "-e",
            "NODE_EXTRA_CA_CERTS=/run/lictory/database-ca.pem",
          ]
        : []),
      // Secrets by name only: never on the command line.
      ...Object.keys(variables).flatMap((name) => ["-e", name]),
      "-e",
      "ZERO_REPLICA_FILE=/tmp/replica.db",
      "-e",
      "ZERO_APP_PUBLICATIONS=lictory_zero",
      "-e",
      `ZERO_ADMIN_PASSWORD=${secret()}`,
      "-e",
      "ZERO_AUTO_RESET=true",
      "-e",
      "ZERO_QUERY_URL=http://api.invalid/query",
      "-e",
      "ZERO_MUTATE_URL=http://api.invalid/mutate",
      "-e",
      "ZERO_ENABLE_TELEMETRY=false",
      "-e",
      "ZERO_NUM_SYNC_WORKERS=1",
      "-e",
      "ZERO_LOG_FORMAT=text",
      zeroImage,
    ],
    variables,
  );
  if (result.status !== 0)
    throw new Error(`Could not start zero-cache: ${result.stderr.trim()}`);
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const probe = docker([
      "exec",
      prefix,
      "curl",
      "-fsS",
      "-o",
      "/dev/null",
      "http://127.0.0.1:4848/keepalive",
    ]);
    if (probe.status === 0) return;
    if (!running())
      throw new Error(
        `zero-cache stopped during its initial sync:\n${logs().split("\n").slice(-20).join("\n")}`,
      );
    await sleep(2000);
  }
  throw new Error("zero-cache did not become healthy within 10 minutes.");
}

/** Changes a table, writes a replicated row, then reports what zero-cache did. */
async function schemaChange(owner: postgres.Sql, table: string) {
  const since = new Date().toISOString();
  await owner.unsafe(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS lictory_verify integer`,
  );
  await owner`UPDATE sync_entity SET data = jsonb_build_object('at', clock_timestamp()) WHERE key = ${prefix}`;
  await sleep(15_000);
  const after = logs(since);
  if (/MissingEventTriggerSupport|auto-reset/i.test(after) || !running())
    return "replication halted and zero-cache reset its replica (degraded mode)";
  if (/schema change\(s\)/i.test(after))
    return "replicated the schema change precisely";
  return "replication continued";
}

async function cleanup() {
  if (env("VERIFY_KEEP") === "1") {
    console.log(`Kept ${prefix}: drop its databases, slots and roles by hand.`);
    return;
  }
  docker(["rm", "-f", prefix]);
  // Logical slots block DROP DATABASE; zero-cache's role may drop its own.
  try {
    const zero = postgres(urls.zero, quiet);
    await zero`SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
                WHERE database = ${prefix} AND NOT active`.catch(
      () => undefined,
    );
    await zero.end({ timeout: 2 });
  } catch {
    // Nothing was created.
  }
  const sql = postgres(adminUrl!, quiet);
  try {
    for (const [database, owner] of [
      [`${prefix}_zero`, `${prefix}_zero`],
      [prefix, `${prefix}_owner`],
    ] as const) {
      const [exists] =
        await sql`SELECT 1 FROM pg_database WHERE datname = ${database}`;
      if (!exists) continue;
      await sql.unsafe(`SET ROLE "${owner}"`).catch(() => undefined);
      await sql.unsafe(`DROP DATABASE "${database}"`);
      await sql.unsafe("RESET ROLE");
    }
    for (const role of ["owner", "app", "zero", "ops"])
      await sql.unsafe(`DROP ROLE IF EXISTS "${prefix}_${role}"`);
    console.log(`Dropped ${prefix}'s databases and roles.`);
  } catch (error) {
    console.error(
      `Cleanup failed (${(error as Error).message}): drop ${prefix}* databases and roles by hand.`,
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function main() {
  console.log(`Verifying ${admin.host} with disposable ${prefix}…\n`);
  const setup = await setupDatabase(adminUrl!, urls);
  for (const line of setup.done) console.log(`  ${line}`);
  for (const line of setup.warnings) console.log(`  warning: ${line}`);
  summary.push(
    `Role setup without a superuser: ${setup.warnings.length ? `done with warnings (${setup.warnings.join(" ")})` : "done"}`,
  );

  const first = await checkDatabaseCompatibility(urls);
  console.log(`\nRequirements before migrations:\n${formatReport(first)}\n`);
  if (!compatible(first)) {
    summary.push("Requirements: NOT met (see the report above)");
    return false;
  }
  const owner = postgres(urls.migration, quiet);
  try {
    await migrate(drizzle(owner), { migrationsFolder: "drizzle" });
    summary.push("Migrations as the owner role: applied");
    await applyGrants(urls);
    await owner`INSERT INTO organization (id, name, slug, created_at)
                VALUES (${prefix}, 'Verification', ${prefix.replaceAll("_", "-")}, now())`;
    await owner`INSERT INTO sync_entity (key, organization_id, type, data)
                VALUES (${prefix}, ${prefix}, 'verification', '{}')`;

    await startZero();
    summary.push("zero-cache initial sync: healthy");
    await applyGrants(urls);
    const second = await checkDatabaseCompatibility(urls);
    console.log(
      `Requirements with zero-cache running:\n${formatReport(second)}\n`,
    );
    const events = second.find((c) => c.id === "event-triggers");
    summary.push(
      `Event triggers: ${events?.status === "pass" ? "installed (schema changes replicate precisely)" : "not available (degraded mode)"}`,
    );
    summary.push(
      `Changing an unreplicated table: ${await schemaChange(owner, "ai_run")}`,
    );
    summary.push(
      `Changing a replicated table: ${await schemaChange(owner, "sync_entity")}`,
    );
    summary.push(
      `Requirements: ${compatible(second) ? "met" : "NOT met"}${
        second.some((c) => c.status === "warn")
          ? `, warnings: ${second
              .filter((c) => c.status === "warn")
              .map((c) => c.id)
              .join(", ")}`
          : ""
      }`,
    );
    return compatible(second);
  } finally {
    await owner.end({ timeout: 2 });
  }
}

let ok = false;
try {
  ok = await main();
} catch (error) {
  summary.push(`Stopped: ${(error as Error).message}`);
} finally {
  await cleanup();
}
console.log(`\nSummary\n${summary.map((line) => `- ${line}`).join("\n")}`);
process.exitCode = ok ? 0 : 1;
