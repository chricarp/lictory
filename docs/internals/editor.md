# One editor for pages and Markdown

Lictory has one rich editor. Pages (Lictory Spaces) store it as canonical
document JSON in commits; everything in Work that people write (specifications
and branch drafts, suggestions, the description of a new work item,
discussions and replies, decisions, Lictory Intelligence context, page
comments) stores **Markdown**. The toolbar, the "/", "#", "[[" and "@"
pickers, the reference chips and the keyboard model are the same everywhere;
only what is stored differs.

## Markdown stays the stored format

Specifications are immutable revisions whose text is diffed line by line,
checked for readiness sections (`sectionContent` in
`packages/core/src/contracts/readiness.ts` reads ATX headings), patched by
Lictory Intelligence and exported to delivery tools. The editor therefore
never changes text nobody edited:

- **Unchanged blocks keep their exact text.** Each top-level block remembers
  the Markdown it was read from; writing back reuses it, with the original
  separators, for every block whose content is unchanged
  (`packages/core/src/editor/markdown.ts`). Opening and saving without edits
  reproduces the input byte for byte, so the server sees no change and no
  revision is created; an edit rewrites only the blocks it touched, which
  keeps revision diffs as small as the edit.
- **Fresh blocks have one form.** A block that was edited (or is new) is
  written in one deterministic GFM form that reads back as the same document:
  ATX headings, `-`/`*` and `1.`/`1)` list markers (alternating only so that
  two adjacent lists stay two lists), `*` and `**` emphasis, fenced code with
  its info string, `\` hard breaks, `|`-tables padded to one width with their
  alignment row. The only other normalizations are whitespace Markdown
  ignores: blank lines between blocks, indentation of list and quote
  contents, leading spaces at the start of a line and trailing spaces before a
  soft line break. Soft line breaks inside a paragraph are kept.
- **Nothing is dropped.** What the editor cannot show (raw HTML and HTML
  comments, footnotes, link reference definitions and reference-style links,
  lists that mix task and plain items) is kept verbatim: a top-level block as
  an uneditable "Markdown kept as written" block, inline syntax as an inline
  source token. Such text is changed with "Edit as Markdown", which edits the
  Markdown itself. An unclosed fence or HTML comment at the end of a document
  is closed when something is added after it, so it cannot swallow the new
  text.

The round-trip suite (`packages/core/src/editor/markdown.test.ts`) runs these
rules over representative specifications and every Markdown document in the
repository: byte-identical reuse, fresh output that reads back as the same
document and is a fixpoint, readiness sections, references and mentions that
survive.

Specifications are edited collaboratively: main and each branch have a
shared live draft of this schema, and saving converts the stored cut back to
Markdown on the server with the same reuse of unchanged blocks (see
[live drafts of specifications](specification-drafts.md)); "Edit as
Markdown" there merges the text into the shared draft block by block and
asks when someone changed the same blocks meanwhile. Every other field
edits its Markdown value directly, its Markdown text included.

Pasted plain text is read as Markdown, so a specification pasted from
elsewhere keeps its headings, lists and references. Revision and approval
semantics do not change: a revision is still created exactly when the stored
Markdown differs.

## References

References use the syntax of `packages/core/src/contracts/references.ts`:
`[PAY-2](item:ID)`, `[Title](page:ID)`, `[Title](page:ID@COMMIT)` (a pinned
version) and `[Title](decision:ID)`; the older `[[page:ID]]` is still read.
"#" inserts a work item, "[[" a page (Shift+Enter or the option's "Pin this
version" cites the version published now), "/" → Decision finds a recorded
decision (the open item's first, then the server's search among decisions I
may read). In page documents the same nodes are `workItemRef`, `pageRef`
(`commitId` when pinned) and `decisionRef`; a page's Markdown projection
writes them as typed links (unpinned pages as `[[page:ID]]`, never with the
other page's title) and `markdownToDocument` reads them back, so Markdown an
agent proposes keeps what it refers to. Exports to delivery tools write a
reference's label as text.

A reference's label is what someone without access sees. Chips
(`apps/platform/src/components/references/`) resolve the target against what
the reader may read now and show more only then:

- **Work item:** status icon, key and current title. The status is the one
  the rest of Work shows: the delivery tool's status for projects that deliver
  externally ("In Progress in Jira", "Not handed off to Jira"), the workflow
  status otherwise.
- **Page:** the space's icon and the page's current title; a pinned
  reference adds "vN" and, when a newer version is published, a quiet marker.
  A pinned chip opens that version.
- **Decision:** its title.

Pointing at a chip or focusing it shows a card: an item's type, status,
refinement state, readiness checks passed of required, owner (the delivery
tool's assignee for external projects) and iteration; a page's space, path,
last publication and, when pinned, the cited and latest versions with a link
to its history; a decision's work item and the revision it was recorded at.
Unreadable targets show only the stored label (a page without one, "Unavailable
page") and no card.

Litto's answers link work and pages by their addresses in the organization
(`/acme/items/PAY-142`, `/acme/spaces/SPACE/pages/ID?commit=COMMIT`), which
stay useful when an answer is copied elsewhere. The answer reader shows such a
link as the same chip when its words name the target (the key, the title, the
address itself) and the address is the target itself; words that say
something else ("blocking discussion", "Failure behavior") stay words and
carry the target's card. Targets the reader cannot read, other organizations'
addresses and every other link stay ordinary links
(`packages/core/src/lib/app-links.ts`).

## Loading

The editor is its own chunk. Fields people write in right away load it when
they appear; comment composers, which pages show whether or not anyone
comments, load it when pointed at or focused. Until then, or when the chunk
cannot load, a plain Markdown field bound to the same value stands in, so
nothing typed is lost. Readers render Markdown without the editor.
