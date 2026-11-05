# Database migrations

Schema and data changes ship as committed, reviewed SQL in `drizzle/`. Every
release applies pending migrations before the new application version
receives traffic. Nothing else migrates a shared database: not API routes,
application boot, image builds or containers starting.

## Connections

| Variable                               | Used by                                           | Where it lives                                                         |
| -------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                         | API and worker (`lictory_app`, DML only)          | Built by Compose from the server's `.env`                              |
| `DATABASE_MIGRATION_URL`               | `scripts/migrate.ts`, backfills (owner)           | Only in the `migrate` service on the server                            |
| `DATABASE_MIGRATION_EXPECTED_HOST`     | Guard: host the migration URL must match          | Compose (`postgres`)                                                   |
| `DATABASE_MIGRATION_EXPECTED_DATABASE` | Guard: database name the URL must match           | Compose (`LICTORY_DB_NAME` of the environment)                         |
| `DATABASE_MIGRATION_TRANSPORT`         | `tls` (default) or `compose-internal`             | Compose sets `compose-internal` (bundled database) or `tls` (external) |
| `DATABASE_MIGRATION_TARGET`            | `local`, `test`, `preview` or an environment name | Compose sets the environment; default `local`                          |
| `LICTORY_ENVIRONMENT`                  | Confirms the target for `compose-internal`        | Server `.env`                                                          |

The runtime role only has DML on application tables; the migration role owns
the schema ([database roles](deployment.md#database-roles)). The migration
credential exists only in the one-shot `migrate` container, so a compromised
API process cannot run DDL. Databases are never reachable from GitHub Actions
or developer machines; migrations always run on their server.

Targets other than `local` and `test` are remote: `preview`, `staging`,
`production` and any custom environment name (lowercase letters, digits and
hyphens) get exactly the same protections.

`scripts/migrate.ts` refuses to run when:

- target `local`/`test` points at anything other than localhost or the Compose
  `postgres` host;
- a remote target lacks `DATABASE_MIGRATION_URL` (runtime URLs are never used)
  or the host differs from `DATABASE_MIGRATION_EXPECTED_HOST`;
- transport `tls` (an [external database](external-database.md), whose
  Compose override sets it): the host is local, a pooler endpoint (Neon
  `-pooler`, Supabase's `pooler.supabase.com`, a `pgbouncer` host), or
  `sslmode` is not `require`/`verify-full`;
- transport `compose-internal` (the single-server deployment, where the
  database is the Compose service `postgres` on an internal network without
  TLS): the target is `local`, `test` or `preview` instead of a server
  environment (`staging`, `production` or a custom name such as `qa`), the host is not
  `postgres`, `sslmode=disable` is not stated explicitly,
  `DATABASE_MIGRATION_EXPECTED_DATABASE` is missing or differs, or
  `LICTORY_ENVIRONMENT` does not equal the target.

Every Compose stack names its database host `postgres`, so the database name
and the environment confirmation are what keep a staging configuration from
migrating production (and the reverse); separate servers and networks make it
impossible in practice. `drizzle.config.ts` likewise refuses
`push`/`studio`/`pull` against a non-local host unless
`DRIZZLE_KIT_ALLOW_REMOTE=1` is set deliberately.

Local Docker, test databases, staging and production never share a database.

## Developer workflow

1. **Change the schema** in `packages/core/src/db/*-schema.ts` (Better Auth tables:
   `bun run auth:generate`).
2. **Generate** a migration: `bun run db:generate -- --name=add_work_item_rank`.
   Answer rename prompts carefully; a wrong answer drops data.
3. **Review the SQL** in `drizzle/NNNN_*.sql` as you would code. Look for table
   rewrites, `NOT NULL` without defaults on populated tables, dropped columns,
   locks on hot tables (`work_item`, `sync_entity`, `activity`), and changes
   to tables in the `lictory_zero` publication (expand/contract below).
4. **Test**: `bun run db:migrate` locally, `bun run db:check` (fails when the
   schema has uncommitted changes), `bun run db:test` and the domain tests
   (each test database applies the full history).
5. **Commit** the SQL and `drizzle/meta` together with the code using it.
6. **Merge**. CI verifies. The next manually selected stable release applies
   the migration.

Never edit, reorder, or delete a migration that has reached main. The runner
compares each applied migration's hash with the committed file and stops on
mismatch. It also stops when a migration is older than the latest applied one
(for example after a long-lived branch), because Drizzle would otherwise skip it
silently; regenerate such a migration on top of main.

`bun run db:migrate:status` lists pending migrations without applying them.

## Rollout on an installation

Releases only publish images ([versions and releases](releases.md)); each
installation applies one when its operator runs `lictory upgrade`, which
drives `deploy.sh release` with that release's `release.env`
([self-hosting](self-hosting.md)):

1. **Prepare** (`deploy.sh prepare`): validate the release file, pull its
   images by digest and check the gateway configuration; nothing serves them
   yet.
2. **Migrate** (`deploy.sh migrate`): a pre-deploy
   backup when migrations are pending, then the `migrate` image's runner, then
   a wait until zero-cache has replicated past the migration.
3. **Activate**: zero-cache, proxy, API and worker switch to the new images
   ([deployment](deployment.md#deploying-a-release)).

A failed preparation or migration leaves the previous version serving.
Deployments on the server hold a lock, and the runner also uses a PostgreSQL
advisory lock, so even a manual run cannot overlap. All
pending migrations apply in one transaction with `lock_timeout` (default
`10s`) and `statement_timeout` (default `10min`): either all commit or none
do. Override with `MIGRATION_LOCK_TIMEOUT` and `MIGRATION_STATEMENT_TIMEOUT`
when needed.

Always migrate through `deploy.sh` (or `lictory`, which calls it): it
re-applies the database roles first, including the migration role's access to
Zero's DDL event triggers, which run as the role issuing the DDL.

### Expand and contract with Zero

Between migration and activation the **previous** version runs against the
**new** schema, and an application rollback never rolls the schema back. Zero
adds a second consumer: zero-cache replicates the `lictory_zero` publication
and clients run queries and mutators compiled into the previous release.

- **Expand** (add a column, table, query or mutator): database first, then API
  and client in the same release. `deploy.sh` waits for zero-cache to
  replicate the migration before replacing the API. Add nullable columns or
  columns with defaults; add tables freely.
- **Contract** (drop or rename): first release a version whose client and API
  no longer use the thing, then drop it in a later release. Renames are an
  expand (new column, backfill, keep both written) followed by a contract.
- Make a column `NOT NULL` only after a backfill has populated it.
- Changing the `lictory_zero` publication is an expand or contract like any
  other schema change; zero-cache backfills newly published columns.
- Keep Zero version upgrades and schema changes in separate releases.

### Recovery

To re-run migrations without code changes, run
`deploy.sh <env> migrate <version>` on the server with a release version
already prepared there. It never activates an application. To fix a failed
migration, merge a fix and release a new nightly. Restoring data is covered
in [recovery](recovery.md). No database credential is ever stored in GitHub.

## Data changes

**In a migration** (`bun run db:generate:data -- --name=seed_default_types`):
small, deterministic, idempotent reference-data changes that the new code needs
immediately. Use `INSERT … ON CONFLICT DO NOTHING`, `UPDATE … WHERE` conditions
that match nothing on a second run, and organization-scoped predicates. They run
inside the release transaction, so they must finish in seconds.

**As a backfill** (`scripts/backfills/<name>.ts`): anything that touches many rows,
calls external services, or could take longer than a few seconds. Backfills:

- resolve their connection with `resolveMigrationConnection(process.env)` from
  `packages/core/src/db/migration-safety.ts`;
- process bounded batches in short transactions and are resumable and
  idempotent;
- never rewrite revisions, approvals, decisions or audit history;
- ship after the expand migration and before any contract migration that
  depends on them.

The migrate image bundles every backfill of its commit. Run one on the server
(a test environment first) with `deploy.sh <env> backfill <version> <name>`,
naming a release prepared there; it runs in the environment's `migrate`
container. That container has no internet access;
work that calls external services belongs in the worker's job queue. Backfills
are never part of the deployment path.

`CREATE INDEX CONCURRENTLY` cannot run inside the migration transaction. Create
large indexes on hot tables operationally, then commit a migration using
`CREATE INDEX IF NOT EXISTS` so history stays consistent.
