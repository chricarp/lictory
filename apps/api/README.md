# Lictory API

The API uses a feature-first Hono architecture. Start at `src/app.ts` to see
the complete HTTP surface, then enter the feature you need.

```text
src/
├── index.ts                         Cloudflare Worker entrypoint
├── app.ts                           Hono composition root and route mounting
├── bindings.ts                      Worker bindings and queue message types
├── http/
│   ├── errors.ts                    shared error envelope and handlers
│   └── middleware.ts                request ID, CORS and authentication
├── features/
│   ├── auth/service.ts              Better Auth configuration and sessions
│   ├── entities/routes.ts           entity CRUD and merge transport
│   ├── graph/routes.ts              context overview transport
│   ├── media/
│   │   ├── routes.ts                media delivery and upload endpoints
│   │   └── uploads.ts               upload slots and signed capabilities
│   ├── notes/
│   │   ├── routes.ts                note HTTP transport
│   │   └── service.ts               note, edge and entity operations
│   ├── search/routes.ts             cross-feature search transport
│   ├── triggers/
│   │   ├── routes.ts                trigger, device and location endpoints
│   │   └── notifications.ts         push notification delivery
│   └── understanding/
│       ├── extraction.ts            AI Gateway/OpenAI and document adapters
│       ├── heuristics.ts            deterministic local extraction
│       └── workflows.ts             durable processing workflows
└── infrastructure/
    ├── database/
    │   ├── schema.ts                canonical Drizzle schema for D1
    │   ├── client.ts                typed client over the D1 binding
    │   ├── rows.ts                  schema-inferred database row types
    │   └── records.ts               rows mapped to public contracts
    └── queue/consumer.ts            queue message dispatch
```

## Dependency direction

`index.ts` adapts Cloudflare events. `app.ts` assembles feature routers. Routes
validate transport input and call feature operations. Feature operations use
the injected Worker bindings and pure functions from `@lictory/contracts`.
Infrastructure modules know about Drizzle/D1, R2, queues, or external delivery
APIs.

Feature routers must not import other feature routers. Reusable behavior belongs
in a feature service or a narrowly named infrastructure module; it should not be
copied between handlers. Public response types always come from
`@lictory/contracts`, never from D1 row types.

## Adding a feature

1. Create `src/features/<feature>/routes.ts` and mount it in `src/app.ts`.
2. Keep simple feature-local queries in the route. Extract reused or non-trivial
   behavior into `service.ts`.
3. Put external-system mechanics under `src/infrastructure/` only when they are
   not owned by one feature.
4. Add request/response schemas to `packages/contracts` when the API surface is
   new or changes.
5. Add focused behavior tests and an app-composition test when mounting a new
   top-level router.

Do not add product endpoints to the Next.js app. Both clients consume this one
API, and every `/v1/*` route receives its user ID from the shared authenticated
boundary in `app.ts`.

## Database changes

`src/infrastructure/database/schema.ts` is the source of truth for product and
Better Auth tables. Runtime code creates a request-scoped Drizzle client over
the `DB` binding; public response types still come from `@lictory/contracts`.

The original `0001`–`0003` SQL files are applied migration history and remain
append-only. Drizzle's snapshot in `migrations/meta` is baselined at `0003`, so
new migrations start at `0004` without trying to recreate an existing database.

```bash
pnpm --filter @lictory/api db:generate       # diff schema.ts into a new SQL migration
pnpm --filter @lictory/api db:check          # validate migration snapshots
pnpm --filter @lictory/api db:migrate:local  # apply to local D1 with Wrangler
```

Review generated SQL before applying it. Use the existing remote migration
script only during an intentional deployment; it targets the real Cloudflare
database.
