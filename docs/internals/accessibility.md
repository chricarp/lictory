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
- Spaces (`tests/platform/spaces.spec.ts`): a space home with a nested page
  tree, and a published page

The helper `tests/helpers/accessibility.ts` checks the WCAG 2.0, 2.1 and 2.2
A/AA rules and fails on any **serious or critical** violation. Moderate and
minor findings are reported by axe but do not fail the suite. Use
`expectNoAccessibilityViolations(page, "state")` in other workflows once the
state being checked is on screen.

## Known gaps

Violations that need a product or design decision are listed here and in
`knownGaps` in the helper, excused only for one rule inside one element. Fix
them rather than adding to the list.

None are excluded today: every serious or critical violation the browser
checks found has been fixed.

Not covered automatically, and worth checking by hand when these areas change:

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
  sync state) and the Lictory Intelligence conversation.
