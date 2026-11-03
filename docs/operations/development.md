# Development runbook

## First checkout

Requirements: [Bun](https://bun.sh) at the version in `package.json`
(`packageManager`), **Node.js 24 LTS**, Docker, and Git. Bun is the only supported
package manager; Node runs workspace build scripts and supplies Zero's supported
native SQLite ABI. Install Node before `bun install`, and check `node --version`.
A bare Bun-only container can fall back to compiling Zero's SQLite module;
it is not the supported development environment. The production Dockerfile
also pairs Bun with Node 24.

For a memory-limited container, allow at least 8 GB of Docker memory. The full
type-aware ESLint check can exceed Node's default 2 GB heap in that environment;
if it reports a JavaScript heap limit, run
`export NODE_OPTIONS=--max-old-space-size=4096` before the verification commands.
This increases the process heap allowance without filtering or disabling checks.

```sh
cp .env.example .env
bun install
docker compose up -d   # PostgreSQL, migrations, zero-cache, Mailpit, MinIO
bun run dev            # SPA, API, worker and website on the host
```

- App: http://localhost:3000 (API 3002, zero-cache 4848)
- Website: http://localhost:3100
- Mailpit (verification and reset emails): http://localhost:8025
- MinIO console (attachment bucket, user `lictory`, password
  `lictory-development`): http://127.0.0.1:9001

Every optional integration (OAuth, Resend, OpenAI, PostHog, Jira) stays
disabled until its variables are set in `.env`. Core refinement works without any
of them. Attachments use the MinIO service: `.env.example` already points
`S3_*` at it; clear those values to run without file storage.

`compose.yaml` holds every service the applications depend on, started in
order:

1. `postgres`: PostgreSQL 17 provisioned for Zero: `wal_level=logical`, WAL
   senders and replication slots, `max_slot_wal_keep_size` bounding the WAL a
   stopped zero-cache can retain, and a superuser connection so zero-cache can
   install the event triggers that replicate schema changes incrementally.
2. `postgres-setup`: creates `lictory_zero`, the database where zero-cache keeps
   its client view records and change log (as in production). Zero's per-app
   tables for client mutation ids live in the application database, because the
   API updates them in the same transaction as domain writes.
3. `migrate`: applies committed migrations with `scripts/migrate.ts` (Bun image,
   this checkout mounted read-only, so run `bun install` first). It creates the
   `lictory_zero` publication zero-cache replicates.
4. `zero-cache`: starts only after migrations succeed; it calls the API on the
   host (port 3002) with the browser's forwarded session cookie.
5. `mailpit`: captures every email.
6. `minio` and `minio-setup`: S3-compatible storage for attachments, with the
   `lictory-files` bucket created on start. The storage tests in
   `packages/core/src/storage/minio.test.ts` run against it (and are skipped
   when it is not running); point `S3_TEST_ENDPOINT`,
   `S3_TEST_ACCESS_KEY_ID` and `S3_TEST_SECRET_ACCESS_KEY` elsewhere to use
   another MinIO.

These services use well-known development credentials (`lictory/lictory`, the
zero-cache admin password `development`), so `compose.yaml` publishes their
ports (5432, 4848, 1025 and 8025) on `127.0.0.1` only. Docker writes its own
firewall rules, so a host firewall such as ufw would not protect a port
published on every interface. To reach them from another machine during remote development, set
`LICTORY_DEV_BIND_ADDRESS` (in the shell or `.env`) to the interface to listen
on, for example a private VPN address, and prefer an SSH tunnel
(`ssh -L 5432:localhost:5432 …`) over `0.0.0.0` on any machine with a public
address. `docker compose config` shows the resulting `host_ip`.

`bun run dev` refuses to start until zero-cache answers on port 4848. After
generating a migration, apply it with `bun run db:migrate` (or
`docker compose run --rm migrate`); zero-cache picks schema changes up through
its event triggers. An older PostgreSQL container created before logical
replication was enabled is replaced automatically by `docker compose up -d`
(the data volume is kept). To start over with an empty database, run
`docker compose down -v`, which also deletes zero-cache's replica.
Production images and the single-server stack are described in
[deployment](deployment.md).

## Daily commands

| Command               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `bun run dev`         | Applications (after `docker compose up -d`)        |
| `bun run check`       | Types, lint, formatting, unused code and PR assets |
| `bun run format`      | Apply Prettier                                     |
| `bun test src/<area>` | Focused domain tests while you work                |
| `bun run test:sync`   | Synchronization invariants against PostgreSQL      |
| `bun run test:e2e`    | Production build plus browser workflows            |
| `bun run test:smoke`  | Production build plus the `@smoke` workflows only  |
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

The single sign-on workflow (`tests/platform/sso.spec.ts`) needs a real
identity provider and is skipped without one. To run it, start the local Dex
(`docker compose --profile sso up -d dex`) and set
`E2E_OIDC_ISSUER=http://127.0.0.1:5556/dex` for `bun run test:e2e`; see
[single sign-on](./sso.md).

### Test tiers

The suite is layered so that a regression in what teams rely on fails fast,
while the code stays cheap to change. Pick the lowest tier that proves a
behavior.

| Tier              | Proves                                                            | Command              | Runs on pull requests               | Nightly                |
| ----------------- | ----------------------------------------------------------------- | -------------------- | ----------------------------------- | ---------------------- |
| Static            | Types, lint, formatting, unused code, committed migrations        | `bun run check`      | Always                              | Yes                    |
| Domain            | Invariants and contracts against real PostgreSQL                  | `bun test src`       | Unless the change is prose          | Yes                    |
| Smoke             | The critical journeys, tagged `@smoke`, against production builds | `bun run test:smoke` | When applications or tests change   | Yes                    |
| Browser workflows | Every workflow in `tests/`                                        | `bun run test:e2e`   | Manual (`CI` → Run workflow → full) | Yes, before publishing |

`.github/scripts/ci-changes.sh` maps changed paths to tiers and runs everything
for paths it does not recognise. The required `Verify` check passes only when
every selected job passed.

What earns a test, while the product is young:

- A domain invariant (approvals belong to revisions, revisions are immutable,
  tenant isolation, server-side authorization, readiness evidence): a domain
  test at the boundary that enforces it, not a browser workflow.
- A bug fix: a regression test at the lowest tier that reproduces the bug.
- A journey whose breakage would stop a team working: a browser workflow. Tag
  it `@smoke` (in the title) only if it is one of the few journeys every
  release must keep. The smoke tier stays around a dozen tests and under five
  minutes in CI; adding one means retiring or merging another. A smoke test
  must pass on its own: it creates its own people and organizations instead of
  relying on what an earlier test left behind.

What does not: markup snapshots, component internals, mocks of our own
modules, copy assertions unless the wording is the behavior, and browser tests
that repeat a domain test. A test that breaks whenever the implementation
changes without the behavior changing should be rewritten or deleted.

CI retries a failed browser test once and reports it as flaky. A flaky test is
fixed promptly or marked `test.fixme` with a linked issue; it never gets more
retries. `scripts/test-e2e.ts` stops the run as soon as a service it started
exits, and an interrupted run (Ctrl-C, a cancelled job) still stops its
services and drops its database.

## Full verification before a pull request

Pull request CI runs the [test tiers](#test-tiers) the change needs, and the
nightly runs every tier before publishing, but neither replaces this sequence.
Run
the complete sequence below before opening or updating a pull request, in order
and against a disposable database, never your development database:

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

## Release performance

Backend release builds run in parallel on native amd64 and arm64 runners.
Verification and Cloudflare frontend preparation also run in parallel with
those builds. Assembly rejects a missing or duplicate architecture, mismatched release plans
and stale previous-proxy assets before publishing multi-platform indexes.
Migration, Zero catch-up and healthy backend activation still precede frontend
publication. The standalone website dispatch builds its selected stable tag.

Bun installs directly from the lockfile: restoring and saving its broad download
cache cost more than an uncached install in measured Actions runs. BuildKit registry caches default
to `IMAGE_REGISTRY/lictory-cache`, with separate tags per target, channel and
architecture; `IMAGE_CACHE_REGISTRY` overrides the namespace. The workflow token
needs package write access there. A cold cache, slow runner allocation, required
environment approval, database backup or initial Zero sync can exceed the
two-minute warm-run target. Measure the entire run, including job queue time and
post steps, rather than only Docker's build duration.
