// What Settings › Updates says when this build cannot update itself, and
// when a check fails: per platform and per install, the truth and what to
// do instead (main/updater.ts decides; the settings screen links to the
// download page).

export type UpdateEnvironment = {
  packaged: boolean;
  platform: NodeJS.Platform;
  // LICTORY_DESKTOP_UPDATES=off, for managed computers.
  turnedOff: boolean;
  appStore: boolean;
  // Linux: started from the AppImage (APPIMAGE is set), not a .deb.
  appImage: boolean;
  // package.mjs: signed (and on macOS notarized); AppImages always.
  signed: boolean;
};

export function updateSupport(
  env: UpdateEnvironment,
): { supported: true } | { supported: false; reason: string } {
  const no = (reason: string) => ({ supported: false as const, reason });
  if (!env.packaged) return no("Updates are off in development builds.");
  if (env.turnedOff)
    return no(
      "Updates are turned off on this computer (LICTORY_DESKTOP_UPDATES=off).",
    );
  if (env.appStore) return no("Your app store keeps Lictory up to date.");
  // No apt repository serves Lictory: the package manager never sees a
  // newer version.
  if (env.platform === "linux" && !env.appImage)
    return no(
      "Lictory installed from a .deb does not update itself. To update, download the newest .deb and install it over this one.",
    );
  if (!env.signed)
    return no(
      `This build is not signed, so ${env.platform === "darwin" ? "macOS does not let it update itself" : "it cannot update itself safely"}. To update, download the newest version and install it over this one.`,
    );
  return { supported: true };
}

// A release without this system's update file (latest*.yml), or no release
// at all, is not a failure of this computer: say what it means.
export function updateErrorMessage(error: { message: string; code?: unknown }) {
  if (
    error.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" ||
    error.code === "ERR_UPDATER_NO_PUBLISHED_VERSIONS"
  )
    return "The newest release has no update for this system yet. Lictory checks again later.";
  return `Checking for updates failed: ${error.message.split("\n")[0]}`;
}
