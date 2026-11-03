# Websites on Cloudflare

Cloudflare serves two static websites from the maintainer's account. Lictory
itself is distributed only for self-hosting ([self-hosting](self-hosting.md)):
there is no hosted application, and `app.lictory.com` serves nothing. The
marketing website and the documentation live in this repository but are never
shipped to self-hosting users and deploy on their own.

| Site      | Host                             | Source           | Worker              | Deploys                                                   |
| --------- | -------------------------------- | ---------------- | ------------------- | --------------------------------------------------------- |
| Marketing | `lictory.com`, `www.lictory.com` | `apps/marketing` | `lictory-marketing` | `deploy-marketing.yml`: pushes to `main`, stable releases |
| Docs      | `docs.lictory.com`               | `apps/docs`      | `lictory-docs`      | `deploy-docs.yml`: pushes to `main`, stable releases      |

Both Workers run `deploy/cloudflare/src/worker.ts` with a different
`SITE_KIND`, so security headers (HSTS, `nosniff`, referrer policy, framing)
and immutable caching of hashed assets are defined once:

- **Marketing** is a Next.js static export. Metadata, social images and
  Markdown documents are generated at build time. Its calls to action lead to
  the documentation's installation page and the GitHub repository. The Worker
  keeps canonical redirects (`www` to the apex with path and query, `/home` to
  `/`) and Markdown media types, and relays `/relay` straight to PostHog for
  the website's analytics ([first-party relay](../internals/analytics.md#first-party-relay)).
  The relay reads the `POSTHOG_HOST` Worker variable, passed with
  `wrangler deploy --var`; without it `/relay` answers 404 and nothing leaves.
  Former application paths (`/app/...`, `/sign-in`, `/sign-up` and the other
  account pages) are not redirected; they are ordinary missing pages.
- **Docs** is a Fumadocs static export. Search downloads a prebuilt index
  (`/search.json`) and runs in the browser. The Worker only serves files and
  headers: no redirects, no backend, no analytics.

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

Verify each Worker through its provider URL before enabling its production
route. The marketing routes serve static assets on the apex and `www`; `www`
redirects to the apex. Preserve the existing email DNS records.

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
SITE_URL=https://lictory.com bun run --cwd apps/marketing build:cloudflare
bun run --cwd apps/marketing preview:cloudflare   # http://localhost:8787

SITE_URL=https://docs.lictory.com bun run --cwd apps/docs build:cloudflare
bun run --cwd apps/docs preview:cloudflare        # http://localhost:8788
```

For marketing, verify the home page and its calls to action, guides,
comparison pages, legal pages, social images, Markdown routes, query strings,
the Microsoft publisher association file and `www` redirects before switching
DNS (add `--var POSTHOG_HOST:<host>` to the preview to exercise the analytics
relay). For docs, verify navigation, search, both themes and the 404 page.
