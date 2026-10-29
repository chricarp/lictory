# Capabilities, MCP and agents

Everything a person can do in Lictory is a **capability**: one business
operation, defined once in `src/capabilities/`, invoked identically by every
surface.

```text
Web UI routes ─┐
MCP server ────┼─▶ capability registry (invoke) ─▶ domain services ─▶ database
Lictory agent ─┘
```

A capability has a name, a description written for people and agents, a Zod
input schema, a kind (`query` or `command`), the surfaces allowed to call it and
a `run` that calls the domain services. `invoke` (registry.ts) is the single
entry point: it checks the surface and token access, validates input, runs the
capability, normalizes every failure into a `CapabilityError` and audits agent
calls. Routes, MCP and the agent adapter contain no business logic.

## Authorization is the domain's, not the surface's

The principal (user id plus surface) always comes from authentication: the
Better Auth session for the browser and the embedded agent, a personal access
token for MCP. Capabilities never accept a user id from the caller. Membership,
application roles (administrators) and organization-role capabilities are
checked inside the domain services' transactions, the same code for every
surface, so an agent can never do what its person could not do in the browser.
Tenant isolation follows from the same checks; tests assert identical refusals
on the web, MCP and agent surfaces.

Surfaces only narrow what is available:

- **Web only:** managing access tokens, entering delivery credentials
  (`connectDelivery`) and the browser's directory read (`syncDirectory`).
  Browser workspace commands go through Zero's mutate endpoint, which runs
  the same `applyMutation` as `executeMutation`. Agents must not mint
  credentials or see secrets.
- **Read tokens** may only invoke queries; MCP hides commands from them.
- **Intelligence chats** bind organization-scoped tools to the authenticated
  conversation's organization on the server. The model's tool schema omits
  `organizationId`; execution supplies it even when an older transcript still
  carries a value. This binding does not grant membership or project
  capabilities: domain authorization runs on every call.
- Account identity and security (sign-in, password, email, sessions, social
  links, account deletion, handle) and organization membership (creating
  organizations, invitations, application roles) stay Better Auth operations in
  the browser. Presence heartbeats and appearance are browser concerns, not
  actions.

## Human decisions

Capabilities that record a human decision (approving or requesting changes on
reviews, suggestions and pull requests; merging; resolving threads; the Lictory
Intelligence policy; exporting to delivery tools) are marked `decision`. MCP tells agents to
call them only when the person explicitly asked; the embedded agent requires the
person's approval before running them or any destructive command
(`needsApproval`). Nothing about agents or Lictory Intelligence changes the domain rule that approvals belong
to a person and a revision.

The embedded agent has two more chat-only tools with no server execution; the
browser answers them. `askQuestions` collects missing details, and
`recommendAction` proposes a change the person did not ask for and returns
their decision (accepted, an alternative, or declined). The prompt tells the
model to act only on acceptance. That is guidance, not enforcement: the
guarantee for decisions and destructive commands remains `needsApproval`.

## Insights

`getInsights` answers "how is work going" questions (refinement, delivery,
people) with figures computed from the person's synchronized workspace
(`src/intelligence/insights.ts`). They are not produced by a model. The chat
renders the result as insight cards and the model only comments on it, so
every number a person sees can be traced to data they can open. Trends appear
only with real history: a burndown needs at least two days, velocity needs
completed iterations, and unestimated work burns down in items.

## Workspace commands

Every workspace command in the sync protocol (`commandSchema`) is generated into
a capability; `commandDocs` must describe it, so a new command does not compile
until it is documented and is then available everywhere. All commands go
through `executeMutation`, the same transaction, projections, receipt, analytics
and notification path the browser's queued mutations use.

Agents may omit identifiers of entities a command creates. They are derived from
the `mutationId`, so retrying a command with the same `mutationId` replays the
receipt instead of creating duplicate work. Optimistic concurrency is unchanged:
specification writes carry `baseRevisionId` and a stale base is a `conflict`
naming the current revision. Command replies capture created keys, revisions,
commits and copied reviews under the same organization lock as the write, and
store them in the mutation receipt. A retry returns the original result even
when later commands have changed the item or branch. Receipts written before
result capture was introduced replay without these additional fields.

## MCP

`POST /api/mcp` implements stateless Streamable HTTP (JSON responses, protocol
versions 2025-06-18, 2025-03-26 and 2024-11-05) with `initialize`, `ping`,
`tools/list` and `tools/call`. Tools are generated from capabilities: JSON Schema
from the Zod input, annotations from kind, `destructive`, `idempotent` and
`external`. Domain failures are tool results with `isError` and the shared error
shape (`category`, `message`, optional `currentRevisionId`, `issues`, `kind`,
`retryable`) so the model can correct itself; protocol misuse is a JSON-RPC
error.

For MCP calls, `organizationId` accepts an exact id or slug returned by
`listOrganizations`. The registry resolves it only among the person's current
memberships, then invokes the domain operation and audits the canonical id.
Unknown and inaccessible references return the same error with a discovery
hint; ambiguous id/slug matches are refused. Organization notification
preferences can use the same reference as `scopeId`. Web inputs continue to
use canonical ids.

Clients authenticate with `Authorization: Bearer lct_…`, a personal access token
created in Account settings. Only a SHA-256 hash is stored; tokens are `read` or
`write`, may expire and are revoked immediately. Requests with a foreign
`Origin` are refused.

## Audit

Every MCP and agent call is recorded in `capability_invocation`: person, token,
client, capability, organization, outcome (or error category), mutation id and
duration. Inputs are not stored because they can contain specification content.
Domain changes are attributed to the person in activity history as before; the
mutation id joins the two.

## Adding a capability

1. Implement the operation in the domain service with its authorization.
2. Define the capability (or, for a workspace command, add it to
   `commandSchema` and describe it in `commandDocs`).
3. Add it to the registry list if it is a new module.

It is then a typed MCP tool and an embedded-agent tool. The browser calls it
through `callCapability` (`POST /api/capabilities/<name>`) or an existing route
that delegates to `invoke`.
