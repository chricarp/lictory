# Deployment and operations

Cloudflare serves the static marketing website at `lictory.com`, redirects
`www.lictory.com` to the apex, and serves the platform SPA at `app.lictory.com`.
The production server runs five long-lived services: the app gateway, API,
background worker, zero-cache and PostgreSQL. There is no marketing container.
See [websites on Cloudflare](cloudflare-marketing.md) for frontend releases.

Images are built off-server by GitHub Actions and deployed by digest. Backend
production changes go through the manually approved **Release to Production**
workflow ([versions and releases](releases.md)). Openship provides service
controls, live logs, routing, health monitoring and saved operational jobs.

```text
lictory.com / www ──▶ Cloudflare static marketing / canonical redirect
app.lictory.com ────▶ Cloudflare SPA
                       └─ /api, /zero, /relay ──▶ Openship HTTPS edge
                                                  └─ private Caddy gateway
                                                       ├─ API / worker
                                                       └─ Zero ──▶ PostgreSQL
```

| Service      | Image                   | Purpose                                                                           |
| ------------ | ----------------------- | --------------------------------------------------------------------------------- |
| `proxy`      | `lictory-proxy`         | Private app gateway: API, streaming, Zero and retained SPA assets                 |
| `api`        | `lictory-api`           | Hono API, Better Auth, files, Zero query/mutate endpoints and document metadata   |
| `worker`     | `lictory-api`           | Durable AI, email and delivery jobs; delivery status refresh and automatic cycles |
| `zero-cache` | `rocicorp/zero:1.11.2`  | Sync engine; SQLite replica of the `lictory_zero` publication on its own volume   |
| `postgres`   | `postgres:17.11-alpine` | Authoritative data; logical replication for Zero                                  |
| `migrate`    | `lictory-migrate`       | One-shot: applies committed migrations before activation                          |
| `ops`        | `lictory-ops`           | One-shot backups, restores and monitoring                                         |

The release manifest still includes a marketing image for release-format
compatibility; it is not a production service and is not pulled by the backend
controller. Cloudflare builds its own static frontend from the selected tag.

Files bytes stay in private Cloudflare R2 (see
[private file storage](../internals/file-storage.md)); email goes through Resend.
OAuth and AI are optional.

## Network boundaries

Only the proxy publishes ports (80 and 443). PostgreSQL and zero-cache are on
an internal Docker network with no route to or from the internet. The API,
worker and ops tooling also join an egress-only network for external
APIs (R2, Resend, OpenAI, Jira, PostHog, OAuth providers). The host firewall
allows SSH (rate limited), HTTP and HTTPS only.

The proxy:

- sends `/zero/*` to zero-cache unchanged (Zero 1.11 serves the `/zero`
  prefix itself) and refuses WebSocket upgrades whose `Origin` is not
  `https://app.lictory.com` (cross-site WebSocket hijacking);
- answers `/api/zero/*` with 404: zero-cache calls those endpoints on the
  internal network with its API key and forwarded session cookies;
- streams `/api/*` and `/relay/*` without buffering (server-sent events,
  AI chat streams) and without a response timeout; request bodies are capped
  per route slightly above the application limits;
- serves `/assets/*` as immutable, `/brand/*` and `/illustrations/*` for a day
  and other static files for an hour, and keeps the previous release's
  `/assets/*` so open tabs can still load their code-split chunks;
- sends every other path to the API, which returns `index.html` with
  path-derived metadata and `Cache-Control: no-store`;
- sets HSTS, `nosniff`, `strict-origin-when-cross-origin`, and refuses framing
  of the application (`frame-ancestors 'none'` unless the API sends a CSP).

`scripts/edge-proxy.ts` is the local stand-in for these routes; keep both in
step.

## Environments

Production and staging are separate servers with separate databases, R2
buckets (files and backups), email domains, OAuth clients and secrets. Staging
uses `staging.lictory.com` and `app.staging.lictory.com` and runs nightly
images; production runs stable images only. Never copy a value between their
`.env` files.

Each server has `/srv/lictory/<environment>/`:

| Path                  | Contents                                                                    |
| --------------------- | --------------------------------------------------------------------------- |
| `.env`                | Secrets and settings (mode 0600, owner `deploy`); template in `deploy/env/` |
| `releases/<version>/` | Image digests (`release.env`), the release's compose file and tooling       |
| `current`             | Symlink to the active release                                               |
| `release-history.log` | Every activation                                                            |
| `deploy.log`          | Deployment log                                                              |

`/srv/lictory/bin` holds `deploy.sh`, `lictory-compose` (docker compose for an
environment), `lictory-remote` (the CI key's forced command), and the backup,
monitor and restore-drill wrappers. A newly activated release installs its
versions of these tools.

## Secrets and settings

`deploy/provision/new-environment.sh` creates `.env` with generated database
passwords, `BETTER_AUTH_SECRET`, `DELIVERY_CREDENTIALS_KEY`, `ZERO_API_KEY` and
`ZERO_ADMIN_PASSWORD`. Fill in the rest by hand:

| Setting                                                    | Notes                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SITE_HOST`, `WWW_HOST`, `APP_HOST`, `ACME_EMAIL`          | Public hosts; certificates are issued automatically                                                    |
| `DELIVERY_CREDENTIALS_KEY`                                 | Never rotate once Jira connections exist; stored credentials become unreadable                         |
| `R2_*`                                                     | Files bucket, bucket-scoped object read/write token                                                    |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                      | Required for production email                                                                          |
| `BACKUP_*`                                                 | Dedicated private backup bucket and its own token; `BACKUP_AGE_RECIPIENTS` is a public key             |
| `ALERT_WEBHOOK_URL`, `MONITOR_PING_URL`, `BACKUP_PING_URL` | Alert webhook and dead-man's-switch pings                                                              |
| `GOOGLE_*`, `MICROSOFT_*`, `OPENAI_API_KEY`, `POSTHOG_*`   | Optional                                                                                               |
| `LICTORY_IMAGE_REGISTRY`, `LICTORY_RELEASE_CHANNEL`        | Releases must be digests in this registry and of this channel (`stable` production, `nightly` staging) |

Each service receives only the variables it needs (see
`deploy/compose.production.yaml`). Secrets are visible to anyone who can run
Docker on the server, which is why only the administrator and `deploy` can log
in. Browser bundles receive public origins and PostHog tokens at build time
from GitHub variables, not from `.env`.

## Database roles

`deploy/postgres/10-lictory-roles.sh` creates the roles on the first start and
re-applies them before every migration:

| Role            | Used by                     | Privileges                                                                                 |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `lictory_owner` | `migrate`                   | Owns the application database and schema; DDL                                              |
| `lictory_app`   | `api`, `worker`             | DML on application tables (default privileges cover future tables); no DDL, no temp tables |
| `zero`          | `zero-cache`                | Superuser with replication; owns `<db>_zero` (client view records and change log)          |
| `lictory_ops`   | backups, monitoring         | `pg_read_all_data`, `pg_monitor`                                                           |
| `postgres`      | operators via `docker exec` | Bootstrap superuser, local socket only                                                     |

zero-cache needs a superuser because PostgreSQL only lets superusers create
event triggers, which Zero uses to replicate schema changes precisely. Without
them a migration halts replication and `ZERO_AUTO_RESET` rebuilds every replica
and client from scratch. The superuser credential exists only in the
zero-cache container on the internal network; the runtime API role cannot run
DDL. Zero's event triggers run as the role issuing DDL, so the role script
grants `lictory_owner` usage of `zero_0` and update on
`zero_0."publishedSchema"` (never membership in `zero`).

The cluster is initialised with the built-in `C.UTF-8` collation: code-point
ordering that matches Zero's replica and the browser, and indexes that survive
C library upgrades.

## Images

`Dockerfile` has one target per image; `deploy/docker-bake.hcl` builds all of
them for `linux/amd64` and `linux/arm64` from one checkout, so the API's
`index.html` and the proxy's assets come from the same SPA build. Tags are the
release version and `sha-<commit>-<channel>`; deployments always pin digests.
The browser and website bundles embed their public origins, so a stable build
of a commit differs from its nightly build.

Local build of all images for this machine:

```sh
REGISTRY=lictory-local VERSION=0.0.0-local PLATFORMS=linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
  docker buildx bake -f deploy/docker-bake.hcl --load
```

The API image bundles the API and worker; only packages left external by the
bundles (`sharp`, `@firecrawl/anydoc`, `postgres` and any other bare import)
are installed for the target platform at the lockfile's versions.

## Provisioning a server

1. Create an Ubuntu 24.04 server in an EU region with
   `deploy/provision/cloud-init.yaml` (your SSH key) and enable provider
   backups or snapshots if wanted.
2. Point DNS at it (below), then copy `deploy/` and run
   `sudo ADMIN_USER=admin LICTORY_ENVIRONMENTS=production bash deploy/provision/provision.sh`.
   It installs Docker from Docker's repository, automatic security updates
   (with a 04:00 UTC reboot when required), the firewall, SSH hardening,
   fail2ban, swap, journald limits, the `deploy` user, `/srv/lictory` and the
   backup and monitor timers. Re-running it is safe.
3. As `deploy`: `new-environment.sh production`, then edit `.env`.
4. The production workflow authenticates `deploy` to GHCR with its temporary
   GitHub job token and removes that credential afterward. No long-lived
   registry token is needed on the server. Direct manual releases outside the
   workflow still need a registry login before pulling private images.
5. Add the release automation's public key to `~deploy/.ssh/authorized_keys`:
   `command="/srv/lictory/bin/lictory-remote",restrict ssh-ed25519 AAAA… release`.
   It can then only prepare, migrate, activate, backfill, roll back and report
   status.
6. Record the host key for GitHub (`ssh-keyscan -t ed25519 <server>`, compared
   with the console output) as `DEPLOY_SSH_KNOWN_HOSTS`.

DNS checklist (production): `A`/`AAAA` for `lictory.com`, `www.lictory.com`
and `app.lictory.com`; a `CAA` record allowing `letsencrypt.org`; keep existing
MX/SPF/DKIM/DMARC records for email. Lower TTLs to 300 s a day before moving
traffic. Staging needs the same three names under `staging.lictory.com`.

## First launch

On an empty database a normal release does everything in order: the first
start of PostgreSQL creates the roles and databases, the migrate service
applies every migration (including the `lictory_zero` publication), zero-cache
performs its initial sync, then the proxy, API and worker start. The
**Release to Production** workflow then deploys both Cloudflare frontends from
the same published stable tag after the backend is healthy.

```sh
# from GitHub: Actions → Release to Production → Run workflow (main)
# or by hand on the server with a release file of digests:
/srv/lictory/bin/deploy.sh production release < release.env
/srv/lictory/bin/deploy.sh production status
# With Openship, enable its saved backup and health jobs (see below).
# Standalone hosts can instead use the supplied systemd timers, never both.
```

Then verify sign-up and email verification, password reset, organization
creation, a revision/approval between two browsers (live updates through
Zero), attachment upload and download, a denied cross-organization request,
the first backup, and a restore drill ([recovery](recovery.md)).

## Deploying a release

`deploy.sh` (driven by the release workflow over SSH) runs three steps:

1. **prepare**: validates the release file (known keys, digests in the
   configured registry, the environment's channel), stores it, pulls the
   images and installs the release's compose file. Nothing changes yet.
2. **migrate**: if migrations are pending, takes a pre-deploy backup,
   re-applies the database roles, runs the `migrate` one-shot (locked,
   transactional; see [migrations](migrations.md)), then waits until
   zero-cache has confirmed replication past the migration's WAL position.
3. **activate**: rolls zero-cache (if its image changed), the proxy (which
   carries the old and new assets), the API and the worker, each
   waiting for its health check; verifies app liveness and a Zero WebSocket
   upgrade through the private proxy; checks that every service
   runs exactly the release's image; then records the activation. If anything
   fails it restores the previous release's images. The proxy holds requests
   for up to 30 s while the API container is replaced, so API restarts drop
   no requests; replacing the proxy itself refuses connections for about two
   seconds (open WebSockets reconnect).

This is Zero's expand order: database, then API, then the Cloudflare client
release. The private gateway retains compatible SPA assets for origin fallback. Contract changes (drop or
rename) go the other way across releases: first a release that stops using
the column, table, query or mutator, then a later release with the contract
migration. The previous release must always work against the new schema,
because a rollback never reverts it. Separate Zero version upgrades from
schema changes; upgrade zero-cache before the client.

When first upgrading from API-owned Litto streams to durable chat runs, let the
old API finish its active conversations before replacing it and reload existing
Litto tabs after activation. In-memory work from the old version cannot be
recovered by the new worker. Historical saved questions remain answerable and
unsaved answers appear as interrupted with Retry. Subsequent durable runs survive
API replacement and recover after worker lease expiry; keep at least one healthy
worker running when rolling multiple instances.

## Rollback

```sh
/srv/lictory/bin/deploy.sh production rollback   # previous activated release
/srv/lictory/bin/deploy.sh production activate 1.4.2
```

Rollback switches application images only; migrations stay applied. After a
rollback, tabs that loaded the newer release reload when they next need a
chunk. Publish a fix as a new release; the release workflow refuses to
activate a version older than the active one.

## Health and monitoring

| Check                       | Where                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| API liveness / readiness    | `GET /healthz`, `GET /readyz` (container health check uses `/readyz`)                                                     |
| zero-cache                  | `GET /keepalive` inside the network (health check, monitor)                                                               |
| Worker, proxy               | Container health checks                                                                                                   |
| Active version and services | `deploy.sh <env> status [--json]`                                                                                         |
| Zero diagnostics            | `lictory-compose <env> exec zero-cache sh -c 'curl -su "admin:$ZERO_ADMIN_PASSWORD" localhost:4848/statz'` (never public) |

The Openship health job (or `lictory-monitor@<env>.timer` on a standalone host)
runs every five minutes and alerts on public Cloudflare route failures, disk usage
above 80 %, unhealthy or stopped containers, a lagging, lost or orphaned
replication slot, `pg_wal` above 6 GB, failed or stuck AI runs, failed or
overdue notification email, partial, failed or stuck delivery exports,
automatic cycles overdue by two hours, and a backup older than 30 hours. It
posts to `ALERT_WEBHOOK_URL` (Slack/Discord-compatible JSON) when the set of
problems changes, every six hours while it persists, and once on recovery, and
pings `MONITOR_PING_URL` (or `/fail`) so an external dead-man's switch notices
a server that stopped reporting. Logs rotate at 5 × 20 MB per container.

## Openship production operations

Open **Lictory production → Services** to inspect the five backend services.
Each service exposes its runtime logs, health, restart count and resource
usage. The project stays always on; push-to-deploy stays disabled. Only the
`proxy` service is public, on `app.lictory.com`. Keep the API, worker,
PostgreSQL and Zero ports private. The edge preserves WebSocket upgrades and
unbuffered streams with five-minute proxy timeouts.

Use service **Restart** for process recovery. Release, migration and image
rollback belong to the guarded controller, not a native stack redeploy: the
controller preserves migration ordering, backup gates and Zero catch-up.
Use GitHub's manual production release for a new version. The saved rollback
job switches only application images and requires a previously activated
version; it never reverses database migrations.

The Openship Jobs view provides:

- **Release status**: active version, digests and service health.
- **Scheduler status**: worker liveness, LISTEN connection and per-job last
  success/failure, next run, run count and consecutive failures.
- **Manual backup** and **Rollback**: explicit operator actions.
- **Nightly encrypted backup**: `30 2 * * *` UTC, using the private backup R2 bucket.
- **Health check**: every five minutes, including disk, containers, public routes,
  replication, queued work and backup freshness.

Enable the Openship schedules or the equivalent systemd timers, never both.
The engine's continuous health watcher detects crashed/unhealthy services.
Failure notifications go to the configured email channel; do not enable
routine success notifications. Docker logs rotate at 5 × 20 MB per container.
Neither in-server checks nor in-server alerts can report during a total VPS
outage without an independently configured external monitor.

### Platform scheduling replaces Vercel Cron

The always-running `worker` owns platform scheduling; no public cron endpoint,
Vercel schedule or duplicate Openship recurring job is needed.

| Activity                  | Trigger / fallback interval                    |
| ------------------------- | ---------------------------------------------- |
| AI runs                   | PostgreSQL notification; poll every 30 seconds |
| Notification email outbox | PostgreSQL notification; poll every 30 seconds |
| Delivery publishing       | PostgreSQL notification; poll every 30 seconds |
| Delivery status refresh   | Every 10 minutes                               |
| Automatic cycles          | Every 5 minutes                                |

Work is durable in PostgreSQL. Leases and fencing make interrupted jobs
recoverable; retries and notification bursts cannot create concurrent runs
of one loop. The LISTEN connection reconnects and wakes every loop. Failures
back off independently. Docker restarts the worker after a crash and on host
boot; stopping the worker deliberately pauses these activities until it is
started again. See [background work](../internals/synchronization.md#background-work).

The internal worker `GET /healthz` reports every loop's counters and timing.
It remains bound to container loopback; read it through the saved **Scheduler
status** job or an authorized service terminal, never a public route.

## Microsoft Entra sign-in

Set `MICROSOFT_CLIENT_ID` (`674718cd-ca91-451c-84eb-02aa492d2b10`) and
`MICROSOFT_CLIENT_SECRET` in production's `.env`. In the Entra application
registration, add the **Web** redirect URI
`https://app.lictory.com/api/auth/callback/microsoft` (and
`http://localhost:3000/api/auth/callback/microsoft` for development); remove
the old `https://lictory.com/...` URI after the switch. `MICROSOFT_TENANT_ID`
defaults to `common`. Add the `email` optional claim to ID tokens. Microsoft
email claims do not prove ownership: new accounts verify through Lictory.
The publisher-domain file
`https://lictory.com/.well-known/microsoft-identity-association.json` must stay
reachable on the website. Google's authorized redirect URI is likewise
`https://app.lictory.com/api/auth/callback/google`.

## Verification and CI

GitHub Actions CI runs only `bun run typecheck` and `bun run db:check`; the
full verification sequence runs locally ([development](development.md)).
Release workflows build images on hosted runners and need no database
credentials: databases are reachable only on their server.

## Costs

The baseline is one server, a backup bucket, the files bucket, email and
optional AI. Review provider usage monthly: server size, R2 storage and
operations, email volume and AI tokens. Keep paid upgrades manual.
