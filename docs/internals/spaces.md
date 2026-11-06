# Lictory Spaces

Lictory Spaces is the knowledge side of Lictory: spaces of nested pages that
people write together in real time and change through the same reviewed,
Git-inspired history as specifications.

This document records the model; the sections under
[Implementation](#implementation), [History in practice](#history-in-practice),
[Comments](#comments), [the collaboration service in operation](#the-collaboration-service-in-operation)
and [Interface](#interface) describe how it is built.

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
  new **epoch** of that draft. Clients of the old epoch reconnect to the new
  one; nothing of the old epoch is applied to it silently. Edits the server
  had stored in the old epoch stay reconstructable on the server (see
  [Epochs](#history-in-practice)); edits it never stored (typed offline or
  still in flight) are refused and kept in the editor's browser, which
  offers them back (see [Interface](#interface)).
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

### History in practice

The commands (`packages/core/src/spaces/history.ts`, all through
`applyMutation`) and the rules they enforce:

| Command                                          | What it does                                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commitDraft`                                    | Seals a line's draft (`draftId`, `epoch`) at exactly `expectedSequence` with a `title` and optional `message`. On main in a Direct space it is "Publish"                                                                                   |
| `restorePageCommit`                              | A new commit on a line with an earlier commit's title and content (`expectedHead` names the head you saw); the line's draft starts a new epoch from it                                                                                     |
| `createPageBranch`                               | A named branch from main's head or `fromCommitId`, with its own draft seeded from that commit                                                                                                                                              |
| `setPageBranchCollaborator`                      | The branch author invites or removes an editor of the space                                                                                                                                                                                |
| `deletePageBranch`                               | The author or an editor of the space deletes a branch no unmerged pull request uses; its draft is fenced, its commits stay                                                                                                                 |
| `syncPageBranch`                                 | Merges main (or `fromBranchId`) into a branch with a two-parent merge commit; conflicts are refused until `resolutions` names a choice for each                                                                                            |
| `createPagePullRequest`, `updatePagePullRequest` | Opens a pull request into main (default) or another branch, optionally as a draft; changes title, description and draft state                                                                                                              |
| `requestPageReview`, `cancelPageReview`          | Asks someone who can comment on the page to review, `required` or not (the reviewer is notified); reviewers may decline                                                                                                                    |
| `decidePagePullRequest`                          | `approve`, `request_changes` or `revoke`, bound to the merge result of `inspectedSourceHead` and `inspectedTargetHead`                                                                                                                     |
| `mergePagePullRequest`                           | Merges after the gates below; into main it publishes and records the valid approvals on the new commit                                                                                                                                     |
| `deletePagePullRequest`                          | The author or an editor of the space closes an unmerged pull request; it stays in the database with its reviews, and its open discussions are resolved (each recorded)                                                                     |
| `proposePageChange`                              | A branch from main, a commit with the given title and content (GitHub-flavoured Markdown through `markdownToDocument`, or canonical JSON) and an open pull request into main, in one step: how agents change pages without publishing them |

Who may do what:

- Writing to a line (commit, restore, sync, opening a pull request from it)
  needs `canEditDraft`: edit access to the active space and page, and for a
  named branch being its author or a collaborator. Main is written only in
  Direct spaces; in Reviewed spaces commits, restores and drafts on main are
  refused and changes arrive through pull requests.
- Creating branches and proposing changes needs edit access to the space.
- Reviewing needs `canReviewPageChange`: comment access to the active page
  (pages have no disciplines) and not being a contributor to the result.
  Contributors are the authors and contributors of every commit the merge
  brings in (reachable from the source head and not from the target head).
  Unlike specifications, the only member of an organization gets no
  exception: a person working alone uses a Direct space.
- Merging into main needs edit access to the space; merging into a branch
  needs to be its author or a collaborator.

**Sealing.** The server reads the epoch's snapshot and the updates up to
exactly `expectedSequence` (refused if the stored sequence is lower: the
editor must wait for "Saved"; refused if it is below `committed_sequence`),
converts them with the document engine and rejects invalid content with the
engine's reason. Contributors are the authors of the updates since the last
committed sequence of the epoch, plus the person sealing. A commit equal to
the head (title and content) is refused as "Nothing to commit"; when edits
since the last commit cancel out, the cut is recorded as committed without a
commit (`nothingToCommit`), so a draft never keeps "uncommitted changes" it
cannot get rid of. Page titles live in commits only, and there is no rename
command. The working title is part of the draft (the `title` Y.Text), so
the committed title is the draft's title at the sealed cut, exactly like
the content: a title someone types after the cut stays uncommitted. Only
when the draft has no title text (nobody edited it) does the `title` of
`commitDraft` apply, and then the head's title; a working title longer than
200 characters is refused.

**Epochs.** Every head move that does not come from sealing a line's own
draft (restore, sync, merging into the line, reopening main when a space goes
back to Direct) starts a new epoch of that line's draft whose snapshot is the
new head's Yjs state (`documentToDraftState`), so the live draft starts with
exactly the committed content. The `space_draft` trigger closes the old
epoch's rooms. Restoring is refused while the draft has uncommitted changes
unless `discardDraftChanges` is passed. Every epoch's starting state is
kept (`space_draft_seed`, written when the epoch starts and never changed)
next to its update log, so a replaced epoch can be reconstructed exactly as
it was last stored: `recoverDraftEpoch(db, actor, draftId, epoch)`
(`packages/core/src/spaces/drafts.ts`) returns its canonical content,
Markdown and working title, for support, operators or a later editor
action. It reads only, needs `canEditDraft` on the draft's line now (others
get "not found"), and putting text back is an ordinary edit of the current
draft. This holds for every epoch started after migration
`0039_space_draft_seed` and for the epochs current when it ran (backfilled
from `space_draft.snapshot`); an epoch replaced before that cannot be
reconstructed, and says so. Seeds and update logs are part of the
organization export and are removed with the organization.

**Merging and conflicts.** Merges use the merge base of the two heads
(refused when there is none or more than one: restore the wanted version on
a branch instead) and `mergePages`: the title merges like a block
(conflict id `page-conflict:title`) and the content through the engine's
`mergeDocuments` (conflict ids `page-conflict:<path>`). In a pull request,
"ours" is the source and "theirs" the target, as in a sync. A conflicted sync
or merge is refused with kind `page_merge_conflicts` and writes nothing; the
read `previewPageMerge` returns the conflicts (and the browser, which has the
same engine and the commits, computes the identical result). A second
`syncPageBranch` sends `resolutions` keyed by conflict id: `"ours"`,
`"theirs"`, `"both"` or `{ manual: blocks }`, and for the title `"ours"`,
`"theirs"` or `{ title }`. Conflicts are resolved on the source branch;
a pull request with conflicts can be neither reviewed nor merged.

**Reviews.** A decision is a row bound to the result hash (`documentHash` of
the merged title and content) and the heads that were inspected. A new
decision withdraws the reviewer's previous one; `revoke` withdraws without a
new one. After every head move of a page, current decisions whose result
hash no longer matches their pull request's result become stale with the
reason ("policy changed after this review…"), and the approvers are told
(`page_approval_invalidated`). A stale or withdrawn decision never counts.

**Merge gates**, checked in this order: the pull request is open (not a
draft); the inspected heads are current; no uncommitted changes in the source
or target draft; a single merge base and no conflicts; changes remain; no
open blocking thread of the pull request (merging into main: of the whole
page); no current request for changes of this result; every required
reviewer has a current approval of this result and still can review the
page; in a Reviewed space merging into main, at least one required review.
Direct spaces need no review, but a request for changes still blocks.

**Merging into main** creates a two-parent commit on main (the target head
first) whose contributors are the change's contributors plus the person
merging, records the pull request and the valid approvers on it
(`approver_ids`: "Approved" names that commit in Reviewed spaces only; in
Direct spaces history shows the same people as "Reviewed by"), moves the
published pointer (main's head), starts a new epoch of main's draft in
Direct spaces and retires the source branch (recorded as `branch_deleted`
with `automatic: true`) unless another unmerged pull request uses it. A merge
into another branch moves only that branch (and starts a new epoch of its
draft).

**Reverse states.** Commits are never undone; restore makes a new commit.
A decision is revoked; a review request cancelled; a pull request returns to
draft or is closed. A deleted branch is not restored: create a new branch
from its last commit (its commits stay in the history and `listPageCommits`).

Page activity (`page_activity`) records the history events a commit graph
does not show: branches created, deleted (automatically or not) and their
collaborators, restores, syncs, proposals, pull requests created, changed,
merged and closed, review requests and decisions. Commits themselves are not
repeated there.

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
- State that projections show ("this page has unpublished changes") changes
  at coarse transitions only (see
  [uncommitted changes](#uncommitted-changes)).
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
- **Stored sequence.** After each stored batch the service sends every
  editor of the document a stateless message
  `{"type":"lictory.draft.stored","sequence":N}` (`DRAFT_STORED_MESSAGE`),
  and sends it to an editor when it connects; an editor may ask again with
  `{"type":"lictory.draft.sequence"}`. `N` is the `expectedSequence` the
  editor passes to `commitDraft`: the cut it has seen stored.
- **Restarts lose nothing stored.** All draft state is in PostgreSQL. SIGTERM
  refuses new connections, closes open ones and waits (bounded) for pending
  saves; editors keep their unsaved changes and resend them when they
  reconnect.

## Comments

Threads are anchored and keep their history like specification threads:

- on a commit: the commit, the block and range, and the quoted text. A
  commit never changes, so the anchor never moves;
- on a live draft: Yjs relative positions, which follow concurrent edits within
  that draft and epoch, frozen to a commit range when the draft is committed;
- on the whole page.

When anchored text is deleted, the thread shows "Original text removed" with
the quote and a link to the version it was written on. Threads are never
silently re-attached elsewhere.

### Who does what

Discussions follow the rules of specification threads, translated to space
access: whoever may comment on the page (`canCommentOnPage`: comment or edit
access to an active space and page) starts a thread, replies, resolves,
reopens and marks it blocking or non-blocking. Viewers read threads but
cannot write them; people without access cannot tell a thread exists.
Messages are never edited or deleted (specification messages are not
either), and resolving keeps every message. Archived pages and spaces are
read-only, discussions included.

A blocking thread blocks merging the page's changes while it is open; the
history commands check it with `openBlockingPageThreads`
(`packages/core/src/spaces/discussions.ts`, see
[History](#history-commits-branches-and-pull-requests)).

### Anchors

The anchor is a versioned protocol shape (`PageThreadAnchor`,
`pageThreadAnchorSchema` in `packages/core/src/contracts/protocol.ts`):

```ts
{ v: 1, kind: "commit", commitId, blockId, from, to, quote }
{ v: 1, kind: "draft", draftId, epoch, start, end, quote }
{ v: 1, kind: "page" }
```

- `blockId` is the block's stable id; `from` < `to` are offsets into that
  block's text, frozen with the commit.
- `start` and `end` are base64 encodings of Yjs relative positions
  (`Y.encodeRelativePosition`) in the draft's current epoch.
- `quote` is the selected text, 1 to 2000 characters (clients shorten longer
  selections).

The server checks the shape and bounds, that the commit belongs to the page,
and that the draft belongs to the page, is open and is at that epoch (an old
epoch's positions point into replaced content, so they are refused with
"select the text again"). It never resolves positions. A draft thread
records the draft's branch as its line; any thread may name the branch it
was written on (`branchId`), which must be a live branch of the page.

**Freezing draft anchors is the commit command's job** (it has the document
engine): when a draft is committed, each open thread anchored to that draft
and epoch is rewritten in the same transaction to a commit anchor on the new
commit with `commit_id` set. The relative positions are resolved against the
Yjs document reconstructed at the sealed sequence: the anchor's block is the
textblock containing the start (found by its path, so it is the committed
block's id even when canonicalization assigned it), `from` and `to` are
ProseMirror offsets into that block's content (a character counts 1, an
inline atom or line break counts 1), a range running into later blocks is
cut at the end of its first block, and the quote is the committed text (the
original quote when that is empty). Threads whose text no longer exists keep
their quote and point at the commit that removed it:

```ts
{ v: 1, kind: "detached", commitId, quote } // "Original text removed"
```

Clients never create `detached` anchors (`storedPageThreadAnchorSchema` is
what is stored and synchronized; `pageThreadAnchorSchema` what commands
accept). Starting a new epoch without committing leaves old draft anchors as
they are: they then show their quote only. This is the only change ever made
to an anchor.

### Notifications

Page notifications use the shared machinery
([notifications](notifications.md#lictory-spaces)) with their own kinds, and
reach only people who can read the space, checked when written and again
whenever one is read or emailed:

| Kind                        | Who                                                                   | Default        |
| --------------------------- | --------------------------------------------------------------------- | -------------- |
| `page_mentioned`            | People mentioned in a message (`@[label](mention:USER_ID)`)           | In app + email |
| `page_thread_reply`         | The thread's earlier participants                                     | In app         |
| `page_blocking_thread`      | Authors and contributors of the page's commits                        | In app + email |
| `page_review_requested`     | Reviewers asked to review a page change (`notifyPageReviewRequested`) | In app + email |
| `page_approval_invalidated` | Reviewers whose approval went stale (`notifyPageApprovalInvalidated`) | In app + email |

Opening or resolving a non-blocking thread notifies nobody: discussions are
read where they are, and notifications exist to unblock work. The two review
entry points (`packages/core/src/spaces/notifications.ts`) take
`{ organizationId, pageId, actorId, reviewerIds, pullRequestId,
pullRequestTitle }` and run in the command's transaction.

### Files

A page can own files ([private file storage](file-storage.md#page-files)).
Commenters attach them, readers of the space list and download them, and
the editor inserts them with the same stable `/api/files/{id}` reference
specifications use (Markdown `![name](/api/files/{id})`, an image node's
`src`).

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
| `space_draft_seed`                        | The starting Yjs state of every epoch of a draft, written once when the epoch starts, so replaced epochs stay reconstructable                                   |
| `page_pull_request`                       | Pull requests: source and target branch, title, description, `status` (draft, open, merged), merge (who, when, `merge_commit_id`), close (`deleted_at`)         |
| `page_pull_request_reviewer`              | Review requests: person, `required`, who asked                                                                                                                  |
| `page_pull_request_review`                | Decisions (append-only): approved or changes requested, `result_hash`, inspected heads, `stale_at` with `stale_reason`, `withdrawn_at`                          |
| `page_thread`, `page_thread_message`      | Discussions: status, blocking, `anchor` (checked against `commit_id` and `branch_id`), `pull_request_id`, resolution; messages (never edited)                   |
| `page_activity`                           | Discussion events (opened, resolved, reopened, blocking changed) with actor, time and delegating agent                                                          |
| `space_entity`                            | Spaces read projections (derived, replicated)                                                                                                                   |

`page_thread.pull_request_id` names the pull request a thread was opened on
(a foreign key within the page). `page_commit` also records the pull request
a merge commit came from and its valid approvers (`approver_ids`), written
once with the commit. `page_activity` exists
because a thread's row shows only its current state: who resolved it, who
reopened it and when it became blocking would otherwise be lost. Page files
are `file_object` rows with a `page_id` instead of a work item (see
[file storage](file-storage.md#page-files)).

`hash` is `documentHash(title, content)`: the SHA-256 of the canonical JSON
of `{ title, content, schemaVersion }`. A new page's first commit is the
engine's canonical empty document (`initialPageCommit`), and every new draft
or epoch starts from its base commit's Yjs state.

### Commands

Protocol version **16** adds `createSpace`, `updateSpace`,
`setSpaceAccessMode`, `setSpaceGrant`, `archiveSpace` (with `archived`),
`createPage` (main branch, first commit and, in Direct spaces, main's draft;
its receipt names `pageId`, `mainBranchId`, `commitId` and `draftId`),
`movePage` and `archivePage` (with `archived`), the page history commands
listed under [History in practice](#history-in-practice), and the page
discussion commands `createPageThread` (`pageId`, `threadId`, `messageId`,
`anchor`, `body`, optional `blocking`, `branchId` and `pullRequestId`),
`replyToPageThread`,
`resolvePageThread`, `reopenPageThread` and `setPageThreadBlocking`
(`packages/core/src/spaces/discussions.ts`). They run through
`applyMutation` like every command, so they are capabilities on every surface;
the handlers live in `packages/core/src/spaces/commands.ts`. Every command
that names a space, page, branch, pull request or thread checks reading it
first: someone who cannot read it gets the same "unavailable" answer as for
one that does not exist, never its name or state. The exceptions are the
administration commands `setSpaceAccessMode`, `setSpaceGrant` and
`archiveSpace`, which a space's administrators may use without reading it
(that is how they grant themselves access). `updateSpace` needs reading,
then edit access for name, handle, description and icon and administration
for home and publishing, and refuses an update that changes nothing
("Nothing to change") without writing. Restoring a page
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
values, a union separate from `Entity`. With a NULL `page_id`: `space`,
`spaceGrant` (id `{spaceId}:{userId}`) and `page` summaries (title and commit
of main's head as `publishedCommitId`, `approvedCommitId` when that commit
merged with valid approvals in a Reviewed space, who published it and its
message as `publishedById` and `publishedMessage` (so the space home says
what changed without loading histories), `mainDraft` in Direct spaces,
`openThreads` and `blockingThreads`). Carrying their page:

- `pageCommit`: parents, title, content, Markdown, hash, message, author,
  contributors, `pullRequestId` and `approverIds`. Every commit carries its
  content: the history view, diffs and the browser's merge preview need
  heads, merge bases and old versions, and pages are bounded (about 1 MB).
  If the history of large pages becomes too heavy to replicate, older
  commits' content moves to on-demand reads (`getPage` with `commitId`)
  without changing any command.
- `pageBranch`: live branches with collaborators and `draft`
  (`PageDraftSummary`: `id`, `epoch`, `documentName` — the collaboration
  document name the browser connects to — `committedSequence` and
  `uncommittedChanges`; null for main in Reviewed spaces).
- `pagePullRequest`: unmerged and merged pull requests (closed ones are not
  projected) with reviewers and, while unmerged, `mergeability`: heads,
  merge base, `resultHash` (null with conflicts), `conflicts`,
  `contributorIds`, `blockingThreads`, `requiredReviews`,
  `requiredApprovals`, `approvals`, `changesRequested`, `staleReviews` and
  `blockers` (`draft`, `no_merge_base`, `conflicts`, `no_changes`,
  `uncommitted_source`, `uncommitted_target`, `blocking_threads`,
  `no_required_review`, `review_pending`, `changes_requested`). It is
  computed from page data only; access of the moment (a reviewer who left)
  is checked when merging.
- `pagePullRequestReview`: every decision, current or not.
- `pageThread`, `pageThreadMessage` (one row per message, so a reply
  replicates one row) and `pageActivity`.

`writeSpaceProjections` rewrites what a command touched: `pages`
(summaries), `commits` (new commits by id: commits never change), `pageLines`
(branches, pull requests, reviews), `pageDiscussions` and `pageHistories`
(all page-level rows). Discussion commands that change counters also rewrite
the page's lines (blocking threads feed mergeability). `rebuildSpaceProjections`,
called by `rebuildProjections`, reconciles `space_entity` and `space_reader`,
and the projection invariant the test suites check includes both. No
`space_entity` row depends on who reads it, so access changes rewrite only
`space_reader`.

#### Uncommitted changes

A draft's stored `sequence` advances with every typing batch through the
draft writer, outside `applyMutation`; it is never projected. What is
projected is whether stored edits exist beyond the last commit
(`sequence > committed_sequence`), and that changes only at two coarse
transitions:

- clean → dirty: when the draft writer's batch is the first beyond the
  committed sequence (`becameDirty`), it calls `refreshDraftProjections`
  after its transaction committed and after the authors were told "Saved".
  That is a transaction of its own taking the organization lock in
  **exclusive** mode, like every domain write, that rewrites the page's
  summary and lines from the tables. The writer's own transaction keeps the
  shared lock and never writes projections, so the narrow exception above
  is unchanged. If the refresh fails the flag shows late (until the next
  history command on the page or a rebuild); every gate reads the draft
  itself.
- dirty → clean: only commits and new epochs (domain commands), which
  rewrite the projections in their own transaction.

The browser connected to a draft also knows the stored sequence from the
collaboration service's stored messages, so the editor can say
"uncommitted changes" without waiting for the projection.

Both tables are in the `lictory_zero` publication. The synced queries
`spaces({ organizationId })` (space-level rows), `page({ organizationId,
pageId })` (one page's history) and `mySpaceAccess({ organizationId })` (my
reader rows) require a `space_reader` row for the current user and their
organization membership; `organization` and `workItem` read only
`sync_entity`.

### Reads, export and deletion

The capabilities `listSpaces` (readable spaces with the reader's level, plus
the restricted spaces the person administers without reading them, names
only), `listPages` (one space's tree in reading order), `getPage` (main's
latest title and Markdown, or any commit with `commitId`; never a draft),
`listPageCommits` (the history, newest first, optionally of one line),
`diffPageCommits` (title and block changes between two commits),
`previewPageMerge` (a pull request's or a sync's merge now: conflicts with
their ids, result hash, Markdown) and `listPageThreads` (a page's
discussions with their messages; resolved ones on request) are available on
every surface. Agents cannot type into live drafts: they change pages with
`proposePageChange`. `commitDraft` (publishing, on main), deciding reviews
and merging are `decision` commands like their specification counterparts
([human decisions](capabilities.md#human-decisions)): agents call them only
when the person asked, and Litto asks for confirmation first. Organization export includes spaces, grants, pages, commits,
branches, collaborators, pull requests with their review requests and
decisions, drafts with their epoch seeds and update logs (binary Yjs state
as base64), threads,
messages, page activity and page files, an additive change that keeps
archive format version 1; organization deletion removes them before projects
and teams. Deleting an account keeps the person's threads and messages,
attributed to the anonymized account, like specification threads.

### Interface

- **Addresses.** `/{org}/spaces` lists every space I can read (organization
  spaces, then by project), `/{org}/spaces/{handle}` is a space's home,
  `/{org}/spaces/{handle}/pages/{pageId}` a page and
  `/{org}/spaces/{handle}/settings` its settings. Pages are addressed by id,
  so moving one never breaks a link. A space or page I cannot read shows the
  same "not found" as one that does not exist.
- **Subscriptions.** The workspace subscribes to `spaces` and `mySpaceAccess`
  when it opens (space-level rows only) and to `page` while a page is open.
  The page tree is built in the browser from `parentId` and `rank`.
- **Predictions.** Only the tree's structure is predicted locally:
  `createPage`, `movePage` and `archivePage`
  (`packages/core/src/spaces/optimistic.ts`, run by the Zero client mutator
  on `space_entity`). Creating a space, every access, home and publishing
  change and archiving a space wait for the server, because they decide who
  can read what.
- **Navigation.** The organization sidebar lists the organization's spaces
  and those of my projects and teams (the rest under "All spaces"); each
  project's navigation lists its own and its teams' spaces. The command
  palette finds spaces and page titles.
- **The page tree** is a WAI-ARIA tree: arrow keys move and expand, Enter
  opens, Alt+Arrow moves a page among its siblings and Shift+F10 opens its
  actions. Dragging drops a page before, after or into another; "Move…"
  does the same without a pointer. Trees over 120 visible rows render only
  the rows in view. Archived pages are hidden unless shown, and archiving
  offers an undo.
  Beside a page the tree can be put away ("Hide pages", remembered in this
  browser like the sidebar's state; "Show pages" brings it back), and it
  steps aside while comments are open on frames under 80rem. The space home
  has "Find a page" (titles anywhere in the tree, with their path) and
  "Recently updated" with who published what (`publishedById`,
  `publishedMessage` of the page summary). Breadcrumbs keep the immediate
  parent and fold the ancestors between the space and it into "…".
- **Reading.** A page shows main's latest commit, a branch's head
  (`?branch=<branchId>`) or a version picked with `?commit=<commitId>`,
  rendered by a read-only Tiptap editor from the commit's canonical JSON with
  the same extensions that wrote it, so a commit looks the same everywhere.
  Readers load no Yjs and open no socket; while the reader's code loads, the
  commit's derived Markdown stands in. Work item mentions render as live
  chips (identifier, status, refinement and readiness as I can see the item
  now); an item I cannot see shows only the key stored in the content. Page
  links show the linked page's current title, or "Unavailable page" without
  a title when I cannot read it.
- **Editing.** Main in a Direct space opens as published; "Edit" (or
  "Continue editing" when it has unpublished changes) opens its live draft.
  A branch I author or collaborate on opens in its draft. In a Reviewed
  space main is read-only and says "Changes to this page are reviewed. Start
  a branch to propose changes"; "Start a branch" creates one
  (`createPageBranch`, a name suggested from my handle and the title) and
  switches `?branch=` to it. The editor binds Tiptap's Collaboration to the
  line's draft (`draft.documentName` from the projection; a new name, after
  a new epoch, remounts the editor with a fresh Y.Doc) through one
  Hocuspocus socket per tab (`/collaboration`, session cookie, empty token).
  It never calls `setContent` on a mounted draft: projections never touch
  its content, carets or selection. Others' carets carry their name and a
  per-person color; "Anna is editing" lists who else has the draft open.
  The working title is part of the draft (a `title` Y.Text beside the
  `default` fragment) so every editor sees the same title, and a commit
  seals the title stored at its cut; the editor shows the line's committed
  title while the draft's is empty. Blocks come from the toolbar, from "/"
  (blocks, image, work item, page link) and from Markdown shortcuts; "#"
  picks a work item and "[[" a page from what I can read. Images are pasted,
  dropped or chosen and stored as page files (`/api/files/{id}`).
- **Toolbar.** Undo and redo, the inline marks (bold, italic, strikethrough,
  code, link) and "Comment" stay visible; block styles are one "Text" menu,
  table, divider, image, work item and page link one "Insert" menu, and a
  "Table" menu appears inside a table. "Close editor" returns to the
  published page (main of a Direct space); the draft stays saved.
- **Save state**, beside the title: "Saving…" while the provider has edits
  the service has not acknowledged, "Saved" when it has none (the service
  stores before it acknowledges, so this means stored), "Offline — changes
  kept on this device" when the browser or the socket is offline (the edits
  stay in the open tab, which warns before closing with unsaved edits, and
  are offered again on reconnect), "Live editing unavailable" when the
  service cannot be reached before the first sync (reading, history and
  comments keep working). A pill says "Unpublished changes" (main) or
  "Uncommitted changes" (branch) from the projection's
  `uncommittedChanges`, the stored sequence the service announced, or local
  unsaved edits. Close reasons from the service are shown as they are: a
  replaced draft reopens the current one (see unsaved text below), revoked
  or missing access leaves
  the editor, a signed-out session asks to sign in again.
- **Unsaved text.** When the editor closes a draft session (a new epoch
  replaced it, or I leave the editor) while it holds edits of mine the
  service has not stored, an open connection first gets about two seconds
  to store them (a replaced epoch refuses them). What is still unstored is
  never dropped: the top-level blocks my unstored edits touched (converted
  by the document engine, as the server would) and the working title, if I
  changed it, are kept in this browser under my person, organization, page
  and draft, and removed with my other kept text when I sign out. The page
  then says "This page was replaced while you had unsaved changes. Your
  text is kept on this device." with "Copy text", "Insert at end" (an
  ordinary edit of the current draft, with new block ids, made only when I
  ask) and "Discard". "Unstored" is judged by my own edits in the Yjs
  document since the service last acknowledged all of them, not by the
  provider's counter, which a refused reconnect also raises.
- **Publish and Commit.** "Publish" (main, Direct space) or "Commit"
  (branch) takes an optional message, waits for "Saved", asks the service
  for the stored sequence (`lictory.draft.sequence`, falling back to the
  last announced one) and sends `commitDraft` with it (and, for older
  drafts without a working title, the title it shows). The
  browser learns the outcome from the line's synchronized branch row: the
  head moved ("Published version N", counting main's first-parent chain) or
  only the committed sequence did ("No changes to publish"); the refusal
  "Nothing to commit" reads the same.
- **Comments.** Selecting text offers "Comment" (people with comment
  access; in the live editor also Mod+Alt+M and the toolbar). On the reader
  the anchor is a commit anchor (the block id, offsets in the block's
  content, the quote); in a live draft it is a draft anchor (base64 Yjs
  relative positions of this epoch). Open threads are highlighted as
  decorations that follow typing and are recomputed from their anchors after
  remote changes. A commit anchor also finds its text in later versions and
  drafts while its block and words survive; otherwise the thread shows its
  quote ("The quoted text changed"). The panel lists the line's threads in
  document order (threads without a range after them, comments on the whole
  page last), with replies, resolve and reopen, blocking toggles, resolved
  threads folded away, and "Original text removed" with a link to the
  version for detached anchors. Threads belong to the line they were
  written on (`branchId`; main also shows threads without one); pull
  request threads are left to the pull request. The header shows the page's
  open and blocking counts and toggles the panel: beside the page on wide
  frames (open by default when the page has comments), a sheet on narrow
  ones. The count of blocking threads says what they block ("blocks merging
  pull requests" in Direct spaces, whose Publish they do not stop; "blocks
  merging" in Reviewed ones). Highlights are tints in the thread's colour;
  the selected thread and the one pointed at, in the panel or in the text,
  are tinted more on both sides.
- **Space settings.** Every setting applies when it changes (text fields
  when left or on Enter) and shows "Saving…", then "Saved", or the refusal
  beside it. Moving an Inherited space to another location asks first,
  since it changes who edits; restricting asks first too. The home is
  labelled "Location" in the interface. Named access rows show the
  effective level and its source (named access, or membership of the
  location, computed for display from the directory with the server's
  rule) and what removing the named access leaves.
- **Loading.** The space home and tree load none of this: the page surface
  (Tiptap, the reader, comments) is its own chunk, and the live editor (Yjs,
  y-tiptap, the Hocuspocus provider) another one that only editors load.
- **Administrators without access.** `/{org}/spaces` lists the restricted
  spaces I administer but cannot read (from `listSpaces`, names only) with an
  explicit, audited "Grant myself access".

- **History and review.** A page's `/history` address shows Versions,
  Branches and Pull requests; `?view=pulls&pr=<id>` opens a particular review.
  A space's `/pull-requests` address lists its open proposals through the
  `spacePullRequests` query and `useSpacePullRequests(spaceId)` hook, which
  authorize membership and space access and return proposal metadata only. History displays
  immutable commits and block changes; restoring creates a new commit and
  restarts the draft epoch, with explicit consent to discard live changes.
- **Branch selection.** `usePageBranchSelection()` from
  `components/spaces/history/branch-selection` returns `{ branchId, branch,
setBranch }`. It reads the page parameter and `?branch=<id>`; absent branch
  selects main. `setBranch(null)` returns to main and preserves other search
  parameters. An unknown explicit branch stays undefined, so editors must not
  fall back to writing main. The editor uses `branch.draft` to connect to the
  selected line. Review decisions send the exact preview heads; conflicts are
  resolved by syncing the target into the source before another review.
