#!/usr/bin/env bash
# Complete local CI verification; never migrate a developer's database.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --wait postgres mailpit
LICTORY_VERIFY_DB="lictory_verify_$(openssl rand -hex 12)"
docker compose exec -T postgres createdb -U lictory "$LICTORY_VERIFY_DB"
cleanup() {
  docker compose exec -T postgres dropdb -U lictory --force "$LICTORY_VERIFY_DB"
}
trap cleanup EXIT
export DATABASE_URL="postgresql://lictory:lictory@localhost:5432/$LICTORY_VERIFY_DB"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export SCHEMA_TEST_DATABASE_URL=postgresql://lictory:lictory@localhost:5432/postgres
export DATABASE_MIGRATION_TARGET=test DATABASE_MIGRATION_URL= VERCEL=
export BETTER_AUTH_URL=http://localhost:3001
export BETTER_AUTH_SECRET=ci-only-secret-not-a-production-credential-32
export RESEND_API_KEY= SMTP_HOST=localhost SMTP_PORT=1025
export SMTP_SECURE=false SMTP_REQUIRE_TLS=false SMTP_USER= SMTP_PASSWORD=
export SMTP_FROM='Lictory <no-reply@lictory.local>' NEXT_TELEMETRY_DISABLED=1
export OPENAI_API_KEY= NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN= NEXT_PUBLIC_POSTHOG_HOST=
export OAUTH_PROXY_URL= OAUTH_PROXY_SECRET= OAUTH_PROXY_TRUSTED_ORIGINS=
export GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= MICROSOFT_CLIENT_ID= MICROSOFT_CLIENT_SECRET=
export R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_BUCKET_NAME=
export S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY= CRON_SECRET=

bun install --frozen-lockfile
bun audit --audit-level=high
bun run check
bun run db:check
bun run db:migrate
bun test src
bunx playwright install --with-deps --only-shell chromium
bun run test:e2e
