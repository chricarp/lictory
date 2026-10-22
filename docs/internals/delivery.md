# Delivery model

Lictory runs delivery natively or hands it to an external tool, per project.
The refinement workflow (revisions, reviews, approvals, readiness) is identical
in both modes; this document covers the delivery concepts built around it.

## Projects and teams

A **project** owns identity (the key and item numbers, `PAY-142`) and how its
work is delivered: workflow, enabled types, estimate scale, iterations, delivery
mode, readiness policy and Definition of Ready, labels and milestones. A **team** is an optional group
of people inside one project (a vertical such as Board or Auth). Every item
belongs to one project and at most one of its teams; moving it between teams
keeps its key, status and iteration. Boards and backlogs are project views that
can be narrowed to a team, and each team has a backlog of its unplanned work
with an intake of the project's unclaimed items. See [organizations, projects and teams](organization-model.md)
for ownership and access.

## Types

Types are an organization-wide registry (Epic, Story, Task, Bug, Subtask by
default, seeded with every organization) that projects opt into. A type has a
**level** that orders the hierarchy and a **specification** flag. Spec-backed
types are refined and reviewed; others are plain work with a revisioned
description. Turning the flag on starts refinement at `draft`; turning it off
hides refinement but never deletes revisions or discussions. Archiving a type
stops new use; existing items keep it.

## Workflows

Each project has its own statuses, each in a fixed category (`backlog`,
`unstarted`, `started`, `done`, `canceled`). Any transition is allowed; there are
no transition rules. Categories give statuses meaning for boards, burndown,
child progress and readiness gating. Archiving a status requires choosing a
replacement: its items move explicitly and each move is recorded in activity.

## Readiness policy

Readiness connects refinement to delivery. The project policy decides what happens
when a spec-backed item that is not `ready` moves into a `started` status:

- `off`: readiness is informative only.
- `warn` (default): the move succeeds and the activity records the failing checks.
- `block`: the server rejects the move with the failing checks.

## Definition of Ready

Which evidence makes a specification ready is the project's choice, per work
item type ("A Story is ready when…"). Project administrators edit it in project
settings. Each type has its own list of checks; a type without one uses
Lictory's defaults (all built-in checks), so a project that never edits it, or a
type added later, needs no configuration. Kinds of checks:

- Built-in evidence, each at most once per type: specification written, no
  open blocking discussion, a required review requested, every required review
  approved on the current revision, every spec-backed child ready (skipped
  without children).
- Required section: a heading (any level) whose section is not empty, such as
  "Acceptance criteria" or "Failure behavior".
- Discipline approval: each chosen reviewing discipline approved the current
  revision.
- Sign-off: a named confirmation by a member of the chosen disciplines (or
  anyone holding a discipline in the project). A sign-off belongs to the
  specification revision it was given on, so a new revision needs a new one;
  withdrawing keeps the record.

Labels are derived from what a check verifies, so a name never claims more
than the check does; only sign-offs are named by people.

The Definition of Ready is versioned: publishing writes the next immutable
`readiness_revision` (shown as a version), recording the defaults as version 1
the first time. The editor works on a draft and shows what changed per type;
before publishing, a read-only preview evaluates the draft against the
project's items (how many keep their version, which become ready, which would
need more work and why). Publishing names the version it was edited from; a
concurrent publication is rejected rather than overwritten. Evaluation follows
these rules:

- Items that are `ready`, or whose status is done or canceled, keep the version
  they were evaluated under (`work_item.readiness_revision_id`), so finished
  work never loses readiness because the rules changed.
- Every other item follows the latest version and moves with its evidence in
  the same transaction: it becomes `ready` when the new checks pass. Children
  feed their parent's `children_ready`, so this repeats until nothing moves.
- A kept item that stops being ready and is not done (a blocking discussion, a
  new revision, a reopened status) moves to the latest version; the activity
  records the move.

Item activity records automatic refinement changes caused by a publication.
These changes do not send notifications; a bulk configuration change would
otherwise notify everyone involved in every affected item.

## Iterations

Sprints and cycles are one concept, `iteration`, with a project-level mode:

- `manual` (sprints): create, plan, start and complete explicitly. Completion
  moves unfinished work to a chosen planned iteration or the backlog.
- `automatic` (cycles): a length and start weekday. The scheduler keeps one
  cycle active and a configured number planned ahead, completes a cycle when it
  ends and rolls unfinished work into the next one.

At most one iteration per project is active. Completed iterations are history:
work cannot be planned into them, and later edits do not change their reports.
Planning requires project administration or the `changeProperties`
capability of a discipline in the project. Moving cards requires
`changeProperties`.

## Estimates and reports

Estimates are integers on items (T-shirt sizes map to points); parents show the
sum of their children. Burndown, scope change and velocity come from
`iteration_event` rows written in the same transaction as the change (item
added or removed, estimate changed, completed, reopened), never reconstructed
from current state. At completion the totals are frozen into the iteration's
`summary`, so a sprint report does not change retroactively.

## Relations

`blocks`, `relates` and `duplicates` are directed rows; inverse labels (blocked
by, duplicated by) are derived. Relations may cross projects and teams within an
organization. A reverse `blocks` pair is rejected.

## Scheduled work

Automatic cycles need a clock. The domain job is `advanceSchedules(db, now)`,
which is deterministic from stored state and `now`, and each organization is
advanced under its organization lock, so retries and overlapping runs (several
worker processes) are safe; an organization that fails is retried on the next
run without holding up the others. The worker (`apps/worker`) runs it every
five minutes (`WORKER_SCHEDULES_INTERVAL_MS`), and a project switching to
automatic cycles runs it for that project immediately. Nothing in the domain
depends on a scheduler vendor. See
[background work](synchronization.md#background-work).

## External delivery

In external mode a project refines in Lictory and hands work off to a delivery
system through a provider adapter (`src/delivery/provider.ts`; Jira Cloud
first). Exactly one system owns delivery state for a project's work: external
projects do not plan iterations or estimate in Lictory, and only external
projects export. Their hand-off view shows what is ready, what changed since it
was handed off, what Jira reports, and what needs attention.

Export is explicit and evidence-gated, independent of the readiness policy:

- Only `ready` spec-backed items are exported. Exporting an item with its
  subtree refuses entirely when the root is not ready; not-ready descendants
  (and everything under them) are skipped. Plain items (tasks, subtasks) go
  along only under an exported parent.
- Lictory owns summary, description (latest revision, including acceptance
  criteria) and labels, pushed one-way on each export. Labels added in Jira
  are kept. Status, assignee, sprint and comments are Jira's; status, its
  category and the assignee are copied back read-only on each export and by
  the worker's status sync (every ten minutes, least recently checked links
  first, bounded batches) or an on-demand refresh. The sync never writes
  Jira and never changes Lictory-owned fields.
- Unchanged items (same payload hash) are not written. Items whose owned
  fields were edited in Jira since the last export, and items linked to an
  existing issue but never exported, are held as conflicts until the
  requester confirms overwriting that item.
- Every export is a `delivery_publication` with a result per item. Requesting
  an export reserves the links and records the running publication, then
  returns; the worker exports the items and clients follow progress through
  `getDeliveryPublication` until it settles. Parents go first; a failed parent
  skips its subtree. Failed items are exported again by themselves.
- No duplicates: links are reserved before the first call, a create attempt
  is committed before it is made, and the `lictory.item` issue property lets a
  crashed create be found and adopted. A recent attempt that cannot be
  confirmed yet is left running and retried by the worker 30 seconds later.
  An issue create is never retried blindly by the Jira client (a timeout or
  5xx may have created it); only the confirmation search decides.
- One runner per publication: the worker claims it with a five-minute lease
  and renews the lease while it works. Every item result and create attempt
  is written only while the lease is still held, so a runner that stalled
  past its lease records nothing; the new owner redoes the item, adopting a
  create through the attempt marker. Items already settled are never redone,
  so a resumed export keeps its partial results. On shutdown the runner stops
  between items and releases the lease for the next worker. Jira requests
  time out after 30 seconds.
- Network calls never run inside the organization lock; each item's outcome
  commits with its projections and an `exported` activity.
- Organization administrators connect Jira sites (credentials). Each project's
  administrators choose its Jira project and type mapping. Exporting and
  linking require the "Hand off to delivery tools" capability of a discipline
  in the project.
