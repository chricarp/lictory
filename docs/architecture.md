# Architecture decision

## Decision

Use Cloudflare Workers as the common backend and deployment platform for both clients. Deploy the Next.js application as a separate Worker through the OpenNext adapter, and expose one Hono Worker API to Next.js and Expo.

```text
Expo iOS / Android ─┐
                    ├── HTTPS ──> Hono API Worker ──> D1 metadata
Next.js web app ────┘               │       │
                                    │       ├── R2 signed uploads
                                    │       ├── Queues (load leveling/retry)
                                    │       └── Workflows (durable AI/time waits)
                                    │                    │
                                    │                    ├── AI Gateway ──> OpenAI
                                    │                    └── Workers AI document conversion
                                    └── Expo Push API ──> APNs / FCM
```

The Next.js Worker is a frontend, not a second backend. Business endpoints remain in `apps/api`, which avoids different behavior between mobile and web.

## API code architecture

The Hono Worker is organised around feature boundaries, with a deliberately
small composition root:

```text
index.ts                              Worker adapter and workflow exports
├── app.ts                            HTTP composition and route mounting
├── bindings.ts                       Cloudflare runtime boundary
├── http/                             middleware and error responses
├── features/
│   ├── notes/                        note transport and operations
│   ├── entities/                     entity transport
│   ├── media/                        upload and private delivery behavior
│   ├── triggers/                     triggers and notifications
│   └── understanding/                extraction and durable workflows
└── infrastructure/
    ├── database/                     D1 row types and contract mappers
    └── queue/                        queue event adapter
```

Dependencies point inward from transport adapters toward operations and pure
contract functions. `app.ts` is the only place that defines global middleware
or assembles the `/v1` API. A new feature normally adds one feature router and
the smallest operation module it needs, then mounts that router in `app.ts`.
Feature routers do not import one another; shared HTTP concerns live in `http/`,
and shared business behavior lives in a named operation module.

D1 is intentionally passed through the Cloudflare `Env` binding rather than
hidden behind generic repository interfaces. When logic is reused, complex, or
needs isolated tests, it is extracted from the Hono handler into an operation.
Simple feature-local queries stay beside their route. This keeps the boundary
clear without building abstractions that merely rename D1 methods. The complete
developer map and feature checklist live in `apps/api/README.md`.

## Why Cloudflare over a Vercel split

Vercel is an excellent default for a Next.js-only product and now offers Queues and durable Workflow primitives. Lictory's center of gravity is different: large objects, asynchronous media processing, long-lived time triggers, edge API access from native clients, and AI inference are primary requirements rather than secondary web features.

Cloudflare keeps R2, D1, Queues, Workflows, AI Gateway, Workers AI, and the API in one security and observability plane. Current Cloudflare support covers the important Next.js App Router features through OpenNext, so placing only Next.js on Vercel would introduce a second deployment/runtime plane without removing a necessary Cloudflare dependency.

Keep `packages/contracts` and `packages/api-client` runtime-portable. If economics or a future model require a different AI provider, the queue/workflow boundary can call it without changing either client.

## Code-sharing rule

Share behavior and contracts aggressively; share presentation selectively.

- `contracts`: transport schemas, inferred TypeScript types, and pure domain functions
- `api-client`: authentication-aware requests and upload orchestration
- app-local code: routing, permissions, file pickers, and visual components

Next.js DOM components and native React Native components deliberately remain separate. Trying to share every view tends to couple web accessibility/SEO to native navigation and permission concerns. New product logic should start in a package when it is platform-neutral; UI belongs in an app until two consumers genuinely need the same primitive.

## Domain model

A **note** is the unit of capture. It holds Markdown text and any number of
attachments of any kind — several voice memos, a handful of photos and a PDF can
sit in the same note. Attachments are rows in `media_assets` pointed at the note
and ordered by `position`.

Everything the AI learns is normalised into relational structure rather than
being left as free-form model output:

```text
notes ──< media_assets                     (attachments of any kind)
  │
  ├──< note_entities >── entities          (person | place | time | topic | organization)
  ├──< note_links >── notes                (semantic note-to-note relationships)
  └──< note_processing_steps               (per-stage AI state, surfaced in the UI)
```

`entities` are deduplicated per user on `(type, normalized_key)`, so the same
person mentioned across fifty notes is one node. Newly learned attributes
(coordinates for a place, a resolved date for a moment) enrich the existing row
instead of forking a duplicate.

Every edge carries `origin` (`ai` | `user`), `confidence` and `status`
(`suggested` | `confirmed` | `rejected`). This is what makes the graph
correctable: the UI shows AI suggestions as dashed chips awaiting review, and any
human decision flips the edge to `origin = 'user'` so re-processing a note never
overwrites a correction.

Place entities carry `latitude`/`longitude`/`radius_meters` and time entities
carry `starts_at`/`recurrence`, which is what lets a note become location- or
time-aware. `triggers` can reference both the originating `note_id` and the
grounding `entity_id`.

## Upload and AI lifecycle

1. A client creates a draft note, then asks `POST /v1/notes/:id/attachments` for
   an upload slot per file.
2. The API validates MIME type/size, writes a `pending_upload` row bound to the
   note, and returns a narrowly scoped signed R2 `PUT` URL. Local development
   returns a one-time Worker upload URL instead.
3. The client uploads bytes directly, then calls `POST /v1/uploads/:id/complete`.
   Attachments that belong to a note settle at `uploaded`; standalone uploads
   from the legacy media surface are queued individually.
4. `POST /v1/notes/:id/process` resets the note's processing steps, marks it
   `queued` and publishes one job for the whole note.
5. The queue consumer creates a `ProcessNoteWorkflow` instance.
6. The workflow runs five durable stages, each recorded in
   `note_processing_steps` so the UI can render real progress rather than a
   spinner:
   - **transcribe** — OpenAI `gpt-4o-mini-transcribe` through Cloudflare AI
     Gateway over every audio attachment
   - **describe** — OpenAI `gpt-5-nano` vision through AI Gateway for images,
     and Workers AI `toMarkdown` for PDFs and Office documents
   - **extract** — one JSON-schema-constrained `gpt-5-nano` call through AI
     Gateway over the note text plus everything read out of its attachments
   - **resolve** — extracted mentions are normalised and upserted into
     `entities`, then linked to the note as `suggested` edges
   - **connect** — notes sharing entities are linked in `note_links`, with
     confidence scaled by how much context they genuinely share

Stages retry independently. A failure marks the note `failed` with the reason and
leaves the completed stages visible, so a partial understanding is never silently
discarded.

Media is private. Because `<img>` and `<audio>` cannot send an Authorization
header, `GET /media/:id` is protected by a capability URL signed with the auth
secret and valid for one hour.

Large audio should eventually move to a format-aware chunking/transcoding pipeline. This starter caps input at 50 MB and processes the source object as one inference request; it does not pretend arbitrary binary byte chunks are valid standalone audio files.

Local development runs without remote AI credentials. Rather than showing an
empty graph, `apps/api/src/heuristics.ts` produces a deterministic extraction
from surface patterns (verb-introduced names, prepositional places, ISO and
relative dates) so the entire UI can be exercised offline. It is never used when
the complete AI Gateway configuration is available.

## Notification lifecycle

Time triggers create a workflow that durably sleeps until the UTC instant. Location triggers are registered with the operating system by the Expo app. When iOS/Android emits a boundary event, the background task sends the authenticated event to the API. Both paths enqueue the same notification job, which loads the user's Expo tokens and sends the push.

Queue delivery is at least once. Push notifications must therefore be treated as potentially duplicated. A production implementation should add a delivery-attempt/outbox table, stable notification IDs, Expo receipt polling, and invalid-device-token cleanup.

## Authentication boundary

`apps/api/src/auth.ts` owns the Better Auth instance for each Worker request and uses D1 directly through Better Auth's Cloudflare-native adapter. The auth tables live beside the product tables, while all product queries still use the D1 binding directly. This avoids adding an ORM solely for authentication.

The web client sends Better Auth's HTTP-only session cookie. Expo stores the same cookie in SecureStore and attaches it to API calls. Every `/v1/*` request resolves the session server-side and takes the user ID from the authenticated Better Auth user, never from request input. Development bearer identities remain available only for focused API testing when Wrangler explicitly uses `ENVIRONMENT=development`; neither client uses them.

tRPC was deliberately not added. The existing shared Zod contracts and typed HTTP client already cover the product API, and Better Auth exposes its own typed client. Adding tRPC for this slice would create a second API transport without improving auth or database safety.

## Location constraints

Background location is inherently platform constrained. Users must explicitly enable it, Android vendors can stop background work, and iOS/Android limit how many geofences an app can monitor. The client should eventually prioritize nearby/soon-relevant regions and synchronize them as the user moves. Location events are recorded for diagnostics; retention should be short and disclosed clearly.
