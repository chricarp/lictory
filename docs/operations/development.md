# Development runbook

## First checkout

Requirements: [Bun](https://bun.sh) at the version in `package.json`
(`packageManager`), Docker for PostgreSQL and Mailpit, and Git. Bun is the only
supported package manager.

```sh
cp .env.example .env
docker compose up -d postgres mailpit
bun install
bun run db:migrate
bun run dev
```

- App: http://localhost:3000
- Mailpit (verification and reset emails): http://localhost:8025

Every optional integration (OAuth, Resend, R2, OpenAI, PostHog, Jira) stays
disabled until its variables are set in `.env`. Core refinement works without any
of them.

The Compose PostgreSQL runs with `wal_level=logical` for Zero. After
`bun run db:migrate`, `docker compose --profile zero up -d zero-cache` starts a
zero-cache (port 4848) against the development database that calls the API on
the host (port 3002). Existing volumes keep their data when the setting changes.
Production images and the single-server stack are described in
[deployment](deployment.md).

## Daily commands

| Command               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `bun run dev`         | Development server                                 |
| `bun run check`       | Types, lint, formatting, unused code and PR assets |
| `bun run format`      | Apply Prettier                                     |
| `bun test src/<area>` | Focused domain tests while you work                |
| `bun run test:sync`   | Synchronization invariants against PostgreSQL      |
| `bun run test:e2e`    | Production build plus browser workflows            |
| `bun run db:generate` | Committed SQL migration after a schema change      |
| `bun run db:check`    | Fail when the schema has no matching migration     |

Schema changes follow [database migrations](./migrations.md). Domain writes
follow [synchronization](../internals/synchronization.md) and
[capabilities](../internals/capabilities.md).

`bun run knip` reports unused files and dependencies. Its configuration
(`knip.jsonc`) lists the few findings that predate it; shrink that list rather
than grow it.

## Tests

Domain tests are colocated as `*/src/**/*.test.ts` in every workspace and run with `bun test src`. Tests
that need PostgreSQL create their own database from `SCHEMA_TEST_DATABASE_URL`
(the admin `postgres` database), so they never touch your development data.

Browser tests in `tests/platform` and `tests/marketing` run against production
builds: `scripts/test-e2e.ts` migrates an isolated database, starts the API,
worker, zero-cache, the website (port 3101) and `scripts/edge-proxy.ts` (the
platform origin, port 3001, routed like production), then drops the database
and its replication slot. PostgreSQL must run with `wal_level=logical`
(`compose.yaml` does). `E2E_PORT_OFFSET` lets several checkouts run side by
side; `E2E_SKIP_BUILD=1` reuses builds when only tests changed. Failure
screenshots land in `/tmp/lictory-playwright-results`.

## Full verification before a pull request

GitHub Actions CI is deliberately minimal to save minutes: it runs only
`bun run typecheck` and `bun run db:check`. Everything else (audit, lint,
format, knip, domain tests and browser workflows) runs only locally, so run the
complete sequence below before opening or updating a pull request, in order and
against a disposable database, never your development database:

```sh
docker compose up -d postgres mailpit
export DB=lictory_verify_$(date +%s)
docker compose exec -T postgres createdb -U lictory "$DB"

export DATABASE_URL=postgresql://lictory:lictory@localhost:5432/$DB
export DATABASE_URL_UNPOOLED=$DATABASE_URL
export SCHEMA_TEST_DATABASE_URL=postgresql://lictory:lictory@localhost:5432/postgres
export BETTER_AUTH_URL=http://localhost:3001
export BETTER_AUTH_SECRET=ci-only-secret-not-a-production-credential-32
export RESEND_API_KEY= SMTP_HOST=localhost SMTP_PORT=1025 NEXT_TELEMETRY_DISABLED=1

bun install --frozen-lockfile
bun audit --audit-level=high
bun run check
bun run db:check
bun run db:migrate
bun test src
bunx playwright install --with-deps --only-shell chromium
bun run test:e2e

docker compose exec -T postgres dropdb -U lictory --force "$DB"
```

Drop the database even when a step fails. Variables exported in the shell take
precedence over `.env`; unset any integration credentials you do not want the
run to use.

## Agents

Agents follow `AGENTS.md`. Skills in `.agents/skills` cover UI polish and
[app verification](../../.agents/skills/test-lictory-app/SKILL.md). Run agents in
a separate worktree and give each worktree its own disposable databases.
