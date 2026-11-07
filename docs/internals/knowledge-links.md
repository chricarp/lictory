# Knowledge links between pages and work

Pages (Lictory Spaces) and work items (Lictory Work) refer to each other in
six ways. Each has one owner, one way of being written, and the same
visibility rule: **a link is visible only to people who can read its page**.
Links grant nothing in either direction: attaching a restricted page to an
item never lets the item's readers read the page, and referencing an item
from a page never lets the page's readers change the item.

| Link                   | Written by                                                                                               | Owned by                          | Changes                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| Page reference         | The page's published content (`workItemRef`, `pageRef`, `decisionRef` nodes)                             | The page (its commits)            | Derived: follows main's head               |
| Specification citation | A main specification revision's Markdown (`[PAY-2](item:ID)`, `[T](page:ID@COMMIT)`, `[T](decision:ID)`) | The work item (its revisions)     | Derived: one immutable set per revision    |
| Attachment             | `attachPage` / `detachPage` on an item                                                                   | The work item (change-properties) | Explicit; detaching keeps history          |
| Source (provenance)    | `createWorkItem` with `source`                                                                           | The work item, written once       | Immutable                                  |
| Branch origin          | `createPageBranch` / `proposePageChange` with `origin`                                                   | The page branch, written once     | Immutable; kept after merge or deletion    |
| Context link           | `linkContextPage` / `unlinkContextPage` / `moveContextPage`                                              | The project (its planners)        | Explicit, ordered; unlinking keeps history |

The Markdown and document reference syntax is defined once in
`packages/core/src/contracts/references.ts`.

## References follow what was published

A page's references are those of **its published version** (main's head
commit), with the top-level block that holds each one. Branches, pull
requests and live drafts are never indexed: a reference written on a branch
appears when the branch is merged into main, and one removed by a restore
disappears with the restore. Historical commits keep their references in
their own content; the index answers "which pages mention this now".

A specification's references are those of each **main revision**, written
with the revision and never changed. An item therefore knows which page
versions its current and historical revisions cite, and a page knows which
specifications cite it and whether each item's current revision still does.
Adopting a newer page version is an ordinary, material specification edit
(it stales approvals like any other); a page change never stales a
specification approval.

A page reference may be pinned to one commit (`pageRef` `commitId`, Markdown
`page:ID@COMMIT`). Pinned citations stay at that version; readers can show
that a newer one exists and compare.

Targets are stored as written: a reference to an item that does not exist,
or to another organization's id, is indexed and matches nothing in this
organization. Labels are never indexed; readers resolve titles from what they
can read now.

## Visibility

Every knowledge link names a page, and its projection lives in
`space_entity` under that page's space, so Zero's `space_reader` check
decides who receives it. The same rule holds for capability reads, which
filter to pages the reader can read and return no row, title or count of
any other page. Archived pages and pages of archived spaces keep their rows
but are excluded from every reader.

Consequences, deliberate:

- An item's activity never records attachments or sources (every member
  reads it). Page activity records them (`page_attached`, `page_detached`,
  `context_page_linked`, `context_page_unlinked`,
  `work_item_created_from_page`, and `origin` on `branch_created` /
  `page_change_proposed`), visible to the page's readers.
- A source quote is page content; it is projected with the page, never on
  the organization-wide item. A person who creates an item from a page
  decides what of it to copy into the item's own title and description.
- Specification Markdown is item content: a citation's label is visible to
  every reader of the item, as the author wrote it. The structured citation
  row (which page, which version) still reaches only readers of the page.

## Authorization

Each link command needs both sides' permission, checked in the same
transaction:

- Attach and detach: the discipline capability `changeProperties` in the
  item's project (attaching context shapes delivery like labels or an epic)
  and read access to the page. A pin must be a commit of that page.
- Source: read access to the page's space; the commit must belong to the
  page, the block (when given) must be one of that commit's top-level blocks,
  the quote at most 2000 characters and **the text of that commit**: an
  invented or paraphrased quote is refused, because Work shows it as what the
  page said. The comparison ignores whitespace (block boundaries, line
  breaks) and reads inline references as a selection copies them (a work
  item as its key, a decision as its label, or either as nothing). With a
  block, the quote must begin in it and may continue across the blocks after
  it, so a selection over several blocks names the block of its first
  character; without one, it may begin anywhere in the commit. A long
  selection is cut to the limit, never given an ellipsis the page does not
  contain. The item's own creation rules apply unchanged.
- Branch origin: the page branch rules (edit access to the space); the
  revision must belong to the named item.
- Context links: project administrators (`canManageProject`) and project
  members whose discipline has `changeProperties` (the people who plan
  iterations and shape the backlog), and read access to the page. Teams must
  be active teams of the project; iterations may be completed (retrospectives
  come afterwards).

Someone who cannot read the page gets "This page is unavailable." exactly as
for a page that does not exist.

## Storage and derivation

| Table                       | Holds                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `page_reference`            | Derived: references of each page's main head (`commit_id`), position, block, kind, target, pin |
| `specification_reference`   | Derived: distinct references of each main revision, position, kind, target, pin                |
| `work_item_page_attachment` | Item ↔ page, `purpose` (background, design, runbook), optional pin, detached by/at             |
| `work_item_page_source`     | Item → page, commit, block, quote, written once                                                |
| `page_branch_origin`        | Page branch → item revision, written once                                                      |
| `page_context_link`         | Project, optional team or iteration → page, rank, removed by/at                                |

The two indexes are maintained in the same transaction as the change they
derive from: `indexPublishedPage` at every move of main's head (page
creation, publishing a draft, restores and merges on main) and
`indexSpecificationRevisions` at every insert of a specification revision
(edits, restores, merges, breakdown acceptance). They equal a rebuild from
the stored commits and revisions (`referenceIndexDrift` is the invariant the
tests check); `rebuildReferenceIndex` repairs them and is the backfill
`rebuild-knowledge-index`. They are not exported (derived) and are deleted
first when an organization is deleted. The explicit links are exported with
the organization.

Projections (`space_entity`, with `work_item_id` or `project_id` naming what
the row concerns): `pageReference` (`{pageId}:{workItemId}`, item targets
only), `specificationCitation` (`{workItemId}:{pageId}`, page targets),
`pageAttachment`, `workItemSource`, `pageBranchOrigin` and
`pageContextLink`. Page and decision backlinks, and item references in
specifications, are read through capabilities.

## Surfaces in Spaces

Pages use the links in [Work in pages](spaces.md#work-in-pages): the "Work
on this page" list reads `pageWork`; "Create work item" on selected text or a
task writes a source; a decision's "Add to a page" opens a branch with an
origin. Work lists in pages are not links: they store a query, are not
indexed, and show items only to people who can see them.

## Reading

- Zero: `workItemKnowledge({ organizationId, workItemId })`,
  `pageWork({ organizationId, pageId })` and
  `projectContext({ organizationId, projectId })`, all through the page's
  readers.
- Capabilities (every surface): `getWorkItemKnowledge`, `listPageWork`,
  `listContextPages` and `listReferencesTo`.
- `describePageLinks` (capability): for pages the reader can read, the
  section heading and a short excerpt of the blocks that mention an item and
  the version numbers of pinned commits. Other pages get no entry.
- Zero `itemPageLinks({ organizationId })`: mentions and attachments of
  readable pages, for the "N pages" count of item lists and previews.

Content search over published pages and specifications uses trigram
indexes on `page_commit` title and Markdown and on `specification_revision`
title and content; it must join main heads for pages and apply the same
visibility rule.

## Work surfaces

- **Knowledge on a work item**, after the breakdown and beside Relations
  (it is reading context for the specification, and the item's other kind of
  link). One row per readable page: where its published version mentions the
  item (section heading and excerpt; opening it lands on the block),
  attachments with their purpose, and citations by the current revision (or
  only earlier ones). A pin shows its version (`v3`) and, when the page has
  published since, a quiet "Newer version" with a comparison in the page
  history. Above: the page the item was created from, as a quote with "Open
  source" at the exact commit and block. Below: page updates proposed from
  the item, with their pull request status. People with `changeProperties`
  attach pages (purpose, optional pin) and detach them, with undo.
- **Propose page update**: pick a page in a space I edit (attached and
  mentioning pages first), name the branch; `createPageBranch` with `origin`
  opens it in the page editor. Work never publishes a page directly; the
  space's rules (reviewed or direct) publish the branch.
- **Counts**: item lists and the item preview show "N pages" (readable pages
  that mention or are attached to the item), linking to the Knowledge
  section. Unreadable pages never count.
- **Delivery surfaces**: context pages (see
  [the delivery model](delivery.md#context-pages)); the project's
  Refinement home shows its spaces and teams' spaces and recently published
  pages in one line.
- **Inbox To do** includes page pull requests waiting on me (see
  [notifications](notifications.md#inbox)).
