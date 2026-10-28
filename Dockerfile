# syntax=docker/dockerfile:1.12
# check=skip=SecretsUsedInArgOrEnv
#
# Production images for the single-server Docker Compose deployment
# (docs/operations/deployment.md). Build every target together with
# deploy/docker-bake.hcl so the API document handler and the proxy share one
# SPA build:
#
#   docker buildx bake -f deploy/docker-bake.hcl --push
#
# JavaScript is built once on the build machine's platform; only the runtime
# stages run on the target platform (linux/amd64 and linux/arm64), where native
# packages (sharp, @firecrawl/anydoc) are installed for that architecture.

ARG NODE_IMAGE=node:24.22-trixie-slim
ARG BUN_IMAGE=oven/bun:1.4.2-slim
ARG CADDY_IMAGE=caddy:2.11-alpine
ARG POSTGRES_IMAGE=postgres:17-alpine
# The proxy keeps the previous release's hashed assets so open tabs can still
# lazy-load their chunks during and after a deploy. Release automation passes
# the currently deployed proxy image; the default carries no assets.
ARG PREVIOUS_PROXY_IMAGE=no-previous-assets

FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS bun

# ---------------------------------------------------------------- build stages
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 CI=1
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM source AS platform-build
ARG APP_VERSION
ARG VITE_SITE_URL
ARG VITE_POSTHOG_PROJECT_TOKEN=""
ARG VITE_POSTHOG_HOST=""
RUN test -n "$APP_VERSION" && test -n "$VITE_SITE_URL"
ENV VITE_APP_VERSION=$APP_VERSION \
    VITE_SITE_URL=$VITE_SITE_URL \
    VITE_POSTHOG_PROJECT_TOKEN=$VITE_POSTHOG_PROJECT_TOKEN \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
RUN bun run --filter @lictory/platform build \
 && test -f apps/platform/dist/index.html

FROM source AS server-build
RUN bun run --filter @lictory/api build \
 && bun run --filter @lictory/worker build \
 && test -f apps/api/dist/index.js && test -f apps/worker/dist/index.js \
 && mkdir -p /manifests \
 && cp package.json bun.lock bunfig.toml /manifests/ \
 && for manifest in apps/*/package.json packages/*/package.json; do \
      mkdir -p "/manifests/$(dirname "$manifest")"; \
      cp "$manifest" "/manifests/$manifest"; \
    done

FROM source AS migrate-build
# One self-contained file: the locked, transactional runner and its safety
# rules, plus every reviewed backfill of this commit (scripts/backfills).
RUN bun build scripts/migrate.ts --target=node --format=esm \
      --outfile=/out/migrate.mjs \
 && mkdir -p /out/backfills \
 && for script in scripts/backfills/*.ts; do \
      [ -e "$script" ] || continue; \
      bun build "$script" --target=node --format=esm \
        --outfile="/out/backfills/$(basename "$script" .ts).mjs"; \
    done

FROM source AS marketing-build
ARG APP_VERSION
ARG SITE_URL
ARG NEXT_PUBLIC_PLATFORM_URL
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ARG LICTORY_LEGAL_NAME=""
ARG LICTORY_LEGAL_ADDRESS=""
ARG LICTORY_LEGAL_EMAIL=""
ARG LICTORY_LEGAL_REGISTRATION=""
RUN test -n "$SITE_URL" && test -n "$NEXT_PUBLIC_PLATFORM_URL"
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    SITE_URL=$SITE_URL \
    NEXT_PUBLIC_PLATFORM_URL=$NEXT_PUBLIC_PLATFORM_URL \
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    LICTORY_LEGAL_NAME=$LICTORY_LEGAL_NAME \
    LICTORY_LEGAL_ADDRESS=$LICTORY_LEGAL_ADDRESS \
    LICTORY_LEGAL_EMAIL=$LICTORY_LEGAL_EMAIL \
    LICTORY_LEGAL_REGISTRATION=$LICTORY_LEGAL_REGISTRATION
RUN bun run --filter @lictory/marketing build \
 && mkdir -p /out \
 && cp -r apps/marketing/.next/standalone/. /out/ \
 && mkdir -p /out/apps/marketing/public \
 && cp -r apps/marketing/public/. /out/apps/marketing/public/ \
 && cp -r apps/marketing/.next/static /out/apps/marketing/.next/static \
 && if [ -d /out/node_modules/sharp ]; then \
      node -p "JSON.parse(require('fs').readFileSync('/out/node_modules/sharp/package.json','utf8')).version" > /out/.sharp-version; \
    else : > /out/.sharp-version; fi \
 && rm -rf /out/node_modules/sharp /out/node_modules/@img

# ------------------------------------------- target-platform native packages
FROM ${BUN_IMAGE} AS bun-target

# Installs the workspace lockfile's exact versions for the target platform,
# then keeps only the files the API and worker bundles load (traced like
# Next.js standalone output) and checks that the native packages load.
FROM ${NODE_IMAGE} AS server-dependencies
COPY --from=bun-target /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src
COPY --from=server-build /manifests/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts
COPY --from=server-build /src/apps/api/dist ./apps/api/dist
COPY --from=server-build /src/apps/worker/dist ./apps/worker/dist
COPY deploy/docker/trace-runtime.mjs ./deploy/docker/trace-runtime.mjs
RUN node deploy/docker/trace-runtime.mjs /deps \
      apps/api/dist/index.js apps/worker/dist/index.js

FROM ${NODE_IMAGE} AS marketing-dependencies
WORKDIR /deps
COPY --from=marketing-build /out/.sharp-version /tmp/sharp-version
# Next.js traces sharp (image optimization) with the build machine's binary;
# reinstall it for the target platform when the standalone output uses it.
RUN --mount=type=cache,target=/root/.npm \
    mkdir -p node_modules && npm init -y >/dev/null \
 && if [ -s /tmp/sharp-version ]; then \
      npm install --omit=dev --ignore-scripts --no-audit --no-fund \
        "sharp@$(cat /tmp/sharp-version)"; \
    fi

FROM ${CADDY_IMAGE} AS no-previous-assets
RUN mkdir -p /srv/platform/current/assets

FROM ${PREVIOUS_PROXY_IMAGE} AS previous-assets

# ------------------------------------------------------------ runtime images
# API and worker: node apps/api/dist/index.js | node apps/worker/dist/index.js
FROM ${NODE_IMAGE} AS api
# Preserve the project and bundled-source notices in distributed images.
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/lictory/
COPY LICENSES /usr/share/licenses/lictory/bundled/
ENV NODE_ENV=production PORT=3002 PLATFORM_DIST_DIR=/app/platform
WORKDIR /app
COPY --from=server-dependencies /deps/node_modules ./node_modules
COPY --from=server-build /src/apps/api/dist ./apps/api/dist
COPY --from=server-build /src/apps/worker/dist ./apps/worker/dist
COPY --from=platform-build /src/apps/platform/dist ./platform
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "apps/api/dist/index.js"]

FROM ${NODE_IMAGE} AS marketing
# Preserve the project and bundled-source notices in distributed images.
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/lictory/
COPY LICENSES /usr/share/licenses/lictory/bundled/
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=marketing-build /out/ ./
COPY --from=marketing-dependencies /deps/node_modules/ ./node_modules/
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/robots.txt').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/marketing/server.js"]

# Runs pending migrations once and exits (deploy/compose.production.yaml `migrate`).
FROM ${NODE_IMAGE} AS migrate
# Preserve the project and bundled-source notices in distributed images.
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/lictory/
COPY LICENSES /usr/share/licenses/lictory/bundled/
ENV NODE_ENV=production
WORKDIR /app
COPY --from=migrate-build /out/migrate.mjs ./migrate.mjs
COPY --from=migrate-build /out/backfills ./backfills
COPY drizzle ./drizzle
USER node
CMD ["node", "migrate.mjs"]

# Reverse proxy with the SPA's static files (deploy/proxy/Caddyfile).
FROM ${CADDY_IMAGE} AS proxy
# Preserve the project and bundled-source notices in distributed images.
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/lictory/
COPY LICENSES /usr/share/licenses/lictory/bundled/
# Ports 80/443 are bound via the net.ipv4.ip_unprivileged_port_start sysctl
# (compose), so the binary needs no file capability; with all capabilities
# dropped, a capability-bearing binary could not even be executed.
RUN apk add --no-cache --virtual .setcap libcap-utils \
 && setcap -r /usr/bin/caddy && apk del .setcap \
 && addgroup -S -g 10001 caddy && adduser -S -D -u 10001 -G caddy caddy \
 && mkdir -p /data /config && chown caddy:caddy /data /config
ENV XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config
COPY deploy/proxy/Caddyfile /etc/caddy/Caddyfile
COPY --from=previous-assets /srv/platform/current/assets /srv/platform/previous/assets
COPY --from=platform-build /src/apps/platform/dist /srv/platform/current
# The API renders index.html (social previews); the proxy never serves it.
RUN rm -f /srv/platform/current/index.html
USER caddy
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:2019/config/"]

# Backup, restore and monitoring tooling (deploy/backup, deploy/monitor), plus
# the release's deployment bundle that deploy.sh installs on the server.
FROM ${POSTGRES_IMAGE} AS ops
# Preserve the project and bundled-source notices in distributed images.
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/lictory/
COPY LICENSES /usr/share/licenses/lictory/bundled/
RUN apk add --no-cache age rclone curl bash coreutils jq \
 && mkdir -p /backups && chown postgres:postgres /backups \
 && touch /opt/rclone.conf
# Remotes come from RCLONE_CONFIG_BACKUP_* variables; the file stays empty.
ENV RCLONE_CONFIG=/opt/rclone.conf
COPY deploy/backup/*.sh deploy/monitor/*.sh /opt/lictory/
COPY deploy/monitor/*.sql /opt/lictory/sql/
COPY deploy/compose.production.yaml deploy/compose.restore-drill.yaml /opt/lictory/deploy/
COPY deploy/postgres /opt/lictory/deploy/postgres
COPY deploy/bin deploy/deploy.sh /opt/lictory/deploy/bin/
RUN chmod 0555 /opt/lictory/*.sh /opt/lictory/deploy/bin/* /opt/lictory/deploy/postgres/*.sh
ENV PATH=/opt/lictory:$PATH
USER postgres
WORKDIR /tmp
ENTRYPOINT []
CMD ["sh", "-c", "echo 'Run: backup.sh | restore.sh | verify.sh | monitor.sh' >&2; exit 64"]
