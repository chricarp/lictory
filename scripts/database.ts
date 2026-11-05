// Database compatibility checks and role setup for any PostgreSQL Lictory runs
// on. Ships in the migrate image as database.mjs; deploy/compose.production.yaml
// runs it as the one-shot `database` service with the same connections the
// services use. See docs/operations/external-database.md.
//
//   database.mjs check [--json]         every requirement, the exact gap and its fix
//   database.mjs setup                  roles and databases (DATABASE_ADMIN_URL, once)
//   database.mjs grants                 object privileges, as their owners
//   database.mjs lsn                    the server's current WAL position
//   database.mjs wait-replicated <lsn> [seconds]   until zero-cache confirmed it
//
// Connections: DATABASE_MIGRATION_URL (required), ZERO_UPSTREAM_DB, ZERO_CVR_DB,
// DATABASE_URL and DATABASE_MONITORING_URL. Connection strings and passwords
// are never printed.
import postgres from "postgres";

import {
  checkDatabaseCompatibility,
  compatible,
  formatReport,
} from "@lictory/core/db/compatibility";
import { applyGrants, setupDatabase } from "@lictory/core/db/database-roles";
import { env } from "@lictory/core/lib/env";

const [command = "check", ...args] = process.argv.slice(2);

function required(name: string, value: string | undefined) {
  if (!value) {
    console.error(`${name} is required for database.mjs ${command}.`);
    process.exit(64);
  }
  return value;
}

function connections() {
  const zero = env("ZERO_UPSTREAM_DB");
  const zeroCvr = env("ZERO_CVR_DB");
  const app = env("DATABASE_URL");
  const monitoring = env("DATABASE_MONITORING_URL");
  return {
    migration: required(
      "DATABASE_MIGRATION_URL",
      env("DATABASE_MIGRATION_URL"),
    ),
    ...(zero ? { zero } : {}),
    ...(zeroCvr ? { zeroCvr } : {}),
    ...(app ? { app } : {}),
    ...(monitoring ? { monitoring } : {}),
  };
}

function print(report: { done: string[]; warnings: string[] }) {
  for (const line of report.done) console.log(line);
  for (const line of report.warnings) console.warn(`warning: ${line}`);
}

const zeroSlots = String.raw`zero\_0\_%`;

async function main() {
  switch (command) {
    case "check": {
      const checks = await checkDatabaseCompatibility(connections());
      if (args.includes("--json"))
        console.log(JSON.stringify({ compatible: compatible(checks), checks }));
      else console.log(formatReport(checks));
      if (!compatible(checks)) process.exitCode = 1;
      return;
    }
    case "setup": {
      const urls = connections();
      print(
        await setupDatabase(
          required("DATABASE_ADMIN_URL", env("DATABASE_ADMIN_URL")),
          {
            ...urls,
            zero: required("ZERO_UPSTREAM_DB", env("ZERO_UPSTREAM_DB")),
            zeroCvr: required("ZERO_CVR_DB", env("ZERO_CVR_DB")),
            app: required("DATABASE_URL", env("DATABASE_URL")),
          },
        ),
      );
      return;
    }
    case "grants": {
      const urls = connections();
      print(
        await applyGrants({
          ...urls,
          zero: required("ZERO_UPSTREAM_DB", env("ZERO_UPSTREAM_DB")),
          app: required("DATABASE_URL", env("DATABASE_URL")),
        }),
      );
      return;
    }
    case "lsn":
    case "wait-replicated": {
      const sql = postgres(
        required("DATABASE_MIGRATION_URL", env("DATABASE_MIGRATION_URL")),
        {
          max: 1,
          onnotice: () => undefined,
        },
      );
      try {
        if (command === "lsn") {
          const [row] = await sql<{ lsn: string }[]>`
            SELECT pg_current_wal_lsn()::text AS lsn`;
          console.log(row!.lsn);
          return;
        }
        const lsn = args[0] ?? "";
        if (!/^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/i.test(lsn)) {
          console.error("Usage: database.mjs wait-replicated <lsn> [seconds]");
          process.exitCode = 64;
          return;
        }
        const deadline = Date.now() + Number(args[1] ?? 600) * 1000;
        for (;;) {
          // Only Zero's slots: a managed server may carry other consumers.
          const [row] = await sql<{ caught: boolean }[]>`
            SELECT coalesce(bool_or(confirmed_flush_lsn >= ${lsn}::pg_lsn), false) AS caught
              FROM pg_replication_slots
             WHERE slot_type = 'logical' AND active AND slot_name LIKE ${zeroSlots}`;
          if (row?.caught) return;
          if (Date.now() >= deadline) {
            console.error(
              `zero-cache has not confirmed WAL position ${lsn}; check its logs.`,
            );
            process.exitCode = 1;
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } finally {
        await sql.end({ timeout: 2 });
      }
    }
    default:
      console.error(
        "Usage: database.mjs check [--json] | setup | grants | lsn | wait-replicated <lsn> [seconds]",
      );
      process.exitCode = 64;
  }
}

// Error messages name hosts and roles; never let a URL or password through.
function redact(message: string) {
  let text = message;
  for (const name of [
    "DATABASE_MIGRATION_URL",
    "ZERO_UPSTREAM_DB",
    "ZERO_CVR_DB",
    "DATABASE_URL",
    "DATABASE_MONITORING_URL",
    "DATABASE_ADMIN_URL",
  ]) {
    const value = env(name);
    if (!value) continue;
    text = text.split(value).join(`<${name}>`);
    try {
      const password = decodeURIComponent(new URL(value).password);
      if (password) text = text.split(password).join("****");
    } catch {
      // Not a URL: the whole value was already replaced.
    }
  }
  return text;
}

try {
  await main();
} catch (error) {
  console.error(
    `database.mjs ${command} failed: ${redact(error instanceof Error ? error.message : String(error))}`,
  );
  process.exitCode = 1;
}
