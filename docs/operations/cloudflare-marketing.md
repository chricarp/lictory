# Websites on Cloudflare

Cloudflare serves the marketing website as static HTML at `lictory.com` and
`www.lictory.com`, and the platform SPA at `app.lictory.com`. The API, job worker,
PostgreSQL and Zero run on the production VPS managed through Openship.

The marketing build uses Next.js static export. Its metadata, social images and
Markdown documents are generated at build time; no Next.js server or R2 cache is
needed. A small Cloudflare Worker preserves canonical redirects and Markdown
media types. `www` redirects permanently to the same path and query on the apex.
The platform uses Vite's static output with an SPA fallback. Its bundle carries
no installation settings: the Worker writes the platform's public runtime
configuration into each document, like the API does on a self-hosted server,
from `SITE_URL` in `apps/platform/wrangler.jsonc` and the `POSTHOG_PROJECT_TOKEN`,
`POSTHOG_HOST` and `ANALYTICS_CONSENT` variables the deployment passes with
`wrangler deploy --var`.

Both frontends forward their `/relay` requests to the backend. The platform also
forwards `/api` and `/zero`, including WebSocket upgrades and streaming responses.
Cookies stay on the public application origin. Internal `/api/zero` endpoints
remain hidden, and cross-origin Zero WebSocket handshakes are rejected.

## One-time setup

Set `BACKEND_ORIGIN=https://app.lictory.com` in both Wrangler files. The platform
uses a Cloudflare **Worker Route**, with a proxied `app` DNS record pointing to
the VPS. Its static assets come from Cloudflare; `/api`, `/zero` and `/relay`
fetch the HTTPS origin on that same hostname. Cloudflare routes same-zone
subrequests directly to the DNS-configured origin without invoking the Worker
again. A Worker Custom Domain has different fetch semantics and must not replace
this route. See [Cloudflare's route documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/).
Keep PostgreSQL and Zero private behind the gateway. No backend subdomain is
needed, and Zero's WebSocket endpoint remains under `app.lictory.com/zero`.

Verify `lictory-marketing` and `lictory-platform` through their provider URLs
before enabling the production Worker Routes. The marketing routes serve static
assets on the apex and `www`; `www` redirects to the apex. Point the proxied `app`
DNS record at the VPS and configure Openship's HTTPS edge for `app.lictory.com`.
Keep the old host available until both frontends and the backend are verified.
Preserve the existing email DNS records and the Openship dashboard domain.

In the protected GitHub environment **Production**, configure variable
`CLOUDFLARE_ACCOUNT_ID` and secret `CLOUDFLARE_API_TOKEN`. Grant only the deployment
permissions needed by these Workers. Never put the token in source or repository
variables. Configure `LICTORY_LEGAL_*` with the actual operator's legal notice and
optional public PostHog settings when enabling analytics.

## Backend gateway behind Openship

The existing migration controller remains responsible for schema changes,
replication catch-up and activation. Openship can adopt the running stack in
place for service visibility and provide saved jobs for its operations; a second
Compose deploy path must not bypass the controller's migration gate. The backend
Compose stack contains no marketing service; marketing and `www` never need a
Next.js server on the VPS. See [Openship production operations](deployment.md#openship-production-operations)
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

## Releases

**Release to Production** automatically calls **Deploy websites to Cloudflare**
after the VPS backend succeeds, using the same newly published stable release
tag. A single manual dispatch releases the backend and both websites in order.
The website workflow can also be manually dispatched from `main` with an
existing published stable release tag for recovery or compatible frontend
rollback. It refuses draft/prerelease tags and
source outside `main`, builds that exact source with production origins, then
deploys both frontends through the protected **Production** environment. Pushes
do not deploy either frontend. The selected tag must contain this configuration.

If the Cloudflare job fails in a combined release, use **Re-run failed jobs**;
the successful backend release is not repeated. If one frontend deploys
and the second fails, inspect the workflow log and retry the same selected tag;
do not assume both changed atomically. An earlier compatible stable tag can be
redeployed without rolling back the database.

Local marketing preview:

```sh
SITE_URL=https://lictory.com NEXT_PUBLIC_PLATFORM_URL=https://app.lictory.com \
  bun run --cwd apps/marketing build:cloudflare
bun run --cwd apps/marketing preview:cloudflare
```

Verify the home page, guides, comparison pages, legal pages, social images,
Markdown routes, legacy application redirects, query strings, the Microsoft
publisher association file and `www` redirects before switching DNS. Verify
platform sign-in, API errors, uploads, realtime reconnects and streaming through
the Cloudflare origin as well as directly on the backend.
