import { app, Menu, nativeImage, Tray, type NativeImage } from "electron";
import { badgeLabel, unreadSummary, withUnreadDot } from "../shared/badge";
import type { Shell } from "./shell";

// The tray (menu bar on macOS) icon: the unread count, the servers, Open,
// Launch at login and Quit. On macOS the count is the title next to the
// template icon; elsewhere a red dot is drawn on the icon.
export function createTray(
  shell: Shell,
  icons: { mac: string; other: string },
  options: { launchAtLoginSupported: boolean },
) {
  let tray: Tray | null = null;
  let base: NativeImage | null = null;
  let dotted: NativeImage | null = null;
  try {
    if (process.platform === "darwin") {
      base = nativeImage.createFromPath(icons.mac);
      base.setTemplateImage(true);
    } else {
      base = nativeImage.createFromPath(icons.other);
      const size = base.getSize();
      dotted = nativeImage.createFromBitmap(
        Buffer.from(withUnreadDot(base.toBitmap(), size.width, size.height)),
        size,
      );
    }
    tray = new Tray(base);
  } catch {
    // No tray on this desktop (some Linux sessions): the window remains.
    tray = null;
  }
  if (!tray) return { available: () => false, update: () => undefined };
  const icon = tray;
  icon.on("click", () => {
    // macOS shows the menu on click by itself.
    if (process.platform !== "darwin") shell.show();
  });

  function update(total: number) {
    if (process.platform === "darwin")
      icon.setTitle(total ? ` ${badgeLabel(total)}` : "");
    else if (base && dotted) icon.setImage(total ? dotted : base);
    icon.setToolTip(`Lictory — ${unreadSummary(total)}`);
    const servers = shell.servers.servers.map((server) => {
      const unread = shell.unreadFor(server.id);
      return {
        label: unread ? `${server.name} (${badgeLabel(unread)})` : server.name,
        click: () => {
          shell.select(server.id);
          shell.show();
        },
      };
    });
    icon.setContextMenu(
      Menu.buildFromTemplate([
        { label: unreadSummary(total), enabled: false },
        { type: "separator" },
        ...servers,
        ...(servers.length ? [{ type: "separator" as const }] : []),
        { label: "Open Lictory", click: () => shell.show() },
        ...(options.launchAtLoginSupported
          ? [
              {
                label: "Launch at Login",
                type: "checkbox" as const,
                checked: shell.settings.launchAtLogin,
                click: () =>
                  shell.updateSettings({
                    launchAtLogin: !shell.settings.launchAtLogin,
                  }),
              },
            ]
          : []),
        { type: "separator" },
        { label: "Quit Lictory", click: () => app.quit() },
      ]),
    );
  }
  update(0);
  return { available: () => true, update };
}
