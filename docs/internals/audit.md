# Audit log

The audit log answers "who changed this, when, and to whom" for the
security-relevant parts of an organization: who belongs, who administers, which
credentials can act in it, how it is configured and what agents did on
someone's behalf. It is separate from work item activity, which records the
review workflow on each item (revisions, approvals, threads, merges) and stays
where it is.

## What is recorded

Three append-only tables, all scoped to one organization, are read together:

| Source                  | Holds                                                                          | Written by                                                      |
| ----------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `audit_event`           | Membership, application roles, invitations, access tokens, two-factor, exports | `recordAuditEvent`, `recordAccountAuditEvent`                   |
| `configuration_audit`   | Configuration commands with the command and previous definition                | `auditConfiguration` in the domain services                     |
| `capability_invocation` | Every MCP and Litto capability call: outcome, token, client                    | The capability registry ([capabilities](capabilities.md#audit)) |

`audit_event` actions are catalogued in `auditActions`
(`packages/core/src/domain/audit.ts`), each with a category and a label:

- **Members & roles**: `member.added`, `member.joined` (accepted an
  invitation), `member.removed`, `member.left`, `member.account_deleted`,
  `member.role_changed` (with the previous and new role),
  `invitation.created`, `invitation.cancelled`, `invitation.rejected`.
- **Access tokens**: `access_token.created` (access, prefix, expiry) and
  `access_token.revoked`. A token acts for its owner in every organization the
  owner belongs to, so each of those organizations records it.
- **Two-factor**: `two_factor.requirement_changed` (with the previous value)
  and `two_factor.member_reset` (an administrator removed a member's
  authenticator; see [two-factor authentication](two-factor-authentication.md)).
- **Organization**: `organization.created`, `organization.updated` (name or
  handle), `audit_log.exported`, `data_export.requested` and
  `data_export.downloaded` ([data export](data-export.md)),
  `organization.deletion_scheduled` (with the date) and
  `organization.deletion_cancelled`
  ([organization deletion](organization-deletion.md)).

Each entry keeps the actor's id together with their name and email at the
time, the target (a member, invitation or token, with a readable label) and a
small `detail` object. Secrets, token values, credentials and specification
content are never recorded. Analytics is independent: events are recorded
whether or not PostHog is configured, which matters because self-hosted
installations run without it by default.

Not recorded here: sign-ins and personal account changes (password, email,
sessions), which belong to the person rather than an organization, and the
organization's deletion itself, which removes the organization's log with it.
That is recorded in the installation's history instead (see retention). Features that add security events (SSO, two-factor resets, data
export) add their actions to the catalogue.

## When it is written

Lictory-owned changes (access tokens, configuration, exports) write their
entry **in the same transaction** as the change: both commit or neither does.

Membership, roles and invitations are Better Auth operations, and Better Auth
commits its own writes outside Lictory's transactions. Its after hook
(`packages/core/src/lib/auth.ts`, mapping in `lib/auth-audit-plan.ts`) records
the entry immediately after a successful call commits, the same way the
directory projection is refreshed. A process crash between the two can lose
that one entry; a failed call never produces one, and a failed audit write is
logged (`audit.write_failed`) rather than reported as a failed change, because
the change already happened.

## Entries cannot be changed

There is no update or delete path in the application. The database enforces
it as well: the `audit_append_only` trigger on `audit_event` and
`configuration_audit` refuses every `UPDATE`, and every `DELETE` unless the
organization row is already gone, which is how an organization's deletion
cascades. `capability_invocation` predates the log and keeps its existing
foreign keys: its rows go with the person's account, and a deleted token's
reference is cleared.

## Retention

Entries are kept for the life of the organization. There is no automatic
expiry and no setting for one yet; an operator who must shorten retention does
so deliberately in the database, outside the application. Deleting an
organization deletes its log; `instance_audit_event` keeps
`organization.deleted`, with who scheduled it and what was removed
([organization deletion](./organization-deletion.md)). Deleting an account
([anonymizing it](./account-deletion.md)) keeps that person's `audit_event` and
`configuration_audit` entries (with their name and email at the time) and
removes their agent call records.

## Reading and exporting

Only organization administrators read the log, checked on the server for every
call (`canReadAuditLog`). The browser reads it through the `listAuditLog`
capability and exports it from `GET /api/organizations/:id/audit-log.csv`
under **Organization settings → Audit log**. Agents cannot read it (human-only
reason `audit`).

Each source is filtered by the organization **inside its own query branch**
before the union, never after fetching, and ordered by `(created_at, id)`, so
pages use a keyset cursor and cost the same at any size. Filters (category,
person, date range in UTC days) run on the server. The CSV export streams the
same query page by page, never holding the whole log in memory, prefixes cells
that a spreadsheet would evaluate as formulas, and records
`audit_log.exported` with its filters.

The log is not synchronized through Zero. Synced queries authorize by
organization membership, so every member could read a projection, while the
log is for administrators only; it is also history read on demand, not state
a workspace needs to stay current.

## Recording a new event

1. Add the action to `auditActions` with its category and label, and a summary
   sentence in `describeEvent` (`domain/audit-log.ts`) when the label alone is
   not specific enough.
2. Call `recordAuditEvent(tx, { organizationId, actor: { id }, action, target,
detail })` inside the transaction that makes the change. For a change to a
   person's account that affects every organization they belong to, call
   `recordAccountAuditEvent(tx, userId, …)`. Pass `actor: null` when Lictory
   itself acted.
3. Keep `detail` to facts an administrator needs; never secrets or content.
