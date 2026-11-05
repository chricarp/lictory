// Pure safety rules for the migration runner (scripts/migrate.ts). Kept free of
// I/O so the guarantees are unit-tested. See docs/operations/migrations.md.
import { poolerHostReason } from "@lictory/core/db/connection-rules";

/**
 * Well-known targets. `local` and `test` migrate local databases only;
 * `preview` names hosted preview databases reached over TLS. Any other valid
 * name (`staging`, `production`, `qa`, `eu-prod`…) is a remote environment and
 * gets every remote protection; a server environment's name is its
 * LICTORY_ENVIRONMENT.
 */
export const migrationTargets = [
  "local",
  "test",
  "preview",
  "staging",
  "production",
] as const;
const localTargets = new Set(["local", "test"]);
/** Targets that never name a server environment of deploy/compose.production.yaml. */
const nonServerTargets = new Set([...localTargets, "preview"]);
/** Same rule as the deployment scripts (deploy/deploy.sh). */
const targetName = /^[a-z][a-z0-9-]{0,31}$/;
export type MigrationTarget = string;

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Docker Compose service name of the database in every Compose stack.
const composeDatabaseHost = "postgres";
const localServiceHosts = new Set([composeDatabaseHost]);

/**
 * How a remote target is reached. `tls`: a managed or remote server over TLS.
 * `compose-internal`: the single-server deployment (deploy/compose.production.yaml),
 * where the migrate container reaches the `postgres` service over an internal
 * Docker network that has no route to or from the internet.
 */
export const migrationTransports = ["tls", "compose-internal"] as const;
export type MigrationTransport = (typeof migrationTransports)[number];

export type MigrationEnvironment = Record<string, string | undefined>;

export type ResolvedMigrationConnection = {
  target: MigrationTarget;
  transport: MigrationTransport;
  url: string;
  host: string;
  database: string;
};

export class MigrationConfigurationError extends Error {}

function value(env: MigrationEnvironment, name: string) {
  const raw = env[name]?.trim();
  return raw?.length ? raw : undefined;
}

/**
 * Resolves the administrative connection for migrations and refuses any
 * configuration that could point one environment's tooling at another
 * environment's database.
 *
 * - local/test may fall back to the runtime variables but only for loopback or
 *   Compose hosts.
 * - every other target (preview, staging, production or a custom environment
 *   name such as qa) requires DATABASE_MIGRATION_URL plus a matching
 *   non-secret DATABASE_MIGRATION_EXPECTED_HOST. Swapping a secret between
 *   environments therefore fails closed.
 *   - transport `tls` (default): a direct (unpooled) TLS connection to a
 *     non-local host.
 *   - transport `compose-internal`: server environments only (not
 *     local/test/preview), host exactly
 *     `postgres`, `sslmode=disable` stated explicitly, and both
 *     DATABASE_MIGRATION_EXPECTED_DATABASE and LICTORY_ENVIRONMENT must match,
 *     because every Compose stack names its database host `postgres`.
 */
export function resolveMigrationConnection(
  env: MigrationEnvironment,
): ResolvedMigrationConnection {
  const declared = value(env, "DATABASE_MIGRATION_TARGET") ?? "local";
  if (!targetName.test(declared)) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_TARGET must be ${migrationTargets.join(", ")} or another environment name of lowercase letters, digits and hyphens; received "${declared}".`,
    );
  }
  const target: MigrationTarget = declared;
  const remote = !localTargets.has(target);
  const declaredTransport = value(env, "DATABASE_MIGRATION_TRANSPORT") ?? "tls";
  if (!(migrationTransports as readonly string[]).includes(declaredTransport)) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_TRANSPORT must be one of ${migrationTransports.join(", ")}; received "${declaredTransport}".`,
    );
  }
  const transport = declaredTransport as MigrationTransport;
  if (transport === "compose-internal" && nonServerTargets.has(target)) {
    throw new MigrationConfigurationError(
      `The compose-internal transport only serves server environments (such as staging or production); received target "${target}".`,
    );
  }

  const explicit = value(env, "DATABASE_MIGRATION_URL");
  const raw =
    explicit ??
    (remote
      ? undefined
      : (value(env, "DATABASE_URL_UNPOOLED") ?? value(env, "DATABASE_URL")));
  if (!raw) {
    throw new MigrationConfigurationError(
      remote
        ? `DATABASE_MIGRATION_URL is required for the ${target} target. Runtime DATABASE_URL values are never used for remote migrations.`
        : "Set DATABASE_URL (or DATABASE_MIGRATION_URL) to the local database.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new MigrationConfigurationError(
      "The migration database URL is not a valid URL.",
    );
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new MigrationConfigurationError(
      "The migration database URL must use the postgresql:// scheme.",
    );
  }
  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const isLocalHost = loopbackHosts.has(host) || localServiceHosts.has(host);
  const resolved = { target, transport, url: raw, host, database };

  if (!remote) {
    if (!isLocalHost) {
      throw new MigrationConfigurationError(
        `The ${target} target only migrates local databases; refusing host "${host}". Set DATABASE_MIGRATION_TARGET for remote environments.`,
      );
    }
    return resolved;
  }

  const expected = value(
    env,
    "DATABASE_MIGRATION_EXPECTED_HOST",
  )?.toLowerCase();
  if (!expected) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_EXPECTED_HOST is required for the ${target} target; set it in that environment's configuration.`,
    );
  }
  if (host !== expected) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_URL host "${host}" does not match DATABASE_MIGRATION_EXPECTED_HOST "${expected}" for the ${target} target.`,
    );
  }
  const expectedDatabase = value(env, "DATABASE_MIGRATION_EXPECTED_DATABASE");
  if (expectedDatabase !== undefined && expectedDatabase !== database) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_URL database "${database}" does not match DATABASE_MIGRATION_EXPECTED_DATABASE "${expectedDatabase}" for the ${target} target.`,
    );
  }
  const sslmode = parsed.searchParams.get("sslmode");

  if (transport === "compose-internal") {
    if (host !== composeDatabaseHost) {
      throw new MigrationConfigurationError(
        `The compose-internal transport only reaches the Compose service "${composeDatabaseHost}"; refusing host "${host}".`,
      );
    }
    if (!expectedDatabase) {
      throw new MigrationConfigurationError(
        `DATABASE_MIGRATION_EXPECTED_DATABASE is required for the compose-internal transport: every Compose stack calls its database host "${composeDatabaseHost}".`,
      );
    }
    const environment = value(env, "LICTORY_ENVIRONMENT");
    if (environment !== target) {
      throw new MigrationConfigurationError(
        `LICTORY_ENVIRONMENT "${environment ?? ""}" does not confirm the ${target} target; the migration must run inside that environment's stack.`,
      );
    }
    if (sslmode !== "disable") {
      throw new MigrationConfigurationError(
        "The compose-internal transport requires sslmode=disable stated explicitly: it never leaves the internal Docker network.",
      );
    }
    return resolved;
  }

  if (isLocalHost) {
    throw new MigrationConfigurationError(
      `The ${target} target cannot point at a local database host.`,
    );
  }
  const pooler = poolerHostReason(host);
  if (pooler) {
    throw new MigrationConfigurationError(
      `Migrations require a direct (unpooled) connection; transaction poolers break advisory locks and session settings (${pooler}).`,
    );
  }
  if (sslmode !== "require" && sslmode !== "verify-full") {
    throw new MigrationConfigurationError(
      "Remote migration URLs must set sslmode=require or sslmode=verify-full.",
    );
  }
  return resolved;
}

export type RepositoryMigration = { tag: string; when: number; hash: string };
export type AppliedMigration = { hash: string; createdAt: number };

export type MigrationPlan = {
  pending: RepositoryMigration[];
  /** Applied rows not present in this checkout (database is newer). */
  unknownApplied: AppliedMigration[];
};

export class MigrationHistoryError extends Error {}

/**
 * Compares committed migrations with the database history. Drizzle only applies
 * migrations newer than the most recently applied one and does not verify
 * hashes, so this rejects the cases it would otherwise silently mishandle:
 * edited applied migrations and out-of-order migrations that would be skipped.
 */
export function planMigrations(
  repository: RepositoryMigration[],
  applied: AppliedMigration[],
): MigrationPlan {
  for (let i = 1; i < repository.length; i++) {
    const previous = repository[i - 1]!;
    const current = repository[i]!;
    if (current.when <= previous.when) {
      throw new MigrationHistoryError(
        `Migration ${current.tag} is not newer than ${previous.tag}. Regenerate it on top of the current main branch.`,
      );
    }
  }
  const byWhen = new Map(repository.map((m) => [m.when, m]));
  const appliedWhens = new Set<number>();
  const unknownApplied: AppliedMigration[] = [];
  for (const row of applied) {
    const committed = byWhen.get(row.createdAt);
    if (!committed) {
      unknownApplied.push(row);
      continue;
    }
    if (committed.hash !== row.hash) {
      throw new MigrationHistoryError(
        `Migration ${committed.tag} was edited after it was applied. Applied migrations are immutable; add a new migration instead.`,
      );
    }
    appliedWhens.add(row.createdAt);
  }
  const lastApplied = applied.reduce(
    (max, row) => Math.max(max, row.createdAt),
    Number.NEGATIVE_INFINITY,
  );
  const pending = repository.filter((m) => !appliedWhens.has(m.when));
  const skipped = pending.filter((m) => m.when <= lastApplied);
  if (skipped.length) {
    throw new MigrationHistoryError(
      `Migration ${skipped.map((m) => m.tag).join(", ")} is older than the latest applied migration and would be skipped. Regenerate it with a newer timestamp.`,
    );
  }
  if (unknownApplied.length && pending.length) {
    throw new MigrationHistoryError(
      "The database contains migrations this checkout does not know, and this checkout has pending migrations. Deploy from a branch that includes every applied migration.",
    );
  }
  return { pending, unknownApplied };
}
