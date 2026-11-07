# Live drafts of specifications

Several people can edit the same specification at once: the line they edit
(main, or one branch) has one shared **live draft**, with everyone's caret
and name, saved as they type. The draft is a working tree, never history.
Only an explicit **Save revision** (main) or **Commit** (a branch) turns an
exact, stored cut of it into an immutable revision or commit, and from there
every rule of reviewed specifications applies unchanged: approvals belong to
revisions, a material revision marks them outdated and re-requests the
reviews, main is protected once readiness passes, pull requests review
commits. Nobody's keystroke is an approval, a revision or a commit.

The machinery is the one of [Lictory Spaces live drafts](spaces.md#live-drafts)
(the draft writer, the collaboration service, epochs, stored-before-seen
updates, sequence numbers, recovery of unsaved text); this document says
what differs for specifications.

## What a draft holds

- **Markdown stays the stored format.** The shared document is the
  [Markdown editor's schema](editor.md) as a Yjs document (the `default`
  fragment; a branch draft also has a `title` text). Each epoch starts from
  the line's Markdown (`markdownToDraftState`,
  `packages/core/src/editor/draft-state.ts`), and the Markdown it started
  from is kept with the epoch's seed.
- **Sealing converts on the server.** The browser never sends content: it
  waits for "Saved", names the stored sequence it has seen
  (`expectedSequence`) and sends `commitSpecificationDraft`. The server
  reconstructs exactly that cut, checks it against the schema and writes
  it with `serializeMarkdown`, using the line's head as the source, so
  every block nobody changed keeps its exact bytes (a list written with `*`,
  a Setext heading, a table's padding) and the revision diff is as small as
  the edit.
- **One draft per line.** Main's draft is based on the latest revision; a
  branch's on its head commit (`specification_draft.base_*`). A draft is
  created the first time someone opens the line's editor
  (`openSpecificationDraft`).

## Who edits

The rules of the line, checked by the collaboration service on connect and
by the draft writer on every stored batch (in its transaction, with the
session, organization membership and two-factor policy, as for pages):

- **Main:** an active discipline of the item's project that edits
  specifications, while main is not protected. Once readiness passes,
  `mainProtected` closes main's draft (the next command on the item fences
  it; until then writes are refused) and changes go through branches.
- **A branch:** its author and invited collaborators, while it exists.
  Deleting the branch, or the automatic deletion after its merge into main,
  closes its draft.
- Reading a specification draft needs the same right: only editors open
  live drafts, so losing the right closes the editor
  ("You can no longer edit this specification draft."). Discipline,
  project membership and collaborator changes signal the service after
  commit; every connection is also rechecked every 30 seconds.
- The item must be active and its type must carry a specification. Plain
  work items keep their directly edited description.

## Sealing

`commitSpecificationDraft` (`draftId`, `epoch`, `expectedSequence`,
optional `message`; through `applyMutation`, a decision command for agents):

- **Main**: one revision through the same path as `updateSpecification`:
  the title is main's (or the draft's working title, if someone set one),
  `message` is the change summary, approvals are marked outdated and
  reviews re-requested. The activity records who sealed it and
  `contributorIds`, the authors of the stored updates since the last cut.
- **A branch**: one commit with `message`, its working title, and the
  person's breakdown edits when they made any (`proposedChildren`, made from
  `breakdownBaseCommitId`; refused when the branch's breakdown changed
  meanwhile). The breakdown is still each person's own until committed.
- Refused: a cut the service has not stored yet ("wait until Saved"), a
  cut below the last saved one, a replaced or closed epoch (reopen the
  editor), main of a protected specification. Two people saving the same
  cut create one revision; the second is told there is nothing to save.
- Edits that cancel out record the cut without a revision ("Nothing to
  save" when there is nothing new at all).

Typing after the cut stays unsaved. The draft keeps its epoch across its
own seals.

## Epochs: the head moves from outside

After every command on an item (and every change to a child made by its
parent's command), `followSpecificationDrafts` compares each open draft with
its line's head:

- the same content (a rename, a breakdown-only commit, the draft's own
  seal) only moves the draft's base;
- other content (a revision saved through the API or by an agent, a
  restore, a merged pull request, a synced branch, a commit to the branch
  made another way) starts a **new epoch** seeded from the new head. The
  `specification_draft` trigger closes the old epoch's rooms; editors
  reopen the new document and keep, on their device, every edit of theirs
  the new head does not contain ("This draft was replaced while you had
  unsaved changes", with Copy text, Insert at end and Discard). Nothing is
  merged into the new epoch on its own;
- "Discard changes" in the editor is the same new epoch, asked for
  (`openSpecificationDraft` with `discardChanges`), for everyone editing.

Every epoch's seed and update log stay stored, so replaced and discarded
edits remain reconstructable on the server.

## Writes, tables and projections

The draft writer is the documented narrow exception to the domain write
rule ([synchronization](synchronization.md#projections-and-atomicity)):
`specification_draft_update` rows and `specification_draft.sequence` are
written under the organization lock in **shared** mode, never projected, and
each update is decoded before it is stored and stored once per epoch.

| Table                        | Holds                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `specification_draft`        | One draft per line (main: `branch_id` NULL, `base_revision_id`; a branch: `base_commit_id`), epoch, sequences, fence |
| `specification_draft_update` | The update log: epoch, sequence, author, digest                                                                      |
| `specification_draft_seed`   | Every epoch's starting Yjs state and the Markdown it was read from (`source`)                                        |

The `specDraft` entity of `sync_entity` (in the item's scope) carries the
draft's id, line, epoch, `documentName` (`spec.<draft id>.<epoch>`),
`committedSequence`, `uncommittedChanges` and base. Like page drafts, the
"unsaved changes" flag changes at coarse transitions only: the writer's
first batch beyond the saved cut refreshes it in a transaction of its own
(exclusive lock), and seals and new epochs rewrite it in their command.
Drafts, updates and seeds are part of the organization export and are
deleted with the organization.

## Interface

- **Main.** "Edit" opens main's live draft for people who may edit main:
  the status line says "Live draft · based on revision N", the save state
  (Saving…, Saved, Offline — changes kept on this device, Save failed, Live
  editing unavailable) and "Anna is editing"; others' carets carry their
  name. "Save revision N+1" takes an optional summary and says that existing
  approvals are marked outdated and reviews re-requested. "Close editor"
  leaves the draft saved; the reader then shows "Unsaved draft changes" to
  editors while the draft holds stored edits no revision has.
- **Branches.** The branch editor binds its title and content to the
  branch's draft; "Commit changes" seals it with the message and the
  person's breakdown edits. The Uncommitted tab diffs the draft against the
  head. A branch edit kept in the browser before live drafts is offered as
  kept text.
- **Loading.** Readers load no Yjs, Hocuspocus or editor: the live editor is
  its own chunk (`components/items/live-specification.tsx`), loaded when an
  editor opens.
- Agents cannot type into live drafts: they change specifications with
  `updateSpecification` (unprotected main) or branch commits, which start a
  new epoch of an open draft.
