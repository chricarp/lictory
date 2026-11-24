# Platform app

## ui-sdk

Before using ui-sdk (`@ui-sdk/react`, `@ui-sdk/core`), follow the `ui-sdk` skill
if it is installed, and read `node_modules/@ui-sdk/react/docs/llms.txt`. To build
a new component, also search `node_modules/@ui-sdk/react/docs/core.md` by
heading, and read `rendering.md` next to it.

The workspace hoists dependencies, so these paths resolve from the repository
root. The default styles are imported once in `src/main.tsx`, before the app's
own CSS.

## Widgets

Every interactive widget is a ui-sdk component. Do not write `role=`,
`aria-checked`, `aria-selected`, roving `tabIndex` or arrow-key handlers for a
dialog, menu, tabs, radio group, switch, checkbox, listbox, combobox, tree,
toolbar or disclosure: use the component.

- Reach for `@lictory/ui/*` first (`button`, `input`, `dropdown-select`,
  `select`, `popover`, `menu`, `dialog`, `switch`, `checkbox`, `radio`,
  `segmented`, `tooltip`, `toast`). These carry Lictory's look and are shared
  with the website and the documentation.
- For anything else, compose `@ui-sdk/react/<component>` parts in place and
  style them with classes and state attributes (`data-checked:`, `data-open:`,
  `data-highlighted:`, `data-disabled:`).
- Popups mount under the body: pass `container={popupContainer()}` from
  `@lictory/ui/popup` to a popover, menu, select, combobox, dialog, tooltip or
  hover card root you compose yourself.
- ui-sdk's default stylesheet is themed, not fought: `packages/ui/src/ui-sdk.css`
  (imported by `src/app.css`) points its `--ui-*` tokens at the theme and
  resets the sizes it sets, as its styling guide asks. Parts that render
  `div`, `span` or `li` take any visible property their classes leave out from
  that themed default, so give them their background, border, radius and
  shadow explicitly when the design differs. No `!important`.
- A link that looks like a button is `<Button render={<Link href="…" />}>`,
  never a button inside a link.
- A plain native `<button>` with a click handler stays a native button.

Left hand-rolled on purpose: the Tiptap suggestion list at the caret (the
editor owns its keys), the pane resizer (pixel widths across components), the
Litto dock's phone sheet, and the row preview card in lists.

## Shell

The shell (`src/components/shell`) is the rail, sidebar, page header,
command palette and Home around every organization page. Modules plug in
through the registry in `src/components/shell/nav-registry.tsx`; read
[the workspace shell](../../docs/internals/shell.md) for the concepts.

- **Sidebar section.** Export a `NavSection` (`id`, `label`, `icon`,
  `href(org)`, `Section`) from your module and list it in `navSections`. Build
  `Section` from `SidebarGroup`, `SidebarLink`, `SidebarAction` and
  `SidebarNote` (`components/shell/sidebar-parts`): they draw the full sidebar,
  the compact one and the phone drawer, so never branch on width yourself.
  Mark the current row with `useNavActive()`.
- **Badge.** Give the section `useBadge`, a cheap hook (a Zero query, a
  counter) returning `{ count, label, tone, dock? }` or null. `strong` is
  addressed to the person (mentions, direct messages, requests), `quiet` is
  activity. Set `dock` only for mentions and direct messages: the shell sums
  those into one source of the desktop badge (`lib/desktop-bridge.ts`, the
  only caller of `setBadge`); never call `setBadge` yourself. The
  shell passes the badge back to `Section` as `badge` for you to place.
- **Palette provider.** Add a `PaletteProvider` (`id`, `group`,
  `useEntries(query)`) to `paletteProviders`. Return candidates (memoized),
  each with an `href` or a `run`; the palette matches, caps and groups them.
  Every section already gets a "Go to" command.
- **Home card.** Add a `HomeCard` (`id`, `label`, `Card`) to `homeCards`.
  `Card` is a `Panel` of `ListRow`s; a `Panel` without rows and without
  `empty` renders nothing, so a card without data leaves no box.
- **Page header.** Start every module page with `PageHeader`
  (`components/shell/page-header`): `title`, optional `icon`, `back`
  (`{ label: "Back to the Factory", href }`), `breadcrumbs`, `meta` (one quiet
  line: a topic, a project chip, "3 running · 1 queued"), `description` (an
  info button, never a paragraph under the title), `tabs` (`PageTabs` inside
  your ui-sdk `Tabs` root, or `PageLinkTabs` for pages that are routes) and
  `actions`. One 44px bar; on phones it is 48px and also carries the
  navigation button and search, replacing the shell's top bar. Never write
  an `<h1>` of your own: `components/shell/page-header.test.ts` fails on a
  new one, and its `knownOffenders` list only shrinks.
- **Empty states.** Say what will appear and what to do first, with
  `EmptyState` (lists) or `MissingState` (whole pages) from `@lictory/ui`.
  A page with no data at all is one `MissingState` with one primary action:
  no zero stat cards, no empty sections beside it. Under a `PageHeader` pass
  `headingLevel={2}`: the header's title is the page's h1. One piece of
  art per state: a module's or a page's empty state shows its
  `illustration`; the `icon` well stands in only where no illustration
  fits (a row, a panel), never under an illustration (`MissingState` and
  `StatusPage` draw one or the other).

## Shared building blocks

See them all in light and dark at `/{org}/design-system` (not linked from
the navigation; `components/shell/gallery.tsx`). Use these rather than
drawing your own; extend them here when a module needs more.

- **People and agents** (`components/identity/actor`). `PersonAvatar`
  (`person`, `size` 16–36: a deterministic color per id, the photo when
  there is one, a dot with a tooltip under 20px, a Slack mark for
  `external: "slack"`), `Actor` (avatar and name; `userId` looks the member
  up, `label` "full" | "first" | "none"), `AgentAvatar` (rounded square, the
  agent's emoji or initial at every size, a robot badge from 24px), `AgentActor` (`agent`, `ownerId` or `owner`:
  "Forge via Ada", the agent's name never truncates), `PolicyActor`
  (`level`, `setById`: "Build policy (set by Ada)", for what a policy did by
  itself), `Facepile` (`people`, `max`; set `--actor-ring` to the surface
  color when it is not the page background). Never draw initials or a robot
  glyph by hand.
- **State** (`lib/session-state`, `@lictory/ui/status-chip`).
  `sessionState(session, { claim, decider })` is the one source of a
  session's or claim's label and tone; a claim whose session waits on a
  person reads "Waiting on Ada". Draw it with `SessionStateChip`
  (`components/shell/session-chip`). Any other state is a `StatusChip`
  (`tone`: neutral, info, attention, success, danger; an icon and a label).
  Do not add pill styles.
- **Rows and panels** (`components/shell/list-row`, `components/shell/panel`).
  `ListRow` (`href` or `onClick`, `leading`, `identifier`, `title`, `meta`,
  `chips`, `time`, `actions` shown on hover or focus) and `Panel` (`title`,
  `icon`, `count`, `more`, `actions`, `empty`). `SectionCaption` labels a
  group outside a card. Captions are sans 12px semibold muted; mono is only
  for identifiers (keys, SHAs, branches, handles) and code.
- **Agent approvals** (`components/shell/approval-request`). `ApprovalRequest`
  (`session`, `approval`, `agent`, `runner`; `compact` in lists) shows what
  is asked, who asks, where and the evidence, and answers through
  `answerAgentApproval`. In lists its action is Review; Approve only appears
  with the context. Only the person who started the session or the agent's
  owner decides; others see who does.
- **Pull requests** (`components/review/pull-request-header`,
  `components/review/merge-box`). One pull request page for code and
  specifications: `PullRequestHeader` (`title`, `number`, `state` draft |
  open | merged | closed, `author` as an `Actor` or `AgentActor`,
  `headingLevel` 2, or 1 where the pull request takes an item's place,
  `commits`, `base`, `head`, `meta`, `tabs` as `PullRequestTabs` inside a
  ui-sdk `Tabs` root) under the page's `PageHeader`, and `MergeBox`
  (`target`, `requirements` with a state and the reason in words,
  `blocked`, `note` saying what merging does or why this person cannot,
  `action` with the merge button, `children` for a conflict resolver;
  `MergedNotice` once merged).
- **Focus.** Interactive elements use `focus-ring` (2px, offset) or
  `focus-ring-inset` for full-bleed rows in a clipping container, with
  `outline-none`. Do not use translucent `ring-ring/60` rings.
- **Routes.** Module pages live at `/$org/<module>`. Add the segment to the
  reserved project keys in `packages/core/src/domain/service.ts` when you add
  one.
