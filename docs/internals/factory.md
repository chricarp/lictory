# The Factory: agents, runners and agent sessions

The Factory is where a team's coding agents work: Claude Code, Codex or
Lictory's built-in harness, running on machines the team controls (servers,
VPSs, laptops, Macs). People start sessions, steer them, answer what agents
ask and read what they did; agents do the work in between. The master design
is [the software factory](software-factory.md); this document holds the
Factory's durable rules. Code: `packages/core/src/factory/`,
`packages/core/src/capabilities/factory.ts`, `apps/api/src/routes/runner.ts`,
`apps/runner/` and `apps/platform/src/components/factory/`.

## Agents

An **agent** (`agent`) is a named, non-human member of one organization:
a handle unique in the organization (`@forge`, never a member's handle), an
optional icon, an **owner** and a **scope**. Kinds: `runner` (a harness run
on a runner), `external` (an MCP client with a token bound to the agent) and
`intelligence` (Lictory Intelligence, built in; never created by people).

The person who creates an agent owns it and is accountable for it. Only the
owner changes it; the owner or an organization administrator archives it.
Agent management, agent tokens and runner credentials are people's
operations in the browser (`humanOnly`): an agent never creates agents,
widens a scope or mints credentials. A `shared` agent may be started by any
member; it still acts as its owner, which is why sharing is the owner's
explicit choice and the default is private.

### Authority: owner ∩ scope

An agent is a delegation, not a principal of its own. A call made as an agent
runs as the owner (the access token's user), so membership, application role
and discipline capabilities are the owner's, checked by the domain exactly as
for the owner. The agent's scope then narrows that authority:

- **Organization.** The agent acts only in its organization, even where its
  owner belongs to others (`listOrganizations` returns only that one).
- **Access.** A `read` agent only reaches queries (the token's access becomes
  read whatever it was minted with).
- **Projects.** With a project allowlist, a call must be provably inside it:
  the registry resolves `projectId`, `workItemId` or a work item key; every
  workspace command is checked again in `applyMutation` after its project is
  resolved; organization-wide commands (types, spaces, the AI policy, new
  projects) and organization-wide queries are refused. Refusing rather than
  filtering keeps the rule simple and safe; a project-limited agent that
  needs organization-wide reads is a wider agent.

So the effective authority is never more than either the owner's or the
scope. The checks are `factory/authority.ts`, used by `invoke` (every
capability call) and `applyMutation` (every workspace write). Activity and
audit name both: work item activity records `performedVia`, the agent's id,
name and handle, and the UI reads "Forge via Ada"; `capability_invocation`
records the token, which names the agent.

The Factory's Sessions page (`/{org}/factory/sessions`) lists the recent
sessions of the organization, newest started first, every row the same
shape (agent, who started it, how long it ran, its outcome), narrowed by
where they stand (active, failed, completed, canceled), by agent and by who
started it. The overview shows what needs attention now, each session in
one block: what needs me (the agents' rows of my To do, answered in place),
what waits on a teammate and on whom (the team's view), what runs, what
finished. A session's duration is its running time (`startedAt` to
`completedAt`), never its time in the queue. The Runners page opens each
runner's detail in place (what it reported: machine, version, harnesses,
isolation, labels, capacity, latest sessions) and says which runners run an
older release than the server (`runner-version.ts`); comparing needs a
release version on both sides, so source builds are never flagged.
An agent's page (`/{org}/factory/agents/{agent}`) is the one place for
it: what it is, its recent sessions and, for its owner, its
**Connection** (the tokens an external MCP client acts as it with) and
its **Wake-ups** (the webhooks and MCP Events subscriptions bound to it,
see [agent events](agent-events.md#where-people-manage-destinations)).
Creating an external agent mints its first token (90 days) and opens its
Connection, where the secret is shown once. Account settings holds only
personal access tokens, which act as the person, not as an agent.

Tokens bound to an agent (`access_token.agent_id`) stop working when the
agent is archived or changes owner, or when the owner's account is
deactivated. Their [agent events](agent-events.md) are the owner's feed seen
through the agent's scope: the owner's events and the agent's own, never
another agent's. A session-scoped token (`access_token.agent_session_id`) also
stops when its session leaves the active states and expires after a day.

Agents never decide for people in the Factory: answering an approval request
is a `decision` that only the session's requester or the agent's owner may
take, and an agent principal (including the session's own token) is refused
even when its owner could answer. A session's token cannot start further
sessions, so a session cannot fan out on its own.

## Runners

A **runner** is a machine running `lictory-runner`. An organization
administrator adds an **organization runner** (runs any eligible agent); any
member adds a **personal runner** (runs only its owner's agents; a person's
agent on a colleague's laptop would act as that person on someone else's
machine). Registration uses a one-time token (`runner_registration`, `lrt_`)
valid for an hour, exchanged once (a conditional update claims it under
concurrency) for a runner credential (`lcr_`). Only SHA-256 hashes are
stored; the credential is shown once to the runner, which keeps it in a
`0600` file. Revoking a runner ends its credential at once and expires the
leases it holds, so its sessions return to the queue. A personal runner stops
authenticating when its owner leaves the organization, and registration
fails if the token's creator is no longer a member (or, for an organization
runner, an administrator).

The runner reports its operating system, architecture, version, detected
harnesses, labels, capacity and isolation with every heartbeat. Online is
derived from the last heartbeat; the projection records heartbeats at most
every 45 seconds, and readers treat a runner as online for about two minutes
after its last recorded one.

## Agent sessions

An **agent session** (`agent_session`) is one run of an agent on one task:
the agent, the runner, the person who started it, an optional work item, a
repository and branch, the steering thread (`channel_id`,
`thread_root_message_id`: text, owned by Channels), the result summary, the
code pull request (text, owned by Code) and timestamps. A session an
autonomy policy started (the dispatcher, Code's reviewer dispatch) records
it (`started_by_policy`: the level and the administrator who set it) and
reads "Build policy (set by Ada)" wherever the Factory says who started it,
in its log and on the claim's activity; the agent's owner is still the
requester, so authority, steering and approvals are unchanged. Its task is
then the policy's, shown as context rather than as anyone's message. Its
status is the
declared machine `agentSession` in `contracts/state-machines.ts`:

```text
queued → assigned → running ⇄ waiting → completed | failed | canceled
failed | canceled → (retry) → queued
assigned | running | waiting → (lease lost) → queued | failed
```

Commands refuse with `requireStep`, the browser offers with `allows`, and
capability descriptions take their state sentences from `rule`. Runners take
the automatic steps (assign, start, wait, resume, finish, requeue); people
send messages, interrupt, cancel, retry and answer approvals. `waiting`
means the agent waits on a person: an approval request it raised, or its
next message. The runner reports the second as a status event: a harness
that waits for a message longer than the short grace after a turn (the
agent asked something in its own words, or a person interrupted it)
reports `awaiting_message` (running → waiting), and `working` once it goes
on (waiting → running, unless an approval request is still pending). Either
way the session waits on the person who started it or the agent's owner,
and counts in their "Needs you" and To do. The session keeps its lease (the
harness is alive, waiting) but does not take one of the runner's session
slots.

Interrupt stops the agent's current turn; the agent keeps its work and
waits for the next message (so the session shows as waiting on the
person). Cancel is immediate: the status becomes canceled and the lease is
cleared, so the runner's next write fails and it stops. Because a cancel and
an expired or reassigned lease fail the same way, the runner then asks one
heartbeat for that session's status, so its log says "canceled" rather than
"lost" when a person canceled it. A retry starts the
run over from the original prompt with fresh attempts. The earlier run's
inputs stay behind (`input_cursor`), so its cancel, interrupts and approval
answers are not replayed, but the messages people sent it are its steering:
they are added again, in order, after the cursor (marked `carried`, so a
later retry sends each once), and nobody has to repeat them.

A queued session that no online runner may take (none reports its agent's
harness, none is online, or the only ones are other people's personal
runners) would wait silently; the Factory, the session card, the item's
claim and the project's queue say "No runner" instead, by the claim's own
rule (`waitsForRunner` in `factory/entities.ts`).

A failed session waits on the person who started it (a policy's session is
requested by the agent's owner): it is in their To do and on Home for a
week, until they retry it or a later session works on its item.

"Completed" is the agent's claim. It moves nothing in delivery: items reach
done through evidence (merged pull requests, checks, the Definition of
Done), never because a session completed.

### Approval requests

A runner raises an approval request (`approval_request`: a request id, a
title and, for a permission, the `tool` and its `input`, as a harness's
permission prompt states them). Text is never permission, so what a person
can do with a request depends on whether it names its action
(`asksPermission`):

- **A permission** (a tool and its input: the command it would run, the
  file it would write) is approved or denied. A denial can carry a message.
- **A question** (no tool: only a title) has nothing to approve. A person
  answers it in words (`answer`, with the note) or denies it; the server
  refuses `approve`. The answer reaches the harness as a non-grant: Claude
  Code hears it as a denial carrying the person's words.

Harnesses that ask for a permission attach the action. Claude Code always
does; the scripted test harness asks a question when its step has no
`action`. Answering is a person's decision (`agentApproval` in the state
machines: approved, denied or answered) that only the session's requester or
the agent's owner may take.

### The event log

`agent_session_event` is the session's append-only log, keyed by session and
sequence: messages, reasoning, tool calls and results, commands, file
changes, approval requests and answers, status changes, errors and the
summary. Runners write most events; the server writes people's messages,
approval answers and status changes. Payloads are bounded twice (by the
runner and again by the server, `boundEvent`: strings cut at 12 000
characters, an event at 16 KiB), and runners coalesce streamed text into one
event per message. People's steering inputs (`agent_session_input`) are a
separate table the runner reads after a cursor; they never travel through
the synchronized log except as the `user_message` and `approval_answer`
events that record them.

## Writes and synchronization

Factory writes are frequent (event batches every few hundred milliseconds,
heartbeats) and touch only Factory tables. Like the conversation writer and
the live draft writer they are a documented exception to `applyMutation`:
`factoryWrite` takes the organization lock in **shared** mode (organization
deletion and other organization-wide writers still exclude them), locks the
rows it changes (`SELECT … FOR UPDATE`), checks membership for people's
commands inside the transaction, and maintains the Factory's own projection
`factory_entity` (agents, runners, session summaries with their pending
approval requests) in the same transaction. It never writes `sync_entity`.

Browsers read `factory_entity` and `agent_session_event` through Zero
(publication migration `*_factory_zero_publication.sql`), authorized by
organization membership. Projections are built only by
`factory/entities.ts`, which never includes credential hashes, lease tokens
or steering inputs; the domain tables stay out of the publication. Every
member of the organization sees the organization's agents, runners and
sessions: the Factory is the team's shared view of what agents are doing.
Queries are windowed: the most recent 200 sessions, and the latest events of
one session (the transcript widens the window on request).

## The runner protocol

`/api/runner/v1/*`, outbound HTTPS from the runner with
`Authorization: Bearer lcr_…`; no port is opened on the runner and it works
behind NAT and proxies. Bodies are JSON (schemas in
`factory/protocol.ts`, shared with the runner). The endpoints:

| Endpoint                 | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `register`               | Exchange a registration token for a credential            |
| `heartbeat`              | Report the machine; renew the leases it lists, learn lost |
| `claim`                  | Long-poll (≤ 25 s) for an assignment                      |
| `sessions/:id/workspace` | Repository, branch and brokered credentials               |
| `sessions/:id/start`     | The workspace is ready: assigned → running                |
| `sessions/:id/events`    | An event batch (≤ 200 events, ≤ 512 KiB)                  |
| `sessions/:id/inputs`    | Long-poll (≤ 25 s) for steering inputs after a cursor     |
| `sessions/:id/complete`  | The result: completed or failed, summary, branch          |
| `sessions/:id/release`   | Shutting down: back to the queue without using an attempt |
| `sessions/:id/model`     | Model calls of the built-in harness (NDJSON stream)       |

Long-polls wake early on a `NOTIFY lictory_factory` signal (sent on commit
when a session is queued or receives an input) and re-check every few
seconds, so a lost signal only delays. Each runner has a token bucket (300
requests, refilled at 20 per second) in each API process; registration is
limited per client address.

### Leases and fencing

A claim (`FOR UPDATE SKIP LOCKED` on the oldest eligible queued session:
the runner's organization, a runner agent whose harness the runner reports,
the runner pinned on the session if any, the owner for a personal runner,
capacity left) sets a random **lease token**, a lease of 90 seconds and the
next attempt. Every session write from the runner carries the token and
fails with `lease_lost` unless the session is still active, held by that
runner and with that token; heartbeats, event batches and input polls renew
it. A runner that disappears stops renewing: the worker's `factory-leases`
job (and every claim) returns its sessions to the queue, or fails them after
`max_attempts` (3). The newer attempt always wins, exactly like the worker's
own jobs.

### Idempotent event batches

Each attempt numbers its events 1, 2, 3… The session stores the last runner
sequence it accepted: a batch's events at or below it are skipped (a batch
resent after a lost response adds nothing), the first new one must follow
it, and a gap is refused with `sequence_gap` and the stored sequence, from
which the runner resends. Completion states the last sequence, so a result
is never recorded with events missing.

## Credential brokering and the workspace

Model keys and code host credentials never live on a runner.

- **Lictory.** Each claim issues a session-scoped access token bound to the
  agent (owner ∩ scope), returned once in the assignment and revoked when the
  run ends. Harnesses use it for Lictory's MCP tools.
- **Repository.** The `SessionWorkspaceResolver` port (`factory/ports.ts`)
  answers the workspace request with the agent's owner, the session's
  project and item and the repository it names (`repository_id`, Code's).
  The default uses the repository URL stated on the session (https or ssh,
  never with credentials embedded) and brokers nothing: public
  repositories, or a runner with its own git credentials. The code loop
  replaces it: the item's project's repository (the one the session names,
  else the project's default, else its first), a credential for that
  repository only where the host mints one, and only when the owner can
  work with the project's code
  ([agent sessions](code-hosts.md#agent-sessions)).
  The runner passes brokered credentials to git as an HTTP header for one
  command at a time, never in a remote URL, a git configuration or a file,
  and redacts them from errors.
- **Models.** The built-in harness runs the AI SDK's tool loop on the runner
  against a model whose calls the server executes
  (`sessions/:id/model`, `factory/model-proxy.ts`) with the organization's
  configured provider, only while the session is running, its agent uses the
  built-in harness and Lictory Intelligence is enabled for the organization
  and available on the server. Only an allowlist of call options passes
  (prompt, tools, sampling settings), never headers or provider options.

## Isolation

Each session works in its own `git worktree` of a bare repository cache on
the runner, on the session's branch (`lictory/<item key>-<title slug>-<id>`
for an item, as Code suggests branch names so key detection links it, else
`lictory/<handle>-<id>`; a retry continues from the branch if an earlier
attempt pushed it). Session
files (the MCP configuration) live in `.lictory/` inside the worktree and are
excluded from git. When the harness finishes, the runner commits what was
left uncommitted (as the agent, with the work item key in the message so
Code links it), pushes the branch and reports it; a failed push keeps the
worktree and fails the session with the path.

A runner registered with container isolation starts one Docker container per
session (`containerImage`, which the operator chooses and should pin by
digest: Lictory publishes no sandbox image and has no default;
`containerNetwork`) with the worktree mounted at
`/workspace` and runs the harness and its commands inside it; the runner
reports its isolation and the UI shows it. The built-in harness's file tools
resolve every path inside the worktree (symbolic links included) and refuse
`.git`; its commands run in the worktree (or the container) with a timeout.

## Harnesses

Adapters implement `AgentHarness` (`apps/runner/src/harness/types.ts`) and
translate a harness's own stream into session events; the domain never sees
a harness format.

- **Claude Code**: `claude -p --input-format stream-json --output-format
stream-json --verbose --permission-prompt-tool stdio` (verified against
  2.1.331). Permission prompts (`control_request` / `can_use_tool`) become
  approval requests and the answer goes back as a `control_response`;
  interrupt is a `control_request` of subtype `interrupt`. Steering messages
  are delivered when the current turn ends, so every message has its own
  turn. The runner's `claudePermissionMode` (default `acceptEdits`) decides
  what it may do without asking.
- **Codex**: `codex exec --json` and `codex exec resume <thread> --json`
  for follow-up messages (verified against 0.171.0). `codex exec` asks
  nobody: commands run in its sandbox (`codexSandbox`), so Codex sessions
  raise no approval requests. Its MCP configuration (`-c
mcp_servers.lictory.url`, `bearer_token_env_var`) is not verified against
  a live server.
- **Lictory (built in)**: the AI SDK tool loop through the model proxy with
  worktree-confined tools.
- OpenCode and Gemini CLI are known harness ids without adapters yet; a
  runner never reports them.
- A scripted test harness (`lictory-runner start --test-harness`) stands in
  for every harness in tests.

## Distribution

`bun apps/runner/scripts/build.ts [target…]` compiles single-file binaries
with `bun build --compile` for linux, darwin and windows on x64 and arm64
(`apps/runner/dist/lictory-runner-<os>-<arch>`), all from one machine; the
darwin binaries come out signed ad hoc. The binary reports the product
version (`lictory-runner --version`, its user agent and heartbeats): the root
`package.json` version, which release builds stamp before compiling (Release
clients checks that the built binary reports the release's version). In Git
that version is `0.0.0-dev`, which no release has, so a build from source
says it is one and its add-runner dialog pins no version.

Every release, nightly and stable, attaches the six binaries, their
installers (`lictory-runner-install.sh` from `apps/runner/install.sh`,
`lictory-runner-install.ps1` from `install.ps1`) and a signed `SHA256SUMS`;
see [releases](../operations/releases.md#runner-and-desktop-app). The
installers pick the binary for the system (the native one under Rosetta or
x64 emulation), refuse one that does not match `SHA256SUMS`, install it
(`/usr/local/bin` when writable, else `~/.local/bin`;
`%LOCALAPPDATA%\Programs\lictory-runner` on Windows, added to the user's
`PATH`) by renaming over the old file, so a running runner is never
truncated, and optionally register it and install the service.

The add-runner dialog shows one command: download the installer of the
latest release, then run it (never `curl … | sh`, which succeeds with nothing
installed when the download fails) with the server's own version, its
address and the one-time token
(`apps/platform/src/components/factory/runner-install.ts`). The runner is
therefore the server's exact release. A build without a release version
installs the latest stable runner; a nightly whose release was pruned fails
with that advice. The protocol is versioned by its path (`/api/runner/v1`),
so a runner of another release keeps working within it. Runners do not update
themselves: running the installer again replaces the binary, and the service
picks it up when it restarts.

## The factory loop

The Factory installs the implementations of the boundaries Claims and
Channels left open (`factory/loop.ts`, `installFactoryLoop`, called at
process start by the API and the worker, which both reach every port), so
a team meets one loop: talk to an agent in a channel, it works on a runner,
it reports and asks in the thread, a person steers or approves there, and
claimed work moves by evidence.

| Port                        | Owner    | Factory's implementation                                                                                                                                                                                                                                                                              |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentDirectory` (claims)   | Claims   | The organization's runner and external agents, not archived; runner agents are dispatchable.                                                                                                                                                                                                          |
| `AgentSessionLauncher`      | Claims   | `startSession` as the agent's owner, outside any transaction. The session id derives from the claim id (`stableId("claim-session", claimId)`), so a second launch of one reservation returns the first session; it never claims again. Refusals that retrying cannot fix are not retryable.           |
| `SessionResumer`            | Claims   | In the claims transaction: announces a question (`question_asked`), tells the session an answer (`question_resolved`, with the discussion's replies quoted as untrusted data) or an ended claim (`claim_ended`), each once per key; a claim that ends before a runner started its session cancels it. |
| `AgentDirectory` (channels) | Channels | Agents by id and handle prefix; the acting agent of a call whose token is bound to an agent (an external agent's token or a session's); `mentioned` and `replied` (below).                                                                                                                            |
| `SessionThreadPublisher`    | Factory  | Writes the session's cards and the agent's replies into its thread, then lets the claim follow a session that ended.                                                                                                                                                                                  |
| `SessionLeaseListener`      | Factory  | After every heartbeat, renews the claims of the sessions whose lease the runner renewed (`renewSessionClaims`, at most every five minutes per claim).                                                                                                                                                 |
| `SessionWorkspaceResolver`  | Code     | Installed by the code loop (`installCodeLoop`, [code hosts](code-hosts.md#the-code-loop)): the item's project's repository with a credential for it. Without a code host, a session works in the repository it states or an empty workspace through Lictory's tools.                                  |
| `SessionCompletionListener` | Code     | Installed by the code loop: a session that completed after pushing its branch becomes a code pull request, recorded on the session (`pull_request_id/url`) and announced in its thread.                                                                                                               |

Claims take the exclusive organization lock and Factory writes the shared
one, which never upgrades. So whatever crosses from a session to its claim
runs after the Factory write committed (`followSessionEnd`,
`renewSessionClaims` in `claims/session-follow.ts`), and whatever crosses
from a claim to its session runs inside the claim's transaction, where the
exclusive lock already excludes every Factory writer. Card writes take the
conversation's lock after either.

### Claims follow their session

- **Alive**: heartbeats renew the claim the session works under.
- **Waiting**: while the session waits on a person's answer, its claim
  says so (`sessionWaitingSince`) and the project's queue counts it as
  waiting on people.
- **Failed or canceled**: the claim is released (`session_failed`,
  `session_canceled`) and the item returns where it was; a dispatcher claim
  backs off after a failure and is held after a person's cancel.
- **Completed**: the claim stays, its lease extended to a seven-day delivery
  hold, until the Definition of Done moves the item to Done. "Completed" is
  still only the agent's claim.

The follow-up is idempotent and runs after commit; a lost one falls back to
the claim's lease (a failed session stops renewing, so its claim expires).

## Sessions in channels

A session has a steering thread when it is started from a conversation or
dispatched in a project that reports to a channel (`reportingChannelId` on
the autonomy policy). Starting a session in a thread requires being able to
post there (the dispatcher's reporting channel was chosen by a project
administrator, so it is trusted). A session in a channel without a thread
takes its card as the thread: the card's id is stable
(`sessionCardId(sessionId)`) and is the session's `thread_root_message_id`.

**Mentions.** `@[forge](agent:ID)` in a person's own message (no agent, no
token, no Litto) starts a session for each runner agent mentioned (at most
three) that the person may use: its owner, or anyone for a shared agent.
The session is requested by that person and acts as the owner. Its task
(`prompt`) is the message (mentions as `@handle`), in the person's words
only. Lictory's **context** (`context`) is stored apart: where it was asked
(the channel by name, never raw identifiers) and, in public channels only,
the earlier thread quoted between delimiters as information, never
instruction; private conversations are not copied into a session every
member can read in the Factory. The harness receives the task, then the
context; the transcript shows the task as the person's message and the
context as a folded "Context Forge received" event (`context`), so no text
is attributed to someone who did not write it. A message linking exactly one
work item in the agent's scope names it, and a repository it names
(`acme/payments` or its address) that the Code module mirrors, for that
item's project when there is one, is the session's repository
(`SessionRepositoryNamer`; the workspace resolver still checks the owner's
access). The session starts in the
message's own transaction (`startSessionIn`, under the writer's shared
organization lock), each in a savepoint, and its card is written there too;
a refusal (a private agent, an archived one) becomes a short system reply
instead. Messages written by agents or through tokens never start sessions,
and get a reply saying so. Mentioning an agent already working in the thread
starts nothing.

**Replies.** A reply in a live session's thread is a steering message
(`sendSessionMessageIn`, recorded with its channel message) only when its
author wrote it themselves and is the session's requester or the agent's
owner. Every other reply stays conversation and never reaches the agent.

**What the thread shows.** The thread is the place people act, so it shows
only what they need; the full log stays in the Factory. In the channel
itself, a thread's root shows the state of the latest session the thread
holds beside its reply count (`threadSessions`), so a mention whose agent
waits on someone reads differently from a quiet thread:

- the live **session card** (agent via owner, status, work item, Factory
  link), updated in place on every status change; the browser renders it
  from the session's synchronized projection when it has it, with the last
  step the agent took, the files it changed, its pull request, and
  Interrupt and Cancel (asked once) for the people who may stop it. One
  card per session: the prompt is the message above it and is not
  repeated. In its thread the card only says that a request waits below
  and leads to it; where the card is a channel's own message (a dispatched
  session's report, outside any thread) it shows each pending request as
  the shared approval request;
- while the agent waits for a message rather than a decision, the card
  says so ("Forge waits for your next message: reply in this thread"); a
  reply from the person who started it or the agent's owner is that
  message;
- an **approval card** per request, where it was asked, so the thread reads
  in order (the card never moves a request to the top). While it is pending
  and the browser can read the session, it is the shared approval request
  (what is asked, where, the evidence, then Approve and Deny for the
  requester and the owner); without the session (for MCP readers and people
  who cannot read the Factory) it names the request and carries Approve and
  Deny itself, calling `answerAgentApproval`. Once answered it stays in
  place as the record of who decided;
- the agent's **first message after each steering message** (its answer to
  the person) and its **summary**, as messages authored by the agent on
  behalf of its owner (`postAgentMessage`); progress messages, tool calls
  and commands are not posted;
- **question cards** for `askQuestion`, in the session's thread and at the
  top of the reporting channel, linking the anchored discussion, marked
  resolved when a person resolves it.

Every write has a stable id (`factory/thread-ids.ts`), so a retried publish
or a replayed hook changes a card in place and never adds a message. Card
payloads are Lictory's live state (`updateCardPayload`), not anyone's words:
they change in place without a revision.

## Ports for other modules

- `resolveAgentHandle(db, organizationId, handle)` for mention resolution.
- `SessionThreadPublisher` (`setSessionThreadPublisher`): called after commit
  when a session starts, changes status, asks for or receives an approval,
  or answers a steering message (`agent_message`). Installed by the factory
  loop; no-op by default.
- `SessionLeaseListener` (`setSessionLeaseListener`): sessions whose lease a
  heartbeat renewed, after commit.
- `SessionWorkspaceResolver` (`setSessionWorkspaceResolver`): repositories
  and credentials, from Code.
- `SessionCompletionListener` (`setSessionCompletionListener`): called after
  a completion that reported a pushed branch committed; Code opens its pull
  request. `recordSessionPullRequest(tx, …)` runs in Code's outbox
  transaction (exclusive organization lock) and `publishSessionPullRequest`
  after it: the card's payload gains the pull request and the agent posts
  "Opened pull request …" once. "Completed" still moves nothing in delivery.
- `startSession` (domain) for the dispatcher of autonomy policies; it applies
  the same checks as people's starts. `startSessionIn` and
  `sendSessionMessageIn` run the same commands inside a caller's transaction
  that holds the organization lock.
