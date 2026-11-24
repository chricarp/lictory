import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { SHELL, type ShellApi, type ShellState } from "../shared/ipc";

// The shell page's access to the main process: the servers list, local
// screens and settings. Only the app's own page (lictory-app://shell/) loads
// this preload; the main process checks the sender again.

const api: ShellApi = {
  state: () => ipcRenderer.invoke(SHELL.state) as Promise<ShellState>,
  onChange(listener) {
    const handler = (_event: IpcRendererEvent, state: ShellState) =>
      listener(state);
    ipcRenderer.on(SHELL.changed, handler);
    return () => {
      ipcRenderer.off(SHELL.changed, handler);
    };
  },
  addServer: (address) => ipcRenderer.invoke(SHELL.addServer, address),
  selectServer: (id) => ipcRenderer.send(SHELL.selectServer, id),
  serverMenu: (id) => ipcRenderer.send(SHELL.serverMenu, id),
  showScreen: (screen) => ipcRenderer.send(SHELL.showScreen, screen),
  retry: (id) => ipcRenderer.send(SHELL.retry, id),
  removeServer: (id) => ipcRenderer.send(SHELL.removeServer, id),
  back: () => ipcRenderer.send(SHELL.back),
  forward: () => ipcRenderer.send(SHELL.forward),
  updateSettings: (patch) => ipcRenderer.invoke(SHELL.updateSettings, patch),
  checkForUpdates: () => ipcRenderer.send(SHELL.checkForUpdates),
  installUpdate: () => ipcRenderer.send(SHELL.installUpdate),
  runner: (command) => ipcRenderer.invoke(SHELL.runner, command),
  runnerLogs: () => ipcRenderer.invoke(SHELL.runnerLogs),
};

if (window.location.href.startsWith("lictory-app://shell/"))
  contextBridge.exposeInMainWorld("lictoryShell", api);
