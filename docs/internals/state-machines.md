# State machines

Much of Lictory is things that move between a few states: a pull request is a
draft, then open, then merged; an iteration is planned, active, completed; an
export is queued, running, ready. The rule for which moves are possible must
live in one place. When it is written again in a command, a button and a tool
description, the copies drift: the button offers what the server refuses, and
an agent learns the rule only by being refused.

Every stored status has exactly one home. Which home depends on who moves it.

## Statuses people move: declared machines

A status that a person (or an agent acting for one) moves is declared in
`packages/core/src/contracts/state-machines.ts`: its states and what they
mean, the steps between them, the states each step is allowed from, and the
sentence a person reads when it is refused. Declared today: specification pull
requests, page pull requests, suggestions, reviews, the refinement state and
iterations.

Three readers use the same table, so they cannot disagree:

- **The server refuses from it.** A command calls `requireStep(machine, state,
step)`. The refusal is a `DomainError` with the table's sentence and kind
  `invalid_state`: the entity is not in a state that allows this, so read it
  again instead of retrying.
- **The browser offers from it.** A component asks `machine.allows(state,
step)` to show or hide an action. It does not compare status literals to
  decide what is possible. Components written before the tables still do in
  places; move them to `allows` when you change them.
- **Agents read it.** Command descriptions take their sentence about states
  from `machine.rule(step)`, so MCP tools and Litto state the rule the server
  enforces.

The table knows states, not people. Who may take a step stays with the
capability checks of the command (see [capabilities](capabilities.md)). What
else must be true (required approvals, no conflicts, readiness evidence) stays
with the evaluation that owns it; a step being allowed from a state means only
that the state does not forbid it.

Some conventions of the table:

- A step marked `idempotent` accepts the state it leads to: marking a draft as
  draft changes nothing and is not an error. `allows` stays strict, so the
  browser never offers a step that would do nothing.
- A step marked `automatic` is taken by the server as a consequence of other
  facts and is never offered. Readiness is the example: nobody chooses
  `ready`; it follows from the checks, and a person cannot move a ready
  specification back while they pass.
- A state listed as `derived` is read from another column. Closing a pull
  request records a deletion time beside its status; `pullRequestState` and
  `pullRequestIsActive` read both.
- A specification pull request can be closed after it merged (it leaves the
  item; the text stays in the specification). A merged page pull request is
  history and cannot be closed. The two tables say so; do not unify them.

## Statuses that follow from something else

`statusColumns` in the same file lists every other status or state column of
the database and names what decides how it moves:

- **consequence**: written only as the result of another command or fact. An
  approval becomes stale because a revision changed, never because someone
  set it. Look for the rule in the command named as its owner.
- **job**: background work that one module claims and settles under a lease
  (Intelligence runs, exports to delivery tools, notification email, data
  exports, organization deletion, Litto runs). The claim is one conditional
  update and every later write is fenced by the lease or attempt, so a crashed
  worker cannot overwrite a newer one. Keep all writes of a job's status in
  its module.
- **toggle**: two states with both directions always allowed (a discussion is
  open or resolved).
- **free**: a label people set to any value. Workflow statuses and milestone
  statuses are free on purpose: transition rules would make Lictory a
  workflow builder.
- **external**: written by a library; Lictory only reads it.

`state-machines.test.ts` reads the schema and fails when a column named
`status` or `state` (an enum ending in `_status` or `_state`, or a text
column) is missing from the list, or when a declared machine and its enum
disagree. A new status therefore does not ship until someone decides how it
moves.

## State that is computed, never stored

Several things read like a status but are computed from facts, and have one
function that computes them. Call it; do not rebuild it from the fields.

- Where a work item stands (proposal, refinement, review, ready, committed,
  underway, completed, canceled): `lifecycleStage`, `readyForSelection`,
  `isAmended` and `refinementQueueStage` in `packages/core/src/lib/lifecycle.ts`
  (see [lifecycle](lifecycle.md)).
- Readiness: the checks in `packages/core/src/contracts/readiness.ts`.
- What stands between a pull request and its merge: `mergeBlockers`
  (`contracts/merge-readiness.ts`) for specifications, `evaluatePullRequest`
  (`spaces/history-state.ts`) for pages, whose result is projected as
  `mergeability`.
- Whether a page review still counts: `currentReview` (neither withdrawn nor
  stale).

## State of the interface

A component whose own progress has three or more states (saving, saved,
failed; a multi-step form) keeps it in one value that names the state, not in
several booleans that can contradict each other. `SaveState` in
`apps/platform/src/components/spaces/editor/session.ts` and the connection
states in `apps/platform/src/data/connection.ts` are the pattern.

## Changing a machine

1. Change the table. A new state needs a meaning; a new step needs its
   refusal sentence.
2. Call `requireStep` in the command that performs the step, before any write.
3. Use `allows` where the browser offers the step and `rule` in the command's
   description.
4. Consider the inverse step (resolve and reopen, mark ready and mark draft).
   A state nothing leaves should be final on purpose.
5. A new enum value is a schema change: follow
   [database migrations](../operations/migrations.md).
