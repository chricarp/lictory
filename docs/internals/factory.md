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
code pull request (text, owned by Code) and timestamps. Its status is the
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
means the agent asked a person something: the session keeps its lease (the
harness is alive, waiting) but does not take one of the runner's session
slots. Cancel is immediate: the status becomes canceled and the lease is
cleared, so the runner's next write fails and it stops. A retry starts the
run over from the original prompt with fresh attempts; the earlier run's
inputs stay behind (`input_cursor`), so its cancel is not replayed.

"Completed" is the agent's claim. It moves nothing in delivery: items reach
done through evidence (merged pull requests, checks, the Definition of
Done), never because a session completed.

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
  answers the workspace request. The default uses the repository URL stated
  on the session (https or ssh, never with credentials embedded) and brokers
  nothing: public repositories, or a runner with its own git credentials.
  The Code module replaces it with short-lived, repository-scoped tokens.
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
the runner, on the session's branch (`lictory/<item key or handle>-<id>`; a
retry continues from the branch if an earlier attempt pushed it). Session
files (the MCP configuration) live in `.lictory/` inside the worktree and are
excluded from git. When the harness finishes, the runner commits what was
left uncommitted (as the agent, with the work item key in the message so
Code links it), pushes the branch and reports it; a failed push keeps the
worktree and fails the session with the path.

A runner registered with container isolation starts one Docker container per
session (`containerImage`, `containerNetwork`) with the worktree mounted at
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
(`apps/runner/dist/lictory-runner-<os>-<arch>`). The install commands the
add-runner dialog shows download them from the latest GitHub release, so the
release workflow must attach them; until it does, run the runner from a
checkout with `bun apps/runner/src/cli.ts`. The binary embeds the protocol
schemas of the server it was built with; the protocol is versioned by its
path (`/api/runner/v1`).

## Ports for other modules

- `resolveAgentHandle(db, organizationId, handle)` for mention resolution.
- `SessionThreadPublisher` (`setSessionThreadPublisher`): called after commit
  when a session starts, changes status, asks for or receives an approval, so
  Channels can post and update a session card in its thread. No-op by
  default.
- `SessionWorkspaceResolver` (`setSessionWorkspaceResolver`): repositories
  and credentials, from Code.
- `startSession` (domain) for the dispatcher of autonomy policies; it applies
  the same checks as people's starts.
