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
    │   ├── rows.ts                  raw D1 row types
    │   └── records.ts               rows mapped to public contracts
    └── queue/consumer.ts            queue message dispatch
```

## Dependency direction

`index.ts` adapts Cloudflare events. `app.ts` assembles feature routers. Routes
validate transport input and call feature operations. Feature operations use
the injected Worker bindings and pure functions from `@lictory/contracts`.
Infrastructure modules know about D1, R2, queues, or external delivery APIs.

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
