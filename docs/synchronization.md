# Workspace synchronization and review invariants

The authenticated workspace uses Better Auth, the existing Drizzle domain tables,
and Markdown revisions. The application runs without AI or delivery integrations.

## Work items

Epics, Stories and Tasks are one entity, `workItem` (`kind`, optional `parentId`,
per-project `number`, `status`, `priority`, `assigneeId`, `milestoneId`,
`labelIds`, `position`). The physical table is `work_item` with `work_item_id`
foreign keys (migration `0004` renamed the original `proposal` table and columns in
place; nothing was copied or dropped). Labels (`label`, `work_item_label`) and
milestones (`milestone`) are project-scoped, archivable, and synchronized as
project-level entities in the organization scope. Assigning them is a
non-material property change. Sibling order is a sparse integer `position`
maintained by `reorderWorkItem` (place before a sibling, or last); collisions
renumber the siblings in one transaction. Identifiers render as `KEY-number` from the
project `key`; numbers are allocated under the organization lock. Stories belong
to an Epic; Tasks belong to an Epic or a Story; Epics have no parent.

Status is user-controlled among `backlog, draft, refinement, in_review, ready,
in_progress, done, cancelled`. `ready` is evidence-gated: the server rejects a
manual move to `ready` while a readiness check fails, promotes an item to `ready`
automatically when every check passes (only from pre-ready statuses) and drops it
back to `in_review` when readiness is lost. Requesting a review moves a backlog/
draft/refinement item to `in_review`. Later statuses are never touched
automatically. Property changes (status, priority, owner, epic) are non-material:
they create no revision and never stale approvals.

Every work item summary carries derived review, thread, suggestion, readiness and
child counts so lists, Inbox and "Needs my review" work from the organization
store without loading histories. Activity is structured (`action` + `detail`).

## Server authority and authorization

`src/sync/server/service.ts` is the domain mutation boundary. Route handlers obtain
the user from Better Auth, validate Zod protocol input, and require same-origin
cookie-authenticated writes. Every command checks current Better Auth organization
membership inside its transaction. Projects are organization-wide in this baseline:
there is deliberately no private-project ACL. Owners/admins manage projects; members
may refine, discuss, suggest, archive, and request reviews. Only an assigned user,
or a current member of an explicitly assigned functional group, can decide a review.
Group membership alone does not confer approval authority.

Organization creation, naming, invitations and acceptance remain Better Auth
operations. Settings create shareable invitation links; automated invitation email
is not configured. The sync directory is a small, fresh projection of Better Auth
organizations/members and domain projects/groups, returned on every sync response.
This also discovers membership and directory changes made through Better Auth.

When adding private projects, change **both** bootstrap and delta authorization,
and introduce access epochs/reset or scoped tombstones before enabling the UI.
The existing organization-wide policy must never be mistaken for a private-project
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
organization, project, optional proposal context, cursor, and upsert/delete envelope.
A proposal archive is a reversible upsert with `archivedAt`, preserving history.
The reconciliation protocol supports deletion tombstones; this slice exposes no
hard-delete domain command. Future deletion commands must append tombstones in the
same transaction. Log retention/compaction is deliberately not enabled: never drop
old changes without adding an expired-checkpoint/reset protocol first.

## Scopes and recovery

Protocol version 3 (projects were previously called products) has organization, project, and work item scopes, expressed by
organization ID plus optional project and work item IDs. A work item scope requires
a project. Organization bootstrap contains projects and **every work item summary**
in the organization (the browser's list store); project bootstrap narrows that to
one project; work item bootstrap adds its revisions, discussions, suggestions,
reviews, assignments, approvals, readiness and activity. It does not send unrelated
item histories. A child's mutation additionally emits its parent Epic's readiness
projection, because `stories_ready` lives in the Epic's scope. Historical content is currently loaded for one proposal as a
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

The `WorkspaceProvider` owns one organization-scope engine for the session and a
small LRU of work item engines (opened items stay warm; each has its own IndexedDB
cache). One realtime hub per organization shares the SSE connection, focus/online
handlers and the recovery interval across engines. The mutation queue is per
user/organization and shared by all engines, so an optimistic change made from an
item engine is visible in lists after the next BroadcastChannel signal.
React reads normalized `{type}:{id}` entities through `useSyncExternalStore`.
Components issue typed domain commands; persistence, queue behavior, and optimistic
logic are below the UI boundary. IndexedDB is behind a `Persistence` interface.
Data and its checkpoint are written in one IndexedDB transaction. Queue entries
are separate records, so two tabs do not overwrite each other's pending work.

A command receives a client UUID, is durably queued, then gets an optimistic overlay.
Item/project creation, property updates, archive, threads, replies, thread state,
review requests and cancellations have centralized optimistic reducers (a created
item predicts its number; the server's number replaces it). Revision changes,
suggestions and review decisions await server validation.
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
The same SSE stream forwards **presence** events (`lictory_presence`): a viewing
tab posts `/api/presence` heartbeats (membership-checked) and the client expires
entries after 45 seconds. Presence is never stored and never affects correctness.
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
ends granted approvals as stale with an actor, timestamp, and reason, and
**re-requests every active review on the new revision with the same assignments**;
the old review rows remain historical. An old completed review cannot satisfy
readiness. Checks: specification written; acceptance criteria present (stories and
tasks; parsed from the `## Acceptance criteria` section); no open blocking threads;
at least one required review requested; every required responsibility approved on
the current revision; and, for Epics with stories, every story ready. Readiness is
computed server-side; the status is only a workflow summary. Threads may quote the
text they discuss; the quote is interpreted against the thread's revision and the
UI reports when it no longer appears. Resolving/reopening threads never
deletes messages; durable activity records retain these actions.

## Verification and deferred work

`bun run test:sync` tests real PostgreSQL transactions in disposable databases and
IndexedDB behavior with fake-indexeddb. `bun run test:e2e` creates a separate database
and Next server on port 3001, signs in through the real UI, and exercises onboarding, Epic and inline Story
creation, inline properties, invitation acceptance, review request, "Needs my
review", blocking discussion and reply, suggestion acceptance, approval, staleness
after a revision with the reviewer's "changed since" diff, resolution → readiness →
Ready, keyboard navigation and the command palette, queue reload after network loss,
and archive/restore propagation across two browser contexts. It does not touch the development database. Install Chromium with
`bunx playwright install chromium` before the first browser run.

The development-only sync inspector exposes cursor, connection/sync state, pending
count, entity count, last sync time and the latest error. Server logs contain metadata
only, never specification/comment content. Normal UI errors retain actionable text.

List filters, sort and grouping live in the URL (`?status=…&label=…&sort=…`);
`/app/[org]/items/KEY-n` resolves any identifier to its project route. The Inbox
renders in pages of 50. Jira, AI, SSO setup, billing, delivery decomposition,
advanced policy configuration, SCIM, notification delivery, private projects,
group administration, CRDT editing, multiplayer cursors, service-worker offline
launch, log compaction, and server-side pagination of organization-wide summaries
and large histories are intentionally not implemented. Functional groups already in the domain database
can receive reviews. No production UI pretends these deferred capabilities exist.
