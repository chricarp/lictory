# Websites on Cloudflare

Cloudflare serves the marketing website as static HTML at `lictory.com` and
`www.lictory.com`, and the platform SPA at `app.lictory.com`. The API, job worker,
PostgreSQL and Zero run on the production VPS managed through Openship.

The marketing build uses Next.js static export. Its metadata, social images and
Markdown documents are generated at build time; no Next.js server or R2 cache is
needed. A small Cloudflare Worker preserves canonical redirects and Markdown
media types. `www` redirects permanently to the same path and query on the apex.
The platform uses Vite's static output with an SPA fallback.

Both frontends forward their `/relay` requests to the backend. The platform also
forwards `/api` and `/zero`, including WebSocket upgrades and streaming responses.
Cookies stay on the public application origin. Internal `/api/zero` endpoints
remain hidden, and cross-origin Zero WebSocket handshakes are rejected.

## One-time setup

Configure `BACKEND_ORIGIN` in both Wrangler files with the HTTPS backend gateway
served through Openship. Keep PostgreSQL and Zero private; the gateway routes
requests to them as defined in the backend deployment. Do not point the backend
origin at either frontend, which would create a proxy loop.

Deploy `lictory-marketing` and `lictory-platform` and verify their provider URLs
before adding custom domains. Adding custom domains changes production DNS;
keep the old host available until both frontends and the backend are verified.
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
Compose deploy path must not bypass the controller's migration gate.

When Openship owns public ports 80/443, configure the Compose environment with
`APP_HOST=backend.lictory.com`, `PUBLIC_APP_HOST=app.lictory.com`,
`PROXY_SCHEME=http`, `HTTP_PORT=8080`,
`HTTP_BINDING=127.0.0.1:8080:80` and
`HTTPS_BINDING=127.0.0.1:8443:443`. Publish the backend gateway through Openship's
HTTPS edge to the loopback HTTP listener. HTTP is confined to the same machine;
Cloudflare's backend origin must use HTTPS. Preserve WebSocket upgrades and
unbuffered event streams through both proxies. PostgreSQL and Zero publish no
host ports. The runtime authentication origin remains the public SPA origin.

## Releases

**Deploy websites to Cloudflare** is manually dispatched from `main` with an
existing published stable release tag. It refuses draft/prerelease tags and
source outside `main`, builds that exact source with production origins, then
deploys both frontends through the protected **Production** environment. Pushes
do not deploy either frontend. The selected tag must contain this configuration.

Deploy the compatible backend before these frontends. If one frontend deploys
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
