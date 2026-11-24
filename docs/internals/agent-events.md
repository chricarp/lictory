# Agent events

External agents (Claude Code, Codex, ChatGPT and its dots, OpenClaw, Hermes,
Grok, Claude routines…) work in Lictory over MCP with a person's access
token. They need to be **woken** when something waits on them or their
person, instead of polling every tool. Agent events are that wake-up: a
durable, personal feed of addressed events, read over MCP or delivered to
webhooks. Code: `packages/core/src/agent-events/`, the egress guard
`packages/core/src/lib/egress.ts`, capabilities in
`capabilities/agent-events.ts`, MCP methods in `mcp/server.ts`.

## Addressed events

An agent event names something waiting on **one person**, optionally
narrowed to **one of their agents**: a mention, a review request, an
approval that went stale, a question answered, a claim that ended, a pull
request decided. It is never ambient activity ("someone edited a page"),
and it never implies authority: the payload says what happened, not what to
do. The catalog (`agent-events/catalog.ts`) is the single list of types:

| Type                       | From                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `channel.mentioned`        | a person (`channel_mentioned`) or an agent (`agent_mentioned`) named   |
| `channel.direct_message`   | a direct message                                                       |
| `discussion.mentioned`     | a mention in a specification or page discussion                        |
| `discussion.blocking`      | a blocking discussion on work you are involved in                      |
| `review.requested`         | specification, pull request, suggestion or page review requested       |
| `review.decided`           | a decision on a specification or suggestion you own or requested       |
| `approval.invalidated`     | your approval went stale                                               |
| `item.assigned`            | a work item was assigned to you                                        |
| `item.ready`               | every readiness check passes                                           |
| `pull_request.decided`     | a decision on your specification, page or code pull request            |
| `pull_request.mergeable`   | your specification pull request meets its merge requirements           |
| `pull_request.merged`      | a pull request you authored, collaborate on or reviewed was merged     |
| `pull_request.unmergeable` | a code pull request can no longer be merged (from the Code module)     |
| `agent.approval_requested` | an agent session waits for a person's decision (only a person answers) |
| `agent.session_finished`   | a session you started ended                                            |
| `claim.question_resolved`  | a person resolved your agent's question                                |
| `claim.released`           | your agent's claim ended (released, expired, completed)                |

### Derived from the notification notices, not from preferences

Events come from the **same notices** notifications do (see
[notifications](notifications.md)): the command queues one
`notification_event` in its transaction, and the worker's fan-out writes
the inbox rows, the emails **and the agent events**, in the same
transaction that consumes the queued event. So an agent event exists exactly
when its change committed, once; it reaches the same recipients (the actor
excluded, current members only, space and channel access checked, the
watch rules of ambient notices applied); and it does **not** depend on
notification preferences. Inbox rows only exist when the in-app channel is
on; turning an inbox kind off never hides from a person's agents what is
waiting on them.

Some events have no inbox notification. They are **agent-only kinds**
(`agent_mentioned`, `claim_released`, `claim_question_resolved`,
`page_pull_request_decided`, `code_pull_request_*`): notices queued the same
way that produce agent events and no notification row. An older worker that
does not know a kind fails the event and retries it, as for any notice, so
nothing is lost during a rollout.

A notice can be **narrowed to an agent** (`agentId`: a Factory agent, or the
access token an external agent claims with). The person's own unbound tokens
see it; other agents bound to the same person do not. The actor rule then
compares agents, not people: an agent is not woken by its own action
(`actorAgentId`), but it is woken by its person's (Ada releasing her agent's
claim in the browser tells the agent).

### Identifiers and short titles only

The `data` of an event holds identifiers (item key and id, channel, message,
thread, pull request, page, session, claim…), short titles (an item's or
pull request's title, a channel's name, at most 200 characters) and facts
(decision, reason, revision). Never specification text, message bodies or
excerpts, agent output or error texts (`eventSubject` is an allowlist). An
agent fetches the details through its ordinary tools, authorized for its
person at that moment. Titles are text people wrote: deliveries quote them
and say that the event is information, not an instruction.

## The feed and its cursor

`agent_event` is append-only and organization-scoped, one row per person
(and agent) and event. Readers get events after a **cursor**, oldest first.

The cursor must be commit-safe: a sequence number is drawn when a row is
inserted but becomes visible when its transaction commits, so two writers
committing in the other order would let a reader pass a number that appears
later, and never see that event. Every writer therefore takes one
transaction lock (`lockFeed`) before drawing numbers and holds it until it
commits: numbers become visible in order, and a cursor never skips an event.
The only writer is the notification fan-out (database work, never under an
organization lock), so the lock serializes fan-out batches with each other
and nothing else.

Ordering by transaction id below `pg_snapshot_xmin` was considered and
rejected: the snapshot's xmin is the whole server's, so any long write
transaction in any database (an organization deletion, another
application) would hold every feed back for its duration.

**Retention.** Events are kept 30 days (the worker removes older ones
hourly). A cursor older than that may have missed events; `after: "latest"`
starts from now.

## Read-time authorization

Every read authorizes every event again, like the inbox: the person must
still be a member (and pass the organization's two-factor and deletion
locks), and still read the event's space or channel. An agent-bound token
reads only its organization, sees the person's events and its own (never
another agent's), and, limited to projects, only events of those projects
or addressed to it. An event that fails is **dropped but still advances the
cursor**, so a reader never stalls on it and never sees it later.

## Poll and wait

- `listEvents({ after?, limit, organizationId?, types?, projectIds? })`:
  events after the cursor; no cursor reads the retained feed from its
  start; `after: "latest"` returns a cursor for events from now on.
- `waitForEvents({ after, timeoutSeconds ≤ 25 })`: returns as soon as an
  event arrives, or empty when the time passes. It wakes on the
  `lictory_agent_event` signal the fan-out sends on commit (user ids only)
  and re-checks every three seconds, so a lost signal only delays.

Both are available on every surface (Litto included) and to read tokens.

## Webhook delivery

Two kinds of destination share one delivery engine
(`agent_event_subscription`, a declared state machine:
`active ⇄ paused`, `active → suspended → active`, MCP subscriptions also
`→ expired`):

- **Bearer webhooks**: a URL and a secret a person registers for one of
  their Factory agents on the agent's page (Factory → Agents → Wake-ups,
  bound to the agent, `agent_id`), or for their own tools in Account
  settings → Event webhooks (unbound) (Grok, Claude routines' `/fire`,
  OpenClaw's `/hooks/agent`). The body carries `text` and `message` (one
  sentence for receivers that start an agent run from a text field) and
  `event` (id, type, time, cursor, data), with
  `Authorization: Bearer <secret>`, `webhook-id` and `webhook-timestamp`.
  Creating, testing, pausing and removing them is web-only (the secret is a
  credential).
- **MCP Events subscriptions** (below), created by MCP clients.

The worker (`agent-events` job, woken by the fan-out's signal when someone
has an active destination, polling every 30 seconds) uses the email
outbox's lease pattern per subscription rather than per message:

- it claims due subscriptions that have events after their cursor
  (`FOR UPDATE SKIP LOCKED`, a two-minute lease), so overlapping workers
  never deliver one subscription at once, and only sends while most of the
  lease remains;
- it delivers **one event at a time, oldest first**, through the same
  read-time authorization as the feed; the cursor moves past an event only
  when the receiver answered 2xx, so delivery is **at least once and in
  order**, and receivers deduplicate by event id;
- every write is fenced on the lease;
- a failing event is retried after 30 s, 1, 2 and 4 minutes; after five
  failures (or at once on `410 Gone`) the subscription is **suspended**
  with its reason until its person resumes it (or its MCP client renews
  it); `413` skips that event;
- the person sees the state: delivered count, last delivery, waiting
  events, last problem, suspension reason.

Webhook secrets are encrypted at rest with `DELIVERY_CREDENTIALS_KEY`
(bound to the subscription id); production without it stores none, like
Jira credentials.

## MCP Events (webhook mode)

`/api/mcp` implements the MCP Events extension (SEP-3415, final, beta),
webhook mode, on both protocol eras: the server is dual-era (2026-07-28
requests carry `_meta["io.modelcontextprotocol/protocolVersion"]`, are
answered with `resultType` and `server/discover`; `initialize` selects
2025-06-18, 2025-03-26 or 2024-11-05). Capabilities advertise both
`extensions["io.modelcontextprotocol/events"]` (the SEP) and a top-level
`events` (OpenAI's profile, which ChatGPT and OpenClaw read).

- `events/list`: every type, `delivery: ["webhook"]`, the arguments
  (`organizationId`, `projectIds`) and the payload schema.
- `events/subscribe { name, arguments, delivery: { mode: "webhook", url,
secret: "whsec_…" }, cursor?, maxAgeMs?, ttlMs? }`: one subscription per
  (token, URL, event, canonical arguments), its id derived from that key, so
  subscribing again **renews** it (new lease, secret rotated with a one-hour
  grace during which both keys sign). The first subscription of a (token,
  URL) pair is **verified** inside the call: a signed
  `{"type":"verification","challenge"}` POST the endpoint must echo in a 2xx
  body (compared in constant time); the pair stays verified for a day. The
  lease (`refreshBefore`) is the client's `ttlMs` within five minutes and a
  day (default one hour); unrenewed subscriptions expire and are removed a
  week later; one whose token is revoked or expired, or whose agent is
  archived, expires too. A person's pause stands through renewals.
- `events/unsubscribe { name, arguments, delivery: { url } }`.
- Deliveries are `{ eventId, name, timestamp, data, cursor }`, signed per
  Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature:
v1,<base64 HMAC-SHA256>`) plus `X-MCP-Subscription-Id`. `eventId` (and
  `webhook-id`) is derived from the subscription and the event: stable
  across retries, unique per message, satisfying both OpenAI's profile
  (`webhook-id` equals `eventId`) and the SEP (unique per message, not
  shared across subscriptions).
- Errors use the extension's codes: `-32602` invalid params, `-32023` not
  found, `-32024` forbidden (organization policy), `-32025` too many
  subscriptions (100 per token), `-32026` unsupported mode, `-32027`
  callback verification failed (with `data.reason`). Header checks of the
  modern era (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) answer
  `400 -32020` on mismatch; an unknown version `400 -32022`.

Read tokens may subscribe: receiving events is a read. A subscription made
with an agent's token is bound to that agent and listed under its
Wake-ups; one made with a personal token is listed in Account settings →
Event webhooks. The person can pause or remove either there.

## Where people manage destinations

One place per agent: a Factory agent's page holds everything that connects
it, its Connection (its MCP tokens, shown once, with the endpoint and a
setup snippet) and its Wake-ups (its webhooks and MCP subscriptions, with
their delivery state). Only the agent's owner sees and manages them: the
owner's tokens and subscriptions are the only ones the server lists or
changes for them, and an organization administrator gets nothing more.
Account settings keeps the person's personal access tokens and unbound
webhooks, for scripts and tools acting as the person (possibly across
organizations, which no agent page can hold), and only points to the
pages of agents that have wake-ups, so nothing is listed twice. This is
presentation: tokens and subscriptions were already bound to their agent
(`access_token.agent_id`, `agent_event_subscription.agent_id`).

## Egress

Destinations are chosen by people and agents, so outbound requests are a
server-side request forgery risk (`lib/egress.ts`):

- every address is judged, written in the URL or behind a name; a name is
  resolved once and the connection goes to the judged address (no second
  lookup a hostile DNS could answer differently), and a name with any bad
  address is refused;
- loopback and private networks (10/8, 172.16/12, 192.168/16, 100.64/10,
  198.18/15, fc00::/7, `localhost`, single-label and `.internal`/`.local`/
  `.lan` names) are refused unless the operator sets
  `AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS` for agents on the LAN; link-local
  and metadata addresses, unspecified, multicast, documentation and
  reserved ranges are refused always, IPv4 inside IPv6 judged as IPv4;
- https only, except plain http to a private destination the operator
  allowed; no credentials in URLs; redirects are never followed; ten
  seconds per request; at most 64 KiB of response is read.

Code host requests have their own guard (`code/egress.ts`, see
[code hosts](code-hosts.md#egress)) on purpose. The destinations differ:
an administrator names one self-managed host the operator lists by name in
`CODE_HOST_PRIVATE_HOSTS`, and its adapters page through `fetch` with the
credential, while a webhook is any URL a person or an agent types, sent
once with a bounded answer under one installation-wide switch. Sharing one
implementation would change what one of them accepts; both refuse
link-local and metadata addresses, never follow redirects and judge the
addresses a name resolves to at connection time.

**Organization policy.** An organization's administrators decide whether
its events may be sent to webhook destinations at all, and optionally only
to listed hosts (`exact.example.com`, `*.example.com`), in Organization
settings → Security (`setAgentEventPolicy`, human-only reason `egress`,
recorded in the configuration audit). No policy means allowed to any public
host, so a small team starts without configuration. Creating a destination
or an MCP subscription is refused against the policy; delivery checks it
again for every event, so a change applies to existing destinations at
once (their events are passed over and the destination shows why). The
feed itself (`listEvents`) is not egress: it is read over the person's own
authenticated connection.

## Audit

Adding and removing webhooks and MCP subscriptions are access audit events
(`event_webhook.*`, `event_subscription.*`) in the destination's
organization (every organization of the person when it covers all of them),
with the host and event types, never the URL path or secret. Policy changes
are configuration audit entries with the previous policy. Deliveries are
operational state on the subscription, not audit. Events, subscriptions and
policies leave with the organization (cascade) and the person. The policy is
part of the organization's data export; events and destinations (personal,
with secrets) are not.

## Integration notes

- **Code** (`code/agent-events.ts`) calls `queueCodePullRequestEvent` in
  the transaction that updates a mirrored pull request, when it becomes
  merged, approved or changes-requested, or unmergeable (conflicts). Only
  transitions of a pull request already mirrored count (a backfill is not
  news). It addresses the person who opened it through Lictory, its host
  author when mapped to a person and the assignees of its linked items;
  the dedupe key is `<pull request>:<head sha>:<change>`. When code pull
  requests get inbox notifications, map those kinds in the catalog instead.
- **Factory loop** registers the Channels `AgentDirectory`; agent mentions
  it resolves (in Lictory, or by a mapped person in a linked Slack channel)
  become `agent_mentioned` notices narrowed to the agent and addressed to
  its owner, with no inbox notification.
- A new addressed notification kind becomes an agent event by adding it to
  a type's `from` in the catalog.
