# Websites on Cloudflare

Cloudflare serves two static websites from the maintainer's account. Lictory
itself is distributed only for self-hosting ([self-hosting](self-hosting.md)):
there is no hosted application, and `app.lictory.com` serves nothing. The
marketing website and the documentation live in this repository but are never
shipped to self-hosting users. They deploy from the **Release** workflow,
each only when its sources changed ([releases](releases.md#release)).

| Site      | Host                             | Source           | Worker              | Deploys                                                             |
| --------- | -------------------------------- | ---------------- | ------------------- | ------------------------------------------------------------------- |
| Marketing | `lictory.com`, `www.lictory.com` | `apps/marketing` | `lictory-marketing` | `deploy-marketing.yml`: from Release when changed or a stable ships |
| Docs      | `docs.lictory.com`               | `apps/docs`      | `lictory-docs`      | `deploy-docs.yml`: from Release when changed                        |

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
  (`/search.json`) and runs in the browser. The Worker serves files and
  headers, the Markdown versions of the pages, and relays `/relay` to PostHog
  like marketing; there is no backend. Its analytics use the same consent
  model and the same PostHog project, with a `site: "docs"` super property.

### Search engines and AI assistants

Each page has exactly one public URL: the apex host, no trailing slash, no
`.html`, no `/index`. Cloudflare's asset server would answer the other forms
with temporary (307) redirects; the Worker answers them first with a single
permanent (301) redirect to the canonical URL, which is also the page's
`<link rel="canonical">` and its sitemap entry. Next.js exports the not-found
page as `/404` and `/_not-found`; the Worker answers both with status 404, so
search engines never see a noindexed page with status 200. The exported React
Server Components payloads (`*.txt` other than `robots.txt`, `llms.txt` and
`llms-full.txt`) are fetched by the router and carry `X-Robots-Tag: noindex`.

Both sites publish `robots.txt`, `sitemap.xml`, `llms.txt` and
`llms-full.txt`. Markdown versions live at the page URL with `.md` appended:
every documentation page (the home page at `/index.md`), and the marketing
guides, comparisons, alternatives and roundups (not its landing or legal
pages).
`robots.txt` allows every crawler, AI assistants and AI training crawlers
included; blocking one is a single rule in `apps/*/src/app/robots.ts`.

After every static build, `scripts/check-site-indexing.ts` reads the export
the way a crawler does and fails the build when a sitemap page is noindexed,
lacks a self-referencing canonical, repeats another page's title or
description, or when an exported page is missing from the sitemap.

## GitHub configuration

**`websites`** (marketing and docs). Deployment branches: `main` only (a
custom branch policy, no tags). Add required reviewers to approve each
website deployment if you want a second gate after the release-manager check.
It holds:

| Setting                                           | Value                                                          |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Secret `CLOUDFLARE_API_TOKEN`                     | The websites token below                                       |
| Variable `CLOUDFLARE_ACCOUNT_ID`                  | The Cloudflare account ID                                      |
| Variables `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST` | Optional website analytics; empty disables them                |
| Variable `ANALYTICS_CONSENT`                      | Optional consent mode for website analytics                    |
| Variables `LICTORY_LEGAL_*`                       | The operator's legal notice ([public legal notices](legal.md)) |

All variables are public build inputs compiled into pages or Worker
variables; only the token is secret. Nothing else in GitHub holds a
Cloudflare credential.

### Cloudflare API tokens

Create it in **My Profile → API Tokens → Create Token → Custom token**,
never a Global API Key:

- **Websites token** (`websites`): permissions _Account → Workers Scripts →
  Edit_ on the Lictory account and _Zone → Workers Routes → Edit_ on the
  `lictory.com` zone. Cloudflare cannot narrow a token to individual scripts:
  keep the account free of unrelated Workers, or move the websites to their own
  account, so the token can change only `lictory-marketing` and
  `lictory-docs`. If Wrangler reports a missing permission, add only that
  one. Set an expiry and keep a reminder to rotate it.

Rotate a token by creating the replacement, updating the environment secret,
running the workflow once, then revoking the old token.

### How the workflows protect the token

- Every job requires `github.repository == 'chricarp/lictory'`, so forks never
  attempt a deployment, and refuses refs other than `main`.
- Triggers are `workflow_call` (from **Release**) and `workflow_dispatch`.
  Either way the first step after checkout requires a release manager
  ([who can release](releases.md#who-can-release)). There is no `push`
  trigger, no `pull_request_target` and no preview deployment: pull requests
  only build the sites (`bun run check`, the browser suite).
- **Release** calls the site workflows with `secrets: inherit`. GitHub
  resolves an environment secret in a called workflow only when the caller
  passes secrets; without it the `websites` token is empty on `workflow_call`
  while `workflow_dispatch` still works. Release itself names no secret.
- `contents: read` plus `deployments: write` for the site's own journal,
  `persist-credentials: false`, actions pinned by commit SHA. Build steps get
  no secret; only the `wrangler deploy` step receives `CLOUDFLARE_API_TOKEN`.
  A last step records the deployed commit (`marketing-site` / `docs-site`)
  so the next Release deploys a site only when it changed. Wrangler metrics and Next.js telemetry
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

- **Release** (**Actions → Release → Run workflow** on `main`) deploys each
  site whose sources changed since its recorded deployment: the site itself,
  `packages/ui`, the shared Worker, `bun.lock`, the root `package.json` and its
  workflow (marketing also `packages/core/src/lib`, and whenever a stable
  release ships, to show its version). `redeploy_websites` deploys both
  anyway. Sites deploy only after the platform release succeeded or was not
  needed.
- **Deploy marketing website / Deploy documentation → Run workflow** on `main`
  redeploys one site from the current `main`, for a release manager. Marketing
  stamps the latest published stable release.

## Rollback

Marketing and docs keep no release artifacts; Cloudflare keeps their
versions. With a token that may deploy the Worker:

```sh
cd apps/docs   # or apps/marketing
bunx wrangler deployments list
bunx wrangler rollback <version-id> --message "Restore the previous docs"
```

A rollback lasts until the next deployment of that site. Revert the change on
`main` to make it permanent.

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
For both, check status codes with `curl -sI`: pages 200, `/404` and missing
pages 404, `/page/` and `/page.html` a 301 to `/page`.

After a deployment that changes URLs or indexing, open the site's **Indexing →
Pages** report in Google Search Console, compare the "Excluded by 'noindex'
tag" URLs with the intentional ones above, choose **Validate fix** on resolved
issues, and resubmit `sitemap.xml` under **Sitemaps** when its URLs changed.
