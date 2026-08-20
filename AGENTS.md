# Lictory

Lictory is a personal context engine. A user captures something — writing, a voice memo, a photo, a PDF, or all of them in one note — and an AI pipeline works out what it means: who is in it, where it happens, when it matters, and which other notes it belongs with. That understanding is stored as a relational graph the user can browse, filter and correct.

It is a pnpm + Turborepo monorepo: an Expo app, a Next.js app, one Hono API on Cloudflare Workers, and two shared packages.

## What makes Lictory Lictory

These are the properties the product is built around. If a change erodes one of them, say so before you write it.

### 1. One note holds everything

A note is not "a photo" or "a voice memo". It is a container that holds Markdown text plus any number of attachments of any kind at once, and the AI reads all of it together as a single piece of context. Any feature that pushes users toward one-attachment-per-note is working against the product.

### 2. Structure, not model output

The AI never leaves a blob of prose as the final answer. Every extraction is normalised into `entities` and typed edges. A date is a row you can click to find every other note on that date. A person is a node with a neighbourhood. If a feature stores an AI result as unstructured text and calls it done, it is unfinished.

### 3. The human is always right

Every AI-produced edge carries `origin`, `confidence` and `status`. A suggestion is visibly a suggestion, and a human decision is permanent: confirming or rejecting an edge flips it to `origin = 'user'`, and re-processing the note must never overwrite it. This invariant lives in `attachEntityToNote` (`apps/api/src/notes.ts`) and the `PATCH` handlers in `apps/api/src/routes-notes.ts`. Breaking it makes the whole graph untrustworthy.

### 4. Legible processing

Understanding takes seconds to minutes. The UI never shows an anonymous spinner for it. `note_processing_steps` records real per-stage state and the UI renders it. When you add a stage to the workflow, add it to the stage enum, the migration's CHECK constraint, and `ProcessingPipeline` — a stage the user cannot see is a lying progress bar.

### 5. Private by default

Notes are personal. Media sits in a private R2 bucket behind signed capability URLs. Every `/v1/*` handler derives the user ID from the authenticated session, never from request input. There is no sharing model yet; do not invent one incidentally.

## Working principles

Prefer the smallest model that makes the correct behaviour unsurprising. Do not preserve complexity because it is already there, and do not add machinery because it looks impressive. Understand the real constraint first.

Treat everything below as good defaults rather than law. The developer's stated preference overrides this file. If a rule here fights the task in front of you, say so out loud instead of quietly working around it.

## Glossary

Use this language when you talk about the system.

- **you** — the agent reading this file and changing Lictory.
- **user** — the person using Lictory to capture their own context.
- **note** — the unit of capture. Markdown body plus attachments plus extracted context.
- **attachment** — a file on a note: image, audio or document. Row in `media_assets`.
- **entity** — a normalised person, place, time, topic or organisation, deduplicated per user.
- **edge** — a `note_entities` or `note_links` row. Carries origin, confidence and review status.
- **suggestion** — an edge with `status = 'suggested'`. The AI's proposal, awaiting a human.
- **context** — the user-facing word for the entity graph. The sidebar section, not a technical term.
- **understanding** — the user-facing word for the AI pipeline. "Being read", "Understood".
- **stage** — one step of `ProcessNoteWorkflow`: transcribe, describe, extract, resolve, connect.
- **trigger** — a scheduled or geofenced reminder that fires a push notification.
- **surface** — one of the three consumers: `apps/web`, `apps/mobile`, `apps/api`.

## The four ways to hurt yourself

1. **`--remote`.** `wrangler d1 execute --remote`, `wrangler d1 migrations apply --remote`, `wrangler r2 ...` and `pnpm --filter @lictory/api db:migrate:remote` all talk to the real Cloudflare account, not your machine. Local development never needs any of them. If you think you need one, stop and ask.
2. **Deleting local state.** `apps/api/.wrangler/state/v3` is the local D1 database, R2 bucket and workflow state. Removing it silently throws away every note, account and uploaded file the developer has been testing with. Re-running migrations is cheap; recreating test data is not.
3. **Editing an applied migration.** `apps/api/migrations/` is append-only. Wrangler tracks which files it has run; changing one that already ran leaves local and remote schemas permanently disagreeing. Fix schema mistakes with a new numbered migration. SQLite also cannot relax a `CHECK` constraint in place — widening an enum means rebuilding the table, as `0003_notes_graph.sql` does for `media_assets`.
4. **Killing by pattern.** `pkill -f "next dev"` or `pkill -f wrangler` will happily kill the developer's other projects, and possibly the process you are running inside. Kill a PID you captured when you spawned it, or leave the server running and say so.

## Hit every surface

The most common defect here is a change that is correct on the path you tested and missing everywhere else. Before calling something done, walk this list and say which entries applied.

- **Three consumers, one API.** `apps/api` is the only backend. `apps/web` has exactly two route handlers, both under `.well-known/`, and they are not business logic. Do not add product endpoints to Next.js — that reintroduces the split behaviour between web and mobile the architecture exists to prevent.
- **Contracts are load-bearing.** `packages/contracts` is imported by all three surfaces. Narrowing a schema or renaming a field breaks the Expo app even if you never open it. If you must change an existing endpoint's shape, either update `apps/mobile` in the same change or keep the old surface working — `/v1/media` and `/v1/uploads` are still there for exactly this reason.
- **Migration, row type, mapper, contract, UI.** A new column touches `apps/api/migrations/`, the row type in `apps/api/src/types.ts`, the mapper in `apps/api/src/records.ts`, the schema in `packages/contracts`, and whatever renders it. Missing the mapper is the quiet failure: it typechecks and returns `undefined`.
- **Both origins.** Anything the AI can produce, a human must be able to add, edit and remove — and vice versa. `resolveEntity` is shared by the workflow and the API for this reason.
- **Reverse states.** If you add a way in, add the way out and the way to see it. Confirm needs reject. Link needs unlink. Process needs re-process. A one-way door is a bug.
- **Empty, loading, failed.** Every list has a real empty state, a skeleton, and a visible failure path. A note whose processing failed still shows its stages and its reason.
- **Both viewports.** The app is used on phones. Check narrow layouts for horizontal overflow before you finish; the composer toolbar has already regressed this way once.
- **Docs.** `docs/architecture.md` is the decision record and data flow. `docs/deployment.md` is provisioning. `README.md` is the entry point and the feature inventory. A change to the data model or the AI lifecycle belongs in the architecture doc.

## Dev servers

```bash
pnpm install
pnpm --filter @lictory/api db:migrate:local   # local D1 only
pnpm dev:api                                  # wrangler, :8787
pnpm dev:web                                  # next, :3000
```

- `pnpm dev` runs everything in parallel through Turbo. Prefer the individual scripts so you can read one log at a time.
- The API dev script always passes `--config wrangler.local.jsonc`. That file is the only place `ENVIRONMENT=development` exists. The checked-in default in `wrangler.jsonc` is `production` on purpose, so a stray deploy can never enable development auth. Do not "fix" that.
- The local config deliberately omits the Workers AI binding, so no Cloudflare login is needed to develop. See **AI without an AI binding** below.
- A physical phone cannot reach `localhost`. Set `EXPO_PUBLIC_API_URL` to your LAN address; Android emulators use `http://10.0.2.2:8787`.
- Stop what you started, by the PID you tracked.

## Test data

An empty database is a bad test, and this product only looks right with a populated graph — a lone note has no entities to click and nothing to link to.

- `Authorization: Bearer dev:<anyUserId>` skips auth entirely on `/v1/*`, but only when `ENVIRONMENT=development`. It is the fastest way to seed and inspect data with `curl`, and it is the reason the checked-in environment default matters. No client uses it.
- Seed at least three notes that deliberately share a person and a place, then process them. That is the only way to exercise `note_links`, the co-occurrence neighbourhood on entity pages, and the "usually appears with" query.
- Attachments need the three-step dance: `POST /v1/notes/:id/attachments`, `PUT` the bytes to the returned URL with its headers, then `POST /v1/uploads/:id/complete`. The declared `bytes` must match the file exactly — the complete endpoint rejects a larger object with a 413, and an off-by-one trailing newline will do it.
- Processing is only enqueued by `POST /v1/notes/:id/process`, and it refuses while any attachment is still `pending_upload`.

## AI without an AI binding

Local development has no `env.AI`. Rather than showing an empty graph, `apps/api/src/heuristics.ts` produces a deterministic extraction from surface patterns — verb-introduced names, prepositional places, ISO and relative dates — so the entire UI can be exercised offline.

It is a development affordance, not a fallback. It is selected in exactly one place, by `this.env.AI` being absent in `ProcessNoteWorkflow`. Never route production traffic through it, never let it become the shape the real extractor has to imitate, and keep its tests fast and pure. If you improve the real prompt, you do not owe the heuristic parity.

## Verifying

- Smallest proof that the change works. `pnpm --filter <pkg> typecheck` and the tests you touched.
- Repo-wide `pnpm typecheck && pnpm lint && pnpm test && pnpm build` is cheap here — a few seconds — so running it before you finish is reasonable, unlike in bigger repos.
- `pnpm format` before you finish. Prettier runs from the root over everything; ESLint is per-app.
- Backend behaviour changes ship with focused tests. Pure logic — normalisation, extraction parsing, geofence math — is where tests pay for themselves; D1 handlers are not worth mocking.
- `next build` catches things `tsc` does not, because it prerenders. A component that throws only during SSR will pass typecheck and fail the build.
- Ask before driving a browser. When the developer does want a visual pass, do it once, after integrating, and check a narrow viewport too.

## Pull requests

- Never open a PR unless you are explicitly asked to.
- Conventional commit titles in plain language: `fix(web): composer toolbar no longer overflows on mobile`.
- Body: the problem in a sentence or two, then how you fixed it.
- UI changes need before/after images. Motion or timing needs a short video.
- One concern per PR. If the description says "also", split it.

## How it works

Clients talk to one Hono Worker. `/v1/*` resolves a Better Auth session and derives the user ID server-side.

Capture creates a draft note, then uploads each attachment directly to R2 through a short-lived signed URL, so bytes never pass through the Worker. `POST /v1/notes/:id/process` resets the note's stages, marks it `queued`, and publishes one queue job for the whole note. The queue consumer creates a `ProcessNoteWorkflow` instance.

The workflow runs five durable stages, each recorded as it goes: **transcribe** (Whisper over audio), **describe** (vision captioning for images, `AI.toMarkdown` for PDFs and Office files), **extract** (one JSON-schema-constrained LLM call over the note text plus everything read out of its attachments), **resolve** (upsert extracted mentions into `entities`, link them to the note as suggestions), **connect** (link notes that share entities, with confidence scaled by overlap). Stages retry independently; a failure marks the note `failed` with a reason and leaves completed stages visible.

Triggers reuse the same machinery: time triggers sleep durably in a workflow, location triggers are registered with the OS by the Expo app and posted back as events. Both enqueue the same notification job.

Media is private and cannot carry an `Authorization` header from an `<img>` or `<audio>` tag, so `GET /media/:id` is protected by an HMAC-signed capability URL valid for one hour.

Full decision record and diagrams: `docs/architecture.md`.

## The data model

```text
notes ──< media_assets                     attachments of any kind, ordered by position
  │
  ├──< note_entities >── entities          person | place | time | topic | organization
  ├──< note_links >── notes                semantic note-to-note relationships
  └──< note_processing_steps               per-stage AI state, surfaced in the UI
```

Two invariants worth internalising:

**Entities are deduplicated per user on `(type, normalized_key)`.** That is what makes the same person across fifty notes one node. `normalizeEntityKey` in `packages/contracts/src/notes.ts` defines identity; changing it re-shards every existing graph without a migration to match, so treat it as a schema change and cover it with tests.

**Edges are enriched, never duplicated.** `resolveEntity` merges newly learned attributes — coordinates for a place, a resolved date for a moment — onto the existing row. Writing a second row for a better-known version of the same thing is the bug the merge endpoint exists to clean up.

## Where code lives

- `apps/api` — the only backend. Hono on Workers. `index.ts` mounts routes and owns the queue consumer; `routes-notes.ts` and `routes-entities.ts` hold the handlers; `notes.ts` is the query and aggregation layer; `workflows.ts` is the durable pipeline; `extraction.ts` wraps the models; `heuristics.ts` is the offline stand-in.
- `apps/web` — Next.js 16 App Router. **Read `apps/web/AGENTS.md` before writing Next code**: this version has breaking changes against most training data, and the version-matched docs are bundled at `apps/web/node_modules/next/dist/docs/`. `params` are Promises.
- `apps/mobile` — Expo Router. Owns geofence registration and push tokens. Easy to break from the API without noticing.
- `packages/contracts` — Zod schemas, inferred types, and pure domain functions. Imported by all three surfaces, so it must stay runtime-portable: no Node built-ins, no DOM, no Workers globals.
- `packages/api-client` — the one typed HTTP client, plus upload orchestration.

Data access is raw D1 SQL by design. There is no ORM and adding one is a conversation, not a refactor.

## Taste

**React.** The web app runs the React Compiler lint rules, and they are not negotiable noise. Do not call `setState` synchronously inside an effect — reset derived state during render by comparing against a stored key instead. Do not assign to a ref during render; mirror props into refs from an effect. Both patterns are used throughout `src/lib/api.tsx` and the detail views; copy them rather than reaching for `eslint-disable`.

**Radix `asChild`.** `Slot` requires exactly one child. Conditionally rendering a spinner beside `{children}` in a component that supports `asChild` typechecks fine and fails at prerender with a message that names no file. `Button` handles this explicitly; do the same anywhere you add `asChild`.

**Tailwind v4.** There is no `tailwind.config.js`. The theme is `@theme inline` in `src/app/globals.css`, colours are `rgb(var(--token))` triples so opacity modifiers work, and the shadcn CLI will not wire itself up correctly here. Add components by hand in the existing house style. Semantic tokens (`bg-surface`, `border-hairline`, `text-muted`) exist so a theme change is one file — reach for a raw hex only when you are defining a token.

**Design language.** Dark-first, hairline borders, one ember gradient as the identity colour, one hue per entity type used consistently so colour carries meaning. Controls are tactile and compress when pressed. AI states are luminous — shimmer, beams, staggered reveals — and everything respects `prefers-reduced-motion`. Motion should explain what the system is doing; decorative animation that repaints continuously is a regression.

**Types.** Inferred over annotated. `any` is the enemy. `noUncheckedIndexedAccess` is on across the repo, so index access is genuinely possibly-undefined and `!` should be earned.

**Comments.** Explain why a thing exists and how it is meant to be used, usually above a function or a non-obvious block. Do not narrate lines that already say what they do. When the code moves, the comment moves with it.

## Additional tips

- Adding a dependency can be blocked by the supply-chain policy in `pnpm-workspace.yaml`. If pnpm refuses a package for being too new, surface it rather than pinning around it.
- Turbo caches aggressively. A suspiciously instant pass is a cache hit, not proof.
- Security matters, but do not over-index on it for local-development affordances that are already gated behind `ENVIRONMENT=development`.
- Do not verify with a browser or computer use unless the developer asks or agrees.
