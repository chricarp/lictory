# Websites on Cloudflare

Cloudflare serves three frontends from the maintainer's account. Only the
platform SPA is part of the released product; the marketing website and the
documentation live in this repository but are never shipped to self-hosting
users and deploy on their own.

| Site      | Host                             | Source           | Worker              | Deploys                                                   |
| --------- | -------------------------------- | ---------------- | ------------------- | --------------------------------------------------------- |
| Marketing | `lictory.com`, `www.lictory.com` | `apps/marketing` | `lictory-marketing` | `deploy-marketing.yml`: pushes to `main`, stable releases |
| Docs      | `docs.lictory.com`               | `apps/docs`      | `lictory-docs`      | `deploy-docs.yml`: pushes to `main`, stable releases      |
| Platform  | `app.lictory.com`                | `apps/platform`  | `lictory-platform`  | `deploy-platform.yml`: only with a stable release         |

The API, job worker, PostgreSQL and Zero run on the production VPS managed
through Openship.

All three Workers run `deploy/cloudflare/src/worker.ts` with a different
`SITE_KIND`, so security headers (HSTS, `nosniff`, referrer policy, framing)
and immutable caching of hashed assets are defined once:

- **Marketing** is a Next.js static export. Metadata, social images and
  Markdown documents are generated at build time. The Worker keeps canonical
  redirects (`www` to the apex with path and query, legacy application pages
  to `app.lictory.com`), Markdown media types, and forwards `/relay` to the
  backend for analytics.
- **Docs** is a Fumadocs static export. Search downloads a prebuilt index
  (`/search.json`) and runs in the browser. The Worker only serves files and
  headers: no redirects, no backend, no analytics.
- **Platform** is Vite's static output with an SPA fallback. Its bundle carries
  no installation settings: the Worker writes the public runtime configuration
  into each document, like the API does on a self-hosted server, from
  `SITE_URL` in `apps/platform/wrangler.jsonc` and the `POSTHOG_PROJECT_TOKEN`,
  `POSTHOG_HOST` and `ANALYTICS_CONSENT` variables passed with
  `wrangler deploy --var`. It forwards `/api`, `/zero` and `/relay` (including
  WebSocket upgrades and streaming responses) to the backend; internal
  `/api/zero` endpoints stay hidden and cross-origin Zero WebSocket handshakes
  are rejected. Cookies stay on the public application origin.

## GitHub configuration

Two environments separate the credentials:

**`websites`** (marketing and docs). Deployment branches: `main` only (a
custom branch policy, no tags). No required reviewer: every push to `main`
deploys. It holds:

| Setting                                           | Value                                                          |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Secret `CLOUDFLARE_API_TOKEN`                     | The websites token below                                       |
| Variable `CLOUDFLARE_ACCOUNT_ID`                  | The Cloudflare account ID                                      |
| Variables `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST` | Optional marketing analytics; empty disables them              |
| Variable `ANALYTICS_CONSENT`                      | Optional consent mode for marketing analytics                  |
| Variables `LICTORY_LEGAL_*`                       | The operator's legal notice ([public legal notices](legal.md)) |

All variables are public build inputs compiled into pages; only the token is
secret.

**`Production`** keeps the platform SPA's `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` next to the backend release settings
([releases](releases.md#one-time-github-and-server-configuration)), with its
required reviewers.

### Cloudflare API tokens

Create one token per environment in **My Profile → API Tokens → Create
Token → Custom token**, never a Global API Key:

- **Websites token** (`websites`): permissions _Account → Workers Scripts →
  Edit_ on the Lictory account and _Zone → Workers Routes → Edit_ on the
  `lictory.com` zone. Cloudflare cannot narrow a token to individual scripts:
  keep the account free of unrelated Workers, or move the websites to their own
  account, so the token can change only `lictory-marketing` and
  `lictory-docs`. If Wrangler reports a missing permission, add only that
  one. Set an expiry and keep a reminder to rotate it.
- **Platform token** (`Production`): the same permissions, used only by
  `deploy-platform.yml`.

Rotate a token by creating the replacement, updating the environment secret,
running the workflow once, then revoking the old token.

### How the workflows protect the token

- Every job requires `github.repository == 'chricarp/lictory'`, so forks never
  attempt a deployment, and refuses refs other than `main`.
- Triggers are `push` to `main` (path-filtered to the site, `packages/ui`, the
  shared Worker, `bun.lock` and the root `package.json`), `workflow_dispatch`
  and `repository_dispatch` `stable-published` (sent by the release automation
  after a stable publication). There is no `pull_request_target` and no
  preview deployment: pull requests only build the sites (`bun run check`, the
  browser suite).
- `permissions: contents: read`, `persist-credentials: false`, actions pinned
  by commit SHA. Build steps get no secret; only the final `wrangler deploy`
  step receives `CLOUDFLARE_API_TOKEN`. Wrangler metrics and Next.js telemetry
  are off.
- One concurrency group per site; a newer commit waits for a running deploy
  instead of cancelling it.
- **Workflow lint** runs actionlint and zizmor on every workflow change; the
  release guardrail tests assert these properties.

## One-time Cloudflare setup

Set `BACKEND_ORIGIN=https://app.lictory.com` in the marketing and platform
Wrangler files. The platform uses a Cloudflare **Worker Route**, with a proxied
`app` DNS record pointing to the VPS. Its static assets come from Cloudflare;
`/api`, `/zero` and `/relay` fetch the HTTPS origin on that same hostname.
Cloudflare routes same-zone subrequests directly to the DNS-configured origin
without invoking the Worker again. A Worker Custom Domain has different fetch
semantics and must not replace this route. See
[Cloudflare's route documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/).
Keep PostgreSQL and Zero private behind the gateway. No backend subdomain is
needed, and Zero's WebSocket endpoint remains under `app.lictory.com/zero`.

Verify each Worker through its provider URL before enabling its production
route. The marketing routes serve static assets on the apex and `www`; `www`
redirects to the apex. Point the proxied `app` DNS record at the VPS and
configure Openship's HTTPS edge for `app.lictory.com`. Preserve the existing
email DNS records and the Openship dashboard domain.

**DNS for the documentation.** The `lictory-docs` Worker Route
`docs.lictory.com/*` needs a proxied DNS record for `docs` so requests reach
Cloudflare: an `AAAA` record `docs` → `100::` (the reserved discard address,
proxied). No origin exists behind it; the Worker answers everything. Deploy
`lictory-docs` once before creating the record, and check
`https://docs.lictory.com/` and `/search.json` afterwards.

## Deploying

- **Marketing and docs**: merging a change under their paths to `main`
  deploys that site. Each stable release (the `stable-published` dispatch)
  rebuilds both; marketing stamps the released version, and a push or manual
  run stamps the latest published stable GitHub Release. **Actions → Deploy
  marketing website / Deploy documentation → Run workflow** on `main`
  redeploys the current `main`.
- **Platform**: **Release to Production** prepares the SPA in parallel with the
  backend images and deploys it after the backend is healthy, from the same
  published stable tag. A backend failure skips it. If only the platform job
  fails, use **Re-run failed jobs**; do not rerun all jobs. **Deploy platform
  SPA to Cloudflare** can also be dispatched from `main` with an existing
  published stable tag for recovery or a compatible frontend rollback. It
  refuses draft/prerelease tags and source outside `main`.

## Rollback

Marketing and docs keep no release artifacts; Cloudflare keeps their
versions. With a token that may deploy the Worker:

```sh
cd apps/docs   # or apps/marketing
bunx wrangler deployments list
bunx wrangler rollback <version-id> --message "Restore the previous docs"
```

A rollback is temporary: the next push to `main` deploys again. Revert the
change on `main` to make it permanent. To roll the platform back, dispatch
**Deploy platform SPA to Cloudflare** with an earlier compatible stable tag;
the database is not rolled back.

## Local preview

```sh
SITE_URL=https://lictory.com NEXT_PUBLIC_PLATFORM_URL=https://app.lictory.com \
  bun run --cwd apps/marketing build:cloudflare
bun run --cwd apps/marketing preview:cloudflare   # http://localhost:8787

SITE_URL=https://docs.lictory.com bun run --cwd apps/docs build:cloudflare
bun run --cwd apps/docs preview:cloudflare        # http://localhost:8788
```

For marketing, verify the home page, guides, comparison pages, legal pages,
social images, Markdown routes, legacy application redirects, query strings,
the Microsoft publisher association file and `www` redirects before switching
DNS. For docs, verify navigation, search, both themes and the 404 page. Verify
platform sign-in, API errors, uploads, realtime reconnects and streaming
through the Cloudflare origin as well as directly on the backend.

## Backend gateway behind Openship

The existing migration controller remains responsible for schema changes,
replication catch-up and activation. Openship can adopt the running stack in
place for service visibility and provide saved jobs for its operations; a second
Compose deploy path must not bypass the controller's migration gate. The backend
Compose stack contains no website service; the websites never need a Next.js
server on the VPS. See [Openship production operations](deployment.md#openship-production-operations)
for service logs, scheduler status and saved recovery jobs.

When Openship owns public ports 80/443, configure the Compose environment with
`APP_HOST=app.lictory.com`, `PUBLIC_APP_HOST=app.lictory.com`,
`PROXY_SCHEME=http`, `HTTP_PORT=8080`,
`HTTP_BINDING=127.0.0.1:8080:80` and
`HTTPS_BINDING=127.0.0.1:8443:443`. Publish the backend gateway through Openship's
HTTPS edge to the loopback HTTP listener. HTTP is confined to the same machine;
Cloudflare's backend origin must use HTTPS. Preserve WebSocket upgrades and
unbuffered event streams through both proxies. PostgreSQL and Zero publish no
host ports. The runtime authentication origin remains the public SPA origin.
