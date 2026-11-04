# Organization deletion

An owner can delete their organization: its projects, work items,
specifications and every revision, reviews and approvals, discussions,
decisions, attachments, Jira connections with their credentials, and its
audit log. Deletion is permanent, so it is never immediate. The owner
schedules it, the organization is locked for a grace period, and only then
does the worker delete it. Accounts are not deleted: they belong to people,
who may belong to other organizations (see
[account deletion](./account-deletion.md)).

## Lifecycle

1. **Schedule** (`scheduleOrganizationDeletion`, owners only, from
   **Organization settings → Delete organization**). The owner first sees the
   latest [data export](./data-export.md) and a link to start one. An export
   is offered, not required. The owner then confirms by typing the
   organization's handle. In one transaction, under the organization lock,
   this:
   - inserts the `organization_deletion` row with
     `deleteAfter = now + grace period`;
   - records `organization.deletion_scheduled` in the organization's
     [audit log](./audit.md) and in `instance_audit_event`;
   - notifies every other member in the app and by email;
   - refreshes the organization profile projection, which now carries the
     date, so every member's app shows the locked page at once.

   Asking again returns the existing schedule.

2. **Grace period.** The organization is locked (see below). An owner can
   cancel (`cancelOrganizationDeletion`). Cancelling deletes the row, records
   `organization.deletion_cancelled` in both logs, notifies the members and
   unlocks the organization. Nothing was deleted, so nothing has to be
   restored.
3. **Deletion** (worker, `processOrganizationDeletions`, polled every five
   minutes). Once `deleteAfter` has passed, a worker claims the row with
   `FOR UPDATE SKIP LOCKED`, sets `status = 'deleting'` and takes a lease.
   From then on the deletion cannot be cancelled. The claim and cancelling
   both lock the row, so exactly one of them wins. The worker then:
   - **deletes the stored files**, outside any transaction. It pages through
     the organization's `file_object` rows (pending, ready and removed alike)
     and deletes each object from storage. Deleting a missing object
     succeeds, so a retry repeats pages safely. When every object is gone it
     sets `files_deleted_at`, and later attempts skip this step.
   - **deletes the rows** in one transaction, under the organization lock. It
     deletes every table in `deletionOrder` (children before the rows they
     reference), clears sessions' remembered active organization, and deletes
     the `organization` row. Members, invitations, the audit log, projections,
     exports, Litto conversations, notification preferences, former members,
     the security policy and the deletion row itself cascade from it. In the
     same transaction it records `organization.deleted` in
     `instance_audit_event`.
4. **Failure and retry.** A failed attempt keeps the row in `deleting`,
   records the reason in `error` and is retried after 15 minutes. A worker
   that crashes leaves an expired lease, and the next claim resumes. A worker
   that stops gracefully hands the row back without spending an attempt.
   There is no attempt limit: the organization stays locked until its
   deletion completes. Instance administrators see the reason in the admin
   console, for example: "The organization has 12 stored files, but the
   worker has no file storage configured…".

Delivery credentials live encrypted in `delivery_connection`, so deleting the
connections deletes them. Lictory never revokes the token at Jira. Revoking
it there is the Jira administrator's choice.

## The lock

While the row exists, the organization is locked for everyone. Its members
keep their memberships and still see it in their organization list, as with
the [two-factor hold](./two-factor-authentication.md). Opening it shows
"<Organization> is scheduled for deletion on <date>", who scheduled it, and
what will be deleted.

The server enforces the lock, not the browser:

- `authorize` (every domain mutation and directory read) refuses the
  organization with the `organization_deletion_scheduled` error kind.
- Synced queries for the organization are refused. The memberships query
  still lists it, with the date in its profile, so the app can show the
  locked page.
- `assertOrganizationAccess` holds every other caller: the capability
  registry (web, MCP and Litto), attachments, Litto's context, the audit
  log, notifications and exports.
- Better Auth refuses invitations, accepting an invitation, adding members,
  role changes and renaming the organization. Leaving and removing members
  stay possible.

**Owners** can still do two things, and only these: export the data (start,
list and download exports) and cancel the deletion. Capabilities opt in with
`whileDeletionScheduled: "owners"`. Administrators who are not owners are
locked out like everyone else.

Work already queued when the deletion was scheduled still finishes. That
includes a Jira publication, an analysis, a delivery status refresh or an
automatic cycle. Nothing new can be started. At deletion time, a writer still
running waits for the organization lock and then fails, because the
organization is gone.

## Who can do what

- **Owners** schedule and cancel. Better Auth's own organization delete
  endpoint is disabled (`disableOrganizationDeletion`), so no path skips the
  grace period and the job.
- **Members and administrators** are notified and see the locked page.
- **Instance administrators** see "Deletion scheduled for <date>" (or "Being
  deleted", with the last error) in the console, and the history entries.
  Being an instance administrator grants no say over an organization's data,
  so they cannot cancel or speed up a deletion.

An owner who is the organization's only owner may delete their account once
the deletion is scheduled. The deletion still runs on its date, but nobody
can cancel it any more.

## Grace period

The default is 30 days. The operator sets `LICTORY_ORGANIZATION_DELETION_GRACE_DAYS`
(1 to 365) on the API. An invalid value stops the API at startup. The date is
fixed when the deletion is scheduled, so changing the setting affects only
deletions scheduled afterwards. The admin console shows the setting with the
rest of the access policy.

## What remains afterwards

- One `instance_audit_event` entry, `organization.deleted`. It names the
  organization (name, slug, id), who scheduled it and when, the date it was
  due, and how many members, files and rows of each table were deleted. The
  scheduling and any cancellations are there too. This history belongs to no
  organization and cannot be changed (see
  [instance administration](./instance-administration.md#history)).
- Accounts, with their names, photos and other memberships.
- Backups taken before the deletion. Lictory cannot reach them, so they keep
  the organization's data until the operator's backup retention removes
  them.
- Jira issues that were published. They belong to Jira.

The organization's handle is free for reuse once the organization is deleted.

## Adding organization data

Every table with an `organization_id` must either cascade from `organization`
or appear in `deletionOrder`
(`packages/core/src/domain/organization-deletion.ts`), and children must come
before the rows they reference. `organization-deletion.test.ts` checks this
against the database's foreign keys, so a new table fails the test until it
is placed. Objects in storage must be reachable through a row the worker
reads before it deletes rows. Today `file_object` is the only one; logos and
profile photos live in PostgreSQL.
