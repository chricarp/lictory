# Deployment and operations

The minimum hosted stack is Vercel, managed PostgreSQL, Resend and private
Cloudflare R2. OAuth is optional; verified email/password authentication works
without Google or Microsoft credentials. No AI provider is required.

## Environment boundaries

Production and previews must use separate databases, storage buckets, email
credentials and authentication secrets. Never expose production credentials to
pull-request builds. Keep the local Docker database and Mailpit for development.
Until an isolated preview stack exists, a failing preview is safer than connecting
unreviewed code to production data.

Production requires `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`,
`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Configure `CRON_SECRET` to enable
scheduled work. Use a stable `DELIVERY_CREDENTIALS_KEY` before storing Jira
credentials; rotating it makes existing encrypted tokens unreadable. These are
server-only variables and must never use the `NEXT_PUBLIC_` prefix.

`BETTER_AUTH_URL` must be the canonical HTTPS origin. Redirect other domains to
that origin and register OAuth callbacks against it. R2 public access stays
disabled; configure upload CORS for exact supported origins. Do not use wildcard
CORS to make arbitrary preview deployments work.

The realtime hub uses PostgreSQL LISTEN/NOTIFY and needs a direct connection.
Configure `DATABASE_URL` for pooled application queries and
`DATABASE_URL_UNPOOLED` for the direct TLS listener and migrations. Neon's Vercel
integration supplies both. Without the unpooled variable, the listener and
migrations fall back to `DATABASE_URL`, which must then be direct. SSE streams
must stay below the host's function duration limit and reconnect; synchronization
recovery is authoritative even when presence/realtime is temporarily unavailable.

## Verification and updates

`CI / Verify` runs on pull requests and main pushes. It uses PostgreSQL 17 and
Mailpit, frozen Bun dependencies, lint/types/format, committed migrations, all
domain tests, signup/verification/password-reset emails through Mailpit,
two-browser workflow tests against a production build. Production
credentials are never supplied to this workflow. Failure screenshots are retained
for seven days. Jobs time out and superseded CI runs are canceled to limit minutes.

Action dependencies are pinned to verified release commits. Dependabot proposes
weekly Bun and Actions updates; review and merge them after CI passes. Do not
automatically merge changes to authentication, migrations or synchronization.

Keep Actions spending capped at zero and monitor included minutes. Hosted Linux
CI and the hourly job consume the private repository's included allowance.
Branch protection for a private personal repository may require GitHub Pro.
Once available, require `Verify`, prohibit force pushes and require PR review
when another maintainer joins. Keep the repository private.

Vercel's Git integration deploys independently of GitHub CI. A passing local
check or a green CI run does not by itself prevent an earlier automatic
deployment. Until deployment checks are enforced, use reviewed main changes and
verify CI before treating a release as usable.

## Migrations and recovery

Create a GitHub environment named `production`, restrict it to main where the
account supports that control, and store the direct database URL as its
`DATABASE_URL` secret. The manual **Production migrations** workflow runs only
from main after entering `migrate-production`. It applies committed SQL; it never
uses `db:push` and never runs from a pull request. Its concurrency group prevents
two workflow migrations from running simultaneously.

Before running it, review SQL and confirm a provider recovery point or encrypted
backup. Test restoration into an isolated database before storing important user
data. Never upload raw production dumps as Actions artifacts. Prefer additive
migrations: apply a compatible schema change, deploy the application, then remove
obsolete schema in a separate reviewed change. An application rollback does not
roll back a database migration. The first deployment also needs migrations.

## Background jobs

Create the separate GitHub environment `production-jobs`. Set its `APP_ORIGIN`
variable to the canonical origin and its `CRON_SECRET` secret to the same value
configured in Vercel Production. This environment must permit unattended
scheduled runs; keep migration approvals on `production` separately.

**Scheduled production jobs** calls the authenticated endpoint hourly, advancing
cycles, resuming interrupted delivery exports and sending queued notifications.
Missing configuration leaves it disabled. Runs are serialized, have bounded
timeouts and retry transient HTTP failures. The endpoint is idempotent. GitHub
schedules can be delayed, so hourly dispatch is not a delivery-time guarantee.
This also means notification email can wait for the next run. Watch failed runs
and Vercel job logs; increasing cadence consumes more Actions minutes.

Do not disable Vercel deployment protection to make the job work. If the
production URL is protected, configure a narrowly scoped automation mechanism
before enabling it. Monitor scheduler execution; an unconfigured successful
workflow means the job was skipped, not that production work ran.

## Costs and release checks

Free plans have usage and retention limits. Vercel Hobby is restricted to personal,
non-commercial use. Cloudflare R2 can charge for usage above its free allowance;
an existing billing account is not a hard zero-cost cap. Review storage/operations,
email volume, database compute/storage and GitHub minutes regularly. Keep paid
features and automatic paid upgrades disabled where the provider supports it.

Before a real release, verify signup and verification email, password reset,
organization creation, review/revision/approval synchronization between two users,
private attachment upload/download, denied cross-organization access, scheduled
job authorization and an actual recovery procedure. A successful build is not
proof that connected services work.
