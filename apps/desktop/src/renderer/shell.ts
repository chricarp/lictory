import { h, icon, icons, logo } from "./dom";
import { renderSettings } from "./settings";
import type { Screen, ShellServer, ShellState } from "../shared/ipc";

// The shell page: the top bar, the server switcher on the left and the local
// screens (welcome, add a server, settings, a server that cannot load). A
// server's page is a separate view the main process places over the content
// area, so this page never sees it.

const api = window.lictoryShell!;
const root = document.getElementById("app")!;

let state: ShellState | null = null;
let screenKey = "";
let screenUpdate: ((state: ShellState) => void) | null = null;

const shortcutLabel = (state: ShellState, digit: string) =>
  state.platform === "darwin" ? `⌘${digit}` : `Ctrl+${digit}`;

function serverButton(server: ShellServer, current: ShellState) {
  const active =
    server.id === current.activeId &&
    current.screen.kind !== "add-server" &&
    current.screen.kind !== "settings";
  const unread = server.unread > 99 ? "99+" : String(server.unread);
  // The name read out starts with the initials shown, so a person using
  // voice control can say what they see (WCAG 2.5.3).
  const label = [
    `${server.initials} ${server.name}`,
    server.unread ? `${unread} unread` : null,
    server.shortcut ? shortcutLabel(current, server.shortcut) : null,
  ]
    .filter(Boolean)
    .join(", ");
  return h(
    "li",
    { class: "server-item" },
    h(
      "button",
      {
        type: "button",
        class: "server",
        "data-key": `server:${server.id}`,
        title: `${server.name} (${server.host})`,
        "aria-label": label,
        "aria-current": active ? "page" : undefined,
        style: `--hue: ${server.hue}`,
        on: {
          click: () => api.selectServer(server.id),
          contextmenu: (event) => {
            event.preventDefault();
            api.serverMenu(server.id);
          },
          keydown: (event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              api.serverMenu(server.id);
            }
          },
        },
      },
      h(
        "span",
        { class: "server-initials", "aria-hidden": "true" },
        server.initials,
      ),
    ),
    // Beside the button, drawn over its corner: its digits are not part of
    // the button's visible name (the name says "3 unread").
    server.unread
      ? h("span", { class: "server-badge", "aria-hidden": "true" }, unread)
      : null,
  );
}

function rail(current: ShellState) {
  const local = current.screen.kind;
  return h(
    "nav",
    { class: "rail", "aria-label": "Servers" },
    h(
      "ul",
      { class: "rail-servers" },
      current.servers.map((s) => serverButton(s, current)),
    ),
    h(
      "div",
      { class: "rail-actions" },
      h(
        "button",
        {
          type: "button",
          class: "rail-action",
          "data-key": "add",
          title: "Add a server",
          "aria-label": "Add a server",
          "aria-current": local === "add-server" ? "page" : undefined,
          on: { click: () => api.showScreen("add-server") },
        },
        icon(icons.plus, 18),
      ),
      h(
        "button",
        {
          type: "button",
          class: "rail-action",
          "data-key": "settings",
          title: "Settings",
          "aria-label": "Settings",
          "aria-current": local === "settings" ? "page" : undefined,
          on: {
            click: () =>
              api.showScreen(local === "settings" ? "server" : "settings"),
          },
        },
        icon(icons.settings, 18),
      ),
    ),
  );
}

function topBar(current: ShellState) {
  const onServer = current.screen.kind === "server";
  const active = current.servers.find((s) => s.id === current.activeId);
  const title =
    current.screen.kind === "settings"
      ? "Settings"
      : current.screen.kind === "add-server" ||
          current.screen.kind === "welcome"
        ? "Add a server"
        : current.screen.kind === "error"
          ? (active?.name ?? "Lictory")
          : current.title;
  return h(
    "header",
    { class: `topbar platform-${current.platform}` },
    h(
      "div",
      { class: "topbar-nav" },
      h(
        "button",
        {
          type: "button",
          class: "icon-button",
          "data-key": "back",
          "aria-label": "Back",
          title: "Back",
          disabled: !onServer || !current.canGoBack,
          on: { click: () => api.back() },
        },
        icon(icons.back),
      ),
      h(
        "button",
        {
          type: "button",
          class: "icon-button",
          "data-key": "forward",
          "aria-label": "Forward",
          title: "Forward",
          disabled: !onServer || !current.canGoForward,
          on: { click: () => api.forward() },
        },
        icon(icons.forward),
      ),
    ),
    h(
      "div",
      { class: "topbar-title" },
      h("span", { class: "topbar-page" }, title),
      onServer &&
        active &&
        current.servers.length > 1 &&
        !title.includes(active.name)
        ? h("span", { class: "topbar-server" }, active.name)
        : null,
      onServer && active?.loading && !active.offline
        ? h("span", {
            class: "spinner",
            role: "status",
            "aria-label": "Loading",
          })
        : null,
    ),
    onServer && active?.offline
      ? h(
          "span",
          {
            class: "topbar-status",
            "data-status": "offline",
            title: offlineText,
          },
          icon(icons.offline, 14),
          "Offline",
        )
      : null,
  );
}

const offlineText =
  "This computer is offline. Lictory reconnects by itself when the network is back; until then, what you see may be out of date.";

// One live region for the bars, which are rebuilt on every change: says
// when the server in front loses or gets back its network.
const announcer = h("p", { class: "sr-only", role: "status" });
let announcedOffline = false;
function announce(current: ShellState) {
  const active = current.servers.find((s) => s.id === current.activeId);
  const offline = current.screen.kind === "server" && !!active?.offline;
  if (offline === announcedOffline) return;
  announcedOffline = offline;
  announcer.textContent = offline ? offlineText : "Back online.";
}

// The address form of the welcome and add-a-server screens.
function addServerForm(current: ShellState, welcome: boolean) {
  const error = h("p", { class: "form-error", role: "alert" });
  const detail = h("p", { class: "hint detail" });
  const input = h("input", {
    id: "server-address",
    class: "input",
    type: "text",
    inputMode: "url",
    autocomplete: "url",
    spellcheck: false,
    placeholder: "lictory.example.com",
    required: true,
    "aria-describedby": "server-address-hint",
  });
  const submit = h(
    "button",
    { type: "submit", class: "button primary" },
    "Connect",
  );
  const form = h(
    "form",
    {
      class: "connect-form",
      on: {
        submit: (event) => {
          event.preventDefault();
          error.textContent = "";
          detail.textContent = "";
          submit.disabled = true;
          input.setAttribute("aria-invalid", "false");
          submit.textContent = "Checking…";
          void api.addServer(input.value).then((result) => {
            submit.disabled = false;
            submit.textContent = "Connect";
            if (!result.ok) {
              error.textContent = result.error;
              detail.textContent = result.detail
                ? `Details: ${result.detail}`
                : "";
              input.setAttribute("aria-invalid", "true");
              input.focus();
            }
          });
        },
      },
    },
    h("label", { class: "label", htmlFor: "server-address" }, "Server address"),
    input,
    h(
      "p",
      { class: "hint", id: "server-address-hint" },
      "The address you open Lictory at in your browser. Each server keeps its own sign-in.",
    ),
    error,
    detail,
    h(
      "div",
      { class: "form-actions" },
      !welcome && current.servers.length
        ? h(
            "button",
            {
              type: "button",
              class: "button",
              on: { click: () => api.showScreen("server") },
            },
            "Cancel",
          )
        : null,
      submit,
    ),
  );
  queueMicrotask(() => input.focus());
  return form;
}

function welcomeScreen(current: ShellState, welcome: boolean) {
  return h(
    "main",
    { class: "screen centered", id: "main", tabIndex: -1 },
    h(
      "section",
      { class: "card", "aria-labelledby": "connect-title" },
      h("div", { class: "brand" }, logo(36)),
      h(
        "h1",
        { id: "connect-title" },
        welcome ? "Connect to your Lictory server" : "Add a server",
      ),
      h(
        "p",
        { class: "lead" },
        welcome
          ? "Lictory runs on your team's own server. Ask your administrator for its address if you do not have it."
          : "Add another Lictory server. Switch between servers with the bar on the left.",
      ),
      addServerForm(current, welcome),
    ),
  );
}

function errorScreen(
  current: ShellState,
  screen: Extract<Screen, { kind: "error" }>,
) {
  const server = current.servers.find((s) => s.id === screen.serverId);
  const retry = h(
    "button",
    {
      type: "button",
      class: "button primary",
      on: { click: () => api.retry(screen.serverId) },
    },
    "Try again",
  );
  queueMicrotask(() => retry.focus());
  // While the server is being tried again (automatically or on request).
  const update = (state: ShellState) => {
    const loading =
      state.servers.find((s) => s.id === screen.serverId)?.loading ?? false;
    retry.disabled = loading;
    retry.textContent = loading ? "Connecting…" : "Try again";
  };
  update(current);
  const element = h(
    "main",
    { class: "screen centered", id: "main", tabIndex: -1 },
    h(
      "section",
      { class: "card", "aria-labelledby": "error-title" },
      h("div", { class: "brand warning" }, icon(icons.alert, 28)),
      h(
        "h1",
        { id: "error-title" },
        `${server?.name ?? "This server"} is not available`,
      ),
      h("p", { class: "lead" }, screen.message),
      h(
        "p",
        { class: "hint" },
        `${screen.next} Lictory keeps trying in the background.`,
      ),
      screen.detail
        ? h("p", { class: "hint detail" }, `Details: ${screen.detail}`)
        : null,
      h(
        "div",
        { class: "form-actions" },
        h(
          "button",
          {
            type: "button",
            class: "button",
            on: { click: () => api.removeServer(screen.serverId) },
          },
          "Remove server…",
        ),
        retry,
      ),
    ),
  );
  return { element, update };
}

// Under the server's own view, which covers it once the page has loaded: the
// shell page still names what it shows (one level-one heading, like every
// screen), and says it is opening only while it is.
function serverScreen(current: ShellState) {
  const server = current.servers.find((s) => s.id === current.activeId);
  const status = h("p", { class: "lead" });
  const update = (state: ShellState) => {
    const loading =
      state.servers.find((s) => s.id === state.activeId)?.loading ?? false;
    status.textContent = loading ? "Opening…" : "";
  };
  update(current);
  const element = h(
    "main",
    { class: "screen centered muted", id: "main", tabIndex: -1 },
    h(
      "div",
      { class: "opening" },
      h("h1", { class: "opening-title" }, server?.name ?? "Lictory"),
      status,
    ),
  );
  return { element, update };
}

function renderScreen(current: ShellState) {
  const screen = current.screen;
  // Settings update in place; the others are rebuilt when they change.
  const key =
    screen.kind === "error"
      ? `error:${screen.serverId}:${screen.message}`
      : screen.kind === "server"
        ? `server:${current.activeId}`
        : screen.kind;
  if (key === screenKey && screenUpdate) {
    screenUpdate(current);
    return null;
  }
  screenKey = key;
  screenUpdate = null;
  switch (screen.kind) {
    case "welcome":
      return welcomeScreen(current, true);
    case "add-server":
      return welcomeScreen(current, false);
    case "error": {
      const view = errorScreen(current, screen);
      screenUpdate = view.update;
      return view.element;
    }
    case "settings": {
      const view = renderSettings(current, api);
      screenUpdate = view.update;
      return view.element;
    }
    case "server": {
      const view = serverScreen(current);
      screenUpdate = view.update;
      return view.element;
    }
  }
}

function render(next: ShellState) {
  state = next;
  document.documentElement.dataset.platform = next.platform;
  let layout = root.querySelector<HTMLElement>(".layout");
  if (!layout) {
    layout = h("div", { class: "layout" });
    root.replaceChildren(layout);
  }
  const screen = renderScreen(next);
  const content =
    layout.querySelector<HTMLElement>(".content") ??
    h("div", { class: "content" });
  if (screen) content.replaceChildren(screen);
  // The bars are rebuilt; keyboard focus on one of their buttons stays.
  const focused = document.activeElement
    ?.closest("[data-key]")
    ?.getAttribute("data-key");
  layout.replaceChildren(
    topBar(next),
    next.servers.length ? rail(next) : h("div", { class: "rail empty" }),
    content,
  );
  if (!announcer.isConnected) root.append(announcer);
  announce(next);
  if (focused)
    layout
      .querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`)
      ?.focus();
}

void api.state().then(render);
api.onChange(render);

// Escape leaves a local screen for the current server.
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    state &&
    (state.screen.kind === "settings" || state.screen.kind === "add-server") &&
    state.servers.length
  )
    api.showScreen("server");
});
