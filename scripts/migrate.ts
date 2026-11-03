// The only supported way to apply committed migrations to any database.
// Usage: bun scripts/migrate.ts [--status]
// See docs/operations/migrations.md for the environment contract.
import "dotenv/config";

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  MigrationConfigurationError,
  MigrationHistoryError,
  planMigrations,
  resolveMigrationConnection,
  type RepositoryMigration,
} from "@lictory/core/db/migration-safety";
import { loadConfiguration } from "@lictory/core/config/validate";
import { env, envInteger } from "@lictory/core/lib/env";

loadConfiguration("migrate");

const migrationsFolder = "drizzle";
// Arbitrary fixed key shared by every runner of this application's migrations.
const advisoryLockKey = 7_316_442_105_839_201n;

const statusOnly = process.argv.includes("--status");
const lockWaitSeconds = envInteger("MIGRATION_LOCK_WAIT_SECONDS") ?? 300;
const lockTimeout = env("MIGRATION_LOCK_TIMEOUT") ?? "10s";
const statementTimeout = env("MIGRATION_STATEMENT_TIMEOUT") ?? "10min";

async function repositoryMigrations(): Promise<RepositoryMigration[]> {
  const journal = JSON.parse(
    await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const files = readMigrationFiles({ migrationsFolder });
  return journal.entries.map((entry, index) => ({
    tag: entry.tag,
    when: entry.when,
    hash: files[index]!.hash,
  }));
}

async function appliedMigrations(sql: postgres.Sql) {
  const [table] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`;
  if (!table?.exists) return [];
  const rows = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  return rows.map((row) => ({
    hash: row.hash,
    createdAt: Number(row.created_at),
  }));
}

async function acquireLock(sql: postgres.Sql) {
  const deadline = Date.now() + lockWaitSeconds * 1000;
  for (;;) {
    const [row] = await sql<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${advisoryLockKey.toString()}::bigint) AS locked`;
    if (row?.locked) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Another migration holds the lock after ${lockWaitSeconds}s. Nothing was applied; retry after it finishes.`,
      );
    }
    console.log("Waiting for another migration to finish…");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function main() {
  const connection = resolveMigrationConnection(process.env);
  console.log(
    `Migration target: ${connection.target} via ${connection.transport} (${connection.host}/${connection.database})`,
  );
  // One connection: the session advisory lock, timeouts and the migration
  // transaction must share a session.
  const sql = postgres(connection.url, {
    max: 1,
    onnotice: () => undefined,
    connection: { application_name: "lictory-migrate" },
  });
  try {
    const repository = await repositoryMigrations();
    if (!statusOnly) await acquireLock(sql);
    // Plan after acquiring the lock so a concurrent runner's work is visible.
    const plan = planMigrations(repository, await appliedMigrations(sql));
    if (plan.unknownApplied.length) {
      console.warn(
        `The database has ${plan.unknownApplied.length} migration(s) newer than this checkout (for example after an application rollback). Nothing to apply.`,
      );
    }
    if (!plan.pending.length) {
      console.log("Database schema is up to date.");
      return;
    }
    console.log(
      `Pending migrations:\n${plan.pending.map((m) => `  - ${m.tag}`).join("\n")}`,
    );
    if (statusOnly) return;

    await sql.unsafe(`SET lock_timeout = '${lockTimeout.replace(/'/g, "")}'`);
    await sql.unsafe(
      `SET statement_timeout = '${statementTimeout.replace(/'/g, "")}'`,
    );
    // Drizzle applies every pending migration in a single transaction: either
    // all of them commit or the database is left unchanged.
    await migrate(drizzle(sql), { migrationsFolder });
    const after = planMigrations(repository, await appliedMigrations(sql));
    if (after.pending.length) {
      throw new Error(
        `Migrations reported success but ${after.pending.length} remain pending.`,
      );
    }
    console.log(`Applied ${plan.pending.length} migration(s).`);
  } finally {
    // Closing the session releases the advisory lock even on failure.
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (error) {
  if (
    error instanceof MigrationConfigurationError ||
    error instanceof MigrationHistoryError
  ) {
    console.error(`Migration refused: ${error.message}`);
  } else {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    console.error("Migration failed; the transaction was rolled back.");
    console.error(cause instanceof Error ? cause.message : cause);
  }
  process.exitCode = 1;
}
