# Development runbook

## First checkout

Requirements: [Bun](https://bun.sh) at the version in `package.json`
(`packageManager`), **Node.js 24 LTS**, Docker, Git, and `jq` and `openssl`
(the release tests run the deployment scripts, which use both; macOS 15 and
later include them, older macOS and minimal Linux images may not). Bun is the only supported
package manager; Node runs workspace build scripts and supplies Zero's supported
native SQLite ABI. Install Node before `bun install`, and check `node --version`.
A bare Bun-only container can fall back to compiling Zero's SQLite module;
it is not the supported development environment. The production Dockerfile
also pairs Bun with Node 24.

Both versions are recorded where version managers find them: `engines` in
`package.json`, `.nvmrc` (`nvm use`, `fnm use`) and `.tool-versions`
(`mise install`, `asdf install`). Update them together with `packageManager`,
the Bun images in the Dockerfile, `.devcontainer/Dockerfile` and
`compose.yaml`, and the Node version in `.github/actions/setup`.

Bun does not enforce `engines`, so `bun run check` starts with
`scripts/check-toolchain.ts`: it stops on a different Bun minor release, a
different Node major release or a missing tool, and warns when only Bun's patch
release differs from CI.

**Shell for release-tooling tests.** The deployment CLI targets Linux and uses
Bash 4+ syntax. macOS ships Bash 3.2; install a current version (for example
`brew install bash`) and put it before `/bin` on `PATH` when running verification.
Check `bash --version` before the full suite.

**Platforms.** macOS and Linux are supported directly. On **Windows, use WSL2**:
clone the repository inside the WSL file system (not under `/mnt/c`) and run
every command there, with Docker Desktop's WSL2 backend or Docker Engine
installed in WSL. The scripts assume a POSIX system (`scripts/dev.ts` stops
services through process groups, the deployment tooling is Bash, and browser
test results go to `/tmp`), so native Windows shells are not supported.

**Dev container.** `.devcontainer/` describes the same environment for VS Code
Dev Containers, GitHub Codespaces or the `devcontainer` CLI: Node 24 with the
exact Bun release, and a Docker daemon of its own (the docker-in-docker
feature) so `docker compose up -d` runs the services inside the container and
the commands below work unchanged. Creating it copies `.env.example` to `.env`
when there is none and runs `bun install`; the app, website and Mailpit ports
are forwarded to the host. Give Docker at least 8 GB of memory, as below. On
macOS and Windows, a clone in a container volume ("Clone Repository in
Container Volume") is much faster than a bind-mounted checkout. With rootless
Docker on Linux, the container's `node` user cannot write a bind-mounted
checkout; use a container volume there too, or the native setup.

For a memory-limited container, allow at least 8 GB of Docker memory. The full
type-aware ESLint check peaks near 4 GB, above Node's default heap on some
machines, so `bun run lint` allows itself 6 GB (`--max-old-space-size=6144`).
A `NODE_OPTIONS` you export comes after it and wins.

```sh
cp .env.example .env
bun install
docker compose up -d --wait   # PostgreSQL, migrations, zero-cache, Mailpit, MinIO
bun run dev                   # SPA, API, worker, collaboration and website on the host
```

`--wait` returns once every service is healthy: zero-cache needs up to a
minute after the migrations for its first sync. Without it, `bun run dev`
waits for a zero-cache that is still starting. `bun run dev` warns when the
installed Bun differs from `packageManager` (`bun install` does not).

- App: http://localhost:3000 (API 3002, collaboration 3004, zero-cache 4848)
- Website: http://localhost:3100
- Documentation (not started by `bun run dev`):
  `bun run --cwd apps/docs dev`, http://localhost:3200
- Mailpit (verification and reset emails): http://localhost:8025
- MinIO console (attachment bucket, user `lictory`, password
  `lictory-development`): http://127.0.0.1:9001

`.env.example` lets anyone sign up and create organizations
(`LICTORY_SIGNUP_MODE=open`, `LICTORY_ORGANIZATION_CREATION=everyone`). Remove
both to work with the self-hosted defaults (invitations only, organizations by
instance administrators); then create the first instance administrator with
`echo '<password>' | bun run admin setup --organization Acme --name "Ada Admin" --email ada@example.test --password-stdin`
and open the admin console at http://localhost:3000/admin. See
[instance administration](../internals/instance-administration.md).

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
6. `minio`: S3-compatible storage for attachments. Its healthcheck creates the
   `lictory-files` bucket, so the service is healthy once the bucket exists. The storage tests in
   `packages/core/src/storage/minio.test.ts` run against it (and are skipped
   when it is not running); point `S3_TEST_ENDPOINT`,
   `S3_TEST_ACCESS_KEY_ID` and `S3_TEST_SECRET_ACCESS_KEY` elsewhere to use
   another MinIO.

These services use well-known development credentials (`lictory/lictory`, the
zero-cache admin password `development`), so `compose.yaml` publishes their
ports (5432, 4848, 1025, 8025, 9000 and 9001) on `127.0.0.1` only. Docker writes its own
firewall rules, so a host firewall such as ufw would not protect a port
published on every interface. To reach them from another machine during remote development, set
`LICTORY_DEV_BIND_ADDRESS` (in the shell or `.env`) to the interface to listen
on, for example a private VPN address, and prefer an SSH tunnel
(`ssh -L 5432:localhost:5432 …`) over `0.0.0.0` on any machine with a public
address. `docker compose config` shows the resulting `host_ip`.

**Ports and a second checkout.** Every published port has a variable, set in
the shell or `.env` and listed in `.env.example`:

| Variable                         | Default | Service                                     |
| -------------------------------- | ------- | ------------------------------------------- |
| `LICTORY_DEV_POSTGRES_PORT`      | 5432    | PostgreSQL (`DATABASE_URL`)                 |
| `LICTORY_DEV_ZERO_PORT`          | 4848    | zero-cache                                  |
| `LICTORY_DEV_SMTP_PORT`          | 1025    | Mailpit SMTP (`SMTP_PORT`)                  |
| `LICTORY_DEV_MAILPIT_PORT`       | 8025    | Mailpit web interface                       |
| `LICTORY_DEV_MINIO_PORT`         | 9000    | MinIO (`S3_ENDPOINT`)                       |
| `LICTORY_DEV_MINIO_CONSOLE_PORT` | 9001    | MinIO console                               |
| `LICTORY_DEV_API_PORT`           | 3002    | The API on the host, which zero-cache calls |

Change the setting in parentheses to the same port: the applications read
those, not the variables. `bun run dev` follows `LICTORY_DEV_ZERO_PORT` and
`LICTORY_DEV_API_PORT`, and serves the app on the port of `PLATFORM_URL` (or
`BETTER_AUTH_URL`), 3000 by default. A second checkout on the same machine
also needs its own `COMPOSE_PROJECT_NAME` (default `lictory`); otherwise its
`docker compose up` takes over the first checkout's containers.

The Vite dev server is the one origin in development: it proxies `/api` and
`/relay` to the API, `/zero` to zero-cache and `/collaboration` (live draft
editing in Spaces, a WebSocket) to the collaboration service
(`COLLABORATION_ORIGIN`, default `http://localhost:3004`). The collaboration
service accepts WebSockets only from `PLATFORM_URL` (`http://localhost:3000`
in development) and allows one running copy per database: a second
`bun run dev` against the same database waits briefly, then its collaboration
service exits with `collaboration.owner_busy` while everything else keeps
running.

`bun run dev` refuses to start until zero-cache answers on port 4848 (it
waits while the container is still starting). Once the API is up it also
checks, from inside the zero-cache container, that zero-cache can reach the
API, and explains the fix when it cannot (see
[troubleshooting](#troubleshooting)). After
generating a migration, apply it with `bun run db:migrate` (or
`docker compose run --rm migrate`); zero-cache picks schema changes up through
its event triggers. An older PostgreSQL container created before logical
replication was enabled is replaced automatically by `docker compose up -d`
(the data volume is kept). To start over with an empty database, run
`docker compose down -v`, which also deletes zero-cache's replica.
Production images and the single-server stack are described in
[deployment](deployment.md).

## Daily commands

| Command                         | Purpose                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `bun run dev`                   | Applications (after `docker compose up -d --wait`)                              |
| `bun run check`                 | Types, lint, formatting, unused code, PR assets and the configuration reference |
| `bun run format`                | Apply Prettier                                                                  |
| `bun test --isolate src/<area>` | Focused domain tests while you work                                             |
| `bun run test:domain`           | Every domain test, files in parallel                                            |
| `bun run test:sync`             | Synchronization invariants against PostgreSQL                                   |
| `bun run test:e2e`              | Production build plus browser workflows                                         |
| `bun run test:smoke`            | Production build plus the `@smoke` workflows only                               |
| `bun run verify`                | The full verification sequence, services included, before a pull request        |
| `bun run db:generate`           | Committed SQL migration after a schema change                                   |
| `bun run db:check`              | Fail when the schema has no matching migration                                  |
| `bun run admin <cmd>`           | Instance administration against `.env`'s database                               |

Schema changes follow [database migrations](./migrations.md). Domain writes
follow [synchronization](../internals/synchronization.md) and
[capabilities](../internals/capabilities.md).

Environment variables are declared in `packages/core/src/config/declarations.ts`.
After adding or changing one, run `bun run config:docs` to regenerate the
[configuration reference](./configuration.md); a test fails when runtime code
reads an undeclared variable.

`bun run knip` reports unused files and dependencies. Its configuration
(`knip.jsonc`) lists the few findings that predate it; shrink that list rather
than grow it.

## Troubleshooting

**`SQLITE_ERROR no such table: _zero.tableMetadata` in zero-cache's log.**
zero-cache logs this once (`Unable to create full ReplicationStatusEvent`)
during its first sync, before it has created its replica's tables. It is
harmless; zero-cache becomes healthy moments later.

**A port is already allocated.** `docker compose up` fails with
`Bind for 127.0.0.1:5432 failed: port is already allocated` when another
PostgreSQL, Mailpit or checkout holds the port. Set the matching
`LICTORY_DEV_*_PORT` variable and the setting that names it (the ports table
under [first checkout](#first-checkout)) instead of writing an override file.

**Sign-up works, then "The workspace could not be opened … Fetch from API
server threw error: fetch failed".** zero-cache runs in Docker and calls the
API on the host (`host.docker.internal:3002`). On Linux, a host firewall (ufw,
firewalld, nftables rules) that drops traffic from Docker's bridge networks
to the host blocks that call, while the browser still reaches the API, so
sign-in succeeds and every synced query fails. `bun run dev` detects this and
prints the network and port; the app says the sync service cannot reach the
API. Fix it in one of two ways:

- Let the Docker network reach the API port, for example
  `sudo ufw allow from 172.18.0.0/16 to any port 3002 proto tcp` with the
  subnet `bun run dev` prints (`docker network inspect lictory_default`). A
  network recreated by `docker compose down` may get another subnet.
- Run zero-cache on the host's network: add
  `COMPOSE_FILE=compose.yaml:compose.host-network.yaml` to `.env` and run
  `docker compose up -d --wait` again. zero-cache then reaches PostgreSQL and
  the API on `127.0.0.1`, and listens on every interface of the host (its port
  and the next one), so your firewall, not `LICTORY_DEV_BIND_ADDRESS`, decides
  who reaches it. Linux only; Docker Desktop needs host networking enabled.

An API started with `HOST=127.0.0.1` is unreachable from Docker for the same
reason; leave `HOST` unset in development.

**`bun run dev` warns about the Bun version.** Install the release in
`packageManager` with the command it prints; `bun run check` refuses a
different minor release.

## Tests

Domain tests are colocated as `*/src/**/*.test.ts` in every workspace and run with
`bun run test:domain` (`bun test --parallel`): files run side by side in worker
processes, and each file gets its own module registry and globals, so a file
that points `DATABASE_URL` at its own database never receives a client another
file already created. Tests that need PostgreSQL create their own database from
`SCHEMA_TEST_DATABASE_URL` (the admin `postgres` database), so they never touch
your development data, and never share one with another file. The tests inside
a file run in order and may build on each other. Run focused tests with
`--isolate` too: without it, Bun runs every file in one global and applies the
preloaded setup (`scripts/test-setup.ts`, including the 60 s default timeout)
to the first file only, so later files fail at Bun's 5 s default.
`scripts/test-timings/domain.json` records how long each file takes, so the
slowest start first; refresh it with
`bun test --parallel --timings=scripts/test-timings/domain.json --update-timings src`
when files are added or grow. A stale entry only makes the run less even.

Browser tests in `tests/platform`, `tests/marketing` and `tests/docs` run
against production builds: `scripts/test-e2e.ts` migrates an isolated database,
starts the API, worker, collaboration service, zero-cache, the website (port 3101), the documentation's
static export behind its Cloudflare Worker in `wrangler dev` (port 3201) and
`scripts/edge-proxy.ts` (the platform origin, port 3001, routed like
production, `/collaboration` included), then drops the database and its replication slot. PostgreSQL must
run with `wal_level=logical` (`compose.yaml` does). `E2E_PORT_OFFSET` lets
several checkouts run side by side; use multiples of 10 (10, 20...), because the
services take consecutive ports (an offset of 1 would put the edge proxy on the
API's port). `E2E_SKIP_BUILD=1` reuses builds when only tests changed. Failure
screenshots land in `/tmp/lictory-playwright-results`.

Browser test files run in parallel Playwright workers (half of your cores, two
in CI; `E2E_WORKERS` overrides). On a machine busy with other work, such as
another checkout's test suite, use fewer (`E2E_WORKERS=2`): the assertions wait
15 seconds, and an overloaded machine misses that bound. The tests inside a file keep their order, so
no person, handle or organization may be shared between files: a file creates
its own (`tests/helpers/workspace-people.ts` gives each workspace file its
people). The applications build concurrently, and the documentation site is
built and started only when the selected tests include `tests/docs`.

CI runs the full suite as four shards (`E2E_SHARD=2/4`). Playwright's own
`--shard` balances by test count; `scripts/e2e-selection.ts` balances by the
durations in `scripts/test-timings/browser.json` instead, placing the longest
files first. The longest file sets the floor for a shard, so split a file that
grows past about two minutes along the people it uses. After adding or growing
files, refresh the durations with `E2E_UPDATE_TIMINGS=1 bun run test:e2e`; a
file without an entry is estimated from its number of tests.

### External services in browser workflows

Browser workflows never reach a real external service. `scripts/test-e2e.ts`
starts two stand-ins of its own on 127.0.0.1 (`scripts/e2e-fakes`), in its own
process, for the length of the run:

- **A Jira Cloud site** (`jira.ts`, port 3005 + offset). It answers the Jira
  REST endpoints the real adapter (`packages/core/src/delivery/jira`) calls,
  with Jira's shapes, so connecting, handing off, recovering a lost create and
  the status sync run unchanged. The site is `https://lictory-e2e.atlassian.net`:
  it passes the adapter's production allowlist (Atlassian hosts over https,
  the protection against server-side request forgery), which stays strict.
  The API and worker reach the stand-in only because the runner starts them
  with `node --import ./scripts/e2e-fakes/route-fake-sites.ts`, which routes
  exactly the origins in `E2E_FAKE_ROUTES` to it, like an `/etc/hosts` entry.
  Tests play the people working in Jira through its `/__fake/*` routes
  (`E2E_FAKE_JIRA_URL`): create a project, move an issue, lose the answer to
  the next create.
- **A scripted AI provider** (`openai.ts`, port 3006 + offset), behind
  OpenAI's Responses API. It decides what a model would do from the request
  alone (the person's words, the page context and the tool results the server
  sent) and fails with a provider error when it has no script. Tools still run
  in the worker with the asking person's permissions, and citations come from
  what they returned, so it exercises authorization, tool calls and rendering
  instead of faking them. It records every request (`E2E_SCRIPTED_AI_URL`
  `/__scripted-ai/requests`) so a test can prove what never reached the
  provider. The API and worker reach it through the AI SDK's own
  `OPENAI_BASE_URL`.

Only the AI files get the AI provider, because a server with AI changes what
every other workflow sees (Litto as the home page, AI controls, onboarding).
The runner runs the browser files in three phases, restarting the API and
worker between them:

1. Every other file, against a server without AI, as a default installation
   has.
2. The `*.ai-console.spec.ts` files, against a server whose environment sets
   no AI variable at all. An instance administrator connects the scripted
   provider in the admin console, as an installation without environment
   settings does.
3. The `*.ai.spec.ts` files, with the scripted provider configured in the
   environment (`OPENAI_API_KEY`, `OPENAI_BASE_URL`), as existing
   installations do.

Sharded runs keep each file in its shard and phase.

Neither stand-in can be reached outside the browser suite: production images
contain neither `scripts/` nor the preload, no application code imports
them, and nothing but `scripts/test-e2e.ts` passes the preload or sets these
variables. The runner also never inherits a developer's `OPENAI_BASE_URL`.

### Tests that pass on every contributor's machine

The verification sequence runs on contributors' laptops and their agents'
machines, often busy with other work, as well as in CI. A test that fails there
without a defect costs everyone a rerun and teaches people to ignore failures.

- **Assert progress, not speed.** Wait for an observable outcome with a
  generous bound instead of counting what happened in a fixed window or
  asserting a duration. Domain tests get a 60 s default timeout
  (`scripts/test-setup.ts`, preloaded by `bunfig.toml`); browser assertions keep
  the configured 15 s.
- **Authentication is rate limited per client address**, as in production
  (sign-in and sign-up: 3 per 10 s), and every browser test runs from one
  machine. Sign in with `signIn` or `newPerson` from `tests/helpers/seed.ts`; a
  test or local helper that submits an authentication form itself, or opens its
  own browser context, takes an address from `clientAddress()` or
  `useClientAddress(page)` in `tests/helpers/client-address.ts`. Never hand-pick an address: two tests that
  pick the same one share a budget, depending on the order they run in.
- **Shell scripts that tests execute must run on macOS**: Bash 3.2 and BSD
  tools (no `${var,,}`, `mapfile`, `declare -A`, `sed -i` without a suffix
  argument, `readlink -f`, `date -d`, `grep -P`).

The single sign-on workflow (`tests/platform/sso.spec.ts`) needs a real
identity provider and is skipped without one. To run it, start the local Dex
(`docker compose --profile sso up -d dex`) and set
`E2E_OIDC_ISSUER=http://127.0.0.1:5556/dex` for `bun run test:e2e`; see
[single sign-on](./sso.md).

### Test tiers

The suite is layered so that a regression in what teams rely on fails fast,
while the code stays cheap to change. Pick the lowest tier that proves a
behavior.

| Tier              | Proves                                                            | Command               | Runs on pull requests                    | Nightly                |
| ----------------- | ----------------------------------------------------------------- | --------------------- | ---------------------------------------- | ---------------------- |
| Static            | Types, lint, formatting, unused code, committed migrations        | `bun run check`       | Always                                   | Yes                    |
| Domain            | Invariants and contracts against real PostgreSQL                  | `bun run test:domain` | Ready, unless the change is prose        | Yes                    |
| Smoke             | The critical journeys, tagged `@smoke`, against production builds | `bun run test:smoke`  | Ready, when applications or tests change | Yes                    |
| Browser workflows | Every workflow in `tests/`                                        | `bun run test:e2e`    | Manual (`CI` → Run workflow → full)      | Yes, before publishing |
| Laptop trial      | `deploy/try.sh` on published images: sign-in, sync, email         | (CI only)             | Ready, when the trial changes            | Yes, after publishing  |

`.github/scripts/ci-changes.sh` maps changed paths to tiers and runs everything
for paths it does not recognise. Each tier is split across parallel jobs so that
the slowest job sets the duration: lint as three jobs over disjoint paths
(`packages/core`, `apps/platform`, everything else) beside one for types,
formatting, unused code and migrations (`bun run typecheck` and
`bun run check:rest`, which together with lint make up `bun run check`; add a
new static check to `check:rest` so CI runs it too), domain test files in three
processes, and the full browser suite in four shards. The lint jobs first
generate the route types Next.js derives for the website and documentation
(`next typegen`), which `bun run typecheck` produces locally before lint. A change to the documentation site (or what
it renders) also builds it in the static checks, so a broken page fails the
pull request. The required `Verify` check passes only when
every selected job passed.

A draft pull request runs only the static checks. The domain, smoke and
laptop trial tiers it needs wait until it is marked ready for review, which starts a new run with
them; re-running the draft's run does not. Until then `Verify` fails and names
the tiers that have not run, so a green pull request always means everything
its changes need was tested. Drafts get static feedback on every push, while
the costly database and browser tiers run once a change is ready. Maintainers
who want them earlier run `gh workflow run ci.yml --ref <branch>` (add
`-f suite=full` for every browser workflow).

The laptop trial tests published release images, not the checkout's code, so it
is not part of the local verification sequence. On a pull request that changes
`deploy/try.sh`, `tests/try` or `.github/actions/trial`, CI runs the changed
script (once the pull request is ready for review) against the newest stable release; Nightly runs it against each
candidate right after publishing it, and a failure there keeps that nightly
from being promoted by Release
([self-hosting](self-hosting.md#try-lictory-on-a-laptop)).

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
- A boundary with an external system (handing off to Jira, a Lictory
  Intelligence answer): a domain test of the adapter and its guarantees, plus
  at most one browser workflow per journey against the
  [stand-ins](#external-services-in-browser-workflows). These workflows are
  long and run in their own phase, so they stay out of `@smoke`.

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

### With one command

```sh
bun run verify
```

`bun run verify` (`scripts/verify.ts`) runs the commands of the manual
sequence below, exactly and in order, against your working tree, with their
output unfiltered. Around them it:

- starts a private PostgreSQL and Mailpit with the images and server flags CI
  uses (`scripts/verify.compose.yaml`), under a Compose project of its own
  (`lictory-verify-…`) on ports Docker picks, so it never touches your
  development services or another checkout's run;
- creates a disposable database and sets every variable listed below, with
  `DATABASE_MIGRATION_URL` cleared so `db:migrate` can only reach that
  database;
- gives the browser suite the first free `E2E_PORT_OFFSET` when its default
  ports are taken (an offset you set is kept);
- runs `bunx playwright install` without `--with-deps`, which needs root, only
  when Chromium already launches on this machine (proof that its system
  libraries are installed); otherwise it runs the command as written, and
  `sudo` may ask for your password;
- removes everything it created (the containers and their data, or with
  `--postgres` its database and that database's replication slots), also when
  a step fails or you press Ctrl-C. A second Ctrl-C stops the running step at
  once.

It stops at the first failed step and ends with a summary of every step (pass,
fail, not run, duration) and the command to rerun the failed one:

```text
  FAIL  test:domain     2m 41s  bun run test:domain  (exit 1)
  ----  playwright     not run  bunx playwright install --with-deps --only-shell chromium
  ----  test:e2e       not run  bun run test:e2e

test:domain failed: `bun run test:domain` exited 1.
Rerun this step:           bun run verify --only test:domain
Rerun it and what follows: bun run verify --from test:domain
```

`--only` and `--from` are for iterating; the full run must pass on the final
changes, and refuses `E2E_SHARD` and `E2E_SKIP_BUILD`, which would narrow the
browser suite. To use services you already run, name them:
`bun run verify --postgres postgresql://lictory:lictory@localhost:5432/postgres --mailpit http://localhost:8025`
(the PostgreSQL admin database, which needs `wal_level=logical`; Mailpit's SMTP
port defaults to 1025 on the same host, `--smtp host:port` overrides it). It
needs Docker unless both are named. `bun run verify --help` lists the options
and step names.

### By hand

Run
the complete sequence below before opening or updating a pull request, in order
and against a disposable database, never your development database:

```sh
docker compose up -d --wait postgres mailpit
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
bun run test:domain
bunx playwright install --with-deps --only-shell chromium
bun run test:e2e

docker compose exec -T postgres dropdb -U lictory --force "$DB"
```

Drop the database even when a step fails. Variables exported in the shell take
precedence over `.env`; unset any integration credentials you do not want the
run to use.

## Agents

Agents follow `AGENTS.md`. Only the project's own
[app verification skill](../../.agents/skills/test-lictory-app/SKILL.md) is tracked
in `.agents/skills`. Third-party skills are recorded in `skills-lock.json` and
can be restored locally from the repository root with the
[skills CLI](https://github.com/vercel-labs/skills/blob/main/docs/commands.md#restore-skills-from-the-project-lock-file):

```sh
npx skills experimental_install
```

Restored third-party skills are ignored by Git. The lockfile records sources and
content fingerprints, not pinned upstream commits; restoration may refresh the
fingerprints if upstream content has changed. Review any lockfile changes.
Run agents in a separate worktree and give each worktree its own disposable databases.

## Release performance

Backend release builds run in parallel on native amd64 and arm64 runners, and
verification runs in parallel with them. Assembly rejects a missing or
duplicate architecture, mismatched release plans and stale previous-proxy
assets before publishing multi-platform indexes. A release deploys nothing,
so its duration is verification and the image builds; the websites deploy
afterwards in their own jobs ([websites](websites.md)).

Bun installs directly from the lockfile: restoring and saving its broad download
cache cost more than an uncached install in measured Actions runs. The Next.js
build caches of the website and the documentation (`.next/cache`) are restored
between browser runs, as Next.js recommends for CI; a miss only costs the
compile time. Verification is the longer half of a release, so it is split:
the full browser suite's four shards each take about as long as the longest
test file, and the smoke tier, the domain tests and the static checks fit in a
few minutes each. BuildKit registry caches default
to `IMAGE_REGISTRY/lictory-cache`, with separate tags per target, channel and
architecture; `IMAGE_CACHE_REGISTRY` overrides the namespace. The workflow token
needs package write access there. A cold cache, slow runner allocation, required
environment approval or a full browser suite can exceed the two-minute
warm-run target. Measure the entire run, including job queue time and
post steps, rather than only Docker's build duration.
