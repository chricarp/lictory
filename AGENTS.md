# Lictory

Lictory is a collaborative requirements and engineering-readiness platform.

The product exists to solve the gap between:

> “Product wants to build this.”

and:

> “Engineering can safely commit to building this.”

Product requirements are treated similarly to code changes: they are drafted, reviewed, discussed, revised, approved, versioned, and eventually promoted into delivery work.

The platform is not intended to replace Jira, Linear, Azure DevOps, or other delivery systems. It sits before them.

A Product Owner should be able to create a rough feature proposal, invite or automatically involve the right people, collaborate asynchronously with engineering and QA, resolve ambiguity, reach an agreed specification, decompose that specification into delivery work, and then publish the resulting work into Jira or another delivery platform.

---

# What makes this product special

These principles define the product. New features should preserve them.

## 1. Requirements are reviewed like code

The central interaction model is inspired by Git pull requests.

A requirement is not a static document.

It has:

- revisions
- diffs
- inline discussions
- suggestions
- reviewers
- approvals
- blocking issues
- resolved discussions
- checks
- history

Users must be able to understand:

- what changed
- who changed it
- why it changed
- who reviewed it
- what remains unresolved
- which revision was approved

Do not reduce the system to a rich-text editor with comments.

The review workflow is the product.

---

## 2. Human decisions remain authoritative

AI assists the process.

AI does not own the process.

The system may:

- identify vague requirements
- suggest missing scenarios
- propose acceptance criteria
- identify related product behavior
- suggest reviewers
- summarize discussions
- propose requirement rewrites
- suggest delivery decomposition
- identify possible contradictions
- generate draft Jira work items

But humans decide what becomes part of the specification.

Never silently rewrite approved requirements.

Never silently resolve discussions.

Never silently approve requirements.

Never silently publish work into external systems unless an explicitly configured automation permits it.

When AI changes text, users should understand that the content is proposed rather than authoritative.

---

## 3. Collaboration should reduce meetings

The platform should make asynchronous review good enough that teams do not need a meeting for every requirement.

That means discussions must retain context.

A comment should normally be attached to:

- a specific text range
- a requirement section
- a revision
- a proposed change
- or a defined review concern

Avoid generic comment feeds when a more precise association is possible.

Users should not need to ask:

> “What was this comment referring to?”

---

## 4. Product, engineering, and QA are equal participants in refinement

The platform must not encode a workflow where Product writes and Engineering merely approves.

Different disciplines provide different kinds of information.

Typical concerns include:

**Product**

- business intent
- customer behavior
- expected outcome
- product constraints

**Engineering**

- feasibility
- architecture impact
- integrations
- compatibility
- persistence
- concurrency
- failure behavior
- operational consequences

**QA**

- testability
- boundary conditions
- negative scenarios
- ambiguous behavior
- reproducibility

**Security**

- authentication
- authorization
- data exposure
- abuse cases

**Operations / SRE**

- observability
- rollout
- recovery
- failure modes

Do not make every discipline fill out every possible field.

The workflow should surface the right concerns for the feature being reviewed.

---

## 5. Jira is downstream

Do not recreate Jira.

The product should be excellent at:

- specification
- review
- decisions
- approvals
- engineering readiness
- decomposition
- traceability

It should not gradually become another:

- sprint planner
- kanban system
- time tracker
- issue tracker
- capacity planner
- roadmap suite

Once work is implementation-ready, delivery systems take over.

Integration should be deep.

Duplication should be minimal.

---

## 6. Readiness is evidence, not a status label

A feature is not ready merely because someone changed a dropdown to `READY`.

Readiness comes from facts.

Depending on project policy, these might include:

- product objective defined
- functional behavior defined
- acceptance criteria present
- failure behavior addressed
- required reviews completed
- blocking discussions resolved
- dependencies identified
- compatibility impact considered
- test scenarios defined
- required approvals valid

Represent readiness as checks.

A status may summarize those checks, but should not replace them.

Think of this as CI for requirements.

---

## 7. Approvals belong to revisions

An approval applies to the version that was reviewed.

If the approved content changes materially, the system must be able to invalidate relevant approvals.

The user should be able to see:

```text
Engineering approved revision 12.

Current revision: 14.

Engineering approval requires review.
```

Do not treat approval as a permanent boolean on a requirement.

---

## 8. Complexity is the enemy

Enterprise software frequently becomes difficult because every hypothetical organization gets represented as another configuration layer.

Avoid this.

Prefer:

- strong defaults
- understandable workflow
- progressive configuration
- small number of concepts
- contextual controls
- obvious state transitions

over:

- giant admin panels
- dozens of required fields
- arbitrary workflow builders
- deeply nested permissions
- configuration before first use

A small team should be able to start using the product immediately.

A large company should be able to add governance without changing the basic mental model.

---

# Product philosophy

Build ambitious behavior from simple concepts.

Do not introduce abstractions merely because they look architecturally clean.

Do not preserve complexity solely because existing code already contains it.

Understand the actual invariant.

Then implement the smallest model that preserves it.

Prefer predictable software over clever software.

Prefer explicit state over hidden behavior.

Prefer reversible operations over destructive ones.

Prefer domain concepts over framework concepts.

Prefer boring infrastructure where boring infrastructure works.

---

# Glossary

Use these terms consistently in code, API contracts, UI copy, documentation, and discussion.

## Organization

A company or independent workspace using the platform.

An organization contains users, groups, products, integrations, and policies.

---

## User

A person with access to an organization.

Authentication may be local during development but enterprise deployments will normally use company identity providers.

---

## Group

A collection of users representing an organizational capability.

Examples:

- Product
- Backend
- Frontend
- QA
- Architecture
- Security
- UX
- SRE

Groups are not permissions.

They represent organizational membership.

---

## Role

A set of permissions or responsibilities.

Examples:

- Product Owner
- Reviewer
- Technical Owner
- QA Approver
- Product Administrator
- Organization Administrator

A user may belong to a group and hold different roles in different contexts.

Do not conflate groups and roles.

---

## Product

A logical product or system whose requirements are managed by the platform.

A product contains feature proposals, knowledge, policies, reviewers, and delivery integrations.

---

## Proposal

The initial expression of a desired product change.

A proposal may begin incomplete.

It can contain:

- problem statement
- business intent
- notes
- screenshots
- files
- links
- existing tickets
- rough stories
- constraints

The system should expect proposals to be imperfect.

Refinement exists to make them useful.

---

## Specification

The structured, evolving description of the behavior being agreed upon.

A proposal may eventually become an approved specification.

The specification is the primary artifact being reviewed.

---

## Revision

An immutable snapshot of specification content.

Revisions allow:

- history
- diffs
- approval tracking
- stale-review detection
- restoration
- traceability

Never mutate historical revisions.

---

## Review

A structured request for one or more humans or groups to evaluate a revision.

Reviews may be required or optional.

A review may target:

- the entire specification
- a concern
- a section
- a delivery decomposition

---

## Thread

A discussion associated with a specific piece of review context.

Threads may be:

- open
- resolved
- blocking
- non-blocking

Resolution should never delete history.

---

## Suggestion

A proposed modification to specification content.

A suggestion is not a comment.

It represents an actionable text change that can be accepted or rejected.

Accepted suggestions create a new revision.

---

## Approval

A reviewer decision that a specific revision satisfies their responsibility.

Examples:

- Product approval
- Engineering approval
- QA approval
- Security approval

Approvals can become stale after changes.

---

## Check

An automated evaluation of engineering readiness.

Examples:

- no blocking threads
- required reviews complete
- failure behavior present
- acceptance criteria present
- dependencies identified

Checks are informative or blocking according to product policy.

---

## Decision

A durable record of an important conclusion reached during refinement.

Discussions are transient.

Decisions should be recoverable later.

Examples:

> Retries will reuse the original transaction ID.

> Existing API clients will remain backward-compatible.

> Cancellation after settlement is unsupported.

When a long thread contains an important conclusion, the product should make it easy to promote that conclusion into a decision.

---

## Delivery item

A unit of implementation work produced from an approved specification.

Examples:

- Epic
- Story
- Task
- Bug
- QA task
- Technical task

Delivery items may eventually be synchronized to systems such as Jira.

---

## Publish

The act of creating or updating delivery work in an external system.

Publishing is not approval.

Approval happens before publishing.

---

# Core workflow

The normal workflow is:

```text
Proposal
   ↓
Refinement
   ↓
Review
   ↓
Changes Requested
   ↓
Revision
   ↓
Review
   ↓
Approved
   ↓
Delivery Decomposition
   ↓
Delivery Review
   ↓
Ready
   ↓
Publish
```

Do not assume that the workflow is perfectly linear.

A specification may return from review to refinement.

Published work may require a new revision.

A previously approved specification may become obsolete.

Preserve history rather than hiding these transitions.

---

# Git-style semantics

Git is an inspiration, not something to copy literally.

Use Git concepts when they make requirement collaboration easier to understand.

Good mappings include:

```text
Git repository        → Product
Branch                → Proposal / specification line of work
Commit                → Revision
Diff                  → Requirement changes
Pull request          → Review
Inline comment        → Thread
Suggested change      → Suggestion
Reviewer              → Reviewer
Required approval     → Approval policy
Status check          → Readiness check
Merge                 → Approved specification
```

Do not expose Git terminology merely because the implementation resembles Git.

Product people and QA users must be able to use the system without understanding Git.

The behavior may be Git-inspired.

The language should remain appropriate to requirements work.

---

# AI behavior

AI should improve information quality.

It should not produce ceremonial text.

Bad AI behavior:

> Rewrite this story professionally.

Better AI behavior:

> The requirement describes a retry but does not define idempotency.

> This flow defines success but does not define timeout behavior.

> The new state conflicts with an existing approved decision.

> QA cannot determine expected behavior when the provider responds after the client timeout.

Prioritize:

1. missing information
2. contradictions
3. ambiguity
4. impact
5. related knowledge
6. edge cases
7. decomposition

before stylistic rewriting.

---

## AI suggestions must be inspectable

AI-generated changes should normally be presented as proposals.

Users should be able to understand:

- what the AI found
- what evidence it used
- what it proposes
- what content would change

Prefer citations to internal product knowledge when possible.

Do not present uncertain model inference as established product behavior.

---

## Product knowledge

The system should gradually build useful organizational memory from approved artifacts.

Potential sources include:

- approved specifications
- decisions
- Jira issues
- Confluence documentation
- API specifications
- architecture documents
- incident reports
- source repositories
- previous review discussions

Approved and authoritative sources should generally rank above transient discussion.

Be conservative when inferring product behavior from source code alone.

Code describes implementation.

Specifications describe intended behavior.

The distinction matters.

---

# Permissions and enterprise boundaries

This product will often contain sensitive information.

Examples include:

- unreleased features
- architecture details
- security considerations
- incidents
- customer behavior
- internal APIs
- strategic product plans

Access control must be designed intentionally.

Do not rely on frontend visibility as authorization.

All protected operations require backend authorization.

Prefer permission checks expressed in domain language.

Examples:

```text
canReviewSpecification
canApproveTechnicalReview
canPublishDeliveryItems
canManageOrganization
```

rather than scattered role-name comparisons.

---

# Authentication and SSO

Enterprise authentication is a first-class concern.

The architecture should support:

- company SSO
- SAML and/or OIDC
- identity-provider-managed users
- group synchronization
- SCIM where applicable
- invitation flows for smaller installations

Do not tightly couple product identity to one authentication vendor.

External identity and internal authorization are separate concerns.

---

# Integrations

Integrations must sit behind adapters.

The domain should not understand Jira-specific field names.

Prefer:

```text
DeliveryProvider
createItem()
updateItem()
linkItem()
getItem()
publishHierarchy()
```

with Jira-specific behavior implemented in a Jira adapter.

This keeps the system capable of supporting:

- Jira Cloud
- Jira Data Center
- Linear
- Azure DevOps
- GitHub Issues
- GitLab

without contaminating requirement logic.

Jira is likely the first and most important integration.

It must not become the domain model.

---

# Data ownership and synchronization

Whenever data exists both inside this platform and in an external system, define ownership explicitly.

For every synchronized field determine whether it is:

- owned here
- owned externally
- synchronized one-way
- synchronized two-way
- immutable after publish

Do not create ambiguous bidirectional synchronization.

Conflict resolution must be intentional.

Silent overwrites are unacceptable.

---

# Realtime collaboration

Realtime collaboration should make the product feel immediate without making correctness depend on timing.

The durable server state is authoritative.

Clients should tolerate:

- reconnection
- duplicate events
- reordered updates where applicable
- stale views
- concurrent edits
- temporary disconnection

Do not assume that two reviewers are always online simultaneously.

The product is realtime-capable but fundamentally asynchronous.

---

# Notifications

Notifications exist to unblock work.

Do not turn the platform into another notification source users learn to ignore.

Useful notifications include:

- review requested
- blocking comment added
- suggestion accepted or rejected
- approval invalidated
- required review completed
- specification ready for next stage
- publish failed
- user explicitly mentioned

Avoid notifying users about every revision or every non-blocking comment by default.

Prefer digesting low-priority activity.

---

# UI principles

The interface should feel lightweight even when the workflow is sophisticated.

Users should be able to understand the current state immediately.

A specification page should make the following obvious:

- current revision
- review state
- outstanding blockers
- required reviewers
- approval state
- readiness state
- recent changes

Do not hide critical workflow state in secondary dialogs.

---

## Document first

The specification itself is the primary surface.

Collaboration tools should surround the document rather than replace it.

Prefer:

- contextual sidebars
- inline comments
- anchored discussions
- diff views
- review panels

over pages full of workflow tables.

---

## Minimize enterprise UI

Avoid the visual language of legacy requirements management tools.

Do not default to:

- dense grids
- nested tree tables
- twenty-column issue views
- giant forms
- modal-heavy workflows

Use structure when structure helps.

Do not make the product feel bureaucratic merely because the customer is an enterprise.

---

## Performance matters

Review workflows involve long documents, many comments, diffs, histories, and realtime events.

Performance regressions are product regressions.

Be careful with:

- unnecessary rerenders
- large document serialization
- sending full documents for small realtime changes
- unbounded comment history rendering
- expensive diff recomputation
- large AI context requests
- unnecessary animation
- polling when events are available

Prefer incremental updates.

Virtualize large collections where appropriate.

Measure before adding complicated optimization machinery.

---

# Architecture principles

Keep the domain model independent from infrastructure.

The core should understand concepts such as:

- proposals
- specifications
- revisions
- reviews
- suggestions
- approvals
- checks
- decisions
- delivery items

It should not understand:

- Jira REST payloads
- Okta response objects
- database row shapes
- websocket message formats
- LLM provider-specific schemas

Complexity belongs at boundaries.

---

## Domain invariants belong on the server

Examples:

- historical revisions are immutable
- approval references a revision
- invalidating changes may stale approvals
- resolved threads retain history
- users cannot approve without permission
- publishing requires appropriate authorization
- external synchronization cannot silently destroy local decisions

Do not rely on the frontend to enforce these rules.

---

## Events are useful when they represent real domain events

Examples:

```text
SpecificationRevised
ReviewRequested
SuggestionAccepted
ThreadResolved
ApprovalGranted
ApprovalInvalidated
SpecificationApproved
DeliveryPlanGenerated
DeliveryPublished
```

Avoid event-driven architecture merely because the domain contains things called events.

Use it where history, asynchronous processing, integrations, notifications, or auditability genuinely benefit from it.

---

# Database changes

Treat requirements history as valuable data.

Migration safety matters.

Never casually rewrite or discard:

- revisions
- discussions
- decisions
- approvals
- audit history
- external references

Prefer additive migrations.

Destructive migrations require a clear reason and explicit review.

---

# Auditability

Users should be able to answer:

> Who changed this?

> Who approved this?

> What did they approve?

> What changed afterward?

> Why was this published?

> Which Jira item came from this requirement?

This does not mean logging every mouse click.

Audit meaningful domain actions.

---

# Review policy

Policies should be composable but understandable.

A project might define:

```text
Required:
- Product approval
- Engineering approval
- QA approval
- No blocking threads
- Acceptance criteria check

Conditional:
- Security review when security impact exists
- Architecture review for cross-service changes
```

Do not build a generic BPMN engine unless the product genuinely requires one.

Start with domain-specific policies.

---

# Reverse states

When adding an action, consider its inverse.

Examples:

- resolve → reopen
- approve → revoke
- archive → restore
- publish → inspect sync / retry
- assign → unassign
- mark blocking → mark non-blocking

One-way doors should be deliberate.

Do not accidentally create them because the first implementation only handled the happy path.

---

# Error handling

Errors must communicate the actionable problem.

Bad:

> Something went wrong.

Better:

> Jira rejected Story 3 because the configured issue type no longer exists.

Better still:

> Story 3 was not published. The other 4 items were published successfully. Update the Jira mapping and retry Story 3.

For multi-step external operations, preserve partial-success state.

Do not lie with a single success/failure boolean when reality is more complicated.

---

# Verification

Use the smallest proof that demonstrates the behavior is correct.

Prioritize tests for domain behavior.

Examples:

- approval becomes stale after a material revision
- non-material metadata changes do not stale approval
- user lacking QA permission cannot grant QA approval
- resolving the final blocking thread updates readiness
- accepted suggestion creates a revision
- historical revision remains unchanged
- Jira publish is idempotent
- partial Jira failure can be retried safely

Do not write tests that merely mirror implementation details.

Test observable behavior and invariants.

---

## Frontend verification

For user-facing changes, verify the complete interaction that changed.

If you modify inline suggestions, test:

```text
create suggestion
→ reviewer sees it
→ accept suggestion
→ document updates
→ revision increments
→ suggestion becomes accepted
→ approval state updates if necessary
```

Testing only that a button renders is insufficient.

---

# External side effects

Be conservative around external systems.

Operations such as:

- creating Jira issues
- updating Jira issues
- sending notifications
- provisioning users
- invoking expensive AI analysis

should be idempotent where possible.

Retries must not create duplicated delivery work.

Persist enough information to recover from partial failure.

---

# Documentation

Most implementation details belong in code and tests.

Document durable concepts that future maintainers could otherwise misunderstand.

Good documentation subjects include:

- revision and approval semantics
- synchronization ownership
- authorization model
- AI evidence model
- readiness policy model
- external integration guarantees

Avoid documentation that merely lists files, classes, endpoints, or fields.

Those become stale quickly.

---

# Plans and temporary work

Do not commit agent scratchpads, temporary implementation plans, investigation notes, generated debugging data, or model transcripts.

Durable architectural decisions belong in the appropriate documentation.

Temporary reasoning belongs outside the repository.

---

# Pull requests

Keep pull requests focused.

A PR should normally represent one coherent concern.

Good:

> `feat(review): invalidate approvals after material revisions`

Bad:

> `feat: improve reviews and also refactor auth and redesign settings`

PR descriptions should explain:

1. the problem
2. the chosen behavior
3. important tradeoffs
4. how it was verified

UI behavior changes should include appropriate visual evidence when practical.

Do not create or publish a pull request unless explicitly requested.

---

# Security

Security matters because this product stores sensitive organizational knowledge.

Take particular care with:

- authorization
- tenant isolation
- SSO
- webhook verification
- external tokens
- Jira credentials
- AI provider credentials
- file access
- audit data
- cross-organization queries

Never trust organization, user, or role identifiers supplied by the client without validating them against authenticated context.

Do not log secrets.

Do not send customer data to external AI providers unless the configured policy allows it.

---

# AI provider boundaries

Treat AI providers as replaceable adapters.

The application should not depend deeply on one model provider's response schema.

Separate:

- prompt construction
- retrieval/context
- model execution
- structured output validation
- product behavior

Validate structured model output.

Models can return invalid or incomplete data.

The domain must remain correct even when AI fails.

---

# Failure without AI

Core collaboration must remain usable when AI is:

- unavailable
- disabled
- rate limited
- misconfigured
- prohibited by enterprise policy

AI should multiply the usefulness of the workflow.

It should not be required for basic requirement review.

---

# Multi-tenancy

Organization isolation is a fundamental invariant.

Every organization-owned entity must be scoped correctly.

Never depend solely on application-side filtering after fetching unscoped data.

Design queries and authorization around tenant boundaries from the beginning.

A cross-tenant data leak is a critical defect.

---

# Taste

When making implementation decisions, bias toward these principles:

- simple domain model over generic framework
- explicit behavior over magic
- immutable history over destructive updates
- human accountability over autonomous AI
- asynchronous collaboration over mandatory meetings
- context-preserving comments over generic chat
- useful defaults over configuration
- domain-specific workflows over generic workflow engines
- adapters over vendor leakage
- incremental synchronization over destructive replacement
- inspectable AI over mysterious AI
- fewer concepts over more screens
- correctness over cleverness
- performance over decorative animation

The product should feel obvious.

A Product Owner should be able to create a proposal without training.

An engineer should immediately understand how to review it.

QA should immediately understand what remains ambiguous.

A manager should immediately understand whether the work is ready.

If a feature requires a tutorial to explain the basic workflow, first ask whether the workflow is too complicated.

---

# Before considering work complete

For meaningful changes, consider which of these surfaces are affected:

- permissions
- organization boundaries
- revisions
- review workflow
- approval validity
- readiness checks
- realtime updates
- notifications
- AI analysis
- external integrations
- audit history
- documentation
- mobile/responsive behavior
- accessibility
- failure recovery

Not every change touches every area.

But do not fix only the visible happy path when the domain change crosses several of them.

---

# The central question

When uncertain about a feature, ask:

> Does this help a team turn incomplete product intent into an agreed, implementation-ready specification with less coordination overhead?

If yes, it probably belongs here.

If it primarily helps teams manage implementation after that point, it probably belongs in Jira or another delivery system.

If it adds process without improving clarity, collaboration, traceability, or readiness, it probably should not exist.
