# Database migrations

Schema and data changes ship as committed, reviewed SQL in `drizzle/`. Every
production release applies pending migrations before the new application version
receives traffic. Nothing else migrates a shared database: not API routes,
middleware, instrumentation, application boot, Vercel builds or individual
function instances.

## Connections

| Variable                           | Used by                                             | Where it lives                               |
| ---------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `DATABASE_URL`                     | App queries (Neon pooled endpoint)                  | Vercel, per environment                      |
| `DATABASE_URL_UNPOOLED`            | App realtime LISTEN/NOTIFY (direct)                 | Vercel, per environment                      |
| `DATABASE_MIGRATION_URL`           | `scripts/migrate.ts`, backfills (owner)             | GitHub environment secret only, never Vercel |
| `DATABASE_MIGRATION_EXPECTED_HOST` | Guard: host the migration URL must match            | GitHub environment variable (not secret)     |
| `DATABASE_MIGRATION_TARGET`        | `local`, `test`, `preview`, `staging`, `production` | Set by the workflow; defaults to `local`     |

The runtime role should only need DML on application tables. The migration role
owns the schema. Keep the migration credential out of Vercel so a compromised
function cannot run DDL.

`scripts/migrate.ts` refuses to run when:

- it is inside Vercel (`VERCEL` is set);
- target `local`/`test` points at anything other than localhost or the Compose
  `postgres` host;
- a remote target lacks `DATABASE_MIGRATION_URL` (runtime URLs are never used),
  the host differs from `DATABASE_MIGRATION_EXPECTED_HOST`, the host is a Neon
  `-pooler` endpoint, or `sslmode` is not `require`/`verify-full`.

A staging secret pasted into production (or the reverse) therefore fails before
connecting. `drizzle.config.ts` likewise refuses `push`/`studio`/`pull` against a
non-local host unless `DRIZZLE_KIT_ALLOW_REMOTE=1` is set deliberately.

Each environment needs its own Neon branch or project: local Docker, CI
disposable databases, previews, staging and production never share a database.
Vercel Preview must not receive production `DATABASE_URL` values. If previews use
Neon branches created from production, they start from production's already
migrated schema; preview-only migrations are not applied automatically, so a
preview that needs new schema fails rather than touching another environment.

## Developer workflow

1. **Change the schema** in `src/db/*-schema.ts` (Better Auth tables:
   `bun run auth:generate`).
2. **Generate** a migration: `bun run db:generate -- --name=add_work_item_rank`.
   Answer rename prompts carefully; a wrong answer drops data.
3. **Review the SQL** in `drizzle/NNNN_*.sql` as you would code. Look for table
   rewrites, `NOT NULL` without defaults on populated tables, dropped columns,
   and locks on hot tables (`work_item`, `sync_change`, `activity`).
4. **Test**: `bun run db:migrate` locally, `bun run db:check` (fails when the
   schema has uncommitted changes), `bun run db:test` and `bun test src`
   (each test database applies the full history).
5. **Commit** the SQL and `drizzle/meta` together with the code using it.
6. **Merge**. CI verifies; the production release applies the migration.

Never edit, reorder, or delete a migration that has reached main. The runner
compares each applied migration's hash with the committed file and stops on
mismatch. It also stops when a migration is older than the latest applied one
(for example after a long-lived branch), because Drizzle would otherwise skip it
silently; regenerate such a migration on top of main.

`bun run db:migrate:status` lists pending migrations without applying them.

## Production rollout

`Deploy production` (`.github/workflows/deploy-production.yml`) runs on every
push to main:

1. **Verify**: the full CI workflow, including `db:check`.
2. **Build**: `vercel deploy --prod --skip-domain` builds the release without
   serving production traffic.
3. **Migrate**: `migrate.yml` against the `production` GitHub environment.
4. **Promote**: `vercel promote` points production domains at the build.

A failure at any step leaves the previous version serving. Releases are
serialized by the `production-deploy` concurrency group; migrations by a
per-environment concurrency group and a PostgreSQL advisory lock, so even a
manual run cannot overlap. All pending migrations apply in one transaction with
`lock_timeout` (default `10s`) and `statement_timeout` (default `10min`): either
all commit or none do. Override with `MIGRATION_LOCK_TIMEOUT` and
`MIGRATION_STATEMENT_TIMEOUT` when needed.

Vercel's Git integration is disabled for `main` in `vercel.json`, so production
cannot be activated by a deployment that skipped migrations. Preview deployments
of other branches still build automatically.

Between migration and promotion the **previous** version runs against the
**new** schema, and an app rollback never rolls the schema back. Every migration
must therefore be backward compatible with the version currently in production
(expand/contract):

- Add nullable columns or columns with defaults; add tables freely.
- Rename or drop in two releases: release 1 stops using the column, release 2
  drops it.
- Make a column `NOT NULL` only after a backfill has populated it.

Recovery: rely on Neon point-in-time restore (check the plan's history
retention) and practice restoring into a separate branch. To retry a failed
migration after fixing it in a new commit, merge the fix; to re-run without code
changes, dispatch **Database migrations** with `production`.

### Setup

GitHub environment `production` (restricted to `main`):

- secrets: `DATABASE_MIGRATION_URL` (direct, owner role, `sslmode=require`),
  `VERCEL_TOKEN`
- variables: `DATABASE_MIGRATION_EXPECTED_HOST`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`

Create `staging` the same way to migrate staging with **Database migrations**.
Until the production environment is configured, the release stops at the build
step and production keeps serving the previous deployment.

## Data changes

**In a migration** (`bun run db:generate:data -- --name=seed_default_types`):
small, deterministic, idempotent reference-data changes that the new code needs
immediately. Use `INSERT … ON CONFLICT DO NOTHING`, `UPDATE … WHERE` conditions
that match nothing on a second run, and organization-scoped predicates. They run
inside the release transaction, so they must finish in seconds.

**As a backfill** (`scripts/backfills/<name>.ts`): anything that touches many rows,
calls external services, or could take longer than a few seconds. Backfills:

- resolve their connection with `resolveMigrationConnection(process.env)` from
  `src/db/migration-safety.ts`;
- process bounded batches in short transactions and are resumable and
  idempotent;
- never rewrite revisions, approvals, decisions or audit history;
- ship after the expand migration and before any contract migration that
  depends on them.

Run them with the manual **Data backfill** workflow (staging first). They are
never part of the deployment path.

`CREATE INDEX CONCURRENTLY` cannot run inside the migration transaction. Create
large indexes on hot tables operationally, then commit a migration using
`CREATE INDEX IF NOT EXISTS` so history stays consistent.
