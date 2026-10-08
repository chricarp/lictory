// Pure safety rules for the migration runner (scripts/migrate.ts). Kept free of
// I/O so the guarantees are unit-tested. See docs/operations/migrations.md.

export const migrationTargets = [
  "local",
  "test",
  "preview",
  "staging",
  "nightly",
  "production",
] as const;
export type MigrationTarget = (typeof migrationTargets)[number];

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Docker Compose service name used by the local stack.
const localServiceHosts = new Set(["postgres"]);

export type MigrationEnvironment = Record<string, string | undefined>;

export type ResolvedMigrationConnection = {
  target: MigrationTarget;
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
 * - preview/staging/nightly/production require DATABASE_MIGRATION_URL plus a matching
 *   non-secret DATABASE_MIGRATION_EXPECTED_HOST, and a direct (unpooled) TLS
 *   connection. Swapping a secret between environments therefore fails closed.
 */
export function resolveMigrationConnection(
  env: MigrationEnvironment,
): ResolvedMigrationConnection {
  if (value(env, "VERCEL")) {
    throw new MigrationConfigurationError(
      "Migrations never run inside Vercel builds or functions. Production migrations run in Release to Production.",
    );
  }
  const declared = value(env, "DATABASE_MIGRATION_TARGET") ?? "local";
  if (!(migrationTargets as readonly string[]).includes(declared)) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_TARGET must be one of ${migrationTargets.join(", ")}; received "${declared}".`,
    );
  }
  const target = declared as MigrationTarget;
  const remote = target !== "local" && target !== "test";

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

  if (!remote) {
    if (!isLocalHost) {
      throw new MigrationConfigurationError(
        `The ${target} target only migrates local databases; refusing host "${host}". Set DATABASE_MIGRATION_TARGET for remote environments.`,
      );
    }
    return { target, url: raw, host, database };
  }

  if (isLocalHost) {
    throw new MigrationConfigurationError(
      `The ${target} target cannot point at a local database host.`,
    );
  }
  const expected = value(
    env,
    "DATABASE_MIGRATION_EXPECTED_HOST",
  )?.toLowerCase();
  if (!expected) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_EXPECTED_HOST is required for the ${target} target; set it as a GitHub environment variable.`,
    );
  }
  if (host !== expected) {
    throw new MigrationConfigurationError(
      `DATABASE_MIGRATION_URL host "${host}" does not match DATABASE_MIGRATION_EXPECTED_HOST "${expected}" for the ${target} target.`,
    );
  }
  if (host.includes("-pooler")) {
    throw new MigrationConfigurationError(
      "Migrations require a direct (unpooled) connection; transaction poolers break advisory locks and session settings.",
    );
  }
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode !== "require" && sslmode !== "verify-full") {
    throw new MigrationConfigurationError(
      "Remote migration URLs must set sslmode=require or sslmode=verify-full.",
    );
  }
  return { target, url: raw, host, database };
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
