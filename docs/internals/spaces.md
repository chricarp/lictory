# Lictory Spaces

Lictory Spaces is the knowledge side of Lictory: spaces of nested pages that
people write together in real time and change through the same reviewed,
Git-inspired history as specifications.

> **Status:** in development behind the `spaces` feature flag. This document
> records the agreed model so that every step of the implementation preserves
> it. Nothing here is available to users until the flag is turned on, and the
> sections describe the target behavior, not shipped behavior.

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
- In the same transaction it re-checks the session, two-factor requirement,
  organization membership (locking the membership row, because Better Auth
  commits membership changes outside the organization lock), space edit access
  and branch collaboration, then appends a bounded batch with the actor and a
  sequence number.
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
  with a short reason that never contains document content.

Measured on a development machine against local PostgreSQL (the spike tests
in `packages/core/src/spaces`): a save takes about 12 ms (p95 under 25 ms) in
a quiet organization and under 80 ms at p95 while four sessions keep the
organization lock fully busy with 10 ms exclusive mutations.

Revocation stops outgoing updates too: access changes signal the collaboration
service after commit, and connections are also revalidated periodically, so a
missed signal is bounded. Writes are always checked against current access.

Compaction of the update log is a worker job with a lease and a fence; it never
removes or alters commits.

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
