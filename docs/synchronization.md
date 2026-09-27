# Workspace synchronization and review invariants

The authenticated workspace uses Better Auth, the existing Drizzle domain tables,
and Markdown revisions. The application runs without AI or delivery integrations.

## Work items

Every kind of work is one entity, `workItem`. It belongs to exactly one
**project** (key and per-project `number`, rendered `KEY-number`; numbers are
allocated under the organization lock) and exactly one **team** (workflow and
delivery). Moving an item between teams never changes its identifier. Its
`typeId` points into the organization's type registry (see
[delivery.md](delivery.md)); hierarchy follows type levels, so a parent's level is
strictly above its child's (Epic 2 > Story/Task/Bug 1 > Subtask 0), and the
server rejects any other parent or type change. Labels and milestones are
project-scoped and archivable. Sibling order under a parent is a sparse integer
`position` (`reorderWorkItem`); backlog and board order is a fractional `rank`
(`rankWorkItem` places between two neighbours and rewrites one row).

Two orthogonal states exist:

- `statusId` is the delivery status from the item's team workflow. Any transition
  is allowed; each status has a fixed category (`backlog`, `unstarted`,
  `started`, `done`, `canceled`) that gives it meaning everywhere.
- `refinementState` (`draft`, `refinement`, `in_review`, `ready`) exists only on
  items whose type has a specification, and is `null` otherwise. `ready` is
  evidence-gated and never set by hand: the server promotes an item to `ready`
  when every readiness check passes and drops it back to `in_review` when
  readiness is lost. Requesting a review moves `draft`/`refinement` to
  `in_review`.

A team's readiness policy (`off`, `warn`, `block`) decides whether a spec-backed
item may move into a `started` status before it is ready. `block` rejects the
command with the failing checks; `warn` allows it and records
`startedBeforeReady` in the activity. Types without a specification are never
gated and have no readiness checks, reviews, suggestions or discussions; their
description is still stored as revisions, so history survives a type change.

Property changes (status, refinement moves before ready, type, team, iteration,
estimate, priority, owner, parent, labels, milestone) are non-material: they
create no revision and never stale approvals. A child created under a
spec-backed parent records the parent's current revision in `sourceRevisionId`,
so clients can show work derived from an older revision.

Every work item summary carries derived review, thread, suggestion, readiness and
child counts (`childDoneCount`, `childReadyCount`, `childEstimate`) so lists,
boards, Inbox and "Needs my review" work from the organization store without
loading histories. Activity is structured (`action` + `detail`); status changes
record the status names at the time, so renaming or archiving a status never
rewrites history.

## Server authority and authorization

`src/sync/server/service.ts` is the domain mutation boundary. Route handlers obtain
the user from Better Auth, validate Zod protocol input, and require same-origin
cookie-authenticated writes. Every command checks current Better Auth organization
membership inside its transaction. Projects are organization-wide in this baseline:
there is deliberately no private-project ACL.

Two kinds of role exist and must not be conflated. **Application roles** are fixed:
Better Auth `member.role` owner/admin is `ADMIN` and everything else is `MEMBER`.
Administrators create/rename projects, invite people, change application roles
(through Better Auth `updateMemberRole`; the last administrator cannot be demoted
in the UI) and manage organization roles. Application roles grant no workflow
capability. **Organization roles** (`organization_role`, `organization_role_member`)
are administrator-managed named member collections carrying four capabilities:
`editSpecifications` (create items, save revisions, rename, close others'
suggestions, merge suggestions once assigned as reviewer), `changeProperties` (status, priority, owner, epic, labels,
milestones, ordering, archive, and the label/milestone lists), `requestReviews`
(request/cancel) and `review` (the role or one of its members can be assigned a
review). A person's effective capabilities are the union over the active roles
they hold; the server recomputes this from the database inside every mutation and
rejects with a message naming the missing capability. Discussion and suggestions
need only membership. Only an assigned user, or a current member of an assigned
role, can decide a review; holding a role never grants approval by itself.
Suggestion reviewers are individuals chosen by the suggestion's author and must
hold one active role that grants **both** `editSpecifications` and `review`
(`canReviewSuggestions`); the author cannot review their own suggestion.

Every organization is seeded with Product (all capabilities), Engineering and QA
(request + review) by the Better Auth `afterCreateOrganization` hook, and the
creator joins Product (`src/sync/server/roles.ts`; migration `0007` did the same for
pre-existing organizations). Roles archive rather than delete: an archived role
grants nothing and cannot be requested, keeps its name on historical assignments,
releases its name for reuse, and can be restored. Role commands (`createRole`,
`updateRole`, `setRoleMembership`) run through the same locked transaction and
receipt path but emit no entity changes; roles live in the directory.

Organization creation, naming, invitations and acceptance remain Better Auth
operations. Settings create shareable invitation links; automated invitation email
is not configured. The sync directory is a small, fresh projection of Better Auth
organizations/members (with application role) and domain projects/roles, returned
on every sync response. This also discovers membership and directory changes made
through Better Auth; a client that changes an application role calls `sync()`.

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

Protocol version 8 (external links as project-level entities, delivery connections and targets in the directory, the export capability; version 7 added teams, the type registry, workflow statuses, iterations and relations; version 6 gave suggestions distinct titles and descriptions; version 5 added the pull-request lifecycle; version 4 replaced functional groups with roles; projects were previously called products) has organization, project, and work item scopes, expressed by
organization ID plus optional project and work item IDs. A work item scope requires
a project. Organization bootstrap contains projects and **every work item summary**
in the organization (the browser's list store); project bootstrap narrows that to
one project; work item bootstrap adds its revisions, discussions, suggestions (with their
reviewers and decisions), reviews, assignments, approvals, readiness and activity. It does not send unrelated
item histories. A child's mutation additionally emits its parent's readiness
projection, because `children_ready` lives in the parent's scope. Relations are
project-level entities routed with their source item's project; removing one
writes a tombstone (`delete` change) in the same transaction.

Delivery configuration (teams with their members, enabled types and statuses;
the type registry; planned, active and the most recent completed iterations) is
part of the **directory**, like roles, and is refreshed on every read. Its
commands therefore write no configuration entities, but a command that also
moves items (archiving a status with a replacement, completing an iteration
with carry-over, automatic cycles) diffs the organization snapshot and emits the
affected work items like any other change. Iteration reports are read on demand
(`?iteration=1`) and replay recorded events on the server.

Delivery exports (`/api/delivery`, see [delivery.md](delivery.md)) are
online-only and never enter the durable client mutation queue: they call
external systems, and tokens must not reach browser storage. Like
`advanceSchedules`, they take the organization lock for each local write,
emit `externalLink` (and `activity`) changes and advance the clock without a
mutation receipt; external calls run between those short transactions, never
inside them.

Automatic cycles are advanced by `advanceSchedules`, an idempotent server job
invoked by a scheduler (see [delivery.md](delivery.md)). It takes each
organization's lock, writes change-log rows and advances the clock exactly like a
command, but writes no mutation receipt. Historical content is currently loaded for one proposal as a
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
Searchable member and Epic selectors use separate, membership-checked read queries
with server-side filtering and 20-row pagination. These lookup reads do not produce
changes, receipts, or checkpoints; selecting a value still goes through the normal
domain mutation boundary.

A command receives a client UUID, is durably queued, then gets an optimistic overlay.
Item/project creation, property updates, archive, threads, replies, thread state,
review requests and cancellations have centralized optimistic reducers (a created
item predicts its number; the server's number replaces it). Revision changes,
every suggestion command and review decisions await server validation.
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
insert snapshots. Commands carry the exact base revision; a stale save or stale
suggestion merge returns a structured conflict with the current revision ID. There
is no automatic text merge. The editor retains the user's text and offers the
latest revision for inspection/reload; failed queued text can be inspected before
discarding and submitting a corrected command.

## Suggestions

A suggestion is a whole-document replacement reviewed like a pull request:
its short title identifies it in lists, and its description explains the reason
and context for reviewers. Existing suggestions without a title still use their
legacy rationale as a heading. Changing only these details does not change the
proposed specification version or invalidate review decisions. Its lifecycle is
`draft → open → merged | closed`, with `closed → draft | open` reversible and
`merged` terminal. It records the mainline revision it was written against and a
`version` that increments on every content update. Only the author updates it
(`updateSuggestion`, which always re-bases onto the current revision; unchanged text
keeps its approvals), changes its state (anyone with `editSpecifications` may also
close it) and assigns or withdraws reviewers. Reviewers approve or request changes
on a named version; a decision on another version is a conflict. A new version
supersedes existing decisions with a reason; history is never deleted. Threads may
target a suggestion instead of the specification: they are excluded from the work
item's thread counts and readiness, and an open blocking one prevents merging.
Merging requires an assigned reviewer who currently holds `editSpecifications`, an
open suggestion based on the current revision, at least one unsuperseded approval of
the current version and no open blocking suggestion thread; it inserts the next
revision through the same helper as a direct save (staling approvals and
re-requesting reviews) and records the merged revision on the suggestion. Work item
summaries carry `openSuggestions` and `suggestionReviewerIds` (reviewers still
awaiting the current version) so "Needs my review" and the Inbox include them.
Migration `0008` mapped existing `pending/accepted/rejected` rows to
`open/merged/closed`.

Reviews are requested from a reviewer-capable role, optionally naming one of its
members; the role's name is the review responsibility. Approvals belong to a
review/revision and an assigned reviewer. A material revision
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
renders in pages of 50. AI, SSO setup, billing, custom fields,
comments on items without a specification, saved views, advanced policy
configuration, SCIM, notification delivery, private projects,
CRDT editing, multiplayer cursors, service-worker offline
launch, log compaction, and server-side pagination of organization-wide summaries
and large histories are intentionally not implemented. No production UI pretends
these deferred capabilities exist.
