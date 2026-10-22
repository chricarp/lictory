# Workspace synchronization and review invariants

The authenticated workspace uses Better Auth, the existing Drizzle domain tables,
and Markdown revisions. The application runs without Lictory Intelligence or delivery
integrations; Lictory Intelligence runs follow the same lock and change-log rules (see [Lictory Intelligence](ai.md)).

## Work items

Every kind of work is one entity, `workItem`. It belongs to exactly one
**project** (key and per-project `number`, rendered `KEY-number`; numbers are
allocated under the organization lock, plus its workflow and delivery
configuration) and at most one of its **teams**. Moving an item between teams
never changes its identifier, status or iteration. Its
`typeId` points into the organization's type registry (see
[delivery.md](delivery.md)); hierarchy follows type levels, so a parent's level is
strictly above its child's (Epic 2 > Story/Task/Bug 1 > Subtask 0), and the
server rejects any other parent or type change. Labels and milestones are
project-scoped and archivable. Sibling order under a parent is a sparse integer
`position` (`reorderWorkItem`); backlog and board order is a fractional `rank`
(`rankWorkItem` places between two neighbours and rewrites one row).

Two orthogonal states exist:

- `statusId` is the delivery status from the project's workflow. Any transition
  is allowed; each status has a fixed category (`backlog`, `unstarted`,
  `started`, `done`, `canceled`) that gives it meaning everywhere.
- `refinementState` (`draft`, `refinement`, `in_review`, `ready`) exists only on
  items whose type has a specification, and is `null` otherwise. `ready` is
  evidence-gated and never set by hand: the server promotes an item to `ready`
  when every readiness check passes and drops it back to `in_review` when
  readiness is lost. Requesting a review moves `draft`/`refinement` to
  `in_review`.

A project's readiness policy (`off`, `warn`, `block`) decides whether a spec-backed
item may move into a `started` status before it is ready. `block` rejects the
command with the failing checks; `warn` allows it and records
`startedBeforeReady` in the activity. Types without a specification are never
gated and have no readiness checks, reviews or suggestions. They can still have
non-blocking discussions, including file and image references. Their description
is stored as revisions, so history survives a type change.

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

`applyMutation` in `packages/core/src/domain/service.ts` is the domain
mutation boundary; browsers reach it through Zero's mutate endpoint and every
other surface through the shared capability layer (see
[capabilities.md](capabilities.md)). Route handlers obtain
the user from Better Auth, validate Zod protocol input, and require same-origin
cookie-authenticated writes. Every command checks current Better Auth organization
membership inside its transaction. Projects are organization-wide in this baseline:
there is deliberately no private-project ACL.

Three access concepts exist and must not be conflated (see
[organizations, projects and teams](organization-model.md)). **Application
roles** are fixed: Better Auth `member.role` owner/admin is `ADMIN` and
everything else is `MEMBER`. Administrators create and archive projects, invite
people, change application roles (through Better Auth `updateMemberRole`; the
last administrator cannot be demoted in the UI) and administer every project.
**Project roles** (`project_member`: admin or member) decide who configures a
project. **Disciplines** (`discipline`, `discipline_member`, per project) carry
five work item capabilities: `editSpecifications` (create spec-backed items,
save revisions, rename, close others' suggestions, merge suggestions once
assigned as reviewer), `changeProperties` (status, priority, owner, epic,
labels, milestones, ordering, archive, iteration planning, and plain work
items), `requestReviews` (request/cancel), `review` (the discipline or one of
its members can be assigned a review) and `publishDelivery` (hand-off to the
project's external tool). A person's capabilities in a project are the union
over the active disciplines they hold there; the server recomputes this from
the database inside every mutation and rejects with a message naming the
missing capability. Neither application nor project roles grant work item
capabilities. Discussion and suggestions need only organization membership.
Only an assigned user, or a current member of an assigned discipline, can decide
a review; holding a discipline never grants approval by itself.

Suggestion reviewers are individuals chosen by the suggestion's author and must
hold one active discipline of the item's project that grants **both**
`editSpecifications` and `review` (`canReviewSuggestions`); the author cannot
review their own suggestion.

Every project is seeded with Product (all capabilities), Engineering (requests,
reviews and changes properties) and QA (request + review) by `createProject`,
and its creator becomes a project administrator in Product
(`src/sync/server/projects.ts`). Disciplines archive rather than delete: an
archived discipline grants nothing and cannot be requested, keeps its name on
historical assignments, releases its name for reuse, and can be restored.
Project configuration commands (`updateProject`, `setProjectMember`,
disciplines, teams, workflow, enabled types, iterations) run through the same
locked transaction and receipt path, are recorded in `configuration_audit`, and
emit only the entities they move; configuration lives in the directory.

Organization creation, naming, invitations and acceptance remain Better Auth
operations. Settings create shareable invitation links; automated invitation email
is not configured. The sync directory is a small, fresh projection of Better Auth
organizations/members (with application role) and domain projects, project
members and disciplines, returned
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

## Projections and atomicity

Browsers read **projections**, never domain tables. `sync_entity` holds one row
per synchronized entity (`key` = `{type}:{id}`) with its organization, project,
optional work item and the versioned protocol projection as `data`. Zero
replicates `sync_entity` and the `member` columns used for authorization
(publication `lictory_zero`) to zero-cache; synced queries return only rows of
organizations the user is a member of, so deleting a membership removes them
from open subscriptions. Secrets, credentials and raw domain rows never reach a
projection.

Every domain writer maintains the projections **in the same transaction** as
its domain writes, after taking the organization advisory lock
(`pg_advisory_xact_lock(hashtextextended(organizationId, 0))`):

- `applyMutation(tx, actor, mutation, effects)` (`packages/core/src/domain/service.ts`)
  is the command boundary. It runs inside the caller's transaction: its own in
  `executeMutation` (capabilities, MCP, the embedded agent), Zero's in the
  mutate endpoint, where Zero's client bookkeeping commits with it. It locks,
  checks Better Auth membership, checks the idempotency receipt, applies the
  command, diffs before/after snapshots of the touched scope into projection
  upserts and deletes, writes rows of other scopes explicitly (a parent's
  readiness, runs owned by other items, readiness moved by configuration,
  activity of moved items), refreshes the directory and records the receipt.
- `advanceSchedules`, the Lictory Intelligence runner, delivery exports and
  status sync, branding, profile photos, handles, `seedOrganization` and the
  Better Auth hooks write projections the same way.

A failed projection write rolls back the domain change (covered by tests that
force `sync_entity` failures). Host side effects (analytics) run only after
commit. Never write domain rows that a projection depends on without writing
the projection in the same transaction.

The directory (`directory:{organizationId}`) carries the organization's
members (name, email, photo, handle, application role), projects, project
members, disciplines, teams, types, statuses, iterations, delivery connections
and targets (never credentials), the AI policy and each project's current
readiness checks. `organizationProfile:{organizationId}` carries name, slug and
logos. `refreshDirectoryProjection` rewrites them only when they differ; it
runs at the end of every mutation and after every Better Auth organization,
member, invitation and user change (Better Auth commits its own writes, so its
hooks refresh right after, each under the organization lock).

Idempotency: `sync_mutation` keeps a receipt (id, actor, SHA-256 fingerprint of
the command) for every applied mutation, whichever surface sent it. A replay
returns `replayed: true` and writes nothing; reusing an id for a different
command is a conflict. Zero additionally deduplicates its own client mutation
ids.

`rebuildProjections(db, organizationId)` recomputes every row from the domain
(organization scope, each work item's history, directory, profile) and
reconciles `sync_entity` under the lock. It is the operator recovery tool
(`bun scripts/rebuild-projections.ts [organizationId ...]`) and the invariant
the test suites check after their workflows: stored projections equal a
rebuild.

## Projection scopes

Organization-level rows (`work_item_id` NULL) are what lists, boards and the
Inbox read: projects, every work item summary (with derived review, thread,
suggestion, readiness and child counts), labels, milestones, relations,
external links, the directory and the profile. A work item's history
(revisions, branches, commits, pull requests and their reviews, reviews,
assignments, threads, messages, suggestions, approvals, readiness, Lictory
Intelligence runs, activity) belongs to that item and is loaded when it is
opened. Rows are routed by `projectionRow` (`packages/core/src/contracts/projection.ts`),
shared by server writers and client predictions so an optimistic row and the
authoritative row that replaces it share key and scope.

Iteration reports, the Definition of Ready history and impact preview, member
and Epic search are read on demand through capabilities; they are not
projected.

Delivery exports (see [delivery.md](delivery.md)) never go through the client
mutation path: they call external systems and tokens must not reach browsers.
Requesting an export reserves links and records a running publication in one
locked transaction; the worker performs the external calls outside the lock and
records each item's result with its projections. Automatic cycles are advanced
by `advanceSchedules` in the worker.

## Background work

Work that must not run inside a request (Lictory Intelligence runs, notification
email, delivery exports) is queued durably by rows written in the domain
transaction (`ai_run` queued, `notification_email` pending,
`delivery_publication` running) plus `pg_notify('lictory_work', 'ai' | 'email'
| 'delivery')` in the same transaction, delivered on commit. The worker listens
and also polls, so a lost signal only delays work. The API never runs
background loops. The jobs are library functions in `packages/core/src/jobs`.

The worker (`apps/worker`) runs one loop per job: AI runs, notification
email and delivery exports (woken by their signal, polled every 30 seconds),
delivery status sync (every ten minutes) and automatic cycles (every five
minutes). Each loop has at most one run in flight, re-runs at once while a
job reports a full batch, coalesces bursts of signals into one extra run, and
backs off after a failure without affecting the other loops. The LISTEN
connection is its own session (`DATABASE_URL_UNPOOLED`); whenever it is
re-established every job runs once, because signals sent meanwhile are lost.

Nothing the worker holds is needed for recovery. Claimed work carries a lease
in its row (AI run `started_at`, `delivery_publication.lease_until`,
`notification_email.lease_until`) and outcomes are fenced on it, so several
workers may run, and a worker may be killed at any point: the work is resumed
by whichever worker finds the lease expired, and a stale worker's late result
is discarded. On SIGTERM the worker stops scheduling, lets runs in flight
finish (`WORKER_SHUTDOWN_TIMEOUT_MS`, 25 seconds), cancels model calls five
seconds before that and hands interrupted work back, then flushes analytics
and exits; anything still running is recovered by its lease.

## Browser store and mutation lifecycle

The `WorkspaceProvider` owns one organization-scope engine for the session and a
small LRU of work item engines (opened items stay warm; each has its own IndexedDB
cache). An item engine nobody displays is suspended: it keeps its data but stops
following realtime signals, and synchronizes again when it is shown. One realtime
hub per organization shares the SSE connection, focus/online handlers and the
recovery interval across engines. An engine publishes a new view only when
something visible changed, so a check that found nothing new re-renders nothing
and does not rewrite its IndexedDB cache. The mutation queue is per
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
branch commits, every suggestion command and review decisions await server validation.
The confirmed entity map stays separate from overlays: deltas update confirmed state,
then pending overlays replay. The frontend checks a known blocking readiness policy
before queuing a status transition. The server remains authoritative when local
state is stale. On a definitive rejection the overlay is removed. Property updates
are forgettable: their rejected queue entry is deleted, including legacy entries
on hydration. Commands containing authored text retain their payload for recovery;
callers can explicitly choose whether a command is forgettable. Accepted commands synchronize
before their queue entry is removed. A crash at any intermediate point safely
replays the same mutation ID.

The queue processes in enqueue order. A definitive rejection on the first attempt
emits a live rejection event and rolls back its optimistic changes. Toasts subscribe
to these events, never to persisted queue snapshots, so reloading does not replay
old feedback. It does not appear in the synchronization dialog, mark synchronization as failed,
or block later commands, which
the server validates independently. Transport failures may have committed, so
later commands wait until their outcome is reconciled. That uncertainty survives
manual retry, even when the attempt counter resets; such commands cannot be forgotten. Network
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

Data reaches browsers through Zero. `/api/events?organizationId=` is a small
server-sent event stream for ephemeral signals only: presence
(`lictory_presence`, posted by viewing tabs to `/api/presence`, never stored)
and "your inbox changed" (`lictory_notification`, carrying only recipient ids).
PostgreSQL `NOTIFY` delivers both after commit and a process-wide `LISTEN`
connection fans them out. Streams are membership-checked, send keep-alive
comments and end after four minutes so reconnection revalidates the session.
Correctness never depends on the stream.

## Revisions, reviews and conflicts

Every material title/content change on **main** inserts an immutable revision.
Direct editing requires `editSpecifications` and is available until readiness
first passes. At that point `mainProtected` is latched: reopening a discussion,
revoking approval, restoring an old revision, or changing delivery properties
never re-enables direct writes. Subsequent changes use reviewed pull requests.
An explicit restore requires `editSpecifications`, the exact current revision,
and an earlier revision from the same item; it copies title/content into a new
revision, stales approvals and retains every historical snapshot and activity.
It does not restore delivery status, ownership or iteration properties.

## Branches and pull requests

Branches belong to one specification-backed work item. They version its title and
Markdown content (including acceptance criteria), while delivery properties stay
shared. `main` is the default target and represents the canonical specification;
branches can also start from and target other branches. Anyone with organization
membership can create a branch, but only its author and explicitly invited
collaborators can commit. Only its author manages collaborators. All branches and
PRs share the work item's access boundary; an uncommitted draft is personal and
stored in the browser under user/organization/item/branch identity.

A commit is an immutable snapshot with parent commit IDs, author and message.
A branch is a movable pointer. The first branch operation imports the item's
existing revision chain into the commit graph under the organization lock.
Subsequent main revisions advance main's pointer in that same transaction.
Branch commits never create main revisions or change main's readiness.

A commit includes the editor's base commit. The server combines independent
changes against that base and the current branch head. Overlapping line edits or
competing title edits require explicit resolution. The resolver shows base,
local and current content, supports choosing either side per conflict, keeping
both or editing manually, and allows discarding or replacing the complete draft.
An explicit resolution names the exact current head; a later commit rejects that
resolution rather than overwriting intervening work. Diff memory is bounded;
large ambiguous rewrites require manual resolution.

PRs have `draft`, `open` and `merged` states. Source commits continue updating an
open PR. PR review requests name an active reviewing discipline of the item's
project, optionally one person in it. Existing main review responsibilities are
copied when the PR is created. Decisions record a SHA-256 fingerprint of the
**complete resulting title and content**, plus the inspected branch heads in
activity. Contributors cannot approve their own source changes. Any source or
target change that alters the merge result makes its approvals stale; unchanged
resulting content retains its evidence. Review requests and stale approvals
appear in notifications and the attention inbox.

A merge requires every required PR review to approve the current result, at least
one required review, no current changes-requested decision, no open blocking PR
threads, and no unresolved merge conflicts. The request includes both inspected
heads; the server rechecks them under the organization transaction lock. Merging
into main requires `editSpecifications`; merging into another branch requires
being its collaborator. PR conflicts are resolved by committing a merge of the
target into the source branch, then reviewing the new result. PR discussions bind
to immutable commits and retain their original context as branches advance.

Merging into main creates a revision and installs the valid PR approvals as
reviews of that exact revision. It supersedes carried pending reviews of the same
responsibilities, avoiding a second approval ceremony. Main's other readiness
checks still apply, including existing blocking discussions and child readiness.
Merging into another branch changes only that branch's pointer.

After a successful merge into main, Lictory automatically deletes the source
branch in the same transaction and records a `branch_deleted` activity with
`automatic: true` and the merged PR's ID. Activity identifies Lictory as the
automatic actor while retaining the merge initiator for auditability. Commits,
the merged PR, its discussions, and approvals remain available. A source branch
still referenced by another draft or open PR is retained so that review can
continue; merges into other branches do not trigger automatic deletion.

PRs and non-main branches can be deleted by their author or a specification
editor. A branch referenced by an active PR must have those PRs deleted first.
Deletion emits atomic synchronization tombstones for its visible entities,
including PR review/discussion projections. Commits, decisions in activity,
merged main revisions and approvals remain durable. Main cannot be deleted.
There are no close/reopen or archive/restore branch/PR actions.

The legacy suggestion tables and commands remain for existing history and
compatibility tests; the user-facing workflow uses branches and PRs. Internal
list fields `openSuggestions` and `suggestionReviewerIds` include active PRs so
existing filters continue working. Protocol version **9** adds commit, branch,
PR and PR-review projections. All new commands preserve the shared organization
lock and atomic domain/change-log/activity/receipt boundary. Branch editor actions
wait for server confirmation before navigating or clearing their saved draft;
definitive rejected commands can be replaced by a corrected draft, while
transport failures retain their idempotency ID in synchronization.

Reviews are requested from a reviewing discipline of the item's project,
optionally naming one of its members; the discipline's name is the review
responsibility. Approvals belong to a
review/revision and an assigned reviewer. A material revision
ends granted approvals as stale with an actor, timestamp, and reason, and
**re-requests every active review on the new revision with the same assignments**;
the old review rows remain historical. An old completed review cannot satisfy
readiness. Which checks readiness requires is project configuration, versioned
like specifications (see [Definition of Ready](delivery.md#definition-of-ready)).
Lictory's defaults are: specification written; no open blocking threads; at
least one required review requested; every required responsibility approved on
the current revision; and, for items with spec-backed children, every child
ready. Readiness is
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
renders in pages of 50. SSO setup, billing, custom fields,
comments on items without a specification, saved views, advanced policy
configuration, SCIM, private projects,
CRDT editing, multiplayer cursors, service-worker offline
launch, log compaction, and server-side pagination of organization-wide summaries
and large histories are intentionally not implemented. No production UI pretends
these deferred capabilities exist.

## Initial workspace setup

Guided onboarding carries explicit project configuration and accepted/deferred
setup decisions on the first `createProject` command. Its project, seeded
workflow and disciplines, optional automatic cycles, historical `organization_onboarding` decision record, projections
and receipt share the existing authorized organization transaction. The setup
snapshot is not current configuration and is never used as a client checkpoint.
See [onboarding.md](onboarding.md) for the decision and recovery semantics.

## Synchronization recovery

The workspace sync dialog reports connection, storage and unexpected server
failures, while expected application rejections stay in contextual feedback.
Transient failures retry automatically; after the retry limit, users can resume
saving with one action. Recovery reuses mutation IDs and preserves queue order
to reconcile writes whose outcome is unknown. Refreshing the workspace replaces
organization and item caches with fresh server reads without dropping queued
changes or editor drafts. Technical error messages are available on demand;
commands and serialized payloads are not exposed in the dialog.
