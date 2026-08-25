# Deployment guide

## 1. Provision Cloudflare resources

From `apps/api` (after `pnpm install`):

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create lictory-db
pnpm exec wrangler r2 bucket create lictory-media
pnpm exec wrangler queues create lictory-jobs
pnpm exec wrangler queues create lictory-jobs-dlq
```

Replace the zero UUID in `apps/api/wrangler.jsonc` with the D1 ID returned by Wrangler. Workflows are created when the Worker is deployed.

Create an authenticated Cloudflare AI Gateway, copy its account and gateway IDs
into `AI_GATEWAY_ACCOUNT_ID` and `AI_GATEWAY_ID` in `wrangler.jsonc`, and create
a gateway token with Run permission. The OpenAI provider key remains a Worker
secret; requests use it only through the provider-native AI Gateway endpoint.

Create an R2 API token scoped to `lictory-media`, then add secrets:

```bash
pnpm exec wrangler secret put R2_ACCOUNT_ID
pnpm exec wrangler secret put R2_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put APPLE_CLIENT_ID
pnpm exec wrangler secret put APPLE_TEAM_ID
pnpm exec wrangler secret put APPLE_KEY_ID
pnpm exec wrangler secret put APPLE_PRIVATE_KEY
pnpm exec wrangler secret put AI_GATEWAY_TOKEN
pnpm exec wrangler secret put OPENAI_API_KEY
```

Apply the schema and deploy:

```bash
pnpm run db:migrate:remote
pnpm run deploy
```

Schema changes start in
`apps/api/src/infrastructure/database/schema.ts`. Run `pnpm run db:generate`
from `apps/api`, review the generated append-only SQL, and test it with
`pnpm run db:migrate:local` before intentionally applying it remotely. Drizzle
Kit generates and checks migrations; Wrangler applies them to D1.

Attach `api.lictory.com` as the API Worker's custom domain. Update `ALLOWED_ORIGINS` for preview domains through a Wrangler environment or deployment configuration rather than broadening it to `*`.

## 2. Configure R2 CORS

Browser uploads go straight to the R2 S3 endpoint. Apply a bucket CORS policy equivalent to:

```json
[
  {
    "AllowedOrigins": ["https://lictory.com", "https://www.lictory.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Native clients are not governed by browser CORS, but use the same signed URL flow.

## 3. Deploy Next.js

Set `NEXT_PUBLIC_API_URL=https://api.lictory.com` in the web build environment. Also set `APPLE_TEAM_ID`, `APPLE_APP_BUNDLE_IDENTIFIER`, `ANDROID_APP_PACKAGE`, and `ANDROID_SHA256_CERT_FINGERPRINTS` so the deployed association endpoints authorize native passkeys. Then:

```bash
pnpm --filter @lictory/web deploy
```

Attach `lictory.com` and `www.lictory.com` to the resulting Worker. `pnpm --filter @lictory/web preview` runs the OpenNext output in the production-like `workerd` runtime.

## 4. Configure and build Expo

Install/login to EAS, initialize the project, and replace the placeholder project ID in `apps/mobile/app.json` (or set `EXPO_PUBLIC_EAS_PROJECT_ID`):

```bash
pnpm dlx eas-cli login
pnpm dlx eas-cli init
pnpm dlx eas-cli build --profile development --platform all
```

Use a development build or store build to test native passkeys, remote push, and background geofencing; these features are not represented by Expo Go. Set `EXPO_PUBLIC_API_URL=https://api.lictory.com` in the EAS environment and configure APNs/FCM credentials through EAS.

For passkeys, enable Associated Domains and Sign in with Apple for the `com.lictory.app` App ID. Register every Android signing SHA-256 fingerprint in the web environment and add the corresponding `android:apk-key-hash:<base64-sha256>` values to the API's `PASSKEY_ORIGINS`. Verify both association URLs return HTTP 200 without redirects before producing release builds.

## 5. Production checklist

- Configure and smoke-test Google and Apple OAuth in a preview environment.
- Add API rate limiting and per-user storage quotas.
- Validate file signatures, not only declared MIME types; add malware and safety scanning before AI processing.
- Add an outbox/delivery-attempt model and poll Expo push receipts.
- Remove invalid push tokens and expose notification/location consent controls.
- Define object, AI-output, and location-event retention/deletion policies.
- Add D1 backup/recovery procedures and alerts for the dead-letter queue.
- Add preview resources so CI integration tests never touch production data.
- Review GDPR/data-region and AI-provider terms for the intended markets.
