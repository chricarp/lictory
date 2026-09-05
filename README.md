# Lictory

Lictory is an Expo + Next.js monorepo for capturing context — writing, voice, photos and documents — understanding it with AI, and returning it through time- or location-based triggers.

A **note** can hold Markdown text plus any number of attachments of any kind at once. Once captured, an AI pipeline transcribes the audio, reads the images and documents, and extracts the people, places, moments and topics inside it into a normalised, correctable entity graph that the whole UI navigates.

The scaffold is intentionally Cloudflare-first:

- `apps/mobile`: Expo Router app for iOS and Android
- `apps/web`: Next.js landing page and web application, deployable to Cloudflare Workers with OpenNext
- `apps/api`: Hono API on Cloudflare Workers
- `packages/contracts`: shared Zod request/response contracts and domain helpers
- `packages/api-client`: one typed client used by Expo and Next.js

See [the architecture](docs/architecture.md) for the decision record and data flows, and [the deployment guide](docs/deployment.md) for production provisioning.

## Local development

Requirements: Node 24+ and pnpm 11+.

```bash
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter @lictory/api db:migrate:local
```

Run each surface in its own terminal:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:mobile
```

Create an account from either client using email and password. Google and Apple buttons become functional after their credentials are added to the API environment. Note understanding always uses OpenAI; set `OPENAI_API_KEY` in `apps/api/.env` for local development. Cloudflare AI Gateway is optional and is used only when its account ID, gateway ID and token are all present.

The first run asks to trust Portless's local certificate authority. The web app is at `https://lictory.localhost`, and the API is at `https://api.lictory.localhost`. Wrangler also stays on `https://api.lictory.localhost` so mobile development keeps working: a physical phone cannot reach `localhost`, so set `EXPO_PUBLIC_API_URL` to your machine's LAN address. Android emulators normally use `http://10.0.2.2:8787`.

## Useful commands

```bash
pnpm build          # API dry-run bundle, Next build, and Expo exports
pnpm typecheck      # strict TypeScript across every workspace
pnpm lint
pnpm test
pnpm format:check
```

Cloudflare-runtime verification for Next.js is separate from the normal fast Next build:

```bash
pnpm --filter @lictory/web exec opennextjs-cloudflare build
pnpm --filter @lictory/web preview
```

## Environment and authentication

Better Auth runs in the Hono Worker at `/api/auth/*` and stores users, linked social accounts, sessions, verifications, and passkeys in the existing D1 database. Browser sessions use an HTTP-only cookie. Expo stores the same Better Auth cookies in SecureStore and forwards them to product API requests.

Required production secrets/variables:

- `BETTER_AUTH_SECRET` (at least 32 high-entropy characters)
- `BETTER_AUTH_URL` (the public API origin, currently `https://api.lictory.com`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID` plus either `APPLE_CLIENT_SECRET` or `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`
- `APPLE_APP_BUNDLE_IDENTIFIER`
- `PASSKEY_RP_ID` and `PASSKEY_ORIGINS`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY`
- Optional Cloudflare AI Gateway routing: `AI_GATEWAY_ACCOUNT_ID`, `AI_GATEWAY_ID`, `AI_GATEWAY_TOKEN`
- `ALLOWED_ORIGINS`
- `NEXT_PUBLIC_API_URL` and `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_EAS_PROJECT_ID`

The API's checked-in default is `ENVIRONMENT=production`, so accidentally deploying it never enables development bearer tokens or the development auth secret. The `dev` script explicitly overrides that value only for local Wrangler.

### OAuth callback URLs

Configure these exact web-client callback URLs with the providers:

- Google local: `https://api.lictory.localhost/api/auth/callback/google`
- Google production: `https://api.lictory.com/api/auth/callback/google`
- Apple production: `https://api.lictory.com/api/auth/callback/apple`

Apple does not accept localhost or plain-HTTP callbacks. Test Apple login and native OAuth through an HTTPS preview/tunnel whose origin is also included in `ALLOWED_ORIGINS`, Better Auth trusted origins, and the provider console.

### Passkeys

Web passkeys use the local `lictory.localhost` relying party over Portless HTTPS. Native passkeys require an HTTPS relying-party domain and a development/store build; they do not work in Expo Go.

The production relying party is `lictory.com`. The Expo config already declares `webcredentials:lictory.com`, and the web app serves both association endpoints:

- `/.well-known/apple-app-site-association`, configured with `APPLE_TEAM_ID`
- `/.well-known/assetlinks.json`, configured with `ANDROID_SHA256_CERT_FINGERPRINTS`

Add every Android signing identity (development, EAS, and Play App Signing) to the fingerprint list. Also add each APK WebAuthn origin (`android:apk-key-hash:<base64-sha256>`) to `PASSKEY_ORIGINS` in the API Worker. Rebuild the native app whenever associated-domain or native module settings change.

## Implemented vertical slices

**Capture**

- One note holding Markdown text, multiple audio clips, multiple photos and multiple documents
- Lightweight GitHub-style Markdown editor with a formatting toolbar, shortcuts and a preview tab
- In-app audio recorder with a live amplitude waveform, pause/resume and review-before-attach
- In-app camera capture, plus drag-and-drop and file-picker uploads with per-file progress
- Direct upload to R2 with a 15-minute signed URL in production, and a credential-free local path backed by Wrangler's local R2

**Understanding**

- Queue-backed, durable per-note AI workflow with independent retries
- OpenAI `gpt-4o-mini-transcribe` audio transcription, directly or through Cloudflare AI Gateway
- OpenAI `gpt-5-nano` vision and strict Structured Outputs extraction, directly or through Cloudflare AI Gateway
- Firecrawl AnyDoc WebAssembly conversion for Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV and text-based PDFs; Workers AI is an OCR fallback for scanned documents
- Per-stage processing state persisted and surfaced live in the UI
- Structured dates distinguish contextual dates, events, deadlines and reminders, including why each one matters

**Structure**

- Entities deduplicated per user, enriched rather than duplicated as new details arrive
- Alias-indexed resolution folds honorifics, legal suffixes, plurals, middle names and acronyms together, so "OpenAI Inc." and "OpenAI" are one node
- Near-misses become reviewable duplicate suggestions instead of silent merges, with a one-tap merge or dismiss
- Places normalised into structured addresses with a geohash; coordinates are read, geocoded, or inherited from a broader place you already have and labelled approximate
- Moments carry an objective — context, event, deadline or reminder — and a structured schedule, so birthdays, recurring plans, reminders and one-off dates are all one row that knows when it next happens
- Reminders arm a real notification you can switch off and back on, and a repeating moment re-arms itself after each firing
- The Moments calendar reads a date range with repeats already expanded, and offers an upcoming agenda grouped by horizon or a month grid with a day panel
- Note-to-entity and note-to-note relationships with `origin`, `confidence` and review status
- Human review of every AI suggestion, plus manual add/edit/merge/delete of entities
- People and organisations share one directory, and each links to the other
- Entity pages, co-occurrence neighbourhoods and cross-entity filtering
- A dedicated ⌘K Ask experience with persistent multi-turn conversations, AI-synthesised titles, editable prompts, regenerated answers, one-click message copy, and citations grounded in writing, audio transcripts, image descriptions, document text and structured context

**Platform**

- D1 relational model with migrations, Queues for load levelling, Workflows for durable waits
- Durable scheduled notifications with `sleepUntil`, Expo push delivery, native background geofencing
- Signed capability URLs for private media delivery
- Shared validation, models, geofence math, and a single typed HTTP client
- Better Auth email/password, Google, Apple, shared web/native sessions, and WebAuthn passkeys

This is a production-shaped scaffold, not a complete product. Before launch, add the product-specific authorization model, upload moderation/malware scanning, Expo push receipt processing and invalid-token cleanup, privacy/retention workflows, rate limits, analytics, and end-to-end tests against preview Cloudflare resources.
