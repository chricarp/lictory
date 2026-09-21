# Workspace synchronization and review invariants

The authenticated workspace uses Better Auth, the existing Drizzle domain tables,
and Markdown revisions. The application runs without AI or delivery integrations.

## Server authority and authorization

`src/sync/server/service.ts` is the domain mutation boundary. Route handlers obtain
the user from Better Auth, validate Zod protocol input, and require same-origin
cookie-authenticated writes. Every command checks current Better Auth organization
membership inside its transaction. Products are organization-wide in this baseline:
there is deliberately no private-product ACL. Owners/admins manage products; members
may refine, discuss, suggest, archive, and request reviews. Only an assigned user,
or a current member of an explicitly assigned functional group, can decide a review.
Group membership alone does not confer approval authority.

Organization creation, naming, invitations and acceptance remain Better Auth
operations. Settings create shareable invitation links; automated invitation email
is not configured. The sync directory is a small, fresh projection of Better Auth
organizations/members and domain products/groups, returned on every sync response.
This also discovers membership and directory changes made through Better Auth.

When adding private products, change **both** bootstrap and delta authorization,
and introduce access epochs/reset or scoped tombstones before enabling the UI.
The existing organization-wide policy must never be mistaken for a private-product
permission system. A denied sync clears all persisted caches and pending commands
for that user/organization and tells other tabs to synchronize. Offline browsers
cannot discover revocation until they reconnect. Caches are partitioned by user,
organization and scope; a different signed-in user never reads the previous user's
partition. Browser storage is not a substitute for server authorization.

## Cursor and atomicity

`sync_clock` holds a PostgreSQL bigint counter per organization. The wire format is
a decimal **string**, preserving values above JavaScript's safe-integer limit.
All sync reads and domain writes take the same organization advisory transaction
lock, before checking access or reading the clock. This deliberately serializes a
small organization's mutations and coherent snapshots.

Do not replace this with a bare sequence/serial and `MAX(id)`: sequences allocate
before commit, so a later transaction can commit first and a client can permanently
skip an earlier allocated change. Our clock advancement, domain writes, change log,
activity records, and idempotency receipt commit together or roll back together.
A forced log-write failure is covered by the integration suite.

`sync_change` stores explicit versioned protocol projections of changed entities,
not arbitrary database rows or full workspace snapshots. Each change has an
organization, product, optional proposal context, cursor, and upsert/delete envelope.
A proposal archive is a reversible upsert with `archivedAt`, preserving history.
The reconciliation protocol supports deletion tombstones; this slice exposes no
hard-delete domain command. Future deletion commands must append tombstones in the
same transaction. Log retention/compaction is deliberately not enabled: never drop
old changes without adding an expired-checkpoint/reset protocol first.

## Scopes and recovery

Protocol version 1 has organization, product, and proposal scopes, expressed by
organization ID plus optional product and proposal IDs. A proposal requires a
product. Organization bootstrap contains product metadata; product bootstrap contains
proposal summaries; proposal bootstrap adds its revisions, discussions, suggestions,
reviews, assignments, approvals, readiness and activity. It does not send unrelated
proposal histories. Historical content is currently loaded for one proposal as a
whole; pagination of very long revision/message histories is future work.

A request without a checkpoint bootstraps under the lock. Delta requests return
ordered changes, `nextCursor`, and `hasMore`; clients drain every page. Empty deltas
can advance to the organization head even when changes belonged to another scope.
Checkpoints belong to **one scope**, never to a user or organization globally. A
mutation receipt is not a delta checkpoint and must never advance the local cursor.

The service currently compares before/after protocol projections within the touched
workspace to emit changes. This keeps every dependent readiness/approval change
visible. It is intentionally simple; replace it with explicit touched-entity
collection when measured document/history size warrants it, retaining the same
transaction and tests. Organization locks are the initial throughput boundary.

## Browser store and mutation lifecycle

React reads normalized `{type}:{id}` entities through `useSyncExternalStore`.
Components issue typed domain commands; persistence, queue behavior, and optimistic
logic are below the UI boundary. IndexedDB is behind a `Persistence` interface.
Data and its checkpoint are written in one IndexedDB transaction. Queue entries
are separate records, so two tabs do not overwrite each other's pending work.

A command receives a client UUID, is durably queued, then gets an optimistic overlay.
Proposal creation, replies and thread-state changes have centralized optimistic
reducers. Revision changes, suggestions and approvals await server validation.
The confirmed entity map stays separate from overlays: deltas update confirmed state,
then pending overlays replay. On rejection the overlay is removed while the full
command remains inspectable for retry or discard. Accepted commands synchronize
before their queue entry is removed. A crash at any intermediate point safely
replays the same mutation ID.

The queue processes in enqueue order and pauses behind conflicts/failures. Network
and server failures back off exponentially, capped at 30 seconds and five attempts;
users can retry manually. Web Locks coordinate sending across supported tabs;
server idempotency remains required even with that lock. BroadcastChannel announces
queue/commit activity. The receipt fingerprint binds an ID to its actor, organization
and parsed command; using the ID for a different command is a conflict.

Unsaved editor keystrokes are not an offline document draft system. Pressing Save
persists the command. Already-loaded data and queued operations survive temporary
network loss and reload when the Next.js document/assets remain reachable. There is
no service worker for a completely offline cold application launch.

## Realtime

PostgreSQL `NOTIFY` fires after commit and a process-wide `LISTEN` connection fans
out generic organization invalidations over SSE. It carries no document content.
SSE fits Next route handlers without replacing the server with a WebSocket runtime.
Connections are bounded to revalidate authentication; a heartbeat, focus/online
handlers, and a 15-second recovery interval catch missed invalidations and sleeps.
Every notification triggers the normal delta path. Correctness never depends on
continuous SSE or PostgreSQL LISTEN connectivity. Deploy behind a proxy that permits
streaming and configure connection/time limits accordingly.

## Revisions, reviews and conflicts

Every material title/content save inserts an immutable revision. No-op saves do not
insert snapshots. Suggestions replace the whole Markdown document and acceptance
uses that same revision helper. Commands carry the exact base revision; a stale save
or stale suggestion acceptance returns a structured conflict with the current
revision ID. There is no automatic text merge. The editor retains the user's text
and offers the latest revision for inspection/reload; failed queued text can be
inspected before discarding and submitting a corrected command.

Approvals belong to a review/revision and an assigned reviewer. A material revision
ends granted approvals as stale with an actor, timestamp, and reason. Review records
remain historical. Required responsibilities continue to require a fresh review on
the current revision; an old completed review cannot satisfy readiness. The baseline
requires at least one required responsibility, current granted approvals for each,
specification content, completion of every current required review, and no open blocking threads. The proposal summary becomes approved only when these checks pass, and reverts if readiness is lost. Readiness is computed server-side;
the proposal status is only a workflow summary. Resolving/reopening threads never
deletes messages; durable activity records retain these actions.

## Verification and deferred work

`bun run test:sync` tests real PostgreSQL transactions in disposable databases and
IndexedDB behavior with fake-indexeddb. `bun run test:e2e` creates a separate database
and Next server on port 3001, signs in through the real UI, and exercises two browser
contexts, review staleness, discussions, queue reload, and archive/restore propagation.
The browser workflow also verifies suggestion acceptance/rejection, missed realtime recovery, invitation acceptance, and an invited reviewer granting approval. It does not touch the development database. Install Chromium with
`bunx playwright install chromium` before the first browser run.

The development-only sync inspector exposes cursor, connection/sync state, pending
count, entity count, last sync time and the latest error. Server logs contain metadata
only, never specification/comment content. Normal UI errors retain actionable text.

Jira, AI, SSO setup, billing, delivery decomposition, advanced policy configuration,
SCIM, notification delivery, private products, group administration, CRDT editing,
presence, service-worker offline launch, log compaction and large-history pagination
are intentionally not implemented. Functional groups already in the domain database
can receive reviews. No production UI pretends these deferred capabilities exist.
