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
  `Card` renders null until it has something to show and uses `HomePanel`
  and `HomeRow` (`components/shell/home/panel`) so Home reads as one page.
- **Page header.** Start every module page with `PageHeader`
  (`components/shell/page-header`): `title`, optional `icon`, `breadcrumbs`,
  `tabs` (`PageTabs` inside your ui-sdk `Tabs` root) and `actions`. It is
  also the desktop app's title bar, so keep its controls real buttons and
  links.
- **Empty states.** Say what will appear and what to do first, with
  `EmptyState` (lists) or `MissingState` (whole pages) from `@lictory/ui`.
- **Routes.** Module pages live at `/$org/<module>`. Add the segment to the
  reserved project keys in `packages/core/src/domain/service.ts` when you add
  one.
