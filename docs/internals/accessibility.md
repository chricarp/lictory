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
- Spaces (`tests/platform/spaces.spec.ts`, `tests/platform/spaces-editor.spec.ts`):
  a space home with a nested page tree, a published page, the live page
  editor, the editor with its comments panel, and the published page reader

The helper `tests/helpers/accessibility.ts` checks the WCAG 2.0, 2.1 and 2.2
A/AA rules and fails on any **serious or critical** violation. Moderate and
minor findings are reported by axe but do not fail the suite. Use
`expectNoAccessibilityViolations(page, "state")` in other workflows once the
state being checked is on screen.

## The page editor's keyboard model

The live page editor (Lictory Spaces) is a rich text field
(`role="textbox"`, multi-line, named by the page title and described by its
save state). From the title field, Enter or Arrow Down moves into the
content.

- **Toolbar.** One tab stop (WAI-ARIA toolbar pattern): Arrow Left/Right,
  Home and End move between controls; every control is labelled and toggles
  report `aria-pressed`. Controls that do not apply right now stay focusable
  with `aria-disabled`, so the toolbar keeps its place in the tab order.
  Clicking a control keeps the editor's selection.
- **Inline pickers.** "/" (blocks), "#" (work items) and "[[" (pages) open a
  listbox while focus stays in the editor, which points
  `aria-activedescendant` at the chosen option: Arrow Up/Down choose, Enter
  or Tab inserts, Escape closes.
- **Shortcuts.** Mod+B, Mod+I, Mod+Shift+S, Mod+E for marks, Markdown input
  rules for blocks, Mod+Z / Mod+Shift+Z undo and redo one's own changes,
  Mod+Alt+M comments on the selection.
- **Comments.** The comments panel is a labelled region beside the page, or
  a modal sheet on narrow frames (Escape closes it and focus returns to what
  opened it). Composers post with Mod+Enter.
- **Carets.** Other people's carets and their name labels are decorative
  (`aria-hidden`); who is editing is stated next to the save state.

## Known gaps

Violations that need a product or design decision are listed here and in
`knownGaps` in the helper, excused only for one rule inside one element. Fix
them rather than adding to the list.

None are excluded today: every serious or critical violation the browser
checks found has been fixed.

Not covered automatically, and worth checking by hand when these areas change:

- **Comments on published page text.** The page reader is read-only, so
  selecting its text needs a pointer (or the browser's caret browsing);
  keyboard users comment on the whole page there, or on text in the live
  editor, where the selection is keyboard-driven (Mod+Alt+M).
- **Text selection comments.** Selecting specification text with a mouse
  offers a selection toolbar (comment, ask); keyboard users start a
  discussion from the composer instead, without the quoted anchor.
- **Drag and drop.** Board cards, backlog ranking and story order are dragged
  with a pointer. Stories reorder with Alt+Arrow keys from their grip button,
  and a card's status and iteration can be changed from the item's properties;
  whether every drag has a single-pointer alternative on the same surface
  (WCAG 2.5.7) has not been audited. Space page trees are dragged with a
  pointer too; their alternative is "Move…" in a page's actions (Shift+F10
  on the focused page, or the page's own header), and Alt+Arrow reorders a
  focused page among its siblings.
- **Dark mode and themes.** The browser checks run in the default light theme,
  whose primary and destructive colors were darkened to reach 4.5:1. Dark mode
  and the optional themes are not scanned; the default dark mode's destructive
  buttons, for example, are below 4.5:1 and need a design pass.
- **The website.** The marketing site is linted but not scanned in the browser
  suite.
- **Screen reader announcements** for realtime changes (another person's edit,
  sync state) and the Lictory Intelligence conversation. The page editor's
  save state is a status region, so its changes are announced politely;
  other people's edits are not announced.
