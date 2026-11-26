import { h } from "./dom";
import type { LogLine } from "../shared/runner";
import type {
  RunnerState,
  ShellApi,
  ShellState,
  UpdateState,
} from "../shared/ipc";

const RELEASES_URL = "https://github.com/chricarp/lictory/releases";

// The settings screen. It is built once and updated in place when the state
// changes, so focus and typed text survive updates.

function toggle(
  id: string,
  label: string,
  description: string,
  onChange: (checked: boolean) => void,
) {
  const input = h("input", {
    id,
    type: "checkbox",
    class: "switch",
    role: "switch",
    "aria-describedby": `${id}-description`,
    on: { change: () => onChange(input.checked) },
  });
  const row = h(
    "div",
    { class: "setting" },
    h(
      "div",
      { class: "setting-text" },
      h("label", { htmlFor: id, class: "setting-label" }, label),
      h("p", { id: `${id}-description`, class: "hint" }, description),
    ),
    input,
  );
  return { row, input };
}

// A titled group of settings: the title above, the settings on a card.
function section(title: string, ...children: (Node | null)[]) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return h(
    "section",
    { class: "settings-section", "aria-labelledby": id },
    h("h2", { id }, title),
    h("div", { class: "settings-card" }, ...children),
  );
}

function updateText(update: UpdateState) {
  switch (update.status) {
    case "unsupported":
      return update.reason;
    case "idle":
      return "Lictory checks for updates in the background.";
    case "checking":
      return "Checking for updates…";
    case "current":
      return "Lictory is up to date.";
    case "downloading":
      return `Downloading an update… ${update.percent}%`;
    case "ready":
      return `Version ${update.version} is ready to install.`;
    case "error":
      return update.message;
  }
}

const runnerStatusText: Record<RunnerState["snapshot"]["status"], string> = {
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  backoff: "Restarting soon",
  stopping: "Stopping…",
  failed: "Stopped after an error",
};

export function renderSettings(initial: ShellState, api: ShellApi) {
  const set = (patch: unknown) => void api.updateSettings(patch);

  const notifications = toggle(
    "setting-notifications",
    "Desktop notifications",
    "Reviews requested, mentions, blocking discussions and other activity that needs you, from every server.",
    (checked) => set({ notifications: checked }),
  );
  // Linux shows notifications through libnotify; without it nothing can.
  const notificationsUnsupported = h("p", {
    class: "setting-status warning",
    role: "status",
  });
  const sound = toggle(
    "setting-sound",
    "Play a sound",
    "With each desktop notification.",
    (checked) => set({ notificationSound: checked }),
  );
  const login = toggle(
    "setting-login",
    "Open at login",
    "Start Lictory in the background when you sign in to this computer.",
    (checked) => set({ launchAtLogin: checked }),
  );
  const tray = toggle(
    "setting-tray",
    "Keep running when the window is closed",
    "Lictory stays in the notification area so notifications keep arriving. Quit it from there.",
    (checked) => set({ closeToTray: checked }),
  );
  const autoUpdate = toggle(
    "setting-updates",
    "Download updates automatically",
    "New versions are installed the next time Lictory starts.",
    (checked) => set({ autoUpdate: checked }),
  );

  const updateStatus = h("p", { class: "setting-status", role: "status" });
  const checkButton = h(
    "button",
    {
      type: "button",
      class: "button",
      on: { click: () => api.checkForUpdates() },
    },
    "Check now",
  );
  const installButton = h(
    "button",
    {
      type: "button",
      class: "button primary",
      on: { click: () => api.installUpdate() },
    },
    "Restart to update",
  );
  const releases = h(
    "a",
    { href: RELEASES_URL, target: "_blank", rel: "noreferrer", class: "link" },
    "Releases page",
  );

  const serverList = h("ul", { class: "server-list" });

  // Personal runner (behind LICTORY_DESKTOP_RUNNER=1).
  const runnerStatus = h("p", { class: "setting-status", role: "status" });
  const runnerServer = h("select", { id: "runner-server", class: "input" });
  const runnerToken = h("input", {
    id: "runner-token",
    class: "input",
    type: "password",
    autocomplete: "off",
    spellcheck: false,
    placeholder: "Registration token",
    "aria-describedby": "runner-token-hint",
  });
  const runnerError = h("p", { class: "form-error", role: "alert" });
  const runnerStart = h(
    "button",
    { type: "button", class: "button primary" },
    "Start",
  );
  const runnerStop = h("button", { type: "button", class: "button" }, "Stop");
  const runnerWithApp = toggle(
    "setting-runner-start",
    "Start with Lictory",
    "Start the runner whenever the app starts.",
    (checked) => set({ runner: { startWithApp: checked } }),
  );
  const runnerLog = h("pre", {
    class: "log",
    tabIndex: 0,
    "aria-label": "Runner log",
  });
  const command = async (input: Parameters<ShellApi["runner"]>[0]) => {
    runnerError.textContent = "";
    const result = await api.runner(input);
    if (!result.ok) runnerError.textContent = result.error;
    return result.ok;
  };
  runnerStart.addEventListener(
    "click",
    () => void command({ action: "start" }),
  );
  runnerStop.addEventListener("click", () => void command({ action: "stop" }));
  const registerForm = h(
    "form",
    {
      class: "runner-register",
      on: {
        submit: (event) => {
          event.preventDefault();
          void command({
            action: "register",
            serverId: runnerServer.value,
            token: runnerToken.value,
          }).then((ok) => {
            if (ok) runnerToken.value = "";
          });
        },
      },
    },
    h("label", { htmlFor: "runner-server", class: "label" }, "Server"),
    runnerServer,
    h(
      "label",
      { htmlFor: "runner-token", class: "label" },
      "Registration token",
    ),
    runnerToken,
    h(
      "p",
      { class: "hint", id: "runner-token-hint" },
      "Create a personal runner token in Lictory (Factory › Runners). It is passed to lictory-runner once and never stored by the app.",
    ),
    h(
      "div",
      { class: "form-actions" },
      h(
        "button",
        { type: "submit", class: "button" },
        "Register this computer",
      ),
    ),
  );
  const runnerSection = section(
    "Personal runner (preview)",
    h(
      "p",
      { class: "hint" },
      "Run your own agents on this computer. The runner connects out to your server; it needs no open port.",
    ),
    runnerStatus,
    h("div", { class: "form-actions start" }, runnerStart, runnerStop),
    runnerWithApp.row,
    registerForm,
    runnerError,
    h("h3", {}, "Log"),
    runnerLog,
  );

  const version = h("p", { class: "hint" });

  const element = h(
    "main",
    { class: "screen settings", id: "main", tabIndex: -1 },
    h("h1", {}, "Settings"),
    section(
      "Notifications",
      notificationsUnsupported,
      notifications.row,
      sound.row,
    ),
    section("Window and startup", login.row, tray.row),
    section("Servers", serverList),
    section(
      "Updates",
      updateStatus,
      autoUpdate.row,
      h(
        "div",
        { class: "form-actions start" },
        checkButton,
        installButton,
        releases,
      ),
    ),
    runnerSection,
    section("About", version),
  );

  let logTimer: number | null = null;
  function showLogs(lines: readonly LogLine[]) {
    const atBottom =
      runnerLog.scrollTop + runnerLog.clientHeight >=
      runnerLog.scrollHeight - 8;
    runnerLog.textContent = lines
      .slice(-300)
      .map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.text}`)
      .join("\n");
    if (atBottom) runnerLog.scrollTop = runnerLog.scrollHeight;
  }

  // While the screen is open, the log is read every second.
  function watchLogs() {
    if (logTimer !== null || !element.isConnected) return;
    void api.runnerLogs().then(showLogs);
    logTimer = window.setInterval(() => {
      if (!element.isConnected) {
        if (logTimer !== null) window.clearInterval(logTimer);
        logTimer = null;
        return;
      }
      void api.runnerLogs().then(showLogs);
    }, 1000);
  }

  function update(state: ShellState) {
    const s = state.settings;
    const supported = state.notificationsSupported;
    notificationsUnsupported.hidden = supported;
    notificationsUnsupported.textContent = supported
      ? ""
      : state.platform === "linux"
        ? "This computer cannot show desktop notifications: Lictory needs libnotify (the libnotify4 package on Debian and Ubuntu) and a notification service. Install it and restart Lictory. The badge and the Inbox still show what needs you."
        : "This computer cannot show desktop notifications. The badge and the Inbox still show what needs you.";
    notifications.input.checked = s.notifications && supported;
    notifications.input.disabled = !supported;
    sound.input.checked = s.notificationSound;
    sound.input.disabled = !s.notifications || !supported;
    login.input.checked = s.launchAtLogin;
    login.row.hidden = !state.launchAtLoginSupported;
    tray.input.checked = s.closeToTray;
    tray.row.hidden = state.platform === "darwin" || !state.trayAvailable;
    autoUpdate.input.checked = s.autoUpdate;

    const u = state.update;
    updateStatus.textContent = updateText(u);
    const unsupported = u.status === "unsupported";
    autoUpdate.row.hidden = unsupported;
    checkButton.hidden = unsupported;
    checkButton.disabled =
      u.status === "checking" || u.status === "downloading";
    installButton.hidden = u.status !== "ready";
    releases.hidden = !unsupported && u.status !== "error";

    serverList.replaceChildren(
      ...state.servers.map((server) =>
        h(
          "li",
          { class: "server-row" },
          h(
            "span",
            { class: "server-row-text" },
            h("span", { class: "setting-label" }, server.name),
            h("span", { class: "hint" }, server.origin),
          ),
          h(
            "button",
            {
              type: "button",
              class: "button",
              "aria-label": `Remove ${server.name}`,
              on: { click: () => api.removeServer(server.id) },
            },
            "Remove…",
          ),
        ),
      ),
      h(
        "li",
        {},
        h(
          "button",
          {
            type: "button",
            class: "button",
            on: { click: () => api.showScreen("add-server") },
          },
          "Add a server…",
        ),
      ),
    );

    const runner = state.runner;
    runnerSection.hidden = !runner.enabled;
    if (runner.enabled) {
      const snap = runner.snapshot;
      runnerStatus.textContent = runner.available
        ? `${runnerStatusText[snap.status]}${snap.pid ? ` · pid ${snap.pid}` : ""}${snap.message ? ` · ${snap.message}` : ""}`
        : `This app does not include lictory-runner yet. To run agents on this computer today, install the runner from Lictory (Factory › Runners › Add runner): it runs on its own, without the app. To start and stop it from here instead, start Lictory with LICTORY_RUNNER_PATH set to where lictory-runner is installed.${runner.binary ? ` Nothing was found at ${runner.binary}.` : ""}`;
      const running = ["starting", "running", "backoff"].includes(snap.status);
      runnerStart.disabled = !runner.available || running || !s.runner.serverId;
      runnerStop.disabled = !running;
      runnerWithApp.input.checked = s.runner.startWithApp;
      const chosen = runnerServer.value || (s.runner.serverId ?? "");
      runnerServer.replaceChildren(
        ...state.servers.map((server) =>
          h(
            "option",
            { value: server.id, selected: server.id === chosen },
            server.name,
          ),
        ),
      );
      watchLogs();
    }

    version.textContent = `Lictory ${state.version} · ${state.platform === "darwin" ? "macOS" : state.platform === "win32" ? "Windows" : "Linux"}`;
  }

  update(initial);
  queueMicrotask(() => {
    element.focus();
    if (initial.runner.enabled) watchLogs();
  });
  return { element, update };
}
