# Accessibility

Lictory targets **WCAG 2.2 level AA** for the platform and the website.
Enterprise and public-sector customers ask for conformance, and review work is
long sessions of reading, commenting and deciding: keyboard, screen reader and
low-vision users must be able to do all of it.

Automated checks catch regressions in what a tool can see. They do not make
the product conformant on their own: axe-core finds roughly a third to a half
of WCAG failures, and the rest (meaningful focus order, understandable
announcements, usable drag alternatives, content that makes sense when read
aloud) needs people.

## What is checked automatically

**Lint (`bun run lint`).** `eslint-plugin-jsx-a11y`'s recommended rules apply
to all React code (platform, website and shared packages). They catch missing
labels and alternative text, invalid ARIA, and pointer handlers on elements a
keyboard cannot reach. Two settings differ from the plugin's defaults, both in
`eslint.config.mjs`:

- `label-has-associated-control` knows that the shared `Input` renders a
  native input, and looks one level deeper for labels that wrap a field with
  its action button.
- `no-autofocus` is off. Lictory moves focus only into what a person just
  opened (a dialog, popover or inline editor) or to the single field of a
  single-purpose step, which is what the WAI-ARIA dialog pattern asks for. The
  rule cannot tell that apart from focus stolen on page load, so reviewers do.

A rule may be disabled for one element with an
`eslint-disable-next-line ... -- reason` comment when it is wrong for that case,
for example a roving-tabindex radio group whose container handles arrow keys
bubbling from its radios. The reason must name the keyboard path that exists.

**Browser workflows (`bun run test:e2e`).** `tests/platform/accessibility.spec.ts`
runs axe-core through `@axe-core/playwright` on the main flows, in their real
rendered state with seeded data:

- account pages: sign-in (including its error state), sign-up, password reset
- specification review: a work item with a requested review and a blocking
  discussion, and the proposals, reviews and items lists
- native delivery: the board with an active sprint, and the backlog
- settings: account settings, every organization settings section and every
  project settings section
- the shell and the factory loop, in light **and dark**: Home and the Inbox
  holding an agent's request, the channels index, a channel whose thread
  holds a live session card with its request, the Factory overview (with the
  request opened), its agents and the session transcript; a real runner with
  the scripted harness drives the session
- Code: the code host settings, the pull request list, a pull request with
  failing checks (conversation and files) and the item it delivers
- the design-system gallery (its dark copy of every example is `inert`,
  so each landmark is met once)
- Spaces (`tests/platform/spaces.spec.ts`, `tests/platform/spaces-editor.spec.ts`):
  a space home with a nested page tree, a published page, the live page
  editor, the editor with its comments panel, and the published page reader

**The desktop app's own screens** (`apps/desktop/tests/smoke.spec.ts`, run
by hand with the Electron binary, see [the desktop app](desktop.md#tests)):
the connect screen and its error, add a server, settings, the offline top
bar and the unavailable-server screen. Electron windows cannot open the extra
page axe uses to combine frames, so they run with the helper's `singlePage`
option (the shell page has no frames).

The helper `tests/helpers/accessibility.ts` checks the WCAG 2.0, 2.1 and 2.2
A/AA rules and fails on any **serious or critical** violation. It also fails,
at any impact, on axe's structural rules: the heading outline
(`heading-order`, `page-has-heading-one`), content outside every landmark
(`region`) and landmarks that repeat a name or sit inside another
(`landmark-*`). Screen reader users move through a page by its headings and
landmarks, so these regress quietly unless they fail. Label in Name
(`label-content-name-mismatch`, WCAG 2.5.3) is enabled although axe marks it
experimental: a control whose visible words are not in its accessible name
cannot be spoken by voice-control users. A control that shows a picture and
a count (the channel members button) is named by its content, the count plus
screen-reader-only words, not by an `aria-label`. Other moderate and minor
findings are reported by axe but do not fail the suite. Use
`expectNoAccessibilityViolations(page, "state")` in other workflows once the
state being checked is on screen.

## Structure

Every page has one h1 (its `PageHeader` title, the item's title, or a
`MissingState` when the whole page is "not found" or "no access"). Section
headings take their level from where they sit: `SectionLabel`,
`SettingsSection` and `Heading` from `@lictory/ui/heading` render the level of
the surrounding `HeadingScope` (h2 under the page title), and a component
that has a heading of its own wraps its content in a `HeadingScope`.

Landmarks are the page's few major parts: the sidebar (`Sidebar`), the page
(`main`), and named complementary parts beside it (an item's `Details` and
`Discussions`). Repeated things inside a page (session cards in a channel,
changed blocks in a diff) are articles or groups, never regions, and a second
breadcrumb inside a page is named for what it walks. Controls such as pane
resizers sit inside the landmark they resize.

## Focus

The first Tab stop on every organization page is "Skip to content", which
moves focus past the rail and sidebar to the page (`#main`). Past the last
control of a page (often a conversation's composer) the browser reports the
document itself as focused before wrapping to the first stop; that is the
browser's end of document, not a stop on the page.

Focus is always visible from the keyboard: one 2px ring in the theme's
focus color, offset from the control (`focus-ring`), or drawn inside a
full-bleed row that sits flush against a clipping scroll container
(`focus-ring-inset`). The ring is opaque, so it keeps 3:1 against every
surface. Muted text keeps 4.5:1 on every light surface it sits on.

The edge of every field and control (text fields, selects, radios, the
off track of a switch, the chosen segment of a segmented control) is drawn
in `--input`, which keeps 3:1 on the background, card, popover and muted
surfaces in every theme and mode (WCAG 1.4.11; `packages/ui/src/theme.test.ts`).
`--border` is for hairlines between regions and never marks where a control
starts. Text a person copies (commands, manifests, diffs) scrolls in its own
area that is a tab stop, with Copy outside the text (`CommandBlock`,
`CopyValue` in `@lictory/ui/command-block`).

## The editor's keyboard model

Every rich text field (the live page editor and Work's Markdown fields:
specifications, branch drafts, descriptions, discussions, decisions) is a
multi-line `role="textbox"` named by its label (the page title in the live
editor, which is also described by its save state). From a page's title
field, Enter or Arrow Down moves into the content.

- **Toolbar.** One tab stop (WAI-ARIA toolbar pattern): Arrow Left/Right,
  Home and End move between controls; every control is labelled and toggles
  report `aria-pressed`. Controls that do not apply right now stay focusable
  with `aria-disabled`, so the toolbar keeps its place in the tab order.
  Clicking a control keeps the editor's selection.
- **Inline pickers.** "/" (blocks), "#" (work items), "[[" (pages) and "@"
  (people, in fields that mention) open a listbox while focus stays in the
  editor, which points `aria-activedescendant` at the chosen option: Arrow
  Up/Down choose, Enter or Tab inserts, Shift+Enter inserts the option's
  alternative (a page pinned to its published version; the chosen option
  is described by that instruction, and shows it as a pointer button),
  Escape closes the picker only. "/" → Decision opens a search field (a combobox) at the caret;
  Escape returns to the text.
- **Shortcuts.** Mod+B, Mod+I, Mod+Shift+S, Mod+E for marks, Markdown input
  rules for blocks, Mod+Z / Mod+Shift+Z undo and redo one's own changes,
  Mod+Alt+M comments on the selection. In Markdown fields Mod+Enter submits
  (saves the revision, posts the comment) and Escape cancels where the field
  has a cancel; "Edit as Markdown" in the toolbar switches to the Markdown
  text, which is also how text kept as written is changed.
- **References.** Chips in readers are links (a decision recorded elsewhere,
  a button); focusing one, or pointing at it, shows its card, which describes
  the chip (`aria-describedby`) and closes with Escape. In an editor a chip is
  part of the text: moving the selection onto it shows its card.
- **Readers.** A specification being read and a published page are one tab
  stop each (`role="document"`, described by their keys). Inside, a
  selected word stands for the cursor: Arrow Left/Right select the previous
  or next word, Arrow Up/Down the first word of the line above or below, Home/End
  the first or last word of the line; Shift with those keys extends the
  selection, Escape clears it (`lib/keyboard-selection.ts`). The selection
  is the browser's own, so the selection actions, Mod+Alt+M and Litto read
  it as they read a pointer's. In a specification the selection actions
  come first in the tab order after the text, and Enter on a marked passage
  opens its discussion.
- **Comments.** The comments panel is a labelled region beside the page, or
  a modal sheet on phone-sized frames (Escape closes it and focus returns to
  what opened it). The sheet is at most 60% of the screen, so the page's title
  and text above it stay in view; a specification's discussions dock beside
  the text down to a 360px text column, so 200% zoom on a laptop keeps both. Composers post with Mod+Enter. A specification's discussions
  work the same way: the header toggle states the open and blocking counts
  and whether the panel is expanded, Alt+Arrow Up/Down (Home and End with
  Alt) move between threads and select the one reached, so its passage is
  marked, and a thread's quote is a button that brings its passage into
  view. Mod+Alt+M comments on the text selected in the specification, or
  opens the panel at the composer when nothing is selected. Threads whose
  text changed say so in words, not only by colour.
- **Carets.** Other people's carets and their name labels are decorative
  (`aria-hidden`); who is editing is stated next to the save state.

## Narrow screens and zoom

Phones, 320px reflow and 200% zoom get the same content, never a word cut in
half or a state reduced to an icon:

- A row that scrolls sideways (settings sections, page and pull request
  tabs, the board's columns) is a `ScrollStrip`: while more lies beyond an
  edge, that edge shows an arrow on the strip's surface. The arrows are a
  pointer convenience (`aria-hidden`, out of the tab order); keyboard focus
  scrolls the focused tab into view.
- List rows (`ListRow`, agents' requests) give titles two lines on phones and
  wrap their meta line instead of clipping it; one long part truncates with
  an ellipsis on its own line.
- The board on a phone shows one column with every column's name and count
  above it; the backlog puts its states, in words, on a second line.
- Copyable commands wrap on phones (copying is unchanged).

## Announcements

Realtime changes made by others are announced through one polite live
region for the workspace (`components/shell/announcer.tsx`), so they queue
instead of interrupting each other and each is said once, also when an
event is replayed or two surfaces show the same thing:

- a new message or thread reply in the open conversation ("Ada: …"); older
  messages loaded by scrolling are not news, and the message lists are not
  live regions themselves
- an agent's approval request and a session starting, finishing, failing or
  waiting, where its card or page is shown
- a new revision, an approval granted or withdrawn and approvals made
  outdated, on the item's page
- an agent claiming or releasing the item and its Definition of Done checks
  changing, on the item's page
- a pull request linked to the item, its checks passing or failing and its
  merge (with who merged, Autopilot included), on the item and pull request
  pages
- something new waiting on the person in the Inbox, wherever they are
- an export's results once the worker finishes

A person's own actions are confirmed where they acted (a toast, the
control's new state, an inline message) and are not announced again. Form
errors are shown next to each field, tied to it with `aria-describedby`, and
the first field to fix takes focus (`ValidatedForm` in
`components/auth/form-field.tsx`); messages after a failed request use
`role="alert"`.

## Known gaps

Violations that need a product or design decision are listed here and in
`knownGaps` in the helper, excused only for one rule inside one element. Fix
them rather than adding to the list.

None are excluded today: every serious or critical violation the browser
checks found has been fixed.

Not covered automatically, and worth checking by hand when these areas change:

- **Actions on text selected in a published page.** The keyboard selects
  text in the page reader; Mod+Alt+M comments on it, and Tab moves into the
  floating bar (Comment, Create work item, Ask Litto), which sits at the end
  of the document. Escape, or leaving the bar with Tab, returns to the text
  with the selection kept. An open task's "Create work item" button is
  reachable with Tab (it appears on focus).
- **Drag and drop.** Board cards, backlog ranking and story order are dragged
  with a pointer. Stories reorder with Alt+Arrow keys from their grip button,
  and a card's status and iteration can be changed from the item's properties;
  whether every drag has a single-pointer alternative on the same surface
  (WCAG 2.5.7) has not been audited. Space page trees are dragged with a
  pointer too; their alternative is "Move…" in a page's actions (Shift+F10
  on the focused page, or the page's own header), and Alt+Arrow reorders a
  focused page among its siblings.
- **Dark mode and themes.** Most browser checks run in the default light
  theme, whose primary and destructive colors were darkened to reach 4.5:1.
  The shell, conversations and the Factory are also scanned in the default
  dark mode; other dark pages and the optional themes are not. Tinted
  identity tiles (agent avatars) take their mix from `--identity-tile`,
  `--identity-ink` and `--identity-edge`, set per mode so the glyph keeps
  4.5:1 on its tile.
- **The websites.** `tests/marketing/accessibility.spec.ts` and
  `tests/docs/accessibility.spec.ts` scan the landing page, downloads, a guide
  and a comparison, and the main documentation pages, in light and dark;
  other website pages share their components but are not scanned.
- **Live drafts.** The page editor's save state is a status region, so its
  changes are announced politely; other people's edits in a live draft are
  not announced (who is editing is stated next to the save state).
- **A manual screen reader pass** (VoiceOver, NVDA) over the factory loop has
  not been recorded; the announcements above are verified by the browser
  workflows' live region, not by a screen reader.
