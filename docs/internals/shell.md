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
  route, or the last one visited) with its queues, delivery surfaces, teams
  and saved views. Its spaces are listed once, first in the Spaces section.
  Organization-level pages keep the last project in context rather than
  dropping the person out of it.

## Home

Home is the organization's index (`/{org}`). It used to redirect to Litto or
to the last project; a factory needs one page that answers "what waits on me
and what is the factory doing?" before any module.

- **Set up {organization}** leads Home while the factory is incomplete: a
  checklist derived from data (a first work item, a second member or an
  invitation, a code host connected, a runner that has connected, an agent,
  a channel), the refinement loop before the factory, each step done when its
  data exists and the next one the single primary action. It leaves Home by
  itself once everything exists, and while it shows, Home shows no empty
  sections beside it (`components/shell/home/setup.ts`).
- **Waiting on you** is the Inbox's To do derivation (questions agents ask
  me, reviews requested, pull requests to approve, page changes to review or
  merge, changes requested, blocked items): the same entries, the first few,
  linking to the Inbox for the rest. The greeting, the card and the Inbox tab
  count the same list (`waitingOnYou` in `components/shell/home/derive.ts`).
  An agent's question is a compact `ApprovalRequest`, reviewed in place
  before it can be approved; agents come first, because a waiting agent is
  stopped.
- **In flight** is work assigned to me whose delivery status is started (in
  Lictory, or as the delivery tool reports it).
- **Ready to start** is work that is mine or unassigned and may start now.
  In native delivery that is the claimability rule
  ([claims](claims.md#claimability)) the item page and the Factory queue
  show: agreed scope, readiness, no blocker, no live claim. A ready
  specification whose scope nobody accepted waits on a person under
  Waiting on you instead, never in both. In external delivery it is ready
  work not handed off yet. Work assigned to someone else is theirs to start.
- **Recently edited pages** are pages whose published version changed last.
- **Registered cards** sit beside them: **Agents at work** (sessions
  running that do not already wait on me, so a session is listed once). A
  card renders nothing until it has something to show, so an organization
  without agents sees no empty box, and a failing card never takes Home
  down. In flight, Ready to start and Recently edited
  pages are hidden while empty; Waiting on you says so in one line.

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
  badge: the shell sums them into one source of the desktop bridge (see
  [Desktop app](#desktop-app)).
- **Palette providers** (`paletteProviders`) return candidates for the typed
  query; the palette matches, ranks, caps and groups them, and every section
  automatically gets a "Go to" command.
- **Home cards** (`homeCards`) are components that render nothing until they
  have something to show.

Registered today:

| Module          | Section, badge                                                                | Palette                                    | Home             |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------ | ---------------- |
| Channels        | joined channels, unread bold; mentions in channels (strong, dock)             | conversations, unread first                | none             |
| Direct messages | recent conversations; everything unread in them (strong, dock)                | (with conversations)                       | none             |
| Factory         | overview, agents, runners; sessions waiting on me (strong, not dock)          | sessions (active first), agents            | Agents at work   |
| Work            | the project in context with its queues (and its Factory queue in native mode) | projects, items, views (the palette's own) | Home's own lists |
| Code            | pull requests; open ones requesting my review (strong, not dock)              | none                                       | none             |

The modules live in their own folders (`components/channels/nav.tsx`, `components/code/code-nav.tsx`,
`components/factory/nav.tsx`); the registry only lists them. Code's
placeholder keeps its link working until its module ships, which replaces
it by changing one import in the registry and one in the router.

## Routes and reserved project keys

Module pages live at fixed organization-level segments (`/{org}/channels`,
`/{org}/factory`, `/{org}/code`, `/{org}/spaces`, `/{org}/inbox`,
`/{org}/search`). They rank above the project segment (`/{org}/{project}`),
so those words are reserved project keys: the server refuses a project whose
key would be shadowed by a module page.

## Desktop app

`desktop()` (`lib/desktop.ts`) returns the bridge the desktop app's preload
exposes, or null in a browser, where nothing changes. The web side has one
owner, `lib/desktop-bridge.ts` (mounted once in the signed-in layout; see
[the desktop app](./desktop.md#the-bridge)):

- **The badge is a sum of sources**, and the bridge alone calls
  `setBadge`. Unread notifications that ask something of the person are one
  source; the shell's `dock` badges (channel mentions and direct messages of
  the open organization, from read state) are another
  (`useDesktopBadgeSource("sidebar", …)`). Channel notifications are left
  out of the first so a mention never counts twice or outlives reading the
  conversation; they still arrive as native notifications.
- **`onNavigate`** requests (deep links, notification clicks, the tray) go
  through the router, only to paths inside the app: other origins and the
  account flows are refused.
- **The title bar is the desktop app's.** Its window draws a 40px top bar
  (with the macOS window buttons, or the Windows controls it overlays) and
  the server switcher, and shows the page in a view below and beside them.
  The page therefore leaves no room for window buttons and declares no drag
  regions; `PageHeader` is an ordinary header.
- ⌘1 to ⌘9 belong to the desktop app, which switches servers with them;
  organizations switch from the rail, the organization menu or the palette.

## Visual language

One `PageHeader` (back, breadcrumbs, title, meta, tabs, actions; 44px, on
the page's surface) starts every module page. On phones the header and the
shell's top bar are one 48px bar: a mounted `PageHeader` claims the bar
(`PhoneChromeContext`) and draws the navigation button before its title and
search after its actions, and pages without one keep the shell's own bar.
A page that searches its own content (a channel) says so (`ownSearch`) and
the global search gives way on phones, so the bar has one search icon; a
page with its own create (`ownCreate`) likewise has one "+".
People, agents and policies are drawn by the identity components, states by
`StatusChip` and `sessionState`, lists by `Panel` and `ListRow` (see
`apps/platform/AGENTS.md` and the gallery at `/{org}/design-system`). The work sits in one framed surface on
the sidebar's tone; the current sidebar row is a raised card. Empty states
say what will appear and what to do first (`EmptyState`, `MissingState` from
`@lictory/ui`), never only "nothing here". Light and dark come from the same
tokens (`packages/ui/src/styles.css`); see [accessibility](./accessibility.md)
for the contrast and keyboard requirements every part meets.
