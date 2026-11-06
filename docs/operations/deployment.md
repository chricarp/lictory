# Deployment and operations

How a Lictory server works: the services it runs, its network boundaries,
settings, database roles, images, upgrades, rollback, monitoring and scaling.
Lictory is self-hosted: the project hosts no platform, and its releases
deploy nothing. Each installation pulls published releases with the
[`lictory` command](self-hosting.md), which drives the server tooling
described here (`deploy.sh` and friends). The maintainer's websites
(`lictory.com`, `docs.lictory.com`) are static and separate
([websites](websites.md)).

A server runs six long-lived services: the app gateway, API, background
worker, collaboration service, zero-cache and PostgreSQL.

```text
https://<your app host> ──▶ Caddy gateway (TLS, SPA assets)
                              ├─ /api ───────────▶ API / worker ─────┐
                              ├─ /zero ──────────▶ zero-cache ───────┤
                              └─ /collaboration ─▶ collaboration ────┴─▶ PostgreSQL
```

| Service         | Image                   | Purpose                                                                            |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `proxy`         | `lictory-proxy`         | Private app gateway: API, streaming, Zero and retained SPA assets                  |
| `api`           | `lictory-api`           | Hono API, Better Auth, files, Zero query/mutate endpoints and document metadata    |
| `worker`        | `lictory-api`           | Durable AI, email and delivery jobs; delivery status refresh and automatic cycles  |
| `collaboration` | `lictory-api`           | Live draft editing in Spaces (Hocuspocus WebSocket); one instance per installation |
| `zero-cache`    | `rocicorp/zero:1.11.3`  | Sync engine; SQLite replica of the `lictory_zero` publication on its own volume    |
| `postgres`      | `postgres:17.11-alpine` | Authoritative data; logical replication for Zero                                   |
| `migrate`       | `lictory-migrate`       | One-shot: applies committed migrations before activation                           |
| `ops`           | `lictory-ops`           | One-shot backups, restores and monitoring                                          |

The release file retains the legacy marketing key for compatibility with
installed controllers, using the API digest for new releases. No marketing
container is built, pulled or started.

File bytes stay in a private S3-compatible bucket (see
[private file storage](../internals/file-storage.md)); email goes through
your SMTP server or Resend (see [Email](#email)). File storage, OAuth and AI
are optional.

## Telemetry and privacy

A self-hosted installation sends no telemetry to the Lictory project or anyone
else. Outbound connections happen only for what the operator configures:

| Setting                                       | Leaves the server                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `OPENAI_API_KEY`                              | Content sent to Lictory Intelligence (analysis, chat, transcription)    |
| `POSTHOG_PROJECT_TOKEN` + `POSTHOG_HOST`      | Product analytics: browser events via `/relay`, server events, job logs |
| `RESEND_*` or `SMTP_*`                        | Transactional and notification email                                    |
| `S3_*` or `R2_*`                              | Uploaded files                                                          |
| A project's delivery connection               | Published work items and status reads with that Jira site               |
| `GOOGLE_*`, `MICROSOFT_*`, `OAUTH_PROXY_*`    | Sign-in through those identity providers                                |
| `ACME_EMAIL`, `BACKUP_*`, alert and ping URLs | Certificate issuance, encrypted backups, alerts and monitoring pings    |

Uploaded documents are converted to text on the server; scanned PDFs are
rejected rather than sent to a hosted OCR service. zero-cache's anonymous usage
telemetry is disabled (`ZERO_ENABLE_TELEMETRY=false`), and zero-cache has no
route to the internet anyway.

**Analytics consent.** Without PostHog settings the app shows no consent banner,
stores no consent choice and loads no analytics code. With them,
`ANALYTICS_CONSENT` selects how analytics follow each visitor's choice:

- unset (default, the current behavior): PostHog loads before a choice in
  cookieless, anonymous mode and switches to full tracking after consent;
  server events are sent regardless of the browser choice.
- `strict`: nothing loads until the visitor grants Analytics consent, and
  server events are sent only for requests from a browser that granted it.
  Events without a request (background jobs) are not sent.

Which mode a deployment needs depends on its own privacy policy; the default is
the maintainer's choice and may change.

## Network boundaries

Only the proxy publishes ports (80 and 443). PostgreSQL, zero-cache and the
collaboration service are on an internal Docker network with no route to or
from the internet. The API,
worker and ops tooling also join an egress-only network for external
APIs (object storage, Resend or SMTP, OpenAI, Jira, PostHog, OAuth providers). The host firewall
allows SSH (rate limited), HTTP and HTTPS only. With an
[external database](external-database.md#configuration) there is no
PostgreSQL container: migrations, zero-cache and the collaboration service
join the egress network too and reach the database over TLS.

The proxy:

- sends `/zero/*` to zero-cache unchanged (Zero 1.11 serves the `/zero`
  prefix itself) and refuses WebSocket upgrades whose `Origin` is not the
  platform's public origin, `PLATFORM_URL` (default
  `https://<PUBLIC_APP_HOST or APP_HOST>`;
  cross-site WebSocket hijacking);
- sends `/collaboration` (live draft editing in Spaces) to the collaboration
  service unchanged, as a WebSocket without buffering or timeouts, with the
  same `Origin` rule as `/zero`; the service checks the origin and the
  session cookie itself as well;
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

Behind an existing reverse proxy or ingress, with an internal CA, or on plain
HTTP, see [existing reverse proxy, internal CA and plain HTTP](reverse-proxy.md).
Lictory needs its own host name; subpath hosting is not supported.

### Client addresses and authentication rate limits

The gateway overwrites `X-Forwarded-For` with one address from Caddy's
`{client_ip}` resolution before forwarding to the API. Better Auth 1.7.7 reads
that header by default but rejects multi-address chains without its own
trusted-proxy configuration. Keep the normalization at the gateway, which can
verify its direct peer; do not make auth trust raw `CF-Connecting-IP` or the
leftmost address of a forwarded chain.

On a standalone gateway, Caddy uses the connection's remote address. Behind
another edge (a load balancer, a CDN), set `CADDY_TRUSTED_PROXIES` to the space-separated
actual proxy IPs or CIDRs. Empty trusts no proxies. The gateway enables
`trusted_proxies_strict` to parse `X-Forwarded-For` from right to left.
Include every trusted hop in the forwarded chain, including
Cloudflare when it is present. The edge must overwrite the client address or
append its connecting peer; clients must not be able to reach the private API
directly. Avoid trusting all private ranges or arbitrary client headers. If
the edge is not trusted, all its users share the edge's address and rate limit.

After changing the edge topology, confirm that the gateway's `client_ip` is the
visitor's address and that separate clients have independent auth limits.

## Environments

Installations choose their own environments and layout. Keep separate
environments on separate databases, buckets, email domains, OAuth clients
and secrets; never copy a value between their `.env` files. An environment
is any name of lowercase letters, digits and hyphens (`production`, `staging`,
`qa`, `eu-prod`); `local`, `test` and `preview` are reserved by the migration
runner. Each name is its own Compose project (`lictory-<environment>`),
database and `.env`, and an environment exists on a server only once its
`.env` does, so a mistyped name is refused instead of created. Every
environment gets the same migration safeguards
([migrations](migrations.md)).

| Setting                  | Default        | Where                                                                       |
| ------------------------ | -------------- | --------------------------------------------------------------------------- |
| `LICTORY_ROOT`           | `/srv/lictory` | Environment of the scripts; `install.sh` writes it into the systemd units   |
| `DEPLOY_USER`            | `deploy`       | `install.sh` and `provision.sh`                                             |
| `LICTORY_ENVIRONMENTS`   | `production`   | `install.sh` and `provision.sh`: the environments hosted on this server     |
| `LICTORY_IMAGE_REGISTRY` | none (GHCR)    | Each `.env`: releases must be digests in it; `registry-login` uses its host |

With another root, the release key's forced command sets it:
`command="LICTORY_ROOT=/opt/lictory /opt/lictory/bin/lictory-remote",restrict …`
(`install.sh` prints the exact line).

Each server has `<root>/<environment>/` (`/srv/lictory/<environment>/` by default):

| Path                  | Contents                                                                            |
| --------------------- | ----------------------------------------------------------------------------------- |
| `.env`                | Secrets and settings (mode 0600, owner: the deploy user); template in `deploy/env/` |
| `releases/<version>/` | Image digests (`release.env`), the release's compose file and tooling               |
| `current`             | Symlink to the active release                                                       |
| `release-history.log` | Every activation                                                                    |
| `deploy.log`          | Deployment log                                                                      |

`<root>/bin` holds `deploy.sh`, `lictory-compose` (docker compose for an
environment), `lictory-remote` (the CI key's forced command), the backup,
monitor and restore-drill wrappers and the `lictory` operator command
(linked as `/usr/local/bin/lictory`; [self-hosting](self-hosting.md)). A
newly activated release installs its versions of these tools. The ops image
of every release carries this bundle, including `provision/` and the `.env`
templates, under `/opt/lictory/deploy`.

## Secrets and settings

`deploy/provision/new-environment.sh <environment>` creates `.env` from
`deploy/env/self-hosted.env.example` (or `LICTORY_ENV_TEMPLATE`) with generated database passwords, `BETTER_AUTH_SECRET`, `DELIVERY_CREDENTIALS_KEY`, `ZERO_API_KEY` and
`ZERO_ADMIN_PASSWORD`. Fill in the rest by hand. The API, the worker and the
migration runner validate their settings at startup and stop with every problem
listed (missing required values, placeholders, secrets shorter than 32 bytes);
see the [configuration reference](./configuration.md).

| Setting                                                    | Notes                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SITE_HOST`, `WWW_HOST`, `APP_HOST`, `ACME_EMAIL`          | Public hosts; certificates are issued automatically. `SITE_HOST` (the marketing site) is optional: without it, website links use `PLATFORM_URL`                                |
| `DELIVERY_CREDENTIALS_KEY`                                 | Never rotate once Jira connections exist; stored credentials become unreadable                                                                                                 |
| `R2_*` or `S3_*`                                           | Optional attachment bucket and object read/write credentials; one of the two, see file storage docs                                                                            |
| `RESEND_*` or `SMTP_*`                                     | A mail transport and sender ([Email](#email)); without one, email is disabled                                                                                                  |
| `BACKUP_*`                                                 | `BACKUP_TARGET` (`s3`, `local`, `rclone`, `none`) and its storage with its own credentials; `BACKUP_AGE_RECIPIENTS` is a public key ([recovery](recovery.md#where-backups-go)) |
| `ALERT_WEBHOOK_URL`, `MONITOR_PING_URL`, `BACKUP_PING_URL` | Alert webhook and dead-man's-switch pings                                                                                                                                      |
| `GOOGLE_*`, `MICROSOFT_*`, `OPENAI_API_KEY`, `POSTHOG_*`   | Optional                                                                                                                                                                       |
| `LEGAL_TERMS_URL`, `LEGAL_PRIVACY_URL`                     | The operator's own terms and privacy notice, linked at sign-up and from the consent banner; unset shows no acceptance notice and no legal links                                |
| `LICTORY_IMAGE_REGISTRY`, `LICTORY_RELEASE_CHANNEL`        | Releases must be digests in this registry and of this channel (`stable` by default for `production`, `nightly` otherwise)                                                      |

Each service receives only the variables it needs (see
`deploy/compose.production.yaml`). Secrets are visible to anyone who can run
Docker on the server, which is why only the administrator and `deploy` can log
in.

Images carry no domain or analytics settings, so the same image runs on any
hostname. The API writes the platform's public runtime configuration (the
website origin from `SITE_URL`, the legal links from `LEGAL_TERMS_URL`/
`LEGAL_PRIVACY_URL` and the browser analytics settings from
`POSTHOG_PROJECT_TOKEN`/`POSTHOG_HOST`) into each SPA document it serves; the
browser reads it there instead of from the bundle. Change `.env` and restart
the API to change them.

## Email

Sign-up requires email verification and invitations arrive by email. Without
a mail transport, production email is disabled: the API and worker start and
log a `config.warning` naming the settings to add, sending fails with the same
message, and password sign-up cannot be completed (single sign-on still
works). Production never falls back to a local mail server. A partial setting,
such as a transport without an explicit sender, stops the API and worker with
the problem listed. Each service logs the transport it uses (without
credentials) when it starts.

Resend is used when `RESEND_API_KEY` is set, with `RESEND_FROM_EMAIL` as sender
(a domain verified in Resend). Otherwise Lictory sends through any SMTP server:

| Setting                      | Meaning                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`                  | Server name; required in production without Resend                                                    |
| `SMTP_PORT`                  | `587` by default (submission with STARTTLS); `465` for TLS from the first byte; `25` for a relay      |
| `SMTP_SECURE`                | TLS from the first byte; defaults to `true` on port 465 and `false` elsewhere                         |
| `SMTP_REQUIRE_TLS`           | `true` refuses to send unless STARTTLS succeeds; recommended for any server reached over the internet |
| `SMTP_USER`, `SMTP_PASSWORD` | Authentication, when the server requires it                                                           |
| `SMTP_FROM`                  | Sender, for example `Lictory <no-reply@mail.example.com>`; required in production                     |

Message-IDs use the platform host (`PLATFORM_URL`). Configure SPF, DKIM and
DMARC for the sender's domain with your provider. Outside production, blank
settings fall back to Mailpit (`localhost:1025`).

## Database roles

With the bundled database, `deploy/postgres/10-lictory-roles.sh` creates the
roles on the first start and re-applies them before every migration. An
[external or managed database](external-database.md#roles) has the same roles
without a superuser: `lictory database setup` creates them once, and the
owning roles apply the grants before every migration.

| Role            | Used by                          | Privileges                                                                                 |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `lictory_owner` | `migrate`                        | Owns the application database and schema; DDL                                              |
| `lictory_app`   | `api`, `worker`, `collaboration` | DML on application tables (default privileges cover future tables); no DDL, no temp tables |
| `zero`          | `zero-cache`                     | Superuser with replication; owns `<db>_zero` (client view records and change log)          |
| `lictory_ops`   | backups, monitoring              | `pg_read_all_data`, `pg_monitor`                                                           |
| `postgres`      | operators via `docker exec`      | Bootstrap superuser, local socket only                                                     |

zero-cache needs a superuser because PostgreSQL only lets superusers create
event triggers, which Zero uses to replicate schema changes precisely. Without
them a migration that changes a replicated table halts replication and
`ZERO_AUTO_RESET` rebuilds every replica and client from scratch; other
migrations replicate normally ([degraded modes](external-database.md#degraded-modes)). The superuser credential exists only in the
zero-cache container on the internal network; the runtime API role cannot run
DDL. Zero's event triggers run as the role issuing DDL, so the role script
grants `lictory_owner` usage of `zero_0` and update on
`zero_0."publishedSchema"` (never membership in `zero`).

The cluster is initialised with the built-in `C.UTF-8` collation: code-point
ordering that matches Zero's replica and the browser, and indexes that survive
C library upgrades.

## Images

`Dockerfile` has one target per image; `deploy/docker-bake.hcl` builds all of
the API/worker, proxy, migration and operations images. Actions builds each
release natively on `linux/amd64` and `linux/arm64` runners and publishes one
multi-platform image per target, so any x86-64 or ARM server pulls the same
digests. Every target uses the selected checkout, so the API's
`index.html` and the proxy's assets come from the same SPA build. Tags are the
release version and `sha-<commit>-<channel>`; deployments always pin digests.
The images embed no public origins; only the marketing website, which is not
part of the release images, is built for one domain. Registry layer caches default to
`IMAGE_REGISTRY/lictory-cache`; set `IMAGE_CACHE_REGISTRY` to use another
namespace. Cache tags are isolated by image, release channel and architecture.
The marketing Docker target is excluded from releases: both public frontends
run on Cloudflare. The legacy `MARKETING_IMAGE` release-file key remains for
compatibility with installed server controllers and points to the API image
for new releases; no service starts or pulls it separately. Old release journals
and rollback targets retain their original marketing digest.
Dependency installation precedes copying application source; release versions
are stamped only in the browser/website build stages.

Release builds and exact-candidate verification run concurrently. The
platform SPA is built into the proxy and API images, so every installation
serves the client from its own gateway. The marketing website and the
documentation are not released with the product; they deploy from `main`. No
deployment skips verification, backup, migration or Zero catch-up.
See [release performance](development.md#release-performance) for measuring the
two-minute warm-run target and the cold-run limits.

Local build of all images for this machine:

```sh
REGISTRY=lictory-local VERSION=0.0.0 PLATFORMS=linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
  docker buildx bake -f deploy/docker-bake.hcl --load
```

The API image bundles the API, the worker and the collaboration service; only packages left external by the
bundles (`sharp`, `@firecrawl/anydoc`, `postgres` and any other bare import)
are installed for the target platform at the lockfile's versions.

## Provisioning a server

Use [`deploy/get.sh` and the `lictory` command](self-hosting.md): they check
the host, install the tooling below from a published release, ask for the
settings and pull releases from GitHub Releases. The manual equivalent:

Any Linux host with Docker Engine and the Docker Compose v2 plugin can run
Lictory; it also needs `bash`, `curl`, `jq`, `openssl` and `flock`
(util-linux). Choose the size and region your data and users require.

1. Install Docker Engine and Compose v2 the way your distribution or company
   does, and harden the host to your own standard.
2. Point DNS at it (below), copy `deploy/` to the server and run, as root,
   `LICTORY_ENVIRONMENTS="production" bash deploy/provision/install.sh`
   (with `LICTORY_ROOT` and `DEPLOY_USER` when the defaults do not fit). It
   creates the deploy user if needed (in the `docker` group, no sudo), the
   directory layout, the host tools and, where systemd runs, the backup and
   monitor timers. It changes nothing else. Re-running it is safe.
3. As the deploy user: `new-environment.sh <environment>` (with the same
   `LICTORY_ROOT`), then edit `.env`.
4. When release images are private, log the deploy user in to their registry
   (`<env> registry-login`, the host of `LICTORY_IMAGE_REGISTRY`).
5. Optional, for your own release automation over SSH: add its public key to
   the deploy user's `~/.ssh/authorized_keys` as
   `command="/srv/lictory/bin/lictory-remote",restrict ssh-ed25519 AAAA… release`.
   It can then only prepare, migrate, activate, backfill, roll back and report
   status of the environments configured on that server.

**Optional Ubuntu hardening.** On a fresh Ubuntu 24.04 server,
`deploy/provision/provision.sh` replaces steps 1 and 2: create the server with
`deploy/provision/cloud-init.yaml` (your SSH key), then run
`sudo ADMIN_USER=admin LICTORY_ENVIRONMENTS=production bash deploy/provision/provision.sh`.
It installs Docker from Docker's repository, automatic security updates (with
a 04:00 UTC reboot when required), the firewall, SSH hardening (only the
administrator and the deploy user may log in), fail2ban, swap and journald
limits, then runs `install.sh`. Re-running it is safe.

Releases are applied with `lictory upgrade`, or `deploy.sh <environment>
release < release.env` with the `release.env` of a published release.

DNS checklist: `A`/`AAAA` for your app host; a `CAA` record allowing
`letsencrypt.org` when certificates come from Let's Encrypt; keep existing
MX/SPF/DKIM/DMARC records for email. Lower TTLs to 300 s a day before moving
traffic.

## First launch

On an empty database a normal release does everything in order: the first
start of PostgreSQL creates the roles and databases, the migrate service
applies every migration (including the `lictory_zero` publication), zero-cache
performs its initial sync, then the proxy, API, worker and collaboration
service start.

```sh
sudo lictory install        # or, by hand, with a release file of digests:
/srv/lictory/bin/deploy.sh production release < release.env
/srv/lictory/bin/deploy.sh production status
```

Then sign in as the first instance administrator (created by `lictory
install`, or later with `lictory admin setup`) and verify an invitation and its
sign-up, email verification, password reset, organization creation in the
admin console, a revision/approval between two browsers (live updates through
Zero), attachment upload and download, a denied cross-organization request,
the first backup, and a restore drill ([recovery](recovery.md)).

## Deploying a release

`deploy.sh` (run by `lictory upgrade`, or by your own automation) runs three
steps:

1. **prepare**: validates the release file (known keys, digests in the
   configured registry, the environment's channel), stores it, pulls the
   images and installs the release's compose file. It resolves the proxy's
   environment through Compose and runs `caddy validate` and `caddy adapt`
   using that release's proxy image in a throwaway container with no network,
   published ports or production volumes. Invalid IPs/CIDRs, comma-separated
   trusted proxies and overrides of the server safeguards fail before any
   migration or service replacement. Empty trusted proxies remain valid for
   standalone deployments. Configuration and Caddy diagnostics are suppressed
   to keep environment values out of deployment logs. Nothing changes yet.
2. **migrate**: if migrations are pending, takes a pre-deploy backup,
   re-applies the database roles, runs the `migrate` one-shot (locked,
   transactional; see [migrations](migrations.md)), then waits until
   zero-cache has confirmed replication past the migration's WAL position.
3. **activate**: rolls zero-cache (if its image changed), the proxy (which
   carries the old and new assets), the API, the worker and the
   collaboration service, each waiting for its health check; verifies app
   liveness and the Zero and collaboration WebSocket upgrades through the
   private proxy; checks that every service
   runs exactly the release's image; then records the activation. If anything
   fails it restores the previous release's images. The proxy holds requests
   for up to 30 s while the API container is replaced, so API restarts drop
   no requests; replacing the proxy itself refuses connections for about two
   seconds (open WebSockets reconnect). Replacing the collaboration service
   pauses live draft editing for a few seconds: the old container closes its
   connections after the pending saves finish, editors keep unsaved changes
   in the browser and send them again when they reconnect.

This is Zero's expand order: database, then API, then the client the gateway
serves. The gateway retains the previous release's SPA assets for open tabs. Contract changes (drop or
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
chunk. Publish a fix as a new release; `lictory upgrade` only moves forward,
and `lictory rollback` returns to the previously activated release.

Proxy validation runs again before migrations and activation with the current
environment, including manual activation, rollback and automatic recovery to
the previous release. A validation failure blocks that operation before it
replaces any service. Keep `servers` blocks out of `CADDY_GLOBAL_OPTIONS`:
they can override the Caddyfile's strict trusted-proxy handling, protocols and
timeouts even when Caddy considers the configuration valid.

## Health and monitoring

| Check                       | Where                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| API liveness / readiness    | `GET /healthz`, `GET /readyz` (container health check uses `/readyz`)                                                     |
| zero-cache                  | `GET /keepalive` inside the network (health check, monitor)                                                               |
| Collaboration               | `GET /livez`, `GET /readyz` inside the network (health check uses `/readyz`: owner lock held, not shutting down)          |
| Worker, proxy               | Container health checks                                                                                                   |
| Active version and services | `deploy.sh <env> status [--json]`                                                                                         |
| Zero diagnostics            | `lictory-compose <env> exec zero-cache sh -c 'curl -su "admin:$ZERO_ADMIN_PASSWORD" localhost:4848/statz'` (never public) |

The `lictory-monitor@<env>.timer` systemd timer (installed by `install.sh`)
runs every five minutes and alerts on public route failures (the app's
`/readyz`, and the marketing site when `SITE_HOST` is set), disk usage
above 80 %, unhealthy or stopped containers, a lagging, lost or orphaned
replication slot, `pg_wal` above 6 GB, failed or stuck AI runs, failed or
overdue notification email, partial, failed or stuck delivery exports,
automatic cycles overdue by two hours, and a backup older than 30 hours
(not checked with `BACKUP_TARGET=none`). It checks only what is configured
and needs nothing but Docker, `bash` and `curl` on the host. It posts to `ALERT_WEBHOOK_URL` (Slack/Discord-compatible JSON) when the set of
problems changes, every six hours while it persists, and once on recovery, and
pings `MONITOR_PING_URL` (or `/fail`) so an external dead-man's switch notices
a server that stopped reporting; both are optional. Logs rotate at 5 × 20 MB
per container.

Existing monitoring can replace or complement it: point an uptime checker
(Uptime Kuma, Pingdom, a load balancer health check) at
`https://<app host>/readyz`, scrape container health with cAdvisor or the
Docker engine metrics endpoint, and use `postgres_exporter` with Prometheus for
replication slot lag and WAL size (the queries are in
`deploy/monitor/checks.sql`). Without the timers, run
`lictory-monitor <env>` from your scheduler or not at all.

## Background scheduling

The always-running `worker` owns platform scheduling; no public cron endpoint
or external recurring job is needed.

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
It remains bound to container loopback; read it from the server
(`lictory-compose <env> exec worker`), never through a public route.

## Scaling

Production runs one copy of each service. Whether a service can run as
several replicas depends on whether its state lives in PostgreSQL:

- **`api`: yes.** Sessions, authentication rate limits and domain state are in
  PostgreSQL. Each replica LISTENs for presence and inbox signals, so an
  `/api/events` stream on one replica receives events caused by writes on
  another. Streams end after four minutes and reconnect to any replica.
- **`worker`: yes.** Jobs claim work through the database: notification email
  with `FOR UPDATE SKIP LOCKED` plus a lease, chat runs with `SKIP LOCKED`,
  delivery exports with a fenced lease that the runner renews, AI runs with a
  lease taken under the organization lock, and automatic cycles under the
  organization lock. Each replica LISTENs on `lictory_work` and also polls.
  The delivery status refresh takes no claim: two replicas may read the same
  external items in one interval, which costs provider calls but changes no
  outcome.
- **`migrate`: one at a time.** A one-shot job. An advisory lock makes a second
  run wait and then fail without applying anything.
- **`zero-cache`: no.** One process holds the SQLite replica on its volume and
  the replication slot. Running more needs Zero's multi-node setup (a
  replication manager plus view syncers sharing a replica backup), which this
  deployment does not configure.
- **`collaboration`: no.** Editors of one draft must share one in-memory
  room, so exactly one instance serves an installation. It holds a
  session-level PostgreSQL advisory lock on its unpooled connection; a second
  copy waits up to 15 seconds (long enough for a replaced container to let
  go), then logs `collaboration.owner_busy` and exits without serving. If the
  lock's connection is lost the service stops and Docker restarts it. Saves
  are serialized in the database either way, so a misconfigured second copy
  could never corrupt a draft, only split its editors.
- **`postgres`: no.** The single primary is the source of truth. There are no
  read replicas.
- **`proxy`: no.** It is the only published entry point (ports 80 and 443) and
  keeps certificates and retained assets on its volumes.

Better Auth keeps its rate-limit counters in the `rate_limit` table, so the
limits hold across API replicas and restarts. The table is not in the
`lictory_zero` publication. Better Auth deletes rows older than the longest
window (one minute) when a counter's window resets, so the table only holds
recent clients and needs no scheduled cleanup. Rate limiting stays on in
production only, with Better Auth's default rules: 100 requests per 10 s on
any auth path, 3 per 10 s for sign-in, sign-up and changing the password or
email, and 3 per minute for password-reset and verification email. Each
counter is keyed by the client address in `X-Forwarded-For`. With several
replicas, the gateway's single-address normalization still applies:
[client addresses](#client-addresses-and-authentication-rate-limits). Without
it, every visitor shares one counter.

Each API replica opens up to 10 database connections plus one LISTEN
connection. Each worker replica opens `WORKER_DB_POOL_MAX` (4) plus one.
The collaboration service opens up to 10 plus its LISTEN and owner-lock
connections.
Before you add replicas, check the total against PostgreSQL's
`max_connections`. The gateway's and zero-cache's upstreams are the `api`
service name. Make sure each replica is reachable under that name and passes
its own `/readyz`. `deploy.sh` replaces one container per service, so scaled
replicas also need a rollout procedure, which this deployment does not have
yet.

## Verification and CI

Pull request CI runs the [test tiers](development.md#test-tiers) a change
needs; the full verification sequence runs locally
([development](development.md)).
Release workflows build and publish images on hosted runners; they hold no
database, server or deployment credential, since releases deploy nothing.

## Costs

The baseline is one server, a backup target, email, and optionally a files
bucket and AI. Review provider usage monthly: server size, storage and
operations, email volume and AI tokens. Keep paid upgrades manual.
