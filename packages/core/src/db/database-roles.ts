// Lictory's database roles on a PostgreSQL that Lictory does not run (a managed
// service or your own server), without a superuser. The bundled database keeps
// deploy/postgres/10-lictory-roles.sh, which runs as its local superuser.
//
// - `setupDatabase` runs once, as the provider's administrator (a role with
//   CREATEROLE and CREATEDB, such as the RDS master user): it creates the four
//   roles and both databases and sets database-level privileges. The
//   administrator's connection is never stored.
// - `applyGrants` runs before and after every migration and after zero-cache
//   starts, as the roles that own the objects: the migration role grants on its
//   tables, the zero-cache role on its zero_0 tables. No administrator needed.
//
// See docs/operations/external-database.md#roles.
import postgres from "postgres";

import { describeUrl } from "@lictory/core/db/connection-rules";

export type RoleUrls = {
  /** Owner of the application database (DATABASE_MIGRATION_URL). */
  migration: string;
  /** zero-cache (ZERO_UPSTREAM_DB). */
  zero: string;
  /** zero-cache's own database (ZERO_CVR_DB). */
  zeroCvr: string;
  /** API and worker (DATABASE_URL). */
  app: string;
  /** Backups and monitoring (DATABASE_MONITORING_URL). */
  monitoring?: string;
};

export type SetupReport = { done: string[]; warnings: string[] };

const quiet = { max: 1, onnotice: () => undefined, connect_timeout: 10 };

/** A string literal for DDL that takes no parameters (passwords). */
function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function role(url: string) {
  const parsed = new URL(url);
  return {
    name: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: describeUrl(url).database,
  };
}

const connectionLimits = { migration: 5, app: 40, zero: 40, monitoring: 5 };

/**
 * Creates or repairs the roles and databases. Idempotent: running it again
 * rotates the passwords to the ones in the URLs and repairs privileges.
 */
export async function setupDatabase(
  adminUrl: string,
  urls: RoleUrls,
): Promise<SetupReport> {
  const report: SetupReport = { done: [], warnings: [] };
  const owner = role(urls.migration);
  const zero = role(urls.zero);
  const app = role(urls.app);
  const monitoring = urls.monitoring ? role(urls.monitoring) : undefined;
  const cvrDatabase = role(urls.zeroCvr).database;
  const roles = [
    ["migration", owner],
    ["app", app],
    ["zero", zero],
    ...(monitoring ? [["monitoring", monitoring] as const] : []),
  ] as const;

  const admin = postgres(adminUrl, quiet);
  try {
    const [server] = await admin<
      { version: number; superuser: boolean; user: string }[]
    >`
      SELECT current_setting('server_version_num')::int AS version,
             r.rolsuper AS superuser, current_user AS user
        FROM pg_roles r WHERE r.rolname = current_user`;
    const { version, superuser, user } = server!;

    for (const [purpose, r] of roles) {
      const [exists] =
        await admin`SELECT 1 FROM pg_roles WHERE rolname = ${r.name}`;
      // Attributes are left at CREATE ROLE's defaults (no superuser, no
      // CREATEDB, no CREATEROLE): naming them needs privileges a managed
      // provider's administrator may not have.
      try {
        await admin.unsafe(
          `${exists ? "ALTER" : "CREATE"} ROLE ${identifier(r.name)} WITH LOGIN CONNECTION LIMIT ${connectionLimits[purpose]} PASSWORD ${literal(r.password)}`,
        );
        report.done.push(`${exists ? "Updated" : "Created"} role ${r.name}.`);
      } catch (error) {
        // PostgreSQL 15 lets only superusers alter a role that has REPLICATION.
        if (!exists || (error as { code?: string }).code !== "42501")
          throw error;
        report.warnings.push(
          `Could not update role ${r.name} (${(error as Error).message}); its password must already match .env.`,
        );
      }
    }
    await admin.unsafe(
      `ALTER ROLE ${identifier(app.name)} SET idle_in_transaction_session_timeout = '5min'`,
    );

    // zero-cache's replication slot: REPLICATION, or the provider's role.
    const [replication] = await admin<{ ok: boolean }[]>`
      SELECT rolsuper OR rolreplication
             OR EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname = 'rds_replication'
                          AND pg_has_role(r.oid, g.oid, 'MEMBER')) AS ok
        FROM pg_roles r WHERE r.rolname = ${zero.name}`;
    if (replication?.ok) {
      report.done.push(`${zero.name} may replicate.`);
    } else {
      try {
        await admin.unsafe(
          `ALTER ROLE ${identifier(zero.name)} WITH REPLICATION`,
        );
        report.done.push(`Gave ${zero.name} REPLICATION.`);
      } catch (error) {
        const [rds] =
          await admin`SELECT 1 FROM pg_roles WHERE rolname = 'rds_replication'`;
        if (rds) {
          await admin.unsafe(
            `GRANT rds_replication TO ${identifier(zero.name)}`,
          );
          report.done.push(`Granted rds_replication to ${zero.name}.`);
        } else {
          report.warnings.push(
            `Could not give ${zero.name} replication (${(error as Error).message}). Do it as the provider's administrator: docs/operations/external-database.md#providers.`,
          );
        }
      }
    }
    if (monitoring) {
      try {
        await admin.unsafe(
          `GRANT pg_monitor TO ${identifier(monitoring.name)}`,
        );
        report.done.push(`Granted pg_monitor to ${monitoring.name}.`);
      } catch (error) {
        report.warnings.push(
          `Could not grant pg_monitor to ${monitoring.name} (${(error as Error).message}): monitoring skips the WAL size check.`,
        );
      }
    }

    // CREATE DATABASE … OWNER and SET ROLE need the administrator to act as
    // the owners. PostgreSQL 16 and newer give a role's creator ADMIN on it
    // but not SET, so grant SET explicitly (without inheriting privileges).
    if (!superuser) {
      for (const r of [owner, zero]) {
        const [member] =
          version >= 160000
            ? await admin<
                { ok: boolean }[]
              >`SELECT pg_has_role(${user}, ${r.name}, 'SET') AS ok`
            : await admin<
                { ok: boolean }[]
              >`SELECT pg_has_role(${user}, ${r.name}, 'MEMBER') AS ok`;
        if (member?.ok) continue;
        await admin.unsafe(
          `GRANT ${identifier(r.name)} TO ${identifier(user)}${version >= 160000 ? " WITH INHERIT FALSE, SET TRUE" : ""}`,
        );
        report.done.push(
          `Let ${user} act as ${r.name} (to own its databases).`,
        );
      }
    }

    // Code-point ordering, as the bundled database (docs: collation).
    const [template] = await admin<{ ctype: string }[]>`
      SELECT datctype AS ctype FROM pg_database WHERE datname = 'template0'`;
    const locale =
      version >= 170000
        ? "LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'"
        : `LC_COLLATE 'C' LC_CTYPE ${literal(template?.ctype ?? "C")}`;
    for (const [database, ownerName] of [
      [owner.database, owner.name],
      [cvrDatabase, zero.name],
    ] as const) {
      const [existing] = await admin<{ owner: string }[]>`
        SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ${database}`;
      if (existing) {
        if (existing.owner !== ownerName)
          report.warnings.push(
            `Database ${database} exists and is owned by ${existing.owner}, not ${ownerName}. Lictory expects ${ownerName} to own it: ALTER DATABASE ${identifier(database)} OWNER TO ${identifier(ownerName)}.`,
          );
        continue;
      }
      await admin.unsafe(
        `CREATE DATABASE ${identifier(database)} OWNER ${identifier(ownerName)} TEMPLATE template0 ENCODING 'UTF8' ${locale}`,
      );
      report.done.push(`Created database ${database} (owner ${ownerName}).`);
    }

    // Database privileges, granted as the owners.
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${identifier(owner.name)}`);
      const db = identifier(owner.database);
      await tx.unsafe(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
      await tx.unsafe(
        `GRANT CONNECT ON DATABASE ${db} TO ${[app, ...(monitoring ? [monitoring] : [])].map((r) => identifier(r.name)).join(", ")}`,
      );
      await tx.unsafe(
        `GRANT CONNECT, CREATE ON DATABASE ${db} TO ${identifier(zero.name)}`,
      );
    });
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${identifier(zero.name)}`);
      await tx.unsafe(
        `REVOKE ALL ON DATABASE ${identifier(cvrDatabase)} FROM PUBLIC`,
      );
    });
    report.done.push(
      `Database privileges: only Lictory's roles connect to ${owner.database} and ${cvrDatabase}.`,
    );
  } finally {
    await admin.end({ timeout: 2 });
  }
  const grants = await applyGrants(urls);
  report.done.push(...grants.done);
  report.warnings.push(...grants.warnings);
  return report;
}

/**
 * Object privileges, granted by the roles that own the objects. Safe to run
 * at any time; deploy.sh runs it around every migration and after zero-cache
 * (re)creates its zero_0 tables.
 */
export async function applyGrants(
  urls: Omit<RoleUrls, "zeroCvr">,
): Promise<SetupReport> {
  const report: SetupReport = { done: [], warnings: [] };
  const owner = role(urls.migration).name;
  const app = identifier(role(urls.app).name);
  const zero = role(urls.zero).name;
  const readers = [
    identifier(zero),
    ...(urls.monitoring ? [identifier(role(urls.monitoring).name)] : []),
  ].join(", ");

  const ownerSql = postgres(urls.migration, quiet);
  try {
    await ownerSql.begin(async (tx) => {
      for (const statement of [
        `GRANT USAGE ON SCHEMA public TO ${app}, ${readers}`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`,
        `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${app}`,
        // zero-cache copies and replicates the published tables; monitoring
        // reads job tables. New tables are readable the moment a migration
        // creates them, before zero-cache sees the publication change.
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${readers}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${app}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${readers}`,
      ])
        await tx.unsafe(statement);
    });
    report.done.push(`${owner} granted access to the application tables.`);
  } finally {
    await ownerSql.end({ timeout: 2 });
  }

  // zero-cache creates zero_0 on its first start (and again after a reset).
  // Zero's DDL event triggers, when installed, run as the migration role; the
  // API records each client's last mutation in zero_0 within its transaction.
  const zeroSql = postgres(urls.zero, quiet);
  try {
    const [shard] = await zeroSql<{ published: boolean; clients: boolean }[]>`
      SELECT to_regclass('zero_0."publishedSchema"') IS NOT NULL AS published,
             to_regclass('zero_0.clients') IS NOT NULL
               AND to_regclass('zero_0.mutations') IS NOT NULL AS clients`;
    if (shard?.published) {
      await zeroSql.unsafe(
        `GRANT USAGE ON SCHEMA zero_0 TO ${identifier(owner)}; GRANT SELECT, UPDATE ON zero_0."publishedSchema" TO ${identifier(owner)}`,
      );
    }
    if (shard?.clients) {
      await zeroSql.unsafe(
        `GRANT USAGE ON SCHEMA zero_0 TO ${app}; GRANT SELECT, INSERT, UPDATE, DELETE ON zero_0.clients, zero_0.mutations TO ${app}`,
      );
      report.done.push(
        `${zero} granted the API access to Zero's mutation records.`,
      );
    } else {
      report.done.push(
        "zero_0 does not exist yet; zero-cache creates it on its first start (grants follow).",
      );
    }
  } finally {
    await zeroSql.end({ timeout: 2 });
  }
  return report;
}
