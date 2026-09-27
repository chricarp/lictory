# Delivery model

Lictory runs delivery natively or hands it to an external tool, per team. The
refinement workflow (revisions, reviews, approvals, readiness) is identical in
both modes; this document covers the delivery concepts built around it.

## Projects and teams

A **project** owns identity: the key and item numbers (`PAY-142`), labels,
milestones and specifications. A **team** owns how work is delivered: its
workflow, enabled types, estimate scale, iterations, board, delivery mode and
readiness policy. Every item belongs to one project and one team; a project has
a default team for new items. Moving an item to another team keeps its key and
maps its status to the first active status of the same category in the new
team. Team membership organizes people and never grants permissions; roles do.

## Types

Types are an organization-wide registry (Epic, Story, Task, Bug, Subtask by
default, seeded with every organization) that teams opt into. A type has a
**level** that orders the hierarchy and a **specification** flag. Spec-backed
types are refined and reviewed; others are plain work with a revisioned
description. Turning the flag on starts refinement at `draft`; turning it off
hides refinement but never deletes revisions or discussions. Archiving a type
stops new use; existing items keep it.

## Workflows

Each team has its own statuses, each in a fixed category (`backlog`,
`unstarted`, `started`, `done`, `canceled`). Any transition is allowed; there are
no transition rules. Categories give statuses meaning for boards, burndown,
child progress and readiness gating. Archiving a status requires choosing a
replacement: its items move explicitly and each move is recorded in activity.

## Readiness policy

Readiness connects refinement to delivery. The team policy decides what happens
when a spec-backed item that is not `ready` moves into a `started` status (native
mode) or would be published (external mode):

- `off`: readiness is informative only.
- `warn` (default): the move succeeds and the activity records the failing checks.
- `block`: the server rejects the move with the failing checks.

## Iterations

Sprints and cycles are one concept, `iteration`, with a team-level mode:

- `manual` (sprints): create, plan, start and complete explicitly. Completion
  moves unfinished work to a chosen planned iteration or the backlog.
- `automatic` (cycles): a length and start weekday. The scheduler keeps one
  cycle active and a configured number planned ahead, completes a cycle when it
  ends and rolls unfinished work into the next one.

At most one iteration per team is active. Completed iterations are history:
work cannot be planned into them, and later edits do not change their reports.
Planning requires the `changeProperties` capability, like moving cards.

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
which is deterministic from stored state and `now`, so retries and overlapping
runs are safe. Three runners call the same function:

- `POST /api/jobs/iterations` with `Authorization: Bearer $CRON_SECRET`. This is
  the recommended target for Trigger.dev or another hosted scheduler when running
  on serverless Next.js. The route is disabled until `CRON_SECRET` is set.
- `bun scripts/iteration-worker.ts` for self-hosted/Docker installations.
- A team switching to automatic cycles runs the job for that team immediately.

Nothing in the domain depends on a scheduler vendor.

## External delivery

In external mode a team refines in Lictory and publishes to a delivery system
through a provider adapter. Exactly one system owns delivery state for a given
item: Lictory does not plan iterations for external teams, and external status
will be read-only metadata on `work_item_external_link`. Publishing itself is
not implemented yet.
