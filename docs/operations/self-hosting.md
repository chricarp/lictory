# Community self-hosting

The community distribution runs on **one machine**, with one application
instance, PostgreSQL and a job worker. It has no maintained HA, failover,
Kubernetes or horizontal-scaling configuration. There is no license restriction
on organization size or number of users. You operate and size the machine for
your workload; no workload capacity guarantee is implied.

All current product features are included. AI, analytics, OAuth and file uploads
are optional. To start, you need Docker Compose, a domain with HTTPS termination,
and an SMTP service or a verified Resend sender. Mailpit is for development,
not production. See [distribution](../internals/distribution.md).

## Configure your installation

Check out a reviewed release tag or commit and record it. Copy `.env.example`
to `.env` and keep it out of source control. For an alternative protected env file, use `--env-file /path/to/operator.env`
and set `LICTORY_ENV_FILE=/path/to/operator.env` so Compose also passes that
file to runtime services. Set the following values:

- `BETTER_AUTH_URL` to the canonical public HTTPS origin. The container build uses
  it for static metadata; rebuild when changing origin.
- `BETTER_AUTH_SECRET` to a persistent random secret (`openssl rand -base64 32`).
- `POSTGRES_PASSWORD` to a separate random **hex** value (`openssl rand -hex 32`).
  Add this variable to `.env`; hex is safe in the Compose database URL.
- `DELIVERY_CREDENTIALS_KEY` before storing external delivery credentials, following
  [the deployment runbook](deployment.md). Keep it stable through upgrades.
- `LICTORY_SOURCE_URL` to a publicly accessible HTTPS download or repository for
  the corresponding source of this exact build, including modifications and
  build instructions. Preserve license and third-party notices. `/source` links
  to it from the public footer and signed-in account menu. A private Git repo
  or a link to unmodified upstream does not supply a modified deployment's source.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and, when required, `SMTP_USER` and
  `SMTP_PASSWORD`. Use `SMTP_SECURE=true` for implicit TLS (typically 465), or
  `SMTP_REQUIRE_TLS=true` for required STARTTLS (typically 587). Alternatively
  set `RESEND_API_KEY` and your own verified `RESEND_FROM_EMAIL`.
- Your own `LICTORY_LEGAL_NAME`, address and contact email. Keep
  `LICTORY_LEGAL_TEMPLATE=self-hosted`; supply terms and privacy text for your
  installation as described in [legal notices](legal.md). Filling in a name does
  not make the bundled operator draft a complete legal notice.

Leave analytics, AI and OAuth credentials empty until you intentionally enable
those integrations. No shared upstream credentials or analytics token are
bundled. Register your own Google/Microsoft clients and callbacks when needed.
The Microsoft publisher association route uses your configured client ID and
returns 404 when no valid GUID is configured.

The Compose stack overrides runtime database URLs with its private PostgreSQL
service. It does not publish the database port. It binds the app to loopback
port 3000, so place your HTTPS reverse proxy on the same machine. Proxy SSE
streams without response buffering and allow reconnects. Forward requests to
`http://127.0.0.1:3000` and retain the public origin in `BETTER_AUTH_URL`.

## Build, migrate, start

```sh
docker compose -f compose.self-host.yaml build
docker compose -f compose.self-host.yaml up -d postgres
docker compose -f compose.self-host.yaml run --rm migrate
docker compose -f compose.self-host.yaml up -d app worker
```

Migrations are explicit and must succeed before starting a new application.
The migration service uses the existing locked runner against the database on
this machine. It never connects to the official cloud database. Do not run the
app or worker before initial migrations. All application containers run as the
unprivileged `bun` user.

Open the public origin, register and verify an account, then create an
organization and project. Check email verification, an anchored discussion,
a revision and a reviewer decision. Check that the worker logs successful job
runs. It advances cycles, resumes publishing, processes queued AI runs and sends
notification email; running only the web app does not perform these jobs.

## Optional private storage

For file uploads use a private R2 bucket, or select
`LICTORY_STORAGE_PROVIDER=s3` and configure `S3_BUCKET_NAME` and `S3_REGION`.
Leave `S3_ENDPOINT` empty for AWS. IAM credentials use the standard AWS chain;
otherwise set both `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. S3-compatible
services can use an HTTPS `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true`. Plain
HTTP endpoints are accepted only on loopback for local development.

The same endpoint must be accessible from the server and the browser, because
uploads and downloads are presigned. A Docker-only hostname is insufficient.
The provider must support conditional PUT (`If-None-Match: *`), HEAD and signed
GET requests. Configure exact-origin CORS and keep buckets private. See
[file storage](../internals/file-storage.md). Non-AWS providers are not declared
supported solely because they expose an S3-shaped API; verify an upload,
finalization, download and denied-access case with your chosen provider.

## Backups, restore and upgrades

Back up PostgreSQL, object storage and operator configuration, including
`BETTER_AUTH_SECRET` and `DELIVERY_CREDENTIALS_KEY`. Store backups encrypted
outside this machine and rehearse restoration in an isolated installation.
Changing encryption keys can make saved delivery credentials unreadable.

For a consistent database backup, pause the app and worker, then run:

```sh
docker compose -f compose.self-host.yaml stop app worker
docker compose -f compose.self-host.yaml exec -T postgres pg_dump -U lictory -Fc lictory > lictory.dump
docker compose -f compose.self-host.yaml up -d app worker
```

Check the dump command's exit status before treating it as a backup. Protect the
file as customer data. Restore to a fresh, isolated PostgreSQL database using
`pg_restore`, restore matching private objects and secrets, then check signup,
existing revisions, approvals and file access before routing traffic to it.

For an upgrade: read release notes and migration guidance, stop app and worker,
back up data, check out the selected source, update the source offer, build,
run the migration service, and start app and worker. Inspect logs and complete
a review workflow. Do not run old and new workers together during maintenance.
A code rollback may not be compatible with a migrated database; the migration
runner intentionally rejects altered history. Recovery may require a forward
fix or a matched data/configuration restore. Never delete migrations to force
an older checkout to run.

`docker compose -f compose.self-host.yaml down` preserves the database volume.
Adding `-v` deletes it. Keep [migration safety](migrations.md) and
[security reporting](../../SECURITY.md) in your operating procedures.
