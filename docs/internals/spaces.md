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
includes text nobody saw. Deleting a branch or merging a pull request removes
the discussions of the line that ends ([When a line ends](#when-a-line-ends)).

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
| `deletePageBranch`                               | The author or an editor of the space deletes a branch no unmerged pull request uses; its draft is fenced, its commits stay, its discussions are removed (`discussionsToRemove` confirms the count shown)                                   |
| `syncPageBranch`                                 | Merges main (or `fromBranchId`) into a branch with a two-parent merge commit; conflicts are refused until `resolutions` names a choice for each                                                                                            |
| `createPagePullRequest`, `updatePagePullRequest` | Opens a pull request into main (default) or another branch, optionally as a draft; changes title, description and draft state                                                                                                              |
| `requestPageReview`, `cancelPageReview`          | Asks someone who can comment on the page to review, `required` or not (the reviewer is notified); reviewers may decline                                                                                                                    |
| `decidePagePullRequest`                          | `approve`, `request_changes` or `revoke`, bound to the merge result of `inspectedSourceHead` and `inspectedTargetHead`                                                                                                                     |
| `mergePagePullRequest`                           | Merges after the gates below; into main it publishes and records the valid approvals on the new commit; removes the source's and its own discussions (`discussionsToRemove` confirms the count shown)                                      |
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
open blocking thread of the pull request or among the discussions the merge
removes (merging into main: of every line of the page that still exists); no
current request for changes of this result; every required
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
configuration change of the organization. The same writer stores the live
drafts of specifications, in their own tables and with Work's rules for who
writes a line ([specification drafts](specification-drafts.md)). The
exception is narrow:

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
- **Document names** are `<draft id>.<epoch>` (`draftDocumentName`), and
  `spec.<draft id>.<epoch>` for specification drafts; the browser takes them
  from the page's (or item's) synchronized state, never builds them from
  anything else. A name of a fenced or replaced epoch no longer opens. The
  `specification_draft` trigger signals on the same channel.
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
- **Refused changes.** A change the service will not store closes only that
  draft's connection, with one of the `SAVE_REFUSALS` reasons: too large
  (one change over 512 KiB), unreadable, edit access lost at write time, or
  the draft gone. The socket stays open, so nothing reconnects or resends on
  its own (a deterministic refusal would only repeat). A database failure is
  different: after a few seconds of retries the service resets the socket and
  the editor reconnects and resends, as after any outage. Hocuspocus queues
  messages that reach a closed draft until that address is opened again on
  the socket, then applies and acknowledges them. Each editor session
  therefore addresses its draft under a key of its own (Hocuspocus session
  awareness, `<document name>\0<session id>`): what an earlier session sent
  is never applied or acknowledged to a later one, which would make the later
  one read "Saved" too early. After a refusal the editor also stops sending
  for that draft, without a close message, and only a new session opens it
  again.
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
Messages are never edited (specification messages are not either), and
resolving keeps every message; discussions are deleted only with their line
([When a line ends](#when-a-line-ends)). Archived pages and spaces are
read-only, discussions included.

A blocking thread blocks merging the page's changes while it is open; the
merge gate counts it from the page's line state
(`evaluatePullRequest` in `packages/core/src/spaces/history-state.ts`, see
[History](#history-commits-branches-and-pull-requests)).

### When a line ends

A discussion belongs to the line it was written on: its `branch_id`, or,
written on a pull request without a branch, that pull request's source. When
a line ends, its discussions end with it, whatever their state: open or
resolved, blocking or not, with every message. This is a deliberate product
decision: a discussion about a line that no longer exists cannot be acted on,
and left behind it would block merges into main forever with nothing to
resolve it on. Lictory never deletes discussions in any other case.

| Event                                 | Removed                                                                                                                                                              | Kept                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Deleting a branch                     | Every discussion on it, and branchless discussions of pull requests from it                                                                                          | Discussions on main and other branches; whole-page and commit discussions without a line |
| Merging, the merge retires the source | The same as deleting the source, plus the pull request's own branchless discussions                                                                                  | As above; discussions written on the pull request but on the target                      |
| Merging, the source stays             | Discussions on the source (not tied to another pull request) and the pull request's own; into main the source stays only while another unmerged pull request uses it | Discussions of the source's other pull requests; the target's; other lines'              |
| Closing a pull request                | Nothing: its open discussions are resolved (each recorded), as before                                                                                                | Everything                                                                               |

`packages/core/src/spaces/discussion-lifecycle.ts` decides the selection;
the commands, the projections and the repair share it, so what people are
told is exactly what is removed. Removal happens in the transaction of the
deletion or merge, after every gate passed: a refused, failed or cancelled
operation removes nothing, and repeating a completed one removes nothing
more. A merge never removes an open blocking discussion: the ones it would
remove hold the merge like the pull request's own until they are resolved.
A merged pull request takes no new discussions.

Each removal records one `discussions_removed` activity (reason, branch,
pull request, thread ids, message count and the counts by state); messages
are not copied into it. Older activity, notifications and exports that name
a removed thread keep its id; following such a link opens the page.

People are told before they confirm. Each branch projection carries
`discussionsOnDelete` and each pull request's mergeability `onMerge` (whether
the source is deleted and the counts by state). The branch deletion and the
merge confirmation say, in English, how many discussions are deleted, by
state, and that this cannot be undone; the merge confirmation also says
whether the source branch is deleted and that discussions on the target and
other branches are kept. The confirmed total travels with the command
(`discussionsToRemove`; a merge also sends whether it was told the source
branch is deleted, `deletesSourceBranch`, refused when that changed); if it no longer matches, the command is refused
("The discussions this removes changed since you confirmed…") and nothing is
removed. A command that would remove discussions without a confirmed total
(a browser tab loaded before the warning existed, an agent that did not look)
is refused the same way. Agents get the same counts and the same check.

Discussions left on branches deleted before this rule are held by nothing
(the merge gate ignores lines that no longer exist). Run the
`remove-orphaned-page-discussions` backfill once after deploying it
(`deploy.sh <env> backfill <version> remove-orphaned-page-discussions`; locally
`bun scripts/backfills/remove-orphaned-page-discussions.ts [--dry-run]
[organizationId ...]`, which rejects any other option). It removes those
discussions and reprojects every page, so branch and pull request rows
projected before the counts existed carry them (until then a confirmation
on such a page has no counts, and the server refuses a removal nobody
confirmed). It works one page per transaction under the organization lock,
records each removal attributed to whoever deleted the branch
(`repair: true`), and changes nothing on a second run.

The confirmations capture the counts when they open and send exactly those.
If the counts change while one is open, it says so and waits until the
person cancels and opens it again; it takes focus when it opens and returns
it to its button when cancelled.

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
  spaces in their navigation. Page titles are in the command palette, and
  what pages say is found by [content search](#search-and-product-knowledge).
- References to work items, other pages (optionally pinned to a version) and
  recorded decisions render as live chips for readers who can see the target:
  an item's key, title and delivery status, with its type, refinement state,
  readiness, owner and iteration in the chip's card; see
  [one editor for pages and Markdown](editor.md#references). Page comments are
  written in the same editor as everything else.
- Pages and work refer to each other through
  [knowledge links](knowledge-links.md): the references of each page's
  published version (work items, pages with an optional pinned commit,
  decisions), the pages specification revisions cite, pages attached to an
  item, the page an item was created from, page branches proposed from an
  item revision and the context pages of projects, teams and iterations.
  Every link is visible only to readers of its page and grants nothing.
- Images and files use [private file storage](file-storage.md) with page
  ownership checks.
- Notifications follow [the notification rules](notifications.md): mentions,
  review requests, stale approvals and blocking comments, never every edit.
- Access changes are recorded in the [audit log](audit.md); organization data
  export, organization deletion and account anonymization cover Spaces.

### Work in pages

Pages show work and start work; they never hold delivery state. Work stays
owned by its delivery owner (Lictory or the delivery tool), and everything a
page shows of it is read live with the reader's own access.

- **Work lists** (`workList` block: a project and one narrow filter, `epic-children`,
  `iteration` or `label` with `filterId`, or `referenced` for the items the
  page mentions, optionally limited to a project; an optional `title`). The
  commit stores only that query. Readers see the matching items they can
  see now (key, title, status, refinement, estimate; in external-delivery
  projects the status read back from the delivery tool) with "N of M done",
  counting only those items (canceled ones count toward neither). Nothing in
  a list changes an item. A list is not a snapshot: an old version shows
  today's items. The commit's derived Markdown states the list's label and
  "(live list in Lictory)"; exports that run with a reader's access (`getPage`,
  for agents and Litto) resolve it at that moment into static `[KEY](item:ID)`
  references, which import back as plain references, never as a live list.
- **Decisions** (`decisionRef`, inline): the shared decision chip inside a
  sentence; a card
  when it stands alone in its paragraph (title, the conclusion, the item key,
  the revision it was recorded on, and "Archived" when it or its item was
  withdrawn). The decision's text stays canonical in Work (`getDecisions`
  reads it, once for every reference on screen); the node keeps a `label`
  for readers it cannot be resolved for. Archiving or restoring elsewhere
  reaches an open page without a reload: what is on screen is read again
  when the window regains focus or becomes visible and every minute while
  visible, the cache belongs to one person and organization, and a failed
  read offers Retry.
  Work's Decisions section offers "Add to a page", which proposes a page
  change (`proposePageChange` with the item revision as `origin`) appending
  the card; main is never edited directly.
- **Work from page text.** Selecting text of a commit in the reader offers
  "Create work item" beside "Comment", and every open task item without a
  work item mention offers it too, to people who can create work in some
  project. The dialog prefills the title (the selection, or the nearest
  heading for long selections; the task's text) and a description quoting
  the text with a pinned link to the page version, lets the person choose
  project and type, and says before anything is created that the quote is
  copied into the item, whose readers may differ from the page's (warning
  when the space is restricted). With Lictory Intelligence available, "Draft
  with Litto" sends the text to `draftProposals` and creates only the drafts
  the person ticks. Every item created records `source` (page, commit,
  top-level block, quote); each item has a stable mutation id, so a retry
  after a lost answer cannot create a second one, and a partial failure keeps
  what was created and retries only the rest. Live drafts are never a source.
  Afterwards, when the person can edit main, "Add to the page" opens the
  live draft and mentions the new items right after their text (found by
  block id and the words before the selection's end; at the end of the page
  when the block is gone): an ordinary, visible draft edit, published only
  when they publish.
- **Work on this page.** Under the published page, a compact list of the
  work the page knows about (`pageWork`): items created from it, items it
  mentions, items it is attached to and items whose specification cites it,
  each once with how it is linked, with a "N of M done" rollup; page changes
  proposed from work items; and the projects, teams and iterations that
  keep it as context. Items the reader cannot see are left out without a
  trace.
- **Linked work.** The home of a project or team space lists the work items
  its published pages mention (`spaceWork`, page references of that space
  only), open work first, with how much is done and which pages mention
  each.
- **Templates.** "New page" offers Blank, Product requirements, Design doc,
  Runbook, Decision record, Retrospective and Iteration notes:
  `templateDocument(kind, context)` in `packages/core/src/spaces/templates.ts`
  (`templatePageContent` for `createPage`'s `content`; names in
  `template-catalog.ts`). `context` (`projectId`, `iterationId`, `epicId`)
  points the template's live work list at an iteration or epic; without it
  the list is left out. The template is the page's first version, like the
  empty document it replaces (also in Reviewed spaces: the page's creator
  wrote no content).

### Search and product knowledge

`searchKnowledge` finds a phrase in what the person can read: published
pages, work items (title and current specification), recorded decisions and
approved or delivered specification revisions. The command palette shows its
results under its instant title matches ("In pages", "In specifications",
"Decisions"), and a page result opens at the block that matched
(`#block-<id>`).

- **Published only.** A page is searched as the head commit of its main line.
  Live drafts, branches and pull requests are never searched, so text nobody
  published cannot be found, quoted or cited.
- **Readable only.** Pages come from active spaces the person reads
  (`space_reader` and a current organization membership, the same predicate
  as `pageAccess`): restricted spaces only for their named readers, never for
  administrators without a grant. Archived pages, the pages under them and
  archived spaces are left out; restoring brings them back. Nothing about an
  unreadable page reaches the result: no title, excerpt, version or count.
  Work items follow organization membership (every member reads every
  project); archived items and projects are left out with their decisions.
- **One snapshot.** Membership and every search are read in one read-only,
  repeatable-read transaction, so a change in the middle of a search cannot
  mix old and new access.
- **Exact versions.** Each result names its kind, the page's commit and
  version number ("version N", main's first-parent position, as the history
  numbers it) or the revision number, a link to that version, an excerpt
  with the matched ranges and whether the title or only the content matched.
- **Simple matching.** A case-insensitive phrase match (LIKE wildcards are
  literal; Markdown escapes such as `refund\_limit` do not hide a match),
  title matches first, then the most recent, at most `limit` results of each
  kind. Trigram indexes make it fast; there is no separate search index to
  keep in sync, because results come from the same rows readers see.

A search hit is not evidence of authority. `searchProductKnowledge`, which
grounds Litto and agents before they describe established behavior, adds
published pages as their own evidence kind (`page`, with the space's
publishing policy, the commit and version) beside recorded decisions and
approved or delivered revisions. For equal match quality agreements and
decisions rank above pages published through review, and those above pages
published directly; a title match ranks above content-only matches. Its
description tells agents that published documentation is neither agreed
intent nor delivered behavior (see the
[evidence ladder](ai.md#evidence-and-citations)). Proposal intake keeps to
agreements and decisions.

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

| Table                                     | Holds                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space`                                   | Name, handle (unique among active spaces, case-insensitively), description, icon, home (`project_id`, `team_id`), `access_mode`, `publishing`, creator, archive        |
| `space_grant`                             | Named access: one level per space and person                                                                                                                           |
| `space_reader`                            | Effective access (derived, replicated)                                                                                                                                 |
| `page`                                    | Space, parent, `rank`, creator, archive                                                                                                                                |
| `page_commit`                             | Immutable snapshots: parents, title, `content` (Tiptap JSON), `markdown`, `hash`, `schema_version`, message, author, contributors, draft provenance                    |
| `page_branch`, `page_branch_collaborator` | Pointers (`head_commit_id`, `base_commit_id`), exactly one `is_main` per page that is never deleted, author and invited collaborators                                  |
| `space_draft`, `space_draft_update`       | Live drafts (one per line, `branch_id` unique) with epoch, sequence, `committed_sequence`, base commit, snapshot and fence; the update log                             |
| `space_draft_seed`                        | The starting Yjs state of every epoch of a draft, written once when the epoch starts, so replaced epochs stay reconstructable                                          |
| `page_pull_request`                       | Pull requests: source and target branch, title, description, `status` (draft, open, merged), merge (who, when, `merge_commit_id`), close (`deleted_at`)                |
| `page_pull_request_reviewer`              | Review requests: person, `required`, who asked                                                                                                                         |
| `page_pull_request_review`                | Decisions (append-only): approved or changes requested, `result_hash`, inspected heads, `stale_at` with `stale_reason`, `withdrawn_at`                                 |
| `page_thread`, `page_thread_message`      | Discussions: status, blocking, `anchor` (checked against `commit_id` and `branch_id`), `pull_request_id`, resolution; messages (never edited, removed with their line) |
| `page_activity`                           | Discussion events (opened, resolved, reopened, blocking changed, removed with their line) with actor, time and delegating agent                                        |
| `page_reference`                          | Derived index of the references in each page's published version (see [knowledge links](knowledge-links.md))                                                           |
| `page_branch_origin`                      | The work item revision a branch was proposed from, kept after the branch ends                                                                                          |
| `space_entity`                            | Spaces read projections (derived, replicated)                                                                                                                          |

Main's head moves in one place (`moveHead` in `history.ts`, plus the first
commit of `createPage`); both rewrite `page_reference` from the new head in
the same transaction, so the index always describes the published version.
The knowledge links that name a page (`work_item_page_attachment`,
`work_item_page_source`, `page_branch_origin`, `page_context_link`, and the
page citations of `specification_reference`) are described in
[knowledge links](knowledge-links.md).

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
- Knowledge links of the page (`pageReference`, `specificationCitation`,
  `pageAttachment`, `workItemSource`, `pageBranchOrigin`,
  `pageContextLink`), which also fill the `work_item_id` or `project_id`
  column so a work item or project can load the rows of the pages its
  reader can read. Archived pages and pages of archived spaces have none.

`writeSpaceProjections` rewrites what a command touched: `pages`
(summaries), `commits` (new commits by id: commits never change), `pageLines`
(branches, pull requests, reviews), `pageDiscussions`, `knowledge` (the
page's knowledge links; `pages` and `pageLines` rewrite them too, since they
follow main's head, the archive state and the branches) and `pageHistories`
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
pageId })` (one page's history), `mySpaceAccess({ organizationId })` (my
reader rows) and the knowledge link queries `workItemKnowledge`, `pageWork`
and `projectContext` require a `space_reader` row for the current user and
their organization membership; `organization` and `workItem` read only
`sync_entity`.

### Reads, export and deletion

The capabilities `listSpaces` (readable spaces with the reader's level, plus
the restricted spaces the person administers without reading them, names
only), `listPages` (one space's tree in reading order), `getPage` (main's
latest title and Markdown with its commit and version number, or any commit
with `commitId`; never a draft), `searchKnowledge` (content search, see
above),
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
  commit's derived Markdown stands in. References render as the shared
  chips ([one editor for pages and Markdown](editor.md#references)): a work
  item with its identifier, title and status, with type, refinement,
  readiness, owner and iteration in its card; an item I cannot see shows only
  the key stored in the content. Page links show the linked page's current
  title (and the cited version when pinned), or "Unavailable page" without a
  title when I cannot read it. Decisions show their stored title.
- **Editing.** Main in a Direct space opens as published; "Edit" (or
  "Edit unpublished draft" when it has unpublished changes) opens its live draft.
  A branch I author or collaborate on opens in its draft. In a Reviewed
  space main is read-only and says "Changes to this page are reviewed. Start
  a branch to propose changes"; "Start a branch" creates one
  (`createPageBranch`, a name suggested from my handle and the title) and
  switches `?branch=` to it. The editor binds Tiptap's Collaboration to the
  line's draft (`draft.documentName` from the projection; a new name, after
  a new epoch, remounts the editor with a fresh Y.Doc) through one
  Hocuspocus socket per tab (`/collaboration`, session cookie, empty token).
  It never calls `setContent` on a mounted draft: projections never touch
  its content, carets or selection. A remote edit keeps my caret where Yjs
  resolves it while the text holding it still exists (`remote-selection.ts`:
  y-tiptap otherwise falls back to the caret's old offset whenever the
  caret's paragraph changed, so typing before someone's caret in their
  paragraph left it behind). Others' carets carry their name and a
  per-person color; "Anna is editing" lists who else has the draft open.
  The working title is part of the draft (a `title` Y.Text beside the
  `default` fragment) so every editor sees the same title, and a commit
  seals the title stored at its cut; the editor shows the line's committed
  title while the draft's is empty. Blocks come from the toolbar, from "/"
  (blocks, image, work item, page link, decision) and from Markdown
  shortcuts; "#" picks a work item and "[[" a page from what I can read
  (Shift+Enter pins the version published now), "/" → Decision a recorded
  decision. Images are pasted,
  dropped or chosen and stored as page files (`/api/files/{id}`).
- **Toolbar.** Undo and redo, the inline marks (bold, italic, strikethrough,
  code, link) and "Comment" stay visible; block styles are one "Text" menu,
  table, divider, image, work item, page link and decision one "Insert" menu, and a
  "Table" menu appears inside a table. "Close editor" returns to the
  published page (main of a Direct space); the draft stays saved.
- **Save state**, beside the title: "Saving…" while the provider has edits
  the service has not acknowledged, "Saved" when it has none (the service
  stores before it acknowledges, so this means stored). Each keystroke is
  stored within milliseconds, so the indicator does not follow every one:
  typing shows a quiet "Saving…" (no spinner) at once, a spinner joins it only
  when edits stay unstored for a second, and "Saved" returns once everything
  has stayed stored for a second (a pause in typing). The display only ever
  trails the truth (never "Saved" with an edit unstored); persistence, the
  unload warning and Publish read the truth directly. Routine saves are not
  announced to screen readers (the editor is described by the indicator, so
  it can be read on demand); going offline and the confirmed recovery
  afterwards are. "Save failed" when the service refused a change (see
  refused changes above), shown and announced at once with the reason, and
  final for that session: it is never inferred from a slow save, and
  neither reconnecting nor typing on clears it. The editor offers "Reopen
  editor", which closes the session (the unstored edits are kept on this
  device, see unsaved text below) and opens a new one from what is stored;
  Publish refuses at once instead of waiting. "Offline — changes
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
  replaced it, I reopen it after "Save failed", or I leave the editor) while it holds edits of mine the
  service has not stored, an open connection first gets about two seconds
  to store them (a replaced epoch refuses them; a refused session skips
  this). What is still unstored is
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
  request threads are left to the pull request. The header counts exactly
  the open and blocking threads the panel lists for the line on screen and
  toggles the panel: beside the page on wide frames (open by default when
  that line has open threads), a sheet on narrow ones. Other live lines with
  open threads are named, never added to the count: "On other branches" in
  the panel switches to one, and the branch menu shows each line's open
  discussions. Deleting a branch removes its threads
  ([When a line ends](#when-a-line-ends)); the page summary's `openThreads`
  and `blockingThreads` stay page-wide, as the merge gate into main is. The count of blocking threads says what they block ("blocks merging
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
- **Work blocks.** "/" offers Decision (the shared decision picker: a card
  on an empty line, a chip inside a sentence) and Work list (a small
  dialog: what to list, project, epic, iteration or label, optional title;
  the list's settings button reopens it in the editor). The task item action
  shows on hover or keyboard focus (always on touch screens) and only where
  the page offers work actions. The selection's actions sit above it
  ("Comment", "Create work item"); "Ask Litto" sits below.
- **Loading.** The space home and tree load none of this: the page surface
  (Tiptap, the reader, comments) is its own chunk, and the live editor (Yjs,
  y-tiptap, the Hocuspocus provider) another one that only editors load. The
  editor core (node views, toolbar, pickers in `components/editor`) is
  shared with Work's Markdown editor, which adds no Yjs.
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
