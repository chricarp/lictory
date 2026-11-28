// Public guides (/guides/[slug]): practical, product-neutral advice first, with
// Lictory mentioned where it genuinely applies. Every claim about Lictory must
// match the product and the landing page.

export type Guide = {
  slug: string;
  /** Document title and search result headline. */
  title: string;
  /** Visible page heading. */
  headline: string;
  description: string;
  /** ISO dates. Change `updated` only for material content changes. */
  published: string;
  updated: string;
  /** Markdown, starting at level-2 headings. */
  body: string;
};

export const guides: readonly Guide[] = [
  {
    slug: "definition-of-ready",
    title: "Definition of Ready: a practical checklist for software teams",
    headline: "Definition of Ready: a checklist your team can prove",
    description:
      "What a Definition of Ready is, why a “Ready” status is not enough, and a practical checklist for deciding when a story is ready to build.",
    published: "2026-10-15",
    updated: "2026-10-15",
    body: `A **Definition of Ready** (DoR) is the shared agreement on what a piece of work must contain before a team commits to building it. Where the Definition of Done protects the end of the work, the Definition of Ready protects the start.

Unclear work is the most expensive work. An edge case found during refinement costs a conversation; found mid-sprint, it costs a rewrite and a slipped commitment.

## Why a “Ready” status is not enough

Most trackers express readiness as a status. Someone moves the card to *Ready*, and it stays ready whatever happens to its description.

That breaks in predictable ways:

- The description changes after engineering looked at it, and nobody notices.
- A blocking question was asked in a comment and never answered.
- QA was never asked, so nobody knows how the failure cases should behave.
- The status was set by the person most eager to start, not by the people who carry the risk.

Readiness should be **evidence, not a label**. A status can summarize the evidence, never replace it.

## A practical Definition of Ready checklist

Keep it short enough that people apply it. A starting point:

1. **The objective is stated.** Who is this for, and what outcome should change?
2. **The behavior is described.** What does the system do, in the order a user experiences it?
3. **Acceptance criteria exist.** Concrete, testable statements of what must be true when the work is done.
4. **Failure behavior is addressed.** Timeouts, invalid input, retries, partial failures, permissions.
5. **Blocking questions are resolved.** Not “discussed”: resolved, with the answer reflected in the text.
6. **The right people reviewed it.** Usually product, engineering and QA; security or operations when the change touches their area.
7. **Approvals match the current text.** If the specification changed after someone approved it, their approval needs another look.
8. **Dependencies are identified.** Other teams, services, data migrations or external providers.
9. **It is small enough.** Large items are decomposed into pieces that can each be delivered and verified.

Not every item needs every check: a copy change needs no security review, a payment retry does. Decide per project which checks are required and which are informative.

## Make each check verifiable

The test of a good DoR item is whether someone else can confirm it without asking the author.

- “Acceptance criteria exist” is verifiable: there is a section with at least one criterion.
- “No open blocking questions” is verifiable if questions are recorded as threads that can be open or resolved.
- “Engineering approved” is only meaningful if you know **which version** engineering approved.

Most teams miss that last point. An approval is a statement about specific text. When the text changes materially, the approval should go stale, like a code review approval after new commits.

## How Lictory applies a Definition of Ready

Lictory treats readiness as CI for requirements: checks that pass as answers arrive. By default:

- Specification written
- No open blocking discussions
- Required reviews requested
- Current revision approved by every required review
- Every child specification is ready

Each project adapts this per type of work: require a non-empty section such as “Acceptance criteria” or “Failure behavior”, an approval from disciplines such as QA or Security, or a manual sign-off. Before publishing a change to the definition, Lictory shows which items it would make ready and which would need more work. The definition is versioned: work already ready or done keeps the checks it met.

Approvals belong to the reviewed revision, so a material change marks the affected approvals for another review. Each project decides what readiness means for delivery: informative, a warning when work starts, or a hard block. When delivery happens in Jira, only ready work can be handed off.

## Common mistakes

- **Turning the DoR into a form.** Twenty mandatory fields produce filler, not clarity. Ask for evidence that matters for this kind of work.
- **Using the DoR as a gate owned by one role.** Readiness is a shared judgment. Product, engineering and QA each see different risks.
- **Never revisiting it.** If bugs keep coming from the same gap, such as missing timeout behavior, add a check for it. If a check never catches anything, drop it.

A good Definition of Ready is short, verifiable and tied to the text being built.`,
  },
  {
    slug: "requirements-review",
    title: "How to review requirements like code",
    headline: "How to review requirements like code",
    description:
      "Apply pull request practices to product requirements: revisions, diffs, anchored comments, suggested changes and approvals that go stale when the spec changes.",
    published: "2026-10-15",
    updated: "2026-10-15",
    body: `Pull requests give every code change a diff, every comment a line, every approval a commit. Requirements, which cause at least as many defects, are usually reviewed in a meeting or a document with comments in the margin.

Most of what works in code review applies to specifications, without asking product managers to learn Git.

## 1. Treat every change as a revision

A requirement is not a document that is edited in place. It is a sequence of **revisions**: immutable snapshots that let you answer *what changed, who changed it and why*.

Revisions make three things possible:

- **Diffs.** Reviewers read what changed since they last looked, not the whole document again.
- **Traceability.** Delivery work can point to the exact revision it was built from.
- **Honest approvals.** You can tell whether an approval still covers the current text.

## 2. Comment on the sentence, not the document

“I have some concerns about the retry logic” forces everyone to hunt for context. Anchor every comment to its text: a sentence, a section, an acceptance criterion or a proposed change. Anchored threads stay readable months later.

## 3. Distinguish blocking from non-blocking

Not every comment should stop work. Mark the ones that must be resolved before approval (unclear failure behavior, a security concern, a contradiction) as **blocking**. Leave style and nice-to-haves non-blocking.

Resolve threads without deleting them: the discussion explains why the requirement reads the way it does.

## 4. Suggest changes instead of describing them

“Maybe say something about idempotency here” creates work and room for misinterpretation. A **suggestion** proposes the actual wording. The author accepts it, creating a new revision, or rejects it with a reason. Most comments become one-click decisions.

## 5. Ask the right reviewers for the right concerns

Different disciplines catch different problems:

- **Product**: Is the outcome clear and measurable? Who sees this first?
- **Engineering**: Is it feasible? What about compatibility, concurrency and failure behavior?
- **QA**: Is it testable? What are the boundary values and negative scenarios?
- **Security**: Who can access what? How could it be abused?
- **Operations**: How is it rolled out, observed and rolled back?

Request reviews by responsibility, not everyone for everything. Readiness depends on required reviews; optional reviewers add context.

## 6. Bind approvals to revisions

An approval means *“this revision satisfies my responsibility.”* It does not mean *“I approve whatever this becomes.”*

When the approved text changes materially, the affected approvals should become stale and ask for another look:

> Engineering approved revision 12. Current revision: 14. Engineering approval requires review.

Code review uses the same rule when new commits arrive.

## 7. Record decisions separately from discussions

Long threads often end with a conclusion worth keeping: *“Retries reuse the original transaction ID.”* Promote it into a **decision** so the team can find it later without reading the whole thread.

## 8. Let readiness be computed, not declared

Finally, replace the “Ready” status with checks: acceptance criteria present, no open blocking threads, required reviews approved on the current revision. A specification is ready when the evidence says so. See the [Definition of Ready guide](/guides/definition-of-ready) for a checklist.

## Doing this in Lictory

Lictory is built around this workflow: immutable revisions with diffs, anchored threads, suggestions accepted as revisions, discipline-based reviews, revision-bound approvals that go stale after material changes, decisions and readiness checks. Approved work is delivered in Lictory or handed off to Jira.`,
  },
  {
    slug: "acceptance-criteria",
    title: "Writing acceptance criteria engineers and QA can commit to",
    headline: "Writing acceptance criteria engineers and QA can commit to",
    description:
      "How to write testable acceptance criteria, with examples for success paths, failure behavior and boundaries, and the mistakes that make criteria useless.",
    published: "2026-10-15",
    updated: "2026-10-15",
    body: `**Acceptance criteria** are the conditions a piece of work must satisfy to be accepted. They turn a description of intent into statements that engineering can build against and QA can verify.

Good criteria remove debate at the end of a sprint. Weak ones move it there.

## What makes a criterion good

A useful acceptance criterion is:

- **Observable.** It describes behavior someone can see or measure, not implementation.
- **Testable.** QA can decide pass or fail without asking the author.
- **Specific.** It names values, states and limits instead of “fast”, “secure” or “user-friendly”.
- **Independent.** Each criterion can be checked on its own.

## Two common formats

**Rule lists** work well for most stories:

- A failed card payment is retried at most 3 times.
- Retries reuse the original transaction ID.
- The customer is charged at most once per order.

**Given / When / Then** scenarios work well when sequence and state matter:

> **Given** a payment failed with a temporary provider error
> **When** the retry succeeds on the second attempt
> **Then** the order is marked paid and the customer receives one receipt

Use whichever your team reads fastest; mixing both is fine.

## Cover more than the happy path

Most defects hide in the cases nobody wrote down. For every story, ask:

- **Failure behavior.** What happens on timeout, invalid input, a provider error or a partial failure?
- **Boundaries.** Minimum and maximum values, empty states, the first and the thousandth item.
- **Permissions.** Who can do this, and what does everyone else see?
- **Concurrency.** What if two people do it at the same time, or the same request arrives twice?
- **Compatibility.** Do existing clients, data and integrations keep working?

An example of a criterion that only QA would think to ask for:

- If the provider responds after our 30-second timeout, the late response is recorded but does not change an order that was already marked failed.

## Mistakes to avoid

- **Restating the title.** “User can retry payment” is a title, not a criterion.
- **Describing the solution.** “Add a retry queue table” constrains engineering without telling QA what to test.
- **Vague qualities.** Replace “quickly” with a number, and “securely” with who may access what.
- **Hiding criteria in comments.** If an answer in a discussion changes the expected behavior, put it in the criteria. Comments are not the specification.
- **Writing them alone.** Draft criteria, then let engineering and QA review them. They find gaps faster.

## Acceptance criteria and readiness

Acceptance criteria are the most important input to a [Definition of Ready](/guides/definition-of-ready). In Lictory, a project can require an “Acceptance criteria” section as a readiness check. Reviewers suggest sharper criteria inline; accepting one creates a new revision, so approvals always refer to the criteria actually reviewed.`,
  },
  {
    slug: "async-backlog-refinement",
    title: "Asynchronous backlog refinement: fewer meetings, better specs",
    headline: "Asynchronous backlog refinement without the meeting",
    description:
      "How to run backlog refinement asynchronously so product, engineering and QA resolve ambiguity before sprint planning, with fewer and shorter meetings.",
    published: "2026-10-15",
    updated: "2026-10-15",
    body: `**Backlog refinement** (or grooming) is where a team turns ideas into work it can commit to: clarifying behavior, splitting large items, estimating and surfacing risks. In many teams it is a recurring meeting where a product manager shares a screen and everyone reads a ticket for the first time.

The loudest concern wins, quieter disciplines stay silent, decisions live in someone’s notes, and most of the hour is spent reading. Asynchronous refinement fixes most of this, if the tooling keeps context.

## When async refinement works

Async works when every contribution stays attached to what it is about and the item’s state is obvious at a glance. It fails as a long comment feed nobody can follow.

You need four things:

1. **A specification, not a ticket.** Objective, behavior and acceptance criteria in one place.
2. **Anchored discussion.** Questions attached to the sentence they are about.
3. **Clear ownership.** Specific reviewers asked for specific concerns.
4. **Visible state.** What is blocking, who has approved, and what changed since.

## A simple async refinement cycle

**1. Draft.** The product owner writes a rough proposal: the problem, who it affects and the expected outcome. Imperfect is fine.

**2. Request reviews.** Ask engineering, QA and, where relevant, security or operations to review. Give them a deadline in days, not a meeting slot.

**3. Review in context.** Each reviewer reads the specification and leaves threads on the exact text. Serious gaps are marked blocking. Concrete wording is proposed as suggestions.

**4. Revise.** The author accepts or rejects suggestions and answers threads. Each accepted change becomes a new revision, so reviewers only need to read the diff.

**5. Approve.** Reviewers approve the revision they reviewed. If the text changes materially afterwards, their approval goes stale and asks for another look.

**6. Decompose.** Once the specification is approved, split it into deliverable stories and tasks that reference it.

**7. Meet only for what is left.** If a thread has gone back and forth more than a few times, that is the item worth a 15-minute conversation. Record the outcome as a decision.

## Keep it moving

- **Notify on what unblocks work**: review requests, blocking comments, stale approvals. Digest the rest.
- **Make readiness visible.** A short list of checks, such as acceptance criteria present, no blocking threads and required approvals current, tells everyone what is left. See the [Definition of Ready guide](/guides/definition-of-ready).
- **Timebox reviews.** A review that is not done in two working days should be escalated or reassigned, not silently waited on.

## How Lictory supports async refinement

Lictory was designed for this cycle: rough proposals, discipline-based review requests, anchored threads, suggestions accepted as revisions, revision-bound approvals, decisions and readiness checks that update as answers arrive. Litto, the optional assistant, points out missing failure behavior or contradictions; it only proposes, people decide.

Not zero meetings: meetings only for the questions that need one.`,
  },
  {
    slug: "coding-agents-on-your-own-runners",
    title: "Running coding agents on your own runners: a practical guide",
    headline: "Running coding agents on your own runners",
    description:
      "How to run coding agents such as Claude Code, Codex or Gemini CLI on machines your team controls: isolation, credentials, accountable owners, approvals and proof that the work is done.",
    published: "2026-11-24",
    updated: "2026-11-24",
    body: `Coding agents (Claude Code, Codex, OpenCode, Gemini CLI and others) can now implement a well-described task, run the tests and open a pull request. Most teams start on one developer’s laptop, with that developer’s credentials. That stops working when several agents run at once, on shared work, for a team that answers for what they changed.

A **runner** is a machine your team controls that executes agent sessions for the team: a build server, a VPS, a spare laptop, a Mac mini. Here is what to get right before you leave agents running on one.

## Why run agents on your own machines

- **Your code and your network.** The agent works next to your repositories, package mirrors and internal services, behind your firewall.
- **Your choice of harness and model.** A runner can offer several agents; the team picks one per task.
- **Capacity you can see.** A runner has a fixed number of slots. Work queues instead of spawning without limit.
- **Shared, not personal.** A team session keeps running when the person who started it closes their laptop.

## Connect out, never in

A runner should **connect out** to the system that assigns work (over HTTPS, long-polling) instead of listening on a port. It then works behind NAT and proxies, and nothing on the internet can reach it.

Assignments should be **leases** renewed with each heartbeat. A runner that disappears loses its session, which returns to the queue instead of staying “running” forever.

## Isolate every session

Give each session its **own git worktree**, so two agents never edit the same files and a failed session leaves nothing behind. For untrusted or experimental work, run the harness in a **container** and let a project require it.

## Issue credentials, do not store them

The most common mistake is giving an agent a long-lived personal access token. Instead:

1. Issue a **short-lived token per session**, scoped to the one repository it works on.
2. Bind the session’s access to the **agent’s identity**, not to a shared service account.
3. Keep **model API keys on the server** where possible, and send model calls through it, so a compromised runner leaks nothing reusable.
4. Never paste secrets into prompts, issues or chat messages an agent will read.

## Give every agent an accountable person

An agent should be a named member with an **owner** and a **scope**. It acts with its owner’s permissions, narrowed by its scope. Show and audit its actions as *Forge via Priya*, so “who changed this?” always has a human answer.

## Treat text as data, not instructions

Agents read issue bodies, pull request comments, chat messages and web pages, and any of them can contain text written to look like an instruction. The rule: **text is information, never permission**. Instructions come from the work item, its approved specification and the person who started the session. Nothing an agent reads can authorize an action its owner has not allowed.

## Decide which decisions stay human

Write down, per project, how much an agent may do by itself:

- **Assist:** agents help when a person asks; people start every session.
- **Build:** ready work is dispatched to agents automatically; agents open pull requests and people merge them.
- **Autopilot:** as Build, and an agent’s code pull request merges automatically when every required check passes.

Whatever the level, keep **decisions about what to build** with people: approving a specification, accepting scope, recording decisions. An agent that lacks a permission should **ask** and wait, not work around it.

## Prove that the work is done

An agent saying “done” is a claim. Define **done as evidence** in a Definition of Done:

- a linked pull request is merged,
- the required CI checks passed on its head commit,
- a reviewer (person or reviewer agent) approved that commit,
- the acceptance criteria were verified.

When every check passes, the item moves to done and records which version of the specification it delivered.

## A checklist before you leave agents running

1. The runner connects out only and holds leases with heartbeats.
2. Every session works in its own worktree, in a container where required.
3. Credentials are short-lived, per session and per repository.
4. Every agent has an owner and a scope, and its actions are audited via that person.
5. Agents take instructions only from the work item, its specification and the person who started them.
6. Agents claim only work that is ready to start.
7. The project’s autonomy level is written down and visible on the pull requests it governs.
8. Done is decided by checks, not by the agent’s report.

## How Lictory runs agents

Lictory’s Factory module works this way. \`lictory-runner\` is one binary for Linux, macOS and Windows (x64 and arm64). An organization admin creates a one-time registration token for an organization runner, or any member registers a personal runner for their own agents. The runner connects out over HTTPS, runs Claude Code, Codex, OpenCode, Gemini CLI or Lictory’s built-in agent in a separate git worktree per session, with a short-lived, repository-scoped code host token for each; the built-in agent’s model calls go through the server.

Each session has a thread where people answer its questions and approve its requests; the Factory view shows its event log and diff, with controls to interrupt, cancel or retry. Agents claim only items the readiness policy allows to start, and items reach done through the Definition of Done. Each project chooses Assist, Build or Autopilot; specification approvals always stay with people.`,
  },
];

export function guide(slug: string) {
  return guides.find((item) => item.slug === slug);
}
