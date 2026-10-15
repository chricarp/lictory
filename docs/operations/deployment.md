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

For social login on local development and trusted previews, see
[OAuth proxy setup](oauth-proxy.md). A dedicated shared proxy secret is optional;
the main authentication secrets remain separate. Prefer a staging callback
server when keeping separate production and development OAuth clients.

The realtime hub uses PostgreSQL LISTEN/NOTIFY and needs a direct connection.
Configure `DATABASE_URL` for pooled application queries and
`DATABASE_URL_UNPOOLED` for the direct TLS listener. Neon's Vercel
integration supplies both. Without the unpooled variable, the listener and
listener falls back to `DATABASE_URL`, which must then be direct. Migrations use
the separate `DATABASE_MIGRATION_URL`, which is never configured in Vercel. SSE streams
last four minutes, below their five-minute function limit, and reconnect;
synchronization recovery is authoritative even when presence/realtime is
temporarily unavailable.

Application queries use protocol-level prepared statements: each statement is
described once per connection, and queries issued together are pipelined in one
round trip. A pooler in front of `DATABASE_URL` must support them (PgBouncer 1.22
or later with `max_prepared_statements` above zero; Neon's pooler does). Keep the
application database in the same region as the functions (`fra1` with Neon's
`aws-eu-central-1`), and disable scale-to-zero on the production compute so
requests never wait for a cold database.

## Microsoft Entra sign-in

Set the server-only `MICROSOFT_CLIENT_ID` to
`674718cd-ca91-451c-84eb-02aa492d2b10` and `MICROSOFT_CLIENT_SECRET` in the
deployment's secret store. Both values are required to show Microsoft alongside
Google on sign-in, sign-up and Account settings. Keep secrets out of source
control; local development can use an ignored `.env.local`.

In the Entra application registration, add a **Web** redirect URI of
`https://lictory.com/api/auth/callback/microsoft` (and
`http://localhost:3000/api/auth/callback/microsoft` for local development).
`MICROSOFT_TENANT_ID` defaults to `common`; the app registration's supported
account types must allow the intended organizational and/or personal accounts.
For a single-tenant installation, set it to that tenant's ID.

Add the `email` optional claim to **ID tokens** in Entra Token configuration so
managed users supply a contact address. Lictory requires a real email for
verification and invitations; it does not substitute a username or a fabricated
mailbox. Microsoft email claims do not prove ownership: new accounts verify
through Lictory, and existing accounts connect Microsoft while signed in.
See [Better Auth's Microsoft setup](https://better-auth.com/docs/authentication/microsoft).

The public publisher-domain association is served without authentication at
`https://lictory.com/.well-known/microsoft-identity-association.json`. It contains
only the application ID and ships with the application; deploy it before
verifying `lictory.com` as the publisher domain in Entra.

## Verification and updates

`CI / Verify` runs on pull requests, main pushes and explicit releases. It uses PostgreSQL 17 and
Mailpit, frozen Bun dependencies, lint/types/format, committed migrations, all
domain tests, signup/verification/password-reset emails through Mailpit,
two-browser workflow tests against a production build. Production
credentials are never supplied to this workflow. Failure screenshots are retained
for seven days. Static checks, domain tests and four browser-test shards run as
parallel jobs; `Verify` passes only when all of them pass. Jobs time out and
superseded CI runs are canceled to limit minutes.

Action dependencies are pinned to verified release commits. Dependabot proposes
weekly Bun and Actions updates; review and merge them after CI passes. Do not
automatically merge changes to authentication, migrations or synchronization.

Keep Actions spending capped at zero and monitor included minutes. Hosted Linux
CI and the hourly job consume the private repository's included allowance.
Branch protection for a private personal repository may require GitHub Pro.
Once available, require `Verify` and `Conventional PR title`, prohibit force pushes and require PR review
when another maintainer joins. Keep the repository private.

Production deploys only through the manually dispatched **Release to Production**.
It selects a verified Nightly source, validates its provenance and semantic
version, runs CI on that source, builds with production settings without assigning
domains, applies migrations and then promotes the build. Git tag pushes cannot
activate production. Automatic Nightly releases create Preview deployments in
the same Vercel project, using its Preview settings without promotion or migrations.
`vercel.json` disables Vercel's Git deployments for `main`; previews of other
branches still deploy automatically.

See [versions and releases](releases.md) for PR-driven versions, automatic
nightlies, stable promotion, one-time configuration and hotfixes. Merging to
`main` does not deploy production.

## Migrations and recovery

See [database migrations](migrations.md) for the connection contract, developer
workflow, rollout order, expand/contract rules, data backfills and recovery.
Migrations never run from the application, Vercel builds or pull requests.

## Background jobs

Vercel Cron (configured in `vercel.json`) calls the authenticated endpoint
hourly on the production deployment, advancing cycles, resuming interrupted
delivery exports and sending queued notifications. Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set in
the Production environment; without it the endpoint stays disabled. Hourly
schedules require a Vercel Pro plan. The endpoint is idempotent, so overlapping
or retried runs are safe. Notification email can wait for the next run. Watch
the cron logs in the Vercel dashboard, where a run can also be triggered by hand.

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
