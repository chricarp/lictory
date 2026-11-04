# Organization data export

An organization administrator can take a complete copy of the organization's
data at any time, so a team can leave an instance, move between instances or
keep its own record. **Organization settings → Data export** starts an export;
the worker builds the archive in the background and the page offers it for
download when it is ready.

## Lifecycle

1. **Request** (`requestOrganizationExport`, administrators only). Under the
   organization lock, the request inserts an `organization_export` row
   (`queued`), records `data_export.requested` in the [audit log](audit.md)
   and signals the worker (`pg_notify('lictory_work', 'export')`), all in one
   transaction. One export per organization is queued or running at a time;
   asking again returns it.
2. **Build** (worker, `processOrganizationExports`). The worker claims one
   export with `FOR UPDATE SKIP LOCKED`, increments its `attempt` and takes a
   five-minute lease that it renews while it works. It reads the database from
   one `REPEATABLE READ READ ONLY` transaction, so every file in the archive
   describes the same moment. Attachment bytes are fetched afterwards, outside
   any transaction. The compressed archive is written as roughly 1 MiB chunks
   (`organization_export_chunk`) belonging to that attempt, so memory stays
   bounded however large the organization is. Only the attempt that still
   holds the lease can mark the export `ready`.
3. **Recovery.** A crashed or killed worker's lease expires and the next claim
   rebuilds the archive from the start, deleting the earlier attempt's chunks.
   A graceful shutdown hands the export back without spending an attempt.
   After three failed attempts the export is `failed` with an actionable
   message; the reason is in the worker log (`export.failed`).
4. **Download** (`GET /api/organizations/:id/exports/:exportId/archive`,
   administrators only). The export is looked up by organization and id in
   one query, `data_export.downloaded` is recorded, and the chunks stream to
   the browser in order. The response carries the size and SHA-256 recorded
   when the archive was finished.
5. **Expiry.** Archives can be downloaded for seven days. The worker then
   marks them `expired` and deletes their chunks (also those of failed
   exports); the `organization_export` rows stay as history.

Archives are stored in PostgreSQL, so exports work on every installation,
including ones without object storage. A large organization's archive
occupies database space until it expires. Email delivery of the link and
storing archives in object storage are possible follow-ups.

## What is included

Everything that is the organization's record, read by organization id in
every query:

- the organization (`organization.json`) and its logos (`organization/`);
- members with their application role, name, email and handle, former
  members by name (so history stays attributed), and invitations;
- projects, project members, disciplines and their members, teams, labels,
  milestones, work item types and project type settings, workflow statuses,
  iterations and their events, readiness policy revisions;
- work items, labels on them, relations, external links;
- every specification revision, commit, branch and pull request with its
  reviews; reviews, review assignments and approvals (each with the
  `revisionId` it approved and how it ended); readiness checks and sign-offs;
  suggestions with reviewers and decisions; threads and messages; decisions;
  activity;
- attachments metadata, and attachment files when file storage is configured;
- delivery connections (without credentials), targets and publications;
  onboarding decisions; Lictory Intelligence runs and context;
- the audit log: audit events, configuration changes and agent calls.

Not included: synchronization projections and receipts (derived from the
above), personal notifications, watch and notification preferences, Litto
conversations (personal), and credentials of any kind (sessions, accounts,
access tokens, encrypted delivery credentials).

## Archive format, version 1

A gzip-compressed POSIX tar (`.tar.gz`), readable by `tar`, every common
archive tool and the standard libraries of most languages. All paths sit
under one directory, `lictory-export-<id>/`:

```text
format.json                  {"format": "lictory-organization-export", "version": 1}
organization.json            id, name, slug, createdAt
entities/<table>.jsonl       one file per entity type (member, project, work_item,
                             specification_revision, approval, thread, ...)
work-items.csv               one row per work item, for spreadsheets
organization/logo-<kind>.<ext>
attachments/<fileObjectId>   attachment bytes; name and type are in
                             entities/file_object.jsonl
manifest.json                written last: export id, organization, snapshot
                             time, the file and row count of every entity
                             type, and whether attachments were included
                             (and which could not be read)
```

`format.json` comes first, so a reader can check the version before reading
anything else. Each `.jsonl` line is one database row of the named table, with
camelCase field names, ISO 8601 UTC timestamps and identifiers exactly as
stored, so references between files (`workItemId`, `revisionId`, `reviewId`,
`threadId`, `parentId`, …) resolve within the archive. The CSV uses the
same identifiers plus readable names (project key, status, assignee email) and
prefixes cells a spreadsheet would evaluate as formulas.

### Versioning

`version` changes when a reader written for the previous version could
misread the archive: a renamed or removed file or field, a changed meaning or
encoding. Adding entity files, fields or manifest entries keeps the version;
readers must ignore what they do not know. Because entity files mirror
database tables, a schema change to an exported table is reviewed for its
effect on the format: additive columns are additive to the format, while
renames and removals bump the version.

Import is not implemented. The format is designed for it: complete rows, the
original identifiers and the revision references of approvals and derived
work.
