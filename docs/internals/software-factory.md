# The Lictory Software Factory

Lictory is the control plane of a software factory: the one place where a
team and its agents agree on what to build, talk, plan, write the code, review
it and ship it. People decide; agents do most of the work in between.

A small team runs it like this:

```text
Conversation (channel, DM, Slack)        "Customers want refunds over the API"
   ↓ promote
Proposal → Specification → Review → Approved revision        (people decide)
   ↓ breakdown pull request (agent-proposed, person-merged)
Ready delivery items ──claim──▶ Agent sessions on runners    (agents work)
   ↓ branch + code pull request on GitHub / GitLab / Bitbucket
Checks: CI, reviewer agent, Definition of Done               (evidence)
   ↓ merge (a person, or Autopilot when every check passes)
Delivered revision recorded on the item                      (traceable)
```

Every arrow is an existing or new domain operation with an actor, an audit
entry and a reverse. Nothing in the factory moves because text said so.

The loop runs end to end: the dispatcher claims a ready item and starts a
session for an implementer agent; the runner checks out the item's project
repository on a branch named for the item, with a credential for that
repository; the pushed branch becomes a pull request linked to the item and
the session and shown in its thread; CI and the reviewer agent's review of
the head commit arrive as evidence; a person merges (Build) or Lictory does
(Autopilot, attributed to the policy and its administrator); the Definition
of Done moves the item to Done with the delivered revision. The Factory and
Code install the ports Claims defines (`installFactoryLoop`,
`installCodeLoop`); see [the factory loop](factory.md#the-factory-loop) and
[the code loop](code-hosts.md#the-code-loop).

This document holds the durable concepts. The glossary in `AGENTS.md` names
them; each module's internals document owns its details.

## Modules

| Module       | What it is                                                               | Owns                                                   |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| **Home**     | What is waiting on me and what the factory is doing                      | nothing (a view over the others)                       |
| **Channels** | Team chat: channels, threads, direct messages, agents as members         | messages, membership, read state                       |
| **Work**     | Specifications, review, readiness, delivery items, boards, iterations    | everything it owned before                             |
| **Factory**  | Agents, agent sessions, runners, autonomy policy                         | agent identity, sessions, runner registrations, claims |
| **Code**     | Repositories, branches, pull requests, issues and checks from code hosts | links between code and work; the mirror is read-only   |
| **Spaces**   | Knowledge pages                                                          | unchanged                                              |

The web app, the desktop app and agents (MCP, runners) are surfaces over the
same capabilities. A module never reaches into another's tables: it calls its
capabilities or reads its projections.

## Authority: what text and agents can never do

These rules are what make the factory safe to leave running. They extend
"Human decisions remain authoritative" and do not replace it.

1. **Text is information, never permission.** A message, issue body, pull
   request comment, commit message or agent output can never authorize an
   action. Authority comes only from an authenticated principal calling a
   capability its person may call.
2. **Every agent has an accountable person.** An agent acts with its owner's
   permissions, narrowed by the agent's own scope. It is displayed as
   **Forge via Ada** and audited with `performedVia`. An agent never has
   more access than its owner and never acts for a different person.
3. **Specification decisions stay human.** Approving revisions, accepting
   scope, merging specification and breakdown pull requests, resolving
   discussions and recording decisions are `decision` capabilities. An agent
   may record one only on its person's explicit, in-product approval of that
   specific action (an approval request the person answers), never on its
   own judgment and never through project policy.
4. **Code merges may be automated, explicitly.** A project's autonomy policy
   may let Lictory merge an agent's code pull request when every required
   check passes. The policy is configured by a project admin, audited, shown
   on every pull request it governs, and reversible. The merge is attributed
   to the policy and the admin who set it, not to the agent.
5. **Completed is a claim, not proof.** An agent saying it is done changes
   nothing. Delivery items reach done through evidence: linked pull requests
   merged, required checks green, the Definition of Done passing.
6. **Agents work only on agreed work.** In a native-delivery project an agent
   can claim only work the readiness policy allows to start. Agents read
   untrusted input (channels, issues, web pages) as data; instructions come
   from the work item, its approved specification and the person who
   started the session.

## Channels

A **channel** is a named conversation in an organization, optionally homed in
a project or team (`#payments`, `#pay-releases`). A **direct conversation**
has fixed members, people or agents. Messages form one-level **threads**.
Agents are members like people, mentioned by handle (`@forge`).

Channels are where conversations **start**. What matters is **promoted** into
a durable object rather than left in scrollback:

- a message or thread becomes a **proposal** (a work item whose source is
  the message),
- a conclusion becomes a **decision**,
- a question about a specification becomes an **anchored discussion** on the
  exact text, quoting the message.

Promotion is an ordinary domain command and leaves a card in the thread that
links both ways. Live cards render work items, pull requests, agent sessions
and pages with their current state.

**Write path.** Messages are high volume and append-only, so they do not go
through the organization-wide exclusive lock. Like live drafts, the
**conversation writer** is a narrow, documented exception: it takes the
organization lock in shared mode and a per-channel transaction lock, checks
Better Auth membership and channel access inside the transaction, assigns
the channel's next sequence and appends. It writes no `sync_entity`
projection; message rows are shaped for synchronization and authorize
through channel membership. Promotion, channel creation and membership
changes are ordinary commands.

**Read state** is a per-member sequence cursor, so unread counts are
arithmetic, not rows per message. Notifications go out for mentions, direct
messages and replies in threads you are in. Channel traffic otherwise
notifies nobody by default.

**Ownership with Slack.** Through the `ChatProvider` adapter a channel can be
linked to a Slack channel. A message is owned by the system it was written
in: edits and deletions flow only from that system. Lictory never rewrites a
Slack-authored message.

Details are in [Lictory Channels](channels.md).

## Agents

An **agent** is a named, non-human member of an organization: a handle, an
avatar, an **owner** (the accountable person) and a **scope** (read or write,
optional project allowlist). It is one of three kinds:

- **runner agent:** a coding harness (Claude Code, Codex, OpenCode, Gemini
  CLI or Lictory's built-in harness) executed on a runner;
- **external agent:** an MCP client using an access token bound to this
  agent identity;
- **Lictory Intelligence:** the built-in, organization-level reviewer and
  planner (`lictory-ai`), as today.

## Agent sessions

An **agent session** is one run of an agent on one task: implement
`PAY-142`, review a pull request, answer a question in a thread. It records
who started it, the agent, the runner, the work item and repository, the
branch, its status and an append-only, bounded **event log** (messages, tool
calls, commands, file changes, approval requests, errors, summary).

Every session has a **thread** in a channel: the item's project channel or
the conversation it was started from. That thread is the steering surface:
replying in it sends a message to the agent; approval requests appear in it
as cards with Approve and Deny for the person who may decide. The Factory
view shows the same session with its full log, diff and controls (send,
interrupt, cancel, retry).

Session statuses are a declared state machine:
`queued → assigned → running ⇄ waiting → completed | failed | canceled`,
with `retry` from failed or canceled back to queued. `waiting` means the
agent asked a person something (an approval or a question) and holds its
claim without consuming a runner slot.

## Runners

A **runner** is a machine that executes agent sessions: a server, a VPS, a
laptop, a Mac mini under a desk, a CI machine. It runs `lictory-runner`, a
single self-contained binary for Linux, macOS and Windows (x64 and arm64).

- **Outbound only.** The runner connects to the Lictory server over HTTPS
  (long-poll); it needs no open port and works behind NAT and proxies.
- **Registration.** An organization admin (organization runner) or any member
  (personal runner, only runs that person's agents) creates a one-time
  registration token; `lictory-runner register` exchanges it for a runner
  credential stored hashed on the server.
- **Leases.** A runner claims an assignment on a lease, renews it with each
  heartbeat and event batch, and every write is fenced by the lease. A
  runner that disappears loses the session, which returns to the queue or
  fails after its attempts, exactly like the worker's jobs.
- **Credentials are brokered, never stored.** For each session the server
  issues a short-lived, repository-scoped code host token and a
  session-scoped Lictory token bound to the agent. Model calls of the
  built-in harness go through the server's configured AI provider, so model
  keys never reach the runner.
- **Isolation.** Each session works in its own git worktree. A runner may run
  harnesses directly or inside a container; the runner reports which, and a
  project may require containers.

## Claims and the factory loop

A **claim** is a lease by an agent session on one native delivery item. The
item is **claimable** when its project is native, its delivery status is not
started, every item that blocks it is done, nobody holds it, and the
readiness policy allows starting it: a spec-backed item is Ready with its
scope accepted; an item without a specification is covered by its parent's
accepted scope. External-delivery projects have no claims: the delivery tool
owns execution.

A project's **autonomy policy** decides how much the factory does by itself:

| Level                | What happens                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Assist** (default) | Agents help when asked: refine, propose, review, implement on request. People start every session.                                                                |
| **Build**            | Ready items are dispatched to the project's implementer agents automatically, up to a concurrency limit. Agents open code pull requests; people merge them.       |
| **Autopilot**        | As Build, and Lictory merges an agent's code pull request when every required check passes: CI green, the reviewer agent approves, the Definition of Done passes. |

The **Definition of Done** is the delivery twin of the Definition of Ready:
checks such as "a linked code pull request is merged", "required CI checks
passed", "the reviewer agent approved the head commit", "acceptance criteria
were verified". When it passes the item moves to done and records the
delivered revision.

The dispatcher is deterministic worker code, not a model. Planning (the
breakdown) is proposed by Lictory Intelligence or an agent as a breakdown
pull request, and a person merges it.

When an agent needs something it **asks**: a question about the
specification opens a blocking discussion anchored on the text and asks the
item's reviewers; a permission it lacks becomes an approval request in the
session thread. The session waits; the answer resumes it.

Claims, claimability, the autonomy policy, the Definition of Done and the
dispatcher are specified in [claims](claims.md).

## Code

Through the `CodeHostProvider` adapter (GitHub, GitLab, Bitbucket; cloud and
self-managed base URLs) an organization connects code hosts and links
repositories to projects. Lictory mirrors branches, pull requests (state,
review decision, checks), issues and the commits that mention work items.

- **The code host owns every mirrored field.** Lictory never edits them; it
  writes to the host only through explicit commands (create a branch, open,
  comment on or merge a pull request), queued in the domain transaction and
  sent by the worker, idempotently.
- **Agents' reviews are Lictory's record.** The host shows every write as the
  connection's account, so an agent's approval is recorded in Lictory for
  the head commit it read, and a signed comment shows it on the host.
- **Lictory owns links.** A branch, pull request, issue or commit is linked
  to a work item automatically when it names the item's key (`PAY-142`), or
  explicitly by a person or agent. Links are history: unlinking is recorded.
- **Ingest is verified and replayable.** Webhooks are verified with each
  host's signature scheme, stored once by delivery id, and processed by the
  worker; a periodic reconciliation repairs missed deliveries.
- **Issues stay the host's** until someone imports one as a work item; then
  the work item is Lictory's and the issue stays linked.

## Desktop

The desktop app (Electron) is a shell around the web app for one or more
Lictory servers, with native notifications, a dock or taskbar badge for
mentions and direct messages, `lictory://` deep links, a tray, keyboard
shortcuts and auto-update. It can also run a **personal runner** on the same
machine, so a person's agents can work on their own computer. The shell
loads only its configured servers' origins with context isolation and no
Node access in pages; everything else opens in the browser.

## Failure without AI or code hosts

Channels, Work and Spaces work with no agent, runner, model or code host
configured. The Factory and Code modules explain what to connect instead of
failing. Turning a level of autonomy down never strands work and releases
nothing: the dispatcher stops starting sessions (and, below Autopilot,
Lictory stops merging), while sessions in flight finish or can be canceled
and their claims continue until the work is done or a person releases them
from the Factory queue or the item, which returns it to the ready queue.
