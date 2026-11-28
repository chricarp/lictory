import { isInAppPath, isLoopbackHost } from "./urls";

// `lictory://<server-host>/<path>` opens <path> on the server at that host:
// `lictory://lictory.example.com/acme/items/PAY-142` opens
// https://lictory.example.com/acme/items/PAY-142 in that server's view.

export const DEEP_LINK_SCHEME = "lictory";
const MAX_LINK = 8192;

export type DeepLink = {
  // host[:port], lower case.
  host: string;
  // Path, query and fragment; always an in-app path.
  path: string;
};

export function parseDeepLink(raw: string): DeepLink | null {
  if (typeof raw !== "string" || raw.length > MAX_LINK) return null;
  const value = raw.trim();
  const prefix = `${DEEP_LINK_SCHEME}://`;
  if (value.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  const rest = value.slice(prefix.length);
  // `lictory:///path` names no host (an https URL would skip the slashes).
  if (!rest || rest.startsWith("/") || rest.startsWith("\\")) return null;
  // Parse the remainder as an https URL: the WHATWG parser treats a custom
  // scheme's host as opaque (not lower-cased, not validated).
  let url: URL;
  try {
    url = new URL(`https://${rest}`);
  } catch {
    return null;
  }
  if (url.username || url.password || !url.hostname) return null;
  // Windows adds a trailing slash to a bare `lictory://host`.
  const path = `${url.pathname || "/"}${url.search}${url.hash}`;
  if (!isInAppPath(path)) return null;
  return { host: url.host, path };
}

// The deep link among a process's arguments (Windows and Linux pass it to the
// second instance; macOS sends `open-url` instead).
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  const prefix = `${DEEP_LINK_SCHEME}://`;
  return (
    argv.find((arg) => arg.slice(0, prefix.length).toLowerCase() === prefix) ??
    null
  );
}

// The configured server a link names. When a host is configured both with
// and without TLS, the HTTPS server wins.
export function serverForLink<T extends { origin: string }>(
  link: DeepLink,
  servers: readonly T[],
): T | undefined {
  const matches = servers.filter((s) => new URL(s.origin).host === link.host);
  return matches.find((s) => s.origin.startsWith("https:")) ?? matches.at(0);
}

// Where an unknown host is looked for: always HTTPS, except this computer.
export function originForHost(host: string): string {
  const hostname = new URL(`https://${host}`).hostname;
  return `${isLoopbackHost(hostname) ? "http" : "https"}://${host}`;
}
