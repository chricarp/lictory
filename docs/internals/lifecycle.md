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
decisions and archived projects are excluded; finished item history stays
searchable. Search is organization-scoped and available to the UI, MCP and Litto.
External Done status remains a provider fact, rather than an attestation that a
particular revision was implemented; it does not create delivered knowledge.

## Agent participation

New proposed amendments use the same branches and PRs for people, Litto and MCP.
Legacy suggestions remain readable and operable for compatibility, but Litto
does not initiate that separate workflow. Durable activity identifies delegated
MCP and Litto execution while retaining the person's authority and authorship.
MCP client names are self-reported provenance, not independent identities.

Multiple agents acting as one person do not become independent reviewers.
Automated Intelligence reviews remain checks. Approval, merge, scope acceptance,
recording conclusions and publishing remain explicit accountable decisions.
Credential bootstrap and account security retain their existing browser boundary;
core lifecycle operations are available through the capability registry.

Protocol 14 ensures clients understand reviewed breakdowns before submitting
commands; older clients must reload before approving the new result shape.
