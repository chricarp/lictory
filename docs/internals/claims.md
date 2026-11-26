# Claims, autonomy and the Definition of Done

The factory loop's domain core: which work an agent may take, how it holds
it, how it asks people, how much the factory does by itself, and how work
reaches Done from evidence. The concepts are introduced in
[the software factory](software-factory.md#claims-and-the-factory-loop);
this document owns their rules. Code: `packages/core/src/claims/`, tables in
`db/claims-schema.ts`, capabilities in `capabilities/claims.ts`.

## Claims

A **claim** is a lease by an agent on one native delivery item. It names the
agent (its id and name when it claimed), the agent session when there is
one, and the **owner**: the accountable person the agent acts for. Agent and
session ids are plain text: the Factory module owns those tables, and a claim
stays readable history after an agent is removed.

The claim is a declared state machine (`claim` in
`contracts/state-machines.ts`):

```text
starting ─activate─▶ active ⇄ waiting (ask / resume)
   │                  │          │
   └──── release / expire / complete ──▶ released | completed
```

- `starting`: the dispatcher reserved the item while it starts a session.
- `active`: an agent works and renews the lease.
- `waiting`: the agent asked people a question. A waiting claim holds the
  item without a lease until every question it asked is resolved.
- `released` and `completed` are history.

At most one live claim per item: claims are taken under the organization
lock and a partial unique index (`work_item_claim_live_unique`) makes the
invariant the database's. Concurrent claims of one item: exactly one wins.

**Leases.** A claim lasts 15 minutes unless renewed (`renewClaim`,
60–3600 seconds, or any `reportProgress`). A starting claim gets 10 minutes.
The dispatcher sweeps claims whose lease ended and releases them
(`expired`); until the sweep, the holder can still renew. A new claim of the
same item sweeps an expired one first.

**People do not claim.** Claims are agents' leases (`agent_required`
otherwise); people assign items to themselves. Litto does not claim delivery
work. External MCP agents claim with their access token as the agent
identity, so external agents use the same loop as runner agents.

### Claimability

`claimability(item, facts)` in `claims/claimability.ts` is the one rule. The
claim transaction enforces it, `listClaimableItems` and the Factory queue
show it, and the browser computes it from its synchronized store with the
same function. An item is claimable when:

- its project delivers natively (`external_delivery` otherwise: the delivery
  tool owns execution);
- it is not archived and its status category is backlog or unstarted;
- no live claim holds it;
- every item that `blocks` it is done (a canceled blocker still blocks: the
  relation should be removed if it no longer applies);
- the readiness policy allows starting it:
  - a spec-backed item has an accepted scope, and is Ready, or its accepted
    revision differs from the current one (an amendment being refined keeps
    the agreement covering the work, as in
    [delivery](delivery.md#agreed-and-delivered-scope)), or the project's
    readiness policy is `off`. Agents never take the `warn` exception a
    person can take;
  - plain work under a specification is covered by its nearest
    specification ancestor's accepted scope, with the same readiness rule;
  - plain work with no specification ancestor needs a person to select it:
    an unstarted status (Todo), not the backlog;
- no pull request a person opened is linked to it, open or merged: someone
  already does that work (`pull_request_linked`, "A pull request is already
  linked: #12 by Ada"). Pull requests an agent session of this factory
  opened do not count, so work whose agent's claim ended can be taken
  again. Only an agent whose session a person started on that very item
  may claim it anyway: people can still start an agent explicitly. The
  rule reads the Code module's mirror through the `DeliveryEvidenceSource`
  port, only for items otherwise claimable;
- the workflow has an active started status;
- its type is not a container (`isTopLevel`, Epic by default): a container
  groups implementation work, and agents take its children. An agreed
  container is outside the queue; one whose scope still needs accepting
  stays in "Waiting on people".

Each refusal has a code and a sentence in people's words that says what
would make it pass; when a capability clears it, `command` names it for
agents (`acceptDeliveryScope`), and the claim refusal agents receive quotes
it.
The result's `stage` buckets items for the queue: `claimable`, `claimed`,
`needs_agreement` (a person accepts scope or selects the work), `blocked`
(agreed, but something else must happen first) and `outside` (started,
closed, external). The queue lists work people already do apart from what
is blocked, as "Left to people": a `blocked` item a person's pull request
covers, and a claimable item the policy leaves to its assignee. Its reason
leads with whose it is, then the pull request.

### Claims follow their item

Starting a claim moves the item to the project's first started status
through `applyMutation` (`updateWorkItem`), attributed to the agent acting
for its owner, so the readiness policy, accepted scope, iteration events,
activity and notifications apply exactly as for a person's board move. The
owner needs `changeProperties` in the project; an agent never has more access
than its person.

Whatever moves the item afterwards, the claim follows (`followItemClaim`,
called by `applyMutation` for every item command): Done completes it,
canceling or archiving releases it, and moving it out of a started status
releases it. An agent cannot move its claimed item to Done
(`evidence_required`): claimed work reaches Done through its Definition of
Done, never on an agent's report.

**Releasing** (`releaseClaim`, with an optional note) is allowed for the
holding agent, its owner, project administrators and people who change
properties in the project. The item returns to the status it had before the
claim started, unless someone moved it since; the refusal of that move (the
person lost the right to change properties) keeps the release and says why
the item stayed. A dispatcher claim a person releases is held from
dispatching until someone retries (`retryDispatch`); one the agent itself
releases counts as a failed attempt.

## Agent questions

`askQuestion` turns "I need to know" into the review machinery that already
exists: a discussion anchored on the exact specification text (`section` and
an exact `quote`, validated against the current revision), on the claimed
item's specification or, for plain work, its nearest specification
ancestor's. It is blocking, so it also blocks readiness: related work waits
until people answer, which is the point. Plain work without any
specification gets a non-blocking discussion on the item. The item's
reviewers (assignees of its current reviews, else the members of reviewing
disciplines) are mentioned and notified through the normal mention path, and
the claim waits.

Asking also tells the `SessionResumer` (`question_asked`), so the Factory
announces the question in the session's thread and the project's reporting
channel. Resolving the discussion is a person's decision (`setThreadState`).
The `claimQuestionResolved` hook resumes the claim when its last question is
resolved, renews its lease and tells the session through the
`SessionResumer` port, which delivers the discussion's replies to the
session as a message. External agents learn it from their
[agent events](agent-events.md) (`claim.question_resolved`, narrowed to the
claiming agent), and every end of a claim (`claim.released`: released by a
person, expired, completed, canceled with its item) the same way, except
when the agent itself released it. Questions never change the
specification; the answer becomes a revision only when a person saves one.

## Autonomy policy

One row per project (`autonomy_policy`; none means Assist):

| Field                   | Meaning                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `level`                 | Assist (people start every session), Build (the dispatcher starts sessions), Autopilot       |
| `implementerAgentIds`   | Runner agents the dispatcher starts sessions for                                             |
| `reviewerAgentId`       | The agent whose approval of a pull request's head commit counts as code review               |
| `maxConcurrentSessions` | Most live claims the dispatcher fills the project up to (agents' own claims count too)       |
| `reportingChannelId`    | Optional channel where dispatched sessions post their card and agent questions are announced |
| `autopilotRequires`     | What must pass before an automatic merge; CI checks are always required                      |

The reporting channel must be a public channel, or a private one the
person saving the policy is in, and not archived.

Only project and organization administrators set it, in the browser
(`setAutonomyPolicy` is human-only, reason `autonomy`: an agent never raises
its own autonomy). Every change writes the configuration audit with the
previous policy, and the settings page restores an earlier version as a new
one. Saving validates against the Factory's agents: implementers must be
runner agents whose scope includes the project, acting for people who can
change properties there. Optimistic concurrency (`expectedVersion`) refuses
a save over a newer policy.

**Lowering autonomy releases nothing.** Claims in flight continue; people
release them from the Factory queue or the item. The dispatcher simply stops
starting new sessions.

## Definition of Done

The delivery twin of the Definition of Ready, per project
(`definition_of_done`; none means Lictory's defaults: a linked pull request
merged and required checks passed). Kinds:

- `pull_request_merged`: a linked code pull request is merged and none is
  still open;
- `checks_passed`: the code host's required checks passed on the head
  commit. A commit the host reported no checks for (or none of whose
  reported checks it marks required) does not pass: an absent check is no
  evidence that CI passed, and the detail says so ("The code host has
  reported no checks for the head commit of …"). A project without CI
  removes the check;
- `code_review_approved`: the reviewer agent approved the head commit (any
  reviewer when the policy names none). An agent's approval is a review
  recorded in Lictory for that commit (`reviewCodePullRequest`, see
  [reviews recorded in Lictory](code-hosts.md#reviews-recorded-in-lictory));
  people's approvals also come from the host, by the login they set. In
  Build and Autopilot projects Code starts the reviewer agent's session for
  each new head of an agent's pull request;
- `acceptance_verified`: a person of the chosen disciplines signed off that
  the acceptance criteria were verified. Several may be required.

A person who changes properties may **override** a failing check for one
item, with a reason. Sign-offs and overrides belong to the item's accepted
revision (else its current one), so re-accepting scope needs new ones;
withdrawing keeps the record (`done_sign_off`). Both are human-only:
evidence that agents' work is done is never recorded by an agent.

`evaluateDefinitionOfDone` (`claims/definition-of-done.ts`) is pure: checks,
code evidence, the reviewer agent and sign-offs in, one result per check
out. It is evaluated for native items in progress or claimed and projected as
`doneEvaluation` in the item's scope. A Done item leaves the projection; the
`definition_of_done_passed` activity that moved it keeps each check (with its
evidence sentence) and the pull requests it read, and the item and its pull
requests show that record while the item stays in that Done. When every check passes (and there is
at least one), the item moves to the project's first Done status through
`updateWorkItem`, attributed to the accountable person (the live claim's
owner, else the assignee) with `automation: definition_of_done`, and records
the delivered revision. A passing item that cannot move says why (`held`):
no accepted scope, nobody accountable, or the accountable person cannot
change properties. An empty definition means people always move work to Done
themselves.

Evaluation re-runs when evidence changes: on sign-offs and overrides, when
the definition changes (passing items move then), when the Code module calls
`followDefinitionOfDone` after it ingests pull request, review or check
events, records a review or the host's answer to a write (in that
transaction, `followCodeEvidence`), and in every dispatcher run for claimed
work.

## The dispatcher

`runDispatcher` (`claims/dispatcher.ts`) is deterministic worker code (the
`factory` job, every `WORKER_FACTORY_INTERVAL_MS`, default one minute, and
woken by the `factory` work signal: policy and claim changes, and accepting
an item's delivery scope, so accepted work is dispatched within seconds
rather than at the next round). It only visits organizations with live
claims or a project on Build or Autopilot. Per organization, under its lock:

1. Expire claims whose lease ended; return their items.
2. Follow the Definition of Done of claimed items (completions, Autopilot
   merges).
3. For each Build or Autopilot project: reserve claimable items in rank
   order up to `maxConcurrentSessions`, each for the least busy implementer,
   as `starting` claims. Work a person owns stays theirs: an item assigned
   to someone goes only to an implementer acting for that person, so the
   dispatcher never takes a colleague's assigned work (a person can still
   start a session on any item they may work on). Unassigned children of an
   accepted specification are the intended work.

Then, outside any transaction, it asks the `AgentSessionLauncher` to start a
session per reservation (idempotency key: the claim id), and settles each
answer in its own locked transaction: a started session activates its claim
and moves the item to started (attributed to the agent, `performedVia:
runner`, `automation: dispatcher`; the `claimed` activity names the policy
and the administrator who set it, "dispatched by the Build policy (set by
Ada)"), unless the item stopped being claimable
meanwhile; a refusal releases the reservation (`launch_failed`) and backs the
item off.

**Backoff** (`dispatch_backoff`): consecutive failures wait 5, 20, then
80 minutes (capped at six hours); after three, or a refusal retrying cannot
fix, the item is held until a person retries. A completed claim clears it.
Because a reservation is a claim, a second session for one item is
impossible whichever worker runs, and running two dispatchers at once
changes nothing.

**Autopilot merges.** When a claimed item's single open pull request passes
everything Autopilot requires (CI on the head commit, which needs at least
one reported required check: Autopilot never merges a commit CI has not
reported on; the reviewer agent's
approval of it, every other Definition of Done check) and the code host
reports it mergeable, Lictory asks the `CodeMergeExecutor` to merge it, once
per pull request head (`autopilot_merge`). The request is attributed to the
policy version and the administrator who set it, never to the agent, and is
refused when that person no longer administers the project. Code queues it
under a person's merge rules (a head that moved, a failing check, conflicts
refuse it), as "Autopilot · policy set by <administrator>" on the write, the
mirror and a comment on the pull request
([Autopilot's merge](code-hosts.md#autopilots-merge)). The item then
completes through its Definition of Done like any other. Merges are only
requested while the project is on Autopilot: lowering the level stops them,
and the refusal for an administrator who lost the project is recorded once
per head.

## Ports

Claims own the loop's rules; the Factory and Code modules implement the
boundaries in `claims/ports.ts` and install them with
`configureClaimPorts` at process start. The defaults keep Lictory working
with neither module: nothing is dispatched ("No runner agents are
configured"), code checks read as not satisfied with the reason ("No code
host is connected"), nothing is merged.

| Port                     | Implemented by | Called                                                                  |
| ------------------------ | -------------- | ----------------------------------------------------------------------- |
| `AgentDirectory`         | Factory        | inside the transaction: agents, owners, scopes                          |
| `AgentSessionLauncher`   | Factory        | outside any transaction, per reservation                                |
| `SessionResumer`         | Factory        | inside the transaction that resolved a question or ended a claim        |
| `DeliveryEvidenceSource` | Code           | inside the transaction: the mirror of pull requests, checks and reviews |
| `CodeMergeExecutor`      | Code           | inside the transaction: queue the merge for the Code worker             |

The Factory installs its ports with `installFactoryLoop` and Code with
`installCodeLoop` ([the code loop](code-hosts.md#the-code-loop)), both in
the API and the worker.

Ports called inside a transaction run under the organization lock: they read
and write Lictory's own tables (queue work for their worker) and never call a
network service. The Factory's implementations are described in
[the factory loop](factory.md#the-factory-loop).

### Claims follow their session

The other direction is not a port: the Factory calls
`claims/session-follow.ts` after its own writes commit (claims take the
exclusive lock its shared-lock writes never upgrade to).
`renewSessionClaims` keeps the claim of a session whose runner renewed its
lease (at most every five minutes). `followSessionEnd` releases the claim of
a failed (`session_failed`, a failed dispatch attempt) or canceled
(`session_canceled`, held until someone retries) session and returns the
item; a completed session's claim stays, with a seven-day delivery hold
(`DELIVERY_HOLD_MS`), until the Definition of Done completes it. Both are
idempotent; a lost call falls back to the lease.
`followSessionWaiting` mirrors whether the session waits on a person (an
approval request) onto its claim (`sessionWaitingSince`) after every
status change, reading the session's status under the lock, so the queue,
the item and the board show such a claim as waiting on a person, never as
working. It is not a claim state: the session's own machine moves it.

Every surface reads a live claim in the one state vocabulary of the
Factory (`sessionState`): "Running", "Waiting on Ada" when its session waits
on the owner's approval, "Waiting on people" when its questions on the
specification are open. An item has one owner on screen: while an agent
holds it, the agent's line ("Forge via Ada", and ", for Ben" when the item is
assigned to someone else) takes the place of the assignee's avatar.

## Projections

Organization level (boards, lists, the queue): live `claim` rows (with the
questions they wait on), `autonomyPolicy` and `definitionOfDone` rows, each
only when stored. Item scope: `doneEvaluation` for items in progress or
claimed. They are part of every snapshot, so `applyMutation` and
`rebuildProjections` keep them; this module's writers project what they
change (`projectClaims`, `syncDoneProjections`), and workflow configuration
that moves items in or out of progress re-syncs the evaluations. Evidence
that changes outside any command reaches the projection through
`followDefinitionOfDone`.

## Audit

Item activity records every claim event (`claimed`, `claim_progress`,
`claim_question_asked`, `claim_question_resolved`, `claim_released` with its
reason, `claim_completed`, `claim_dispatch_failed`, `dispatch_retried`) and
every Definition of Done decision (sign-offs, overrides, `definition_of_done_passed`,
Autopilot merge requests and refusals), with the agent (`performedVia`,
`agentName`, `agentSessionId`) and any `automation`. Autonomy and Definition
of Done changes are configuration audit entries with the previous value.
Claims, questions, policies, definitions, sign-offs and merge requests are
part of the organization export; dispatcher backoff is operational state and
is not.
