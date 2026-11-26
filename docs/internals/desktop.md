# The desktop app

`apps/desktop` (`@lictory/desktop`) is an Electron shell around the web app
of one or more Lictory servers. Lictory is self-hosted, so the app ships
with no server: the person adds the servers their teams use, like Slack
workspaces, and switches between them on the left. It adds what a browser
tab cannot do well: native notifications, a dock or taskbar badge,
`lictory://` links, a tray icon, launch at login, keyboard shortcuts,
updates, and (in preparation) a personal runner for the person's agents.

The app adds no server behavior. It loads the web app from each server and
talks to it through a small bridge; everything the web app shows comes from
the server as in a browser.

## Shape

One window per installation (a second launch focuses it):

- **The shell page**, the window's base layer: the top bar, the server
  switcher on the left and the app's own screens (welcome, add a server,
  settings, a server that cannot be loaded). It is the app's own code,
  served from `lictory-app://shell/`.
- **One view per server** (a `WebContentsView`) over the content area. Only
  the active server's view is visible; the others stay loaded so their
  notifications and badges keep arriving.

The main process owns the list of servers, the badge and notifications, and
checks every message from either kind of page (`src/main/shell.ts`). The
rules it applies are pure modules under `src/shared/`, tested without
Electron.

### Toolchain

Main process, preloads and shell page are TypeScript bundled by **esbuild**
(`build.mjs`), the bundler the API, worker and collaboration service already
use. Each sandboxed preload must be a single file (it can require only
`electron`), the main process bundles `electron-updater` so the package
carries no `node_modules`, and the shell page is one script. That is three
esbuild calls and a few copies, so electron-vite (a Vite layer and its own
configuration to keep current) adds nothing, and `tsc` alone cannot bundle.
`tsc --noEmit` type-checks it like every workspace.

Installing the monorepo never downloads Electron: Electron 45 fetches its
binary on first use, not at install. Run `bun run --cwd apps/desktop setup`
once before starting the app locally. The server images exclude the
workspace (`.dockerignore`), so they do not grow.

## Servers

- **Adding a server.** The person types an address; `parseServerAddress`
  makes it an origin (HTTPS unless it names this computer, path dropped,
  no user name or password). The app then asks `GET /api/session`, the
  public endpoint every Lictory server answers without a session, and adds
  the server only if the answer has Lictory's shape. A redirect to another
  HTTPS origin (the canonical address) is followed and that origin is
  stored; a downgrade to HTTP is refused. The request runs in an empty,
  in-memory session, so no server's cookies reach an address being checked.
  Plain HTTP to another computer is accepted only when typed explicitly.
- **Sessions.** Each server has its own persistent partition
  (`persist:server-<random id>`): cookies, storage and sign-in stay apart,
  exactly like separate browser profiles. Removing a server clears its
  partition, so adding it again starts signed out.
- **Names.** A server is first named after its host. Once its page reports
  the organization the person uses there (the bridge's
  `setOrganizationName`, sent when they belong to exactly one), the
  switcher, menus and notifications use that name and its initials ("HF"
  for Harborline Freight) instead of "LO" for `localhost`. A name the person
  chose is kept; without a single organization the name goes back to the
  host.
- **Stored files** (user data directory): `servers.json` (origins, names,
  the reported organization, order, last path, zoom), `settings.json` and
  `window.json`. The shell
  stores **no credentials**: sign-ins live in each partition's cookies,
  encrypted by Chromium with the operating system's key store (the
  cookie-encryption fuse is on).
- **Reopening.** Each server reopens at the last in-app path it showed; the
  window reopens where it was while that place is still on a display.
- **A server that cannot be loaded** shows an error screen instead of its
  view and is tried again after 5 seconds, then less and less often up to
  every minute, at once when the computer wakes up, and on **Try again** or
  Reload. Chromium's own error page never counts as the server answering.
  The screen and the add-a-server form say what happened in plain words
  with the next step (`src/shared/net-errors.ts`: offline, unknown name,
  refused, no answer, certificate, proxy, blocked port); Chromium's code
  (`ERR_CONNECTION_REFUSED`) appears only as a detail line.
- **No network.** A server's page reports `navigator.onLine` through its
  preload; while it is false the top bar shows **Offline** and a live region
  says so, until the network is back. The page keeps what it shows and
  reconnects by itself. A server that is down while the network works is
  shown by the web app's own sync status, and by the error screen on the
  next load.

## Security model

The pages are a server's web app, which may be compromised or simply buggy.
Nothing a page does may reach the computer beyond what a browser tab can,
plus the bridge.

- **Renderer.** Every view runs with `contextIsolation`, the Chromium
  sandbox (`app.enableSandbox()` for all renderers), no `nodeIntegration`
  (also not in frames or workers), `webSecurity` on, no `<webview>`, safe
  dialogs, no navigation by drag and drop. The remote module no longer
  exists in Electron. Developer tools exist only in development builds.
- **Navigation allowlist.** A server's view loads only its own origin. A
  link to another configured server opens in that server's view; anything
  else opens in the default browser, and only `https:`, `http:` and
  `mailto:` URLs without credentials are handed to `shell.openExternal`
  (`isSafeExternalUrl`): `file:`, `smb:` and other applications' schemes can
  run code on the computer. Top-level navigations, server redirects and
  `window.open` all go through the same rule; no page ever opens a window
  of the app.
- **Sign-in with a company identity provider.** The one exception to the
  allowlist, and a deliberate one: an OAuth or OpenID Connect authorization
  request whose `redirect_uri` is on the server's origin loads in the
  server's view, and so do the identity provider's pages (MFA hops across
  hosts) until the flow returns to the server or ten minutes pass. Opening
  it in the browser would sign the browser in, not the app. Those pages
  never receive the bridge: the preload exposes it only when the page's
  origin is the server's, and the main process checks the sender's origin
  again. The app's user agent is Chrome's without the Electron and app
  tokens, because some providers refuse embedded browsers they recognise.
- **Permissions.** Notifications and clipboard writes are granted to the
  server's own top-level page. Camera and microphone are asked of the
  person (a native dialog naming the server; on macOS also the system
  prompt) and remembered until the app quits. Everything else is denied:
  location, screen capture, MIDI, USB, serial and HID devices, reading the
  clipboard, fullscreen, opening other applications. Frames and other
  origins get nothing.
- **The shell page** is served from `lictory-app://shell/` with a strict
  content security policy (scripts, styles and its bundled Geist font from
  itself only, no connections; without `font-src 'self'` Chromium silently
  falls back to a system font). Its preload exposes its API only on that origin, and the
  main process answers only messages from that page.
- **IPC.** Bridge messages are accepted only from a server view's main frame
  whose origin is that server's. Their content is validated (titles and
  bodies shortened, paths must be in-app paths, counts clamped) and
  notifications are rate limited per server.
- **Certificates and proxies.** Invalid certificates are refused, never
  bypassed; a company certificate authority must be trusted by the
  operating system. Proxies come from the system settings.
- **Packaged binary.** electron-builder sets the Electron fuses: no
  `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, the app loads
  only from its integrity-checked `app.asar`, cookies are encrypted, and
  `file://` has no extra privileges.

## The bridge

The web app and the shell share one contract,
`apps/platform/src/lib/desktop.ts` (`desktop()` returns it in the app, null
in a browser): `platform`, `version`, `notify`, `setBadge`, `onNavigate` and
the optional `setOrganizationName` (older apps lack it, so the page checks).
The preload (`src/preload/web.ts`) implements exactly that shape.

**In the shell:**

- `notify` shows a native notification, unless notifications are turned off
  in settings or the person is already looking at what it is about: the
  window focused on that server's page that the notification opens (its
  query and fragment aside). Working elsewhere in the app, even on the same
  server, is when a review request or a mention should interrupt, so the
  focused window alone does not suppress it. With several servers the
  notification names its server. Linux shows notifications through
  libnotify (a dependency of the `.deb`); where `Notification.isSupported()`
  is false, settings say so instead of offering a switch that does nothing. Clicking it focuses the window, selects
  the server and opens the notification's path. Notifications with the same
  tag replace each other.
- `setBadge` sets that server's count. The dock (macOS), taskbar overlay
  (Windows, drawn as a red disc with the count) and launcher badge (Linux
  desktops that show one) carry the sum over servers; each server's button
  in the switcher and its tray menu entry carry its own.
- `onNavigate` delivers paths from deep links, notification clicks and the
  tray. A page that has not registered a listener (signed out, an error
  page) is loaded at the path instead.
- `setOrganizationName` names the server after the person's organization
  (see Servers); the web app sends it once memberships have loaded, so the
  name never flips to the host while they load.

**In the web app** (`apps/platform/src/lib/desktop-bridge.ts`, mounted once
in the signed-in layout by `components/app/desktop-connector.tsx`):

- It reads the unread notifications whose kind **asks something of the
  person**: by the catalog's rule (see [Notifications](notifications.md)),
  the kinds that notify by email by default. Informational kinds never
  raise the badge or a native notification. It uses the same endpoint and
  realtime signals as the Inbox and adds no server events.
- The badge is a **sum of sources**, and this module is the only caller of
  `setBadge`. Notifications are one source; another feature adds its own
  unread count with `useDesktopBadgeSource(source, count)`. The shell adds
  its sidebar's `dock` badges (channel mentions and direct messages of the
  open organization, from read state, and the agent sessions waiting on the
  person; see [the shell](shell.md#desktop-app)), so notifications of the
  Channels category and agents' requests are left out of the notification
  source: reading a conversation clears its mentions without marking their
  notifications read, and answering an agent clears its session's wait.
  They are still forwarded as native notifications.
- `onNavigate` paths go through the router only when they are pages of the
  app: other origins and the account flows are refused.
- The page is a view under the window's top bar and beside the server
  switcher, so it declares no drag regions and leaves no room for window
  buttons.
- New notifications become native ones. The first read only records what
  is there (starting the app never replays the inbox), and later reads
  forward unseen notifications no older than the newest of that first read.
  More than three at once become the two newest and one summary.
- Refreshes come from the organization's realtime signals, a change of read
  state in the tab, window focus and, for signals lost while a stream
  reconnects, once a minute.

## Deep links

`lictory://<server host[:port]>/<path>` opens `<path>` on the server at that
host, for example
`lictory://lictory.example.com/acme/items/PAY-142?pr=3`. The path must be an
in-app path; anything else is refused.

- macOS delivers links with `open-url` (also before the app is ready);
  Windows and Linux start a second instance with the link as an argument,
  which the single-instance lock hands to the running app.
- A link to a configured server opens in its view. A link to an unknown
  host asks first (a native dialog, which a page cannot imitate); the app
  then checks `https://<host>` like a typed address (plain HTTP only for
  this computer), adds it and opens the path.
- Packages register the scheme: `protocols` in electron-builder writes the
  macOS `Info.plist` entry, the Windows registry keys of the installer and
  `MimeType=x-scheme-handler/lictory` in the Linux desktop entry. Development
  builds register it only with `LICTORY_DESKTOP_REGISTER_PROTOCOL=1`.

## Window, menus, tray

- **Title bar.** macOS uses the hidden-inset style: the traffic lights sit in
  the app's own top bar, which is the drag area. Windows draws its own
  window controls over the top bar (`titleBarOverlay`, colored to match the
  theme). Linux keeps the native frame, which window managers expect. The
  top bar names the page in front (its title, with the server's name only
  when several servers are added and the title does not already say it);
  a page without a title of its own, or one that failed to load, is named
  after its server, never by its address.
- **Scrollbars.** On Windows and Linux, Chromium gives web pages a browser's
  classic scrollbars. The shell draws slim ones in its colors, and injects
  the same colors and `scrollbar-width: thin` into servers' pages
  (`src/main/scrollbars.ts`, standard properties only, so a page's own
  `scrollbar-width` still wins). macOS keeps its overlay scrollbars.
- **Shortcuts** (Ctrl instead of ⌘ on Windows and Linux): ⌘1 to ⌘9 open the
  server at that position, ⌘K is left to the page (its command palette; the
  menu item types it when chosen with the mouse), ⌘, settings, ⌘⇧N add a
  server, ⌘R and ⌘⇧R reload, ⌘0, ⌘= and ⌘- zoom (kept per server), ⌘[ and
  ⌘] (Alt+arrows) back and forward, plus the standard edit and window
  commands. A right-click menu offers spelling suggestions, edit commands
  and, on links, opening in the browser.
- **Spell check** uses the system checker on macOS and Chromium's
  dictionaries for the system languages elsewhere (downloaded by Chromium
  on first use).
- **Tray** (menu bar on macOS): the unread count (as the title on macOS, a
  red dot on the icon elsewhere), each server with its count, Open, Launch
  at Login and Quit. On Windows and Linux, closing the window keeps the app
  in the tray (a setting); on macOS it stays in the Dock as usual.
- **Launch at login** uses the login item API on macOS and Windows and a
  desktop entry in `~/.config/autostart` on Linux. Launched that way, the app
  starts hidden.

## Updates

Installed apps update from the GitHub releases of this repository through
`electron-updater` (`src/main/updater.ts`): checked 30 seconds after start
and every six hours, downloaded in the background (a setting) and installed
when the app quits or on **Restart to update**. Pre-releases (nightlies) are
ignored.

A build updates itself only when it can do so safely, and otherwise settings
say why, per platform, and link to lictory.com/download
(`src/shared/updates.ts`, with its tests):

- not in development builds, and not with `LICTORY_DESKTOP_UPDATES=off`
  (for managed computers);
- macOS and Windows: only builds that were signed (and on macOS notarized);
  `package.mjs` records this in the packaged `package.json`
  (`lictory.updatable`). Squirrel.Mac refuses unsigned apps, and an unsigned
  Windows installer cannot be verified;
- Linux: only the AppImage (checked against the release's SHA-512). A
  `.deb` belongs to the package manager, and no apt repository serves
  Lictory, so it never updates: settings say to install the newest `.deb`
  over it, never that the package manager will.

A release without this system's `latest*.yml` (or no stable release at all)
reads as "the newest release has no update for this system yet", not as a
failed check.

**Releases.** Every release, nightly and stable, carries the installers,
their `.blockmap` files and the `latest*.yml` files, built by
`.github/workflows/release-clients.yml` on macOS, Windows and Linux runners
from the release's source with its version (`scripts/inject-release-version.ts`;
the app takes the repository's version) and checked before publication:
each `latest*.yml` must be for that version and describe its installer by
SHA-512 and size, since an installed app finds no update without it. See
[releases](../operations/releases.md#runner-and-desktop-app). The asset names
come from `package.mjs` (`Lictory-<version>-mac-universal.zip`,
`-windows-setup.exe`, `-linux-<arch>.AppImage`, `lictory_<version>_<arch>.deb`)
and contain no spaces, which GitHub would rename, breaking `latest*.yml`.
Each release also carries a byte-for-byte copy of every installer under a
name without the version (`Lictory-mac-universal.dmg`,
`Lictory-windows-setup.exe`, `Lictory-linux-{x64,arm64}.AppImage`,
`lictory_{amd64,arm64}.deb`), so `releases/latest/download/<name>` always
serves the newest stable one; lictory.com/download links only to those.
Updates never use the copies: `latest*.yml` names the versioned files.
Installed apps follow GitHub's latest release, so nightlies never reach
them.

Signing certificates come from the **desktop-signing** environment
(`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `WIN_CSC_LINK`,
`WIN_CSC_KEY_PASSWORD`), mapped to electron-builder's variables in the
packaging step. A platform whose certificates are missing is built unsigned
and records that it does not update itself.

## Managed computers

Two existing mechanisms spare people typing the address:

- **A link.** `lictory://lictory.example.com/` (in an onboarding email or
  the intranet) asks once, in a native dialog, and adds the server.
- **A servers file.** Before the first launch, an administrator's tooling
  writes `servers.json` into the user data directory
  (`~/Library/Application Support/Lictory`, `%APPDATA%\Lictory`,
  `~/.config/Lictory`): `{"servers":[{"id":"managed-lictory","origin":"https://lictory.example.com"}]}`.
  Only `id` (8 to 64 letters, digits or dashes; it names the session
  partition) and `origin` are needed; the rest takes its default
  (`normalizeServers`, covered by a unit test). Writing it later replaces
  the person's own list.

`LICTORY_DESKTOP_UPDATES=off` turns self-updating off for computers updated
by their management tool. There is no policy file (locked server list,
forced settings); that would be a new concept.

## Packaging

`bun run --cwd apps/desktop package -- --linux` (or `--mac`, `--win`) builds
`dist/` and packages it with electron-builder (`package.mjs`), never
publishing. Each operating system packages on its own (macOS only builds
on macOS); CI builds all three, unsigned, for every pull request that
changes the app, with the same workflow releases use:

- **macOS:** universal (Intel and Apple silicon) DMG and ZIP (the ZIP feeds
  updates), hardened runtime with JIT, camera and microphone entitlements.
  Without `CSC_LINK`/`CSC_NAME` the app is signed ad hoc (Apple silicon
  runs no unsigned code) instead of by whatever identity the build machine
  holds; such a build does not update itself.
- **Windows:** NSIS installer for x64 and arm64, per user, without
  administrator rights.
- **Linux:** AppImage and `.deb` for x64 and arm64. The AppImage uses
  electron-builder's static runtime (toolset `1.0.3`), which needs neither
  libfuse2 nor any other system library, both absent from current Ubuntu
  and Fedora installs.
- The package holds only `dist/` and `package.json` (no `node_modules`);
  icons are rendered from the Lictory mark by `icons.mjs` into `static/`.

## Personal runner (prepared)

The desktop app can run `lictory-runner` (`apps/runner`, the Factory
stream) as a child process, so the person's agents can work on this
computer. It is behind `LICTORY_DESKTOP_RUNNER=1` until the runner ships
inside the package; with the flag, **Settings › Personal runner (preview)**
shows it. No package includes the binary yet, and the section says so: to
run agents on the computer today, the person installs the runner from
**Factory › Runners › Add runner**, which runs on its own; to drive that
binary from the app, they start it with `LICTORY_RUNNER_PATH`.

Implemented here, without depending on the runner:

- `src/shared/runner.ts` supervises the process: start, stop (SIGTERM, then
  SIGKILL after 10 seconds), restart after an unexpected exit with an
  exponential backoff from 1 second to 1 minute (reset after a minute of
  running), no restart after a clean exit or a configuration error, and a
  log of the last thousand lines without terminal colours.
- `src/main/runner.ts` finds the binary (`LICTORY_RUNNER_PATH`, or
  `resources/runner/lictory-runner[.exe]` in the package), gives it the
  person's login-shell `PATH` (apps started from the Dock or a launcher do
  not get it, and harnesses and git live there) without Electron's own
  variables, stops it before the app quits, and stops it when its server is
  removed.
- The settings screen: status, start and stop, start with the app,
  registering this computer with a server, and the live log.

**Contract with `lictory-runner`** (to confirm when apps/runner lands):

- `lictory-runner register --server <origin> --config-dir <dir> --name
<hostname> --token-stdin` reads the one-time registration token from
  standard input, exchanges it and stores the runner credential in
  `<dir>`. The app passes the token once and never stores it, and stores no
  runner credential: only which server the runner works for.
- `lictory-runner start --server <origin> --config-dir <dir>` runs until
  SIGTERM, then finishes or hands back its sessions and exits 0.
- Exit codes: 0 for a clean stop; 64 to 78 (sysexits: usage, configuration,
  not registered) for problems the person must fix, which the app does not
  retry; anything else is retried.
- Logs go to standard output and error, one line per event, and never
  contain tokens or credentials.
- `LICTORY_RUNNER_MANAGED_BY=lictory-desktop` is set in its environment.

To ship it: add the release's `lictory-runner` binary for each platform and
architecture (built by the same release workflow, see
[factory](factory.md#distribution)) with electron-builder `extraResources` to
`resources/runner/`, sign it with the app on macOS and Windows, and turn the
flag into a setting.

## Tests

- Unit tests next to the pure modules (`src/shared/*.test.ts`): addresses
  and the server check, deep links, the navigation allowlist and
  permissions, notifications, badge drawing, settings, window placement and
  runner supervision. `apps/platform/src/lib/desktop-bridge.test.ts` covers
  the web app's side (attention kinds, badge sources, what counts as new,
  refresh coalescing). Both run in `bun run test:domain`.
- `tests/platform/desktop-bridge.spec.ts` runs the real web app with a
  recording bridge: an assignment raises the badge and a native
  notification, the shell navigates the page, reading clears the badge.
- `apps/desktop/tests/smoke.spec.ts` runs the built app with Playwright's
  Electron support against a fake Lictory server: the bundled font, adding a
  server (and refusing wrong ones in plain words), the bridge without
  Node.js, the badge, the organization's name in the switcher, native
  notifications (shown while working elsewhere, not repeated for the page in
  front), a deep link, links that leave the app, the offline top bar
  (network emulation), settings, an unavailable server and reopening, with
  axe on each of the app's own screens.
  It needs the Electron binary (`bun run setup`), a display
  (`xvfb-run -a bun run test:smoke` on Linux) and Electron's system
  libraries (GTK 3, NSS); containers without the setuid sandbox helper run it
  with `--no-sandbox`. It is not part of the web browser suite.

## Known limits

- Every server's page stays loaded so notifications arrive; each costs about
  as much memory as a browser tab.
- Passkeys work with security keys and phones; platform authenticators
  (Touch ID, Windows Hello) depend on Electron's WebAuthn support and may be
  unavailable, so keep another sign-in method.
- Flows a page sends to another site without returning to the server
  through `redirect_uri` (installing a code host app, for example) continue
  in the browser, where the person may need to sign in to finish.
- Proxies that ask for a user name and password are not supported yet.
- Linux badges show only on desktops that support the launcher API; the
  tray needs a StatusNotifier host (GNOME needs an extension); notifications
  need libnotify and a notification service (the AppImage does not bundle
  libnotify; settings say when it is missing).
