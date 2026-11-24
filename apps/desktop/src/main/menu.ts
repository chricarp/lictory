import {
  app,
  clipboard,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";
import type { Shell } from "./shell";

const DOCS_URL = "https://docs.lictory.com/basics/desktop";
const ISSUES_URL = "https://github.com/chricarp/lictory/issues";

// The application menu with the standard shortcuts. ⌘1…⌘9 switch servers
// (Ctrl on Windows and Linux); ⌘K is listed but left to the page, which owns
// its command palette; developer tools exist only in development builds.
export function installMenu(shell: Shell, options: { isDev: boolean }) {
  const mac = process.platform === "darwin";
  const servers = shell.servers.servers
    .slice(0, 9)
    .map((server, i): MenuItemConstructorOptions => ({
      label: server.name,
      type: "radio",
      checked: server.id === shell.servers.activeId,
      accelerator: `CmdOrCtrl+${i + 1}`,
      click: () => shell.select(server.id),
    }));
  const settings: MenuItemConstructorOptions = {
    label: mac ? "Settings…" : "Settings",
    accelerator: "CmdOrCtrl+,",
    click: () => shell.showScreen("settings"),
  };
  const checkForUpdates: MenuItemConstructorOptions = {
    label: "Check for Updates…",
    click: () => shell.hooks?.checkForUpdates(),
  };
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              checkForUpdates,
              { type: "separator" },
              settings,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Add Server…",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => shell.showScreen("add-server"),
        },
        { type: "separator" },
        ...(mac
          ? [{ role: "close" } satisfies MenuItemConstructorOptions]
          : [
              settings,
              { type: "separator" } satisfies MenuItemConstructorOptions,
              { role: "quit" } satisfies MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => shell.reload(),
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => shell.reload(true),
        },
        ...(options.isDev
          ? [
              {
                label: "Toggle Developer Tools",
                accelerator: mac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
                click: () => shell.toggleDevTools(),
              } satisfies MenuItemConstructorOptions,
            ]
          : []),
        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: () => shell.zoom(0),
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          click: () => shell.zoom(1),
        },
        // Also with Shift (⌘+ on most keyboards), without a second label.
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          visible: false,
          click: () => shell.zoom(1),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => shell.zoom(-1),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        {
          label: "Back",
          accelerator: mac ? "Cmd+[" : "Alt+Left",
          click: () => shell.back(),
        },
        {
          label: "Forward",
          accelerator: mac ? "Cmd+]" : "Alt+Right",
          click: () => shell.forward(),
        },
        { type: "separator" },
        {
          label: "Command Palette…",
          accelerator: "CmdOrCtrl+K",
          registerAccelerator: false,
          click: () => shell.openPalette(),
        },
        ...(servers.length
          ? [
              { type: "separator" } satisfies MenuItemConstructorOptions,
              ...servers,
            ]
          : []),
      ],
    },
    mac
      ? { role: "windowMenu" }
      : {
          label: "Window",
          submenu: [{ role: "minimize" }, { role: "close" }],
        },
    {
      role: "help",
      submenu: [
        {
          label: "Lictory Desktop Help",
          click: () => shell.openExternal(DOCS_URL),
        },
        {
          label: "Report an Issue",
          click: () => shell.openExternal(ISSUES_URL),
        },
        ...(mac
          ? []
          : [
              { type: "separator" } satisfies MenuItemConstructorOptions,
              checkForUpdates,
              {
                label: "About Lictory",
                click: () => app.showAboutPanel(),
              } satisfies MenuItemConstructorOptions,
            ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // Right-click on a server in the switcher.
  shell.serverMenu = (serverId) => {
    const index = shell.servers.servers.findIndex((s) => s.id === serverId);
    const server = shell.servers.servers[index];
    if (!server || !shell.window) return;
    Menu.buildFromTemplate([
      { label: "Open", click: () => shell.select(server.id) },
      {
        label: "Reload",
        click: () => {
          shell.select(server.id);
          shell.reload();
        },
      },
      {
        label: "Copy Address",
        click: () => void clipboard.writeText(server.origin),
      },
      { type: "separator" },
      {
        label: "Move Up",
        enabled: index > 0,
        click: () => shell.move(server.id, -1),
      },
      {
        label: "Move Down",
        enabled: index < shell.servers.servers.length - 1,
        click: () => shell.move(server.id, 1),
      },
      { type: "separator" },
      {
        label: `Remove ${server.name}…`,
        click: () => void shell.removeServer(server.id),
      },
    ]).popup({ window: shell.window });
  };
}
