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
    ├── database/                     Drizzle schema/client and contract mappers
    └── queue/                        queue event adapter
```

Dependencies point inward from transport adapters toward operations and pure
contract functions. `app.ts` is the only place that defines global middleware
or assembles the `/v1` API. A new feature normally adds one feature router and
the smallest operation module it needs, then mounts that router in `app.ts`.
Feature routers do not import one another; shared HTTP concerns live in `http/`,
and shared business behavior lives in a named operation module.

D1 is exposed by Cloudflare through the `Env` binding and wrapped in a
request-scoped Drizzle client. The TypeScript schema is the canonical model for
product and Better Auth tables, and database row types are inferred from it.
When logic is reused, complex, or needs isolated tests, it is extracted from the
Hono handler into an operation; simple feature-local queries stay beside their
route. The complete developer map and migration workflow live in
`apps/api/README.md`.

Wrangler remains the migration executor because it owns local D1 persistence
and the remote Cloudflare binding. Drizzle Kit generates and validates the SQL.
The hand-written `0001`–`0003` migrations remain immutable applied history;
Drizzle metadata is baselined after `0003`, and every later schema change is a
new generated, reviewed migration.

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
  │                        ├──< entity_aliases      (every surface form that names it)
  │                        ├─── entity_places       (structured address + geohash)
  │                        ├─── entity_moments      (when it happens, how it repeats)
  │                        └──< entity_duplicates   (pairs awaiting a human)
  ├──< note_links >── notes                (semantic note-to-note relationships)
  └──< note_processing_steps               (per-stage AI state, surfaced in the UI)
```

`entities` are deduplicated per user on `(type, normalized_key)`, so the same
person mentioned across fifty notes is one node. Newly learned attributes
(coordinates for a place, a resolved date for a moment) enrich the existing row
instead of forking a duplicate.

### Resolution

An exact key alone is too brittle to be the whole answer — it splits "OpenAI"
from "OpenAI Inc." and "standup" from "standups". Resolution therefore decides
identity in order of how much evidence each signal carries:

1. **the identity key** — `normalizeEntityKey`, unchanged, so no existing graph
   re-shards;
2. **the alias index** — `entity_aliases` holds every unambiguous surface form,
   with honorifics, legal suffixes, plurals and middle names folded away and
   organisation acronyms expanded. This is a lookup, not a scan;
3. **name similarity** — token-set overlap, acronym expansion and initialled
   surnames. Only structural matches auto-merge; anything merely plausible is
   written to `entity_duplicates` for a human;
4. **proximity**, for places only — two records within ~150 m whose names
   already look alike are one place written two ways.

The canonicalization and scoring live in `packages/contracts/src/resolution.ts`
as pure functions, so they are unit tested and behave identically everywhere.
Only unambiguous variants become aliases: a bare first name would otherwise
hijack every future person who shares it, so it stays a scored suggestion.

### Places

`entity_places` holds the address as structure — street, locality, region,
postal code, country — plus a geohash that gives SQLite a prefix-indexable
proximity bucket without a spatial extension.

Coordinates are taken from the model when it offers them, then from a geocoder
if `GEOCODER_URL` is configured, and otherwise **inherited** from a broader
place the user already has: an address in Milano borrows Milano's position and
records `precision = 'locality'`, `source = 'inherited'` and the
`parent_entity_id` it came from. Knowing roughly where something is beats
knowing nothing, as long as the imprecision is recorded rather than hidden. A
coordinate a person typed in outranks every deduced one and survives
re-processing.

### Moments

`entity_moments` is the authoritative record of when something happens. Timing
lives there rather than on `entities` because a moment is not a bag of loose
columns: the timestamp, how precise it is, how it repeats and the notification
derived from all three only make sense together. The matching columns on
`entities` are kept as a mirror for clients that still read the flat shape, and
a single writer (`upsertMomentFacet`) owns both, so they cannot drift.

The four shapes the product cares about are all expressible in that one table:

| Shape                  | How it is stored                                                |
| ---------------------- | --------------------------------------------------------------- |
| One-off date           | `starts_at`, `recurrence_freq` null                             |
| Birthday / anniversary | `recurrence_freq = 'yearly'`, `all_day = 1`, anchor in the past |
| Recurring event        | any `recurrence_freq` with an `interval` and optional `until`   |
| Reminder               | `needs_reminder = 1`, or `kind = 'reminder'`                    |

Note that a birthday is **not** a fifth kind of moment. `kind` is the moment's
_objective_ — plain context, an event, a deadline, or an explicit ask to be
reminded — and repetition is orthogonal to all four. Modelling repetition rather
than enumerating occasions is what lets one row answer "when is this next?"
forever, and it is why the free-text `recurrence` column this replaced was never
usable: nothing could interpret it. `parseRecurrence` now reads the model's
prose into `(freq, interval, until)` at the boundary, so a birthday the AI
inferred and one a person typed are the same row.

`next_occurrence_at` is the denormalized answer to "when is this next?" — the
one column a calendar can index and sort by without knowing whether the row
repeats. It is recomputed on every write, re-armed when a reminder fires, and
self-healed when the range endpoint reads a row that time has overtaken, so an
index can be trusted rather than quietly rotting.

Occurrences are **expanded, not materialised**. `GET /v1/moments?from&to` filters
one-offs in SQL by the indexed `next_occurrence_at` and expands repeating rows in
memory with `occurrencesBetween`. A personal graph has tens of repeating moments,
not thousands, which makes expansion cheaper than an occurrence table that would
then have to be kept in step with every edit.

The objective determines the reminder's lead time: a deadline warns a day ahead,
an event nudges shortly before, and a reminder fires exactly when it was asked
for. Moments that only ever named a month are never scheduled, because a
notification at an invented time is worse than none. Crucially the lead is
measured from the **next occurrence**, not the anchor — otherwise a birthday
recorded in 1994 could never fire.

When a moment warrants one, the pipeline arms a real `triggers` row with
`origin = 'ai'`. Re-processing retimes that trigger rather than stacking a
second, a repeating moment rewinds the same row to its next occurrence after
firing, and a reminder the user switched off stays off: the moment deliberately
keeps pointing at the cancelled trigger, and that link is the record of the
human decision. Re-arming is a single call, so switching it off is never a
one-way door.

Every edge carries `origin` (`ai` | `user`), `confidence` and `status`
(`suggested` | `confirmed` | `rejected`). This is what makes the graph
correctable: the UI shows AI suggestions as dashed chips awaiting review, and any
human decision flips the edge to `origin = 'user'` so re-processing a note never
overwrites a correction.

Place entities carry `latitude`/`longitude`/`radius_meters` and moments carry
`starts_at` plus a structured schedule, which is what lets a note become
location- or time-aware. `triggers` can reference both the originating `note_id` and the
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
   - **transcribe** — OpenAI `gpt-4o-mini-transcribe`, called directly or
     through Cloudflare AI Gateway, over every audio attachment
   - **describe** — OpenAI `gpt-5-nano` vision through the configured OpenAI
     route for images, and Firecrawl AnyDoc in Worker-hosted WebAssembly for
     office, OpenDocument, EPUB, CSV, RTF and text-based PDF attachments.
     Workers AI `toMarkdown` is used only as an OCR fallback for scanned files
   - **extract** — one strict Structured Outputs `gpt-5-nano` call through the
     configured OpenAI route over the note text plus everything read out of its
     attachments. The capture timezone grounds relative dates; the result
     includes a title, feed summary, Markdown rundown, and typed entities
   - **resolve** — extracted mentions are normalised through the resolution
     ladder above, upserted into `entities` with their place and moment facets,
     any reminder is armed, and each is linked to the note as a `suggested`
     edge. The stage detail reports what normalization actually did — how many
     were merged, how many look like duplicates, how many reminders were armed
   - **connect** — notes sharing entities are linked in `note_links`, with
     confidence scaled by how much context they genuinely share

Stages retry independently. A failure marks the note `failed` with the reason and
leaves the completed stages visible, so a partial understanding is never silently
discarded.

Media is private. Because `<img>` and `<audio>` cannot send an Authorization
header, `GET /media/:id` is protected by a capability URL signed with the auth
secret and valid for one hour.

Large audio should eventually move to a format-aware chunking/transcoding pipeline. This starter caps input at 50 MB and processes the source object as one inference request; it does not pretend arbitrary binary byte chunks are valid standalone audio files.

Local development uses the same OpenAI path as production and fails visibly
when `OPENAI_API_KEY` is missing. `apps/api/src/heuristics.ts` remains only as a
pure parser-test utility; workflow results are never mocked. AnyDoc conversion
is local to the Worker and does not require an external document service.

## Notification lifecycle

Time triggers create a workflow that durably sleeps until the UTC instant. Location triggers are registered with the operating system by the Expo app. When iOS/Android emits a boundary event, the background task sends the authenticated event to the API. Both paths enqueue the same notification job, which loads the user's Expo tokens and sends the push.

Queue delivery is at least once. Push notifications must therefore be treated as potentially duplicated. A production implementation should add a delivery-attempt/outbox table, stable notification IDs, Expo receipt polling, and invalid-device-token cleanup.

## Authentication boundary

`apps/api/src/features/auth/service.ts` owns the Better Auth instance for each
Worker request. It uses Better Auth's Drizzle adapter over the same Cloudflare
D1 binding as the product data. Auth tables live in the canonical schema beside
the product tables, so authentication and product schema changes share one
migration history.

The web client sends Better Auth's HTTP-only session cookie. Expo stores the same cookie in SecureStore and attaches it to API calls. Every `/v1/*` request resolves the session server-side and takes the user ID from the authenticated Better Auth user, never from request input. Development bearer identities remain available only for focused API testing when Wrangler explicitly uses `ENVIRONMENT=development`; neither client uses them.

tRPC was deliberately not added. The existing shared Zod contracts and typed HTTP client already cover the product API, and Better Auth exposes its own typed client. Adding tRPC for this slice would create a second API transport without improving auth or database safety.

## Location constraints

Background location is inherently platform constrained. Users must explicitly enable it, Android vendors can stop background work, and iOS/Android limit how many geofences an app can monitor. The client should eventually prioritize nearby/soon-relevant regions and synchronize them as the user moves. Location events are recorded for diagnostics; retention should be short and disclosed clearly.
