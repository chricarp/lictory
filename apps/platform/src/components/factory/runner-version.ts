// Whether a runner runs the server's release. The runner protocol stays
// compatible across releases, but the docs ask to keep runners on the
// server's release (a runner gets fixes and new harness support with it),
// so the Runners page says which machines lag after an upgrade. Builds
// without a release version (a source checkout, "0.0.0-dev") are never
// compared: nothing can be said about them.

const release = /^v?(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d{8})\.(\d+))?$/;

function parse(version: string | null | undefined) {
  const match = version ? release.exec(version.trim()) : null;
  if (!match) return null;
  const [, major, minor, patch, date, build] = match;
  if (major === "0" && minor === "0" && patch === "0") return null;
  return [major, minor, patch, date ?? "99999999", build ?? "0"].map(Number);
}

export type VersionSkew = "behind" | "ahead";

export function runnerVersionSkew(
  runnerVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): VersionSkew | null {
  const runner = parse(runnerVersion);
  const server = parse(serverVersion);
  if (!runner || !server) return null;
  for (let i = 0; i < runner.length; i++) {
    if (runner[i]! < server[i]!) return "behind";
    if (runner[i]! > server[i]!) return "ahead";
  }
  return null;
}
