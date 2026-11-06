# Lictory Spaces

Lictory Spaces is the knowledge side of Lictory: spaces of nested pages that
people write together in real time and change through the same reviewed,
Git-inspired history as specifications.

> **Status:** in development on the `feat/lictory-spaces` branch, shipping as
> one change without a feature flag. This document records the agreed model so
> that every step of the implementation preserves it. The foundation (schema,
> access, space and page commands, projections, Zero queries, reads, export
> and deletion) and the collaboration service are implemented as described
> under [Implementation](#implementation) and
> [the collaboration service in operation](#the-collaboration-service-in-operation);
> history commands and the interface follow.

## Concepts

```text
Organization
└─ Space        a home for knowledge, optionally belonging to a project or a team
   └─ Page      nested pages; each has its own history
      ├─ main         the published line of the page
      └─ branches     proposed changes, each with its own live draft
```

- A **space** belongs to the organization and optionally to one project, or to
  one team of a project (its **home**). It appears in that project's or team's
  navigation. A space owns no delivery configuration and moving work items
  never changes it.
- A **page** belongs to one space and optionally has a parent page in the same
  space. Siblings are ordered by a fractional rank. Archiving hides a page and
  its subtree and is reversible; there is no hard delete. Pages move only
  within their space.
- Pages are not work items. They have no key, status, estimate, iteration or
  readiness. Work item specifications stay exactly as they are (Markdown,
  single-author drafts, branches and pull requests on the item); pages and work
  items link to each other.

## History: commits, branches and pull requests

A page's history is a commit graph, like a specification's
([branches and pull requests](synchronization.md#branches-and-pull-requests)):

- **main** is the published line. Readers see main's latest commit.
- A page can have any number of **branches**. A branch's author and the
  collaborators they invite edit it; anyone who can read the space can view it.
- A **commit** is an immutable snapshot of the page (title and canonical
  content) with parents, a message and every person who contributed to it.
  Historical commits are never changed. Restoring an old version creates a new
  commit.
- A **pull request** proposes merging one branch into main or another branch.
  Review decisions bind to a fingerprint of the complete result; any change to
  the result makes them stale. Contributors to the result cannot approve it.
  Merging into main publishes; merging into another branch only moves that
  branch.

Each space chooses one publishing policy:

| Policy           | Main                                                                                | Labels                                 |
| ---------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| Direct (default) | Has a live draft; editors publish it as a commit. Branches and PRs remain available | "Published", never "Approved"          |
| Reviewed         | Protected: no live draft; changes arrive only through PRs with required approvals   | "Approved" names the approved revision |

Merges require no open blocking threads and, in Reviewed spaces, every required
review approving the current result. A merge is refused while the source or
the target has uncommitted live changes, so a published commit never omits or
includes text nobody saw.

## Live drafts

Every writable line (each branch, and main in Direct spaces) has one **live
draft**: a Yjs document edited through Tiptap by everyone allowed to edit that
line at the same time, with their cursors visible.

- A live draft is a working tree, not history. It is never reviewed, approved,
  searched as product knowledge or exported as published content.
- **Commit** (and Publish, in Direct spaces) seals an exact, durably stored cut
  of the draft: the server reconstructs the content from stored updates,
  validates it against the schema and writes the immutable commit. Browsers
  never submit the content of a commit. Typing after the cut remains
  "uncommitted changes".
- The editor shows "Saved" only after the server has durably stored the edits.
- Replacing a draft's content (merging main into a branch, restoring) starts a
  new **epoch** of that draft. Clients of the old epoch reconnect; edits that
  arrive for an old epoch are kept for explicit recovery, never applied
  silently.
- Deleting a branch fences its draft, disconnects its editors and keeps its
  commits.

### Canonical content and merging

The canonical content of a commit is Tiptap JSON with a stable ID on every
block, under a versioned schema of open-source extensions only. Markdown is
derived from it for diffs, search, export, MCP and Lictory Intelligence; it is
never the source of truth for pages.

Merging two lines whose common base differs from both is a conservative
three-way merge over blocks:

- changes on one side only, and identical changes on both, merge automatically;
- any other overlap is a conflict on the smallest valid container: a block, a
  whole list for nesting changes, a whole table, widening to a section or the
  document when identity is ambiguous;
- conflicts are resolved as for specifications: merge the target into the
  source branch, choose ours, theirs, both or a manual edit per conflict, then
  review the new result.

Branches are never merged by replaying CRDT updates into each other. Yjs
reconciles concurrent typing **within** one draft; between branches, conflicts
are always surfaced to people.

## Access

Access is decided per space, from its home, with one restriction mechanism.

| Mode                | Who can edit                                                           | Who can read                              |
| ------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| Inherited (default) | Members of the home (organization, project or team), and named editors | Every organization member                 |
| Restricted          | Named editors                                                          | Only named people (view, comment or edit) |

- Inherited access is live: joining a team gives edit access to its spaces;
  leaving takes it away. In Inherited mode named grants only add access.
- A Restricted space ignores home membership. Switching back to Inherited keeps
  the named grants.
- Levels are view, comment and edit. Editing a branch also requires being its
  author or a collaborator; publishing or merging into main requires edit
  access to the space (and, in Reviewed spaces, the review gates).
- Space administrators (its creator, the home's administrators, organization
  administrators) manage access, the publishing policy, the home and archiving.
  Managing access does not grant reading: an administrator reads a Restricted
  space only by granting themselves access, which is audited.
- Page-level restrictions do not exist. To restrict part of a tree, put it in
  its own Restricted space (it can share the same home).

Team and project membership grant access to Spaces only. They still grant no
work item capabilities; disciplines do (see
[organizations, projects and teams](organization-model.md)).

A few consequences of these rules, decided while implementing them:

- A person who creates a Restricted space, or switches a space to Restricted,
  receives an edit grant if they hold none, so nobody locks themselves out by
  accident. The grant is ordinary: visible, audited, removable.
- Creating an Inherited space grants its creator nothing beyond what the home
  gives them: an administrator who creates a team's space without being in
  the team reads it like any other organization member (and administers it).
- Archiving a project or a team changes no space access. Its spaces keep
  their home and readers; memberships of an archived project cannot change
  until it is restored, and an archived project or team cannot become a new
  home.
- Grants count only for current organization members. A person who leaves
  keeps their grant rows (like their project memberships) and gets them back
  if they rejoin; deleting the account removes them.
- Space details (name, handle, description, icon) are the editors'; the home,
  publishing policy, access mode, grants and archiving are the administrators'.

Effective access is materialized as one row per organization, space, person and
level, recomputed in the same transaction as every change to its inputs:
organization membership (Better Auth hooks), project members, team members, the
space's mode and its grants. Zero queries for Spaces authorize through those
rows, so a revoked person's open subscriptions lose the rows. The existing
`organization` and `workItem` queries exclude Spaces rows; private titles,
grants and trees never enter the directory.

Domain checks are named for what they allow (`canReadSpace`,
`canCommentOnPage`, `canEditDraft`, `canPublishPage`, `canReviewPageChange`,
`canManageSpaceAccess`) and run on the server for every surface: the browser,
MCP, Litto and the collaboration service.

## Synchronization and the collaboration service

```text
Browser ── /zero ───────────▶ zero-cache ──▶ PostgreSQL
   │                                           ▲
   └── /collaboration (WS) ─▶ collaboration ───┘
```

- **Zero** carries decisions and metadata: spaces, the page tree, commits
  (content loaded per page), branches, pull requests, reviews, threads,
  activity and access summaries. Every write goes through `applyMutation`.
- **The collaboration service** (Hocuspocus, same image as the API, one
  instance per installation) carries only live draft updates and cursors.
  Neither transport writes the other's state; a Zero update never replaces the
  content of a mounted editor.
- If the collaboration service is unavailable, reading, history, comments and
  reviews keep working; only draft editing pauses, and the editor says so.

### Draft writes: a narrow exception to the domain write rule

Live draft updates are persisted by one dedicated writer, not by
`applyMutation`, because routing every typing batch through the exclusive
organization lock would serialize typing against every review, delivery and
configuration change of the organization. The exception is narrow:

- The draft tables (draft state, update log, epochs and writer fence) are not in
  the Zero publication, and no `sync_entity` projection reads them.
- The writer takes the organization lock in **shared** mode
  (`pg_advisory_xact_lock_shared` on the same key), so it waits for exclusive
  domain mutations and they wait for it, while drafts never wait for each
  other. Lock order is always organization lock, then the draft row. A
  transaction never upgrades shared to exclusive.
- In the same transaction it re-checks each author's session (signing out or
  revoking a session ends writing even for a member), two-factor requirement,
  organization membership (locking the membership row, because Better Auth
  commits membership changes outside the organization lock), space edit access
  and branch collaboration, then appends a bounded batch with the actor and a
  sequence number.
- Every update is decoded before it is stored, so a malformed update can never
  make a draft unloadable, and each update is stored once per draft epoch
  (keyed by its digest): retrying after a commit whose acknowledgement was lost
  does not duplicate it.
- State that projections show ("this page has unpublished changes", draft
  contributors) changes through `applyMutation` at coarse transitions only.
- Commits, publishing, merges and every other decision go through
  `applyMutation` as usual.

### Stored before anyone sees it

Hocuspocus handles each connection's messages in order and waits for its
`beforeHandleMessage` hook before it applies a message, sends it to the other
editors and acknowledges it to the sender. The collaboration service stores
every document change in that hook, so:

- other editors only ever receive edits the database holds, and the author's
  "Saved" (no unsynced changes left) means stored;
- each loaded draft has one writer that groups everything arriving while its
  previous transaction is in flight into the next one (group commit): a busy
  page costs one transaction per database round trip, not one per keystroke;
- a database failure is retried with backoff while the edits stay unsaved and
  private; after a bounded time the connection is reset and the client
  reconnects and offers its unsaved changes again (the Yjs sync exchange sends
  whatever the server lacks). Refusals for access reasons close the document
  with a short reason that never contains document content;
- Hocuspocus direct connections, which change a document without that hook,
  are disabled;
- memory is bounded: per socket, messages over 1 MB and inbound traffic beyond
  a burst plus a sustained rate disconnect the client; per draft, changes
  waiting to be stored are capped, and beyond the cap the client reconnects.

Measured on a development machine against local PostgreSQL (the spike tests
in `packages/core/src/spaces`): a save takes about 12 ms (p95 under 25 ms) in
a quiet organization and under 80 ms at p95 while four sessions keep the
organization lock fully busy with 10 ms exclusive mutations.

Revocation stops outgoing updates too: access changes signal the collaboration
service after commit, and every connection is also revalidated every 30
seconds, so a missed signal leaves a revoked reader connected for at most that
long. Writes are always checked against current access. Revalidation only ever
removes rights from an open connection: someone who gains edit access
reconnects, because Hocuspocus re-reads a connection's read-only flag after the
storage hook and promoting it mid-message could apply an unstored update.

Compaction of the update log is a worker job with a lease and a fence; it never
removes or alters commits.

### The collaboration service in operation

- **Process and route.** `apps/collaboration`, shipped in the API image and
  run as the `collaboration` service. The proxy routes the public
  `/collaboration` path (WebSocket upgrades only from the platform's own
  origin, the same rule as `/zero`) to it unchanged; Hocuspocus carries
  document names inside its messages, so the path only routes and one socket
  serves every page a tab has open. The service checks the Origin itself as
  well, and answers `/livez` and `/readyz` for health probes.
- **Authentication.** The Better Auth session cookie of the upgrade request,
  checked with the same Better Auth configuration as the API. Nothing in the
  URL and no provider token is ever trusted; the browser provider sends an
  empty token. Each stored batch re-checks that session in its transaction.
- **Document names** are `<draft id>.<epoch>` (`draftDocumentName`); the
  browser takes them from the page's synchronized state, never builds them
  from anything else. A name of a fenced or replaced epoch no longer opens.
- **Signals.** One NOTIFY channel, `lictory_spaces_access`, delivered on
  commit, payload `{organizationId, userIds?, draftIds?}` (identifiers only).
  `refreshSpaceAccess` sends the people whose effective access changed, from
  every writer that calls it (space commands, project and team membership,
  Better Auth membership hooks, account deletion, projection rebuilds); the
  service rechecks their connections. A trigger on `space_draft` sends the
  draft whenever its epoch changes, it is fenced or it is deleted, so every
  current and future writer of drafts signals; the service closes that
  draft's rooms with the reason "This draft was closed or replaced", and the
  editor reopens the page's current draft. The service listens on the direct
  connection (`DATABASE_URL_UNPOOLED`) and rechecks every connection whenever
  that LISTEN is re-established, since signals sent while it was down are
  lost.
- **One instance.** Rooms live in the service's memory, so two copies would
  split a page's editors into groups that do not see each other. The service
  holds a session-level advisory lock (`hashtextextended('lictory:collaboration-owner', 0)`)
  on a dedicated direct connection while it serves. A second copy waits up
  to 15 seconds (a replaced container releasing it), then logs
  `collaboration.owner_busy` and exits. If the lock's connection ends, the
  service stops at once and its supervisor restarts it.
- **Restarts lose nothing stored.** All draft state is in PostgreSQL. SIGTERM
  refuses new connections, closes open ones and waits (bounded) for pending
  saves; editors keep their unsaved changes and resend them when they
  reconnect.

## Comments

Threads are anchored and keep their history like specification threads:

- on a commit: the commit, the block path and range, and the quoted text. A
  commit never changes, so the anchor never moves;
- on a live draft: Yjs relative positions, which follow concurrent edits within
  that draft and epoch, frozen to a commit range when the draft is committed.

When anchored text is deleted, the thread shows "Original text removed" with
the quote and a link to the version it was written on. Threads are never
silently re-attached elsewhere.

## Integration with the rest of Lictory

- Navigation: Spaces in the organization sidebar, and each project's and team's
  spaces in their navigation. Page titles are in the command palette.
- Work item mentions (`PAY-142`) in pages render as live references (status,
  refinement state, readiness) for readers who can see the item.
- Images and files use [private file storage](file-storage.md) with page
  ownership checks.
- Notifications follow [the notification rules](notifications.md): mentions,
  review requests, stale approvals and blocking comments, never every edit.
- Access changes are recorded in the [audit log](audit.md); organization data
  export, organization deletion and account anonymization cover Spaces.

## Capacity

The working target, to be measured before release, is on the recommended 4 GB
server: 10,000 pages per organization, pages up to about 1 MB of content, 25
people editing one page at once and 200 open editing connections per
installation, with "Saved" under 300 ms (p95, 50 ms round trip) while ordinary
work item mutations run.

## Implementation

### Tables

All tables carry `organization_id`; composite foreign keys keep a team inside
its space's project, a parent page inside the same space, and commits,
branches and drafts inside their page (`packages/core/src/db/spaces-schema.ts`).
History uses restrictive deletes.

| Table                                     | Holds                                                                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space`                                   | Name, handle (unique among active spaces, case-insensitively), description, icon, home (`project_id`, `team_id`), `access_mode`, `publishing`, creator, archive |
| `space_grant`                             | Named access: one level per space and person                                                                                                                    |
| `space_reader`                            | Effective access (derived, replicated)                                                                                                                          |
| `page`                                    | Space, parent, `rank`, creator, archive                                                                                                                         |
| `page_commit`                             | Immutable snapshots: parents, title, `content` (Tiptap JSON), `markdown`, `hash`, `schema_version`, message, author, contributors, draft provenance             |
| `page_branch`, `page_branch_collaborator` | Pointers (`head_commit_id`, `base_commit_id`), exactly one `is_main` per page that is never deleted, author and invited collaborators                           |
| `space_draft`, `space_draft_update`       | Live drafts (one per line, `branch_id` unique) with epoch, sequence, `committed_sequence`, base commit, snapshot and fence; the update log                      |
| `space_entity`                            | Spaces read projections (derived, replicated)                                                                                                                   |

`hash` is the SHA-256 of the canonical JSON of `{ title, content,
schemaVersion }`. Until the document engine lands, a new page's first commit is
an empty document from `initialPageCommit` (`packages/core/src/spaces/commands.ts`)
and a new main draft starts with empty Yjs state; the engine replaces both.

### Commands

Protocol version **16** adds `createSpace`, `updateSpace`,
`setSpaceAccessMode`, `setSpaceGrant`, `archiveSpace` (with `archived`),
`createPage` (main branch, first commit and, in Direct spaces, main's draft;
its receipt names `pageId`, `mainBranchId`, `commitId` and `draftId`),
`movePage` and `archivePage` (with `archived`). They run through
`applyMutation` like every command, so they are capabilities on every surface;
the handlers live in `packages/core/src/spaces/commands.ts`. Restoring a page
restores the subpages archived together with it; subpages archived earlier
stay archived. Switching a space to Reviewed fences main's drafts and is
refused while one has unpublished changes; switching back opens them again as
a new epoch at main's head.

Access, mode, grant, home, publishing and archive changes are recorded in
`configuration_audit` with identifiers and settings only; a grant someone
gives themselves carries `selfGrant: true`. Spaces commands record no work
item activity: a page's commits are its history.

### Access

`refreshSpaceAccess(tx, organizationId, { spaceIds?, projectId?, userIds? })`
(`packages/core/src/spaces/access.ts`) recomputes `space_reader` for the scope
and writes only the rows that differ. It runs in the same transaction as the
space commands, `setProjectMember`, `setDisciplineMember` and
`setTeamMembership`, the Better Auth membership hooks
(`refreshMemberships`, after a member is added, changes role or accepts an
invitation, and in `recordDeparture`), account deletion and the projection
rebuild. The domain checks read the current rows and also require the
membership row, so a removed member is refused even before Better Auth's hook
has run. `canReadDraft` and `canWriteDraft`
(`packages/core/src/spaces/draft-access.ts`) adapt them for the collaboration
service, with `resolveDraftDocument` mapping document names
(`<draftId>.<epoch>`) to open draft epochs.

### Projections and Zero

`space_entity` rows (`key` = `{type}:{id}`) hold protocol `SpaceEntity`
values, a union separate from `Entity`: `space`, `spaceGrant` (id
`{spaceId}:{userId}`) and `page` summaries (title and commit of main's head)
with a NULL `page_id`; `pageCommit` (with content) and `pageBranch` (with
collaborators) carry their page. `writeSpaceProjections` rewrites what a
command touched; `rebuildSpaceProjections`, called by `rebuildProjections`,
reconciles `space_entity` and `space_reader`, and the projection invariant
the test suites check includes both. No `space_entity` row depends on who
reads it, so access changes rewrite only `space_reader`.

Both tables are in the `lictory_zero` publication. The synced queries
`spaces({ organizationId })` (space-level rows), `page({ organizationId,
pageId })` (one page's history) and `mySpaceAccess({ organizationId })` (my
reader rows) require a `space_reader` row for the current user and their
organization membership; `organization` and `workItem` read only
`sync_entity`.

### Reads, export and deletion

The capabilities `listSpaces` (readable spaces with the reader's level, plus
the restricted spaces the person administers without reading them, names
only), `listPages` (one space's tree in reading order) and `getPage` (main's
latest title and Markdown, never a draft) are available on every surface.
Organization export includes spaces, grants, pages, commits, branches,
collaborators and drafts (binary Yjs state as base64), an additive change
that keeps archive format version 1; organization deletion removes them
before projects and teams.
