# From proposal to delivered agreement

One work item carries a proposal through refinement and delivery. Creating it
captures intent; it does not commit the team to implementation. Types describe
the work, while refinement evidence and delivery facts describe its progress.
The Refinement view brings those facts together without introducing another
persisted workflow status.

## Eligibility and commitment

Specification-backed work starts as a proposal. People clarify the behavior,
request discipline reviews, and resolve contextual concerns. Each approval names
the revision reviewed. Readiness means the project's Definition of Ready passes
for that revision; the evidence remains visible. A passing check establishes
only what its label says: a nonempty section does not establish that its behavior
is correct. Acceptance criteria and relevant failure behavior should be supplied
during refinement, with required sections configured according to project needs.

Ready for selection excludes committed, underway and closed work. A ready
specification can remain ready while its delivery progresses; the available-work
queue and the specification's evidence answer different questions.

Native iteration planning is tentative. Accepting delivery scope records the
current revision as the team's agreement and moves backlog work to an unstarted
status when available. Starting delivery also records a first agreement. Later
specification changes retain that agreement and display the difference until a
person accepts the updated scope. The project's readiness policy governs
exceptions. See [delivery](delivery.md) for enforcement and completion behavior.

External projects accept scope by publishing. The published revision and the
provider's read-only status and assignee drive lifecycle views. Local delivery
status and assignee changes are refused: one system owns execution. An exporting
item is held out of the selection queue while publication settles; failure and
conflict remain visible in Hand-off.

## Specification agreement and delivery preparation

Reviews approve specification behavior. Existing specification-backed children
may still need their own evidence before the parent is delivery-ready. Those
checks do not erase approvals of the parent's unchanged specification.
Protecting main does not prevent preparing children.

A branch can propose additive child work alongside its specification changes.
The immutable commit includes each proposed child's stable identifier, type,
title and description. The PR displays the resulting breakdown, and the full
result participates in approval fingerprints. Proposal-only changes therefore
require fresh review even when the parent's text stays the same.

No shared children exist until merge into main. Merge creates them atomically,
recording the resulting parent revision as their source. Accepted proposal IDs
stay in commit history so later branches cannot create the same children again.
Existing children cannot be silently changed or removed through a breakdown.
This is an additive proposal model, not branching of arbitrary workspace state.
Ownership, ranking, iterations and existing work remain explicit shared actions.

## Completion and subsequent change

Done records the scope accepted for delivery, even if a newer specification
exists. It does not assert deployment, verification or customer impact. Frozen
iteration reports and revision history retain their own evidence. Reopening and
accepting a later revision is an explicit new delivery decision; a specification
amendment alone does not rewrite the delivered record.

Historical items without a recorded agreement remain explicit about that
absence. Migration does not infer what teams previously accepted or delivered.

## Decisions and product knowledge

A recorded decision is a durable conclusion, with author and source revision.
It can cite a resolved specification discussion; the discussion's original
revision is preserved even when the item has since changed. Recording a decision
does not approve a specification or resolve the discussion. Decisions are
archived and restored, retaining their original text and activity.

Product knowledge search returns recorded conclusions, current ready revisions
with review approval, and recorded delivered revisions. Each result identifies
its evidence kind and exact revision. A conclusion is not automatically
delivered behavior, and approval establishes intended behavior. Archived
decisions, archived work items and archived projects are excluded: archiving
withdraws an item from active product knowledge together with the decisions
recorded on it, and restoring it brings them back. Nothing is deleted. Done and
canceled items are not archived, so finished item history stays searchable.
Search is organization-scoped, reads the reader's access and the results from
one snapshot, and is available to the UI, MCP and Litto.

Each work item contributes at most two candidate revisions (its recorded
delivered revision and its current approved ready revision), so specification
search scales with the number of items rather than with revision history.
Decisions are matched through trigram indexes (`pg_trgm`).
External Done status remains a provider fact, rather than an attestation that a
particular revision was implemented; it does not create delivered knowledge.

## Agent participation

New proposed amendments use the same branches and PRs for people, Litto and MCP.
Legacy suggestions remain readable and operable for compatibility, but Litto
does not initiate that separate workflow. Durable activity identifies delegated
MCP and Litto execution while retaining the person's authority and authorship.

Agents are named delegations, not principals. Each personal access token is one
agent: its owner names it, and every activity it produces records the token id
and name (`agentId`, `agentName`) beside the person who is the actor. Litto is
recorded by name. A person's active tokens must have distinct names, so history
answers which of their agents produced a commit, finding or breakdown. Agents
hold no capabilities of their own: authorization is the person's, and a revoked
token stops its agent immediately while its history remains. MCP client names
stay self-reported provenance, not identities.

History therefore shows the requester and accountable person (the actor), the
executing agent (the delegation), and, for a later decision such as a merge or
scope acceptance, the person who recorded that decision.

Multiple agents acting as one person do not become independent reviewers.
Automated Intelligence reviews remain checks. Approval, merge, scope acceptance,
recording conclusions and publishing remain explicit accountable decisions.
Credential bootstrap and account security retain their existing browser boundary;
core lifecycle operations are available through the capability registry.

Protocol 14 ensures clients understand reviewed breakdowns before submitting
commands; older clients must reload before approving the new result shape.

## Workspace navigation

Project navigation follows the purpose of the work, independently of item type:

- **Proposals** holds incomplete specifications that have not started refinement.
- **Refinement** holds specifications being clarified, reviewed or ready for
  delivery, including amendments to an already accepted or handed-off revision.
  Its Ready for delivery queue is eligibility, not commitment. An amendment does
  not reset the original delivery state or replace its recorded scope.
- **Delivery** uses the project's native board/backlog or external hand-off.
- **All items** is the catalog across every configured type and lifecycle stage,
  including completed, canceled and optionally archived work.

Refinement is a project's home when it enables specification-backed types;
projects of plain work open their board (native) or catalog (external).

Types are filters and creation choices, never mandatory sidebar destinations.
The organization owns types; each project enables the ones it uses. No type
named Epic or Story is required. Parent selection follows hierarchy levels,
including custom levels, rather than assuming all parents are epics.

Every item has one type-neutral address, `/{organization}/{project}/items/{KEY-n}`.
An item opened from Proposals, Refinement or Reviews carries that queue in
`?from=` so the sidebar, breadcrumb and the list beside it stay in place. The
earlier `/epics` and `/stories` addresses redirect, including links already
published to delivery tools.

The same words describe the same facts everywhere: **Ready for delivery** means
the checks pass for the current revision; **Accept for delivery** is the
accountable decision recording that revision; **Accepted for delivery** and
**Delivered** name the recorded revisions. Specifications are accepted from the
item once ready. Plain work records its scope when it starts. Higher-level items
(Epic by default) are delivered through their children, which boards and
backlogs show.

Creation from Proposals or Refinement offers specification-backed types.
Creation from delivery defaults to plain work, then to the lowest-level type,
so new work appears where it was created; a specification-backed type still
requires refinement according to project policy. The primary create action
opens the item so the next step is visible; Create another supports batch
capture.
