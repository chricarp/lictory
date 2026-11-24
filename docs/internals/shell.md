# The workspace shell

Lictory is one product with several modules (Home, Channels, Work, Factory,
Code, Spaces). The shell is what makes them read as one: the same rail,
sidebar, header, palette and empty states around every page, and a single
place where modules plug in. It owns no data; everything it shows comes from
the modules' synchronized state.

## Information architecture

```text
┌──────┬──────────────────┬───────────────────────────────┬────────┐
│ orgs │ sidebar          │ page (PageHeader + content)   │ Litto  │
│ rail │ Home             │                               │ sheet  │
│      │ Inbox · Litto    │                               │        │
│  +   │ Channels         │                               │        │
│      │ Direct messages  │                               │        │
│      │ Factory          │                               │        │
│      │ Code             │                               │        │
│      │ Projects (Work)  │                               │        │
│      │ Spaces           │                               │        │
│      │ Org settings     │                               │        │
│      │ account · sync   │                               │        │
└──────┴──────────────────┴───────────────────────────────┴────────┘
```

- **The organization rail** lists every organization the person belongs to,
  with a dot when another organization has unread notifications, and a way to
  create one when the instance allows it. One organization is the common case
  and reads as the app's anchor. The rail appears on wide windows (96rem and
  up) beside the full sidebar and in the phone drawer. On laptops its 48px go
  to the work instead: at 1280 to 1440px they decide whether an item's review
  rail fits beside its discussions, and the organization menu at the top of
  the sidebar switches organizations there.
- **The sidebar** holds the registered sections in a fixed order. Groups fold
  under their caption (remembered per organization in this browser); a folded
  group still shows its count. The sidebar is resizable (its edge is a window
  splitter, by drag or keyboard; double-click resets) and dragging it past its
  narrowest folds it to the compact sidebar. Compact, every section becomes
  icons and the rail gives way to the organization menu.
- **Phones** get the rail and sidebar in a drawer, opened from the top bar,
  which also carries a dot when something addressed to the person waits.
- **Projects** is the Work module: the project in context (named by the
  route, or the last one visited) with its queues, delivery surfaces, teams,
  spaces and saved views. Organization-level pages keep the last project in
  context rather than dropping the person out of it.

## Home

Home is the organization's index (`/{org}`). It used to redirect to Litto or
to the last project; a factory needs one page that answers "what waits on me
and what is the factory doing?" before any module.

- **Waiting on you** is the Inbox's To do derivation (reviews requested,
  pull requests to approve, page changes to review or merge, changes
  requested, blocked items): the same entries, the first few, linking to the
  Inbox for the rest.
- **In flight** is work assigned to me whose delivery status is started (in
  Lictory, or as the delivery tool reports it).
- **Ready to start** is ready, not yet committed work that is mine or
  unassigned. Work assigned to someone else is theirs to start.
- **Recently edited pages** are pages whose published version changed last.
- **Registered cards** (Factory: running agent sessions, questions agents
  ask) sit beside them. A card renders nothing until it has something to
  show, so an organization without agents sees no empty box, and a failing
  card never takes Home down.

Every list is derived from synchronized state in the browser
(`components/shell/home/derive.ts`); nothing polls.

## How modules plug in

The registry (`apps/platform/src/components/shell/nav-registry.tsx`) is three
static lists. Static on purpose: their order is the order people see, and the
hooks the shell calls for each entry run in a stable order.

- **Sections** (`navSections`) name a module, its icon and its page, and
  render its rows with the shared sidebar parts, which draw both the full and
  the compact sidebar.
- **Badges** (`useBadge` on a section) are a count, what it counts, a tone
  and whether it counts toward the desktop dock. `strong` is addressed to the
  person (mentions, direct messages, requests); `quiet` is activity worth a
  glance. Only mentions and direct messages count toward the dock or taskbar
  badge; the shell sums them and is the only caller of `setBadge`.
- **Palette providers** (`paletteProviders`) return candidates for the typed
  query; the palette matches, ranks, caps and groups them, and every section
  automatically gets a "Go to" command.
- **Home cards** (`homeCards`) are components that render nothing until they
  have something to show.

Placeholder sections and pages for Channels, Direct messages, Factory and
Code (`components/shell/placeholders`) keep every link working until their
modules ship; a module replaces its placeholder by changing one import in the
registry and one in the router.

## Routes and reserved project keys

Module pages live at fixed organization-level segments (`/{org}/channels`,
`/{org}/factory`, `/{org}/code`, `/{org}/spaces`, `/{org}/inbox`,
`/{org}/search`). They rank above the project segment (`/{org}/{project}`),
so those words are reserved project keys: the server refuses a project whose
key would be shadowed by a module page.

## Desktop app

`desktop()` (`lib/desktop.ts`) returns the bridge the desktop app's preload
exposes, or null in a browser, where nothing changes. Inside the app:

- the root element carries `data-desktop` and `data-desktop-platform`;
- `[data-drag-region]` elements (the sidebar's top strip and every
  `PageHeader`) move the window while their controls stay clickable;
- on macOS the left column leaves `--titlebar-inset` (36px) for the window
  buttons, which assumes a hidden, inset title bar;
- `onNavigate` requests (deep links, notification clicks, the tray) go
  through the router, only to paths inside the app: other origins and the
  account flows are refused;
- ⌘1 to ⌘9 (Ctrl elsewhere) open the first nine organizations; browsers
  keep those keys for their tabs.

## Visual language

One `PageHeader` (title, breadcrumbs, tabs, actions; 44px, on the page's
surface) starts every module page. The work sits in one framed surface on
the sidebar's tone; the current sidebar row is a raised card. Empty states
say what will appear and what to do first (`EmptyState`, `MissingState` from
`@lictory/ui`), never only "nothing here". Light and dark come from the same
tokens (`packages/ui/src/styles.css`); see [accessibility](./accessibility.md)
for the contrast and keyboard requirements every part meets.
