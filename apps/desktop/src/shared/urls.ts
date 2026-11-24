// URL rules shared by the main process: which addresses are servers, which
// paths are in-app paths, and which URLs may be handed to the operating
// system. Pure, so they are tested without Electron.

// Hosts that only reach this computer. Plain http is the default for them,
// so a development server (http://localhost:3000) needs no scheme.
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const controlCharacters = /[\u0000-\u001f\u007f]/;
const MAX_PATH = 4096;

// A path inside a Lictory server (`/acme/items/PAY-1?pr=2#c`): it can never
// name another origin, a scheme or a protocol-relative URL.
export function isInAppPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/") || path.length > MAX_PATH) return false;
  if (path.startsWith("//") || path.includes("\\")) return false;
  if (controlCharacters.test(path)) return false;
  try {
    const base = "https://lictory.invalid";
    return new URL(path, base).origin === base;
  } catch {
    return false;
  }
}

// The path, query and fragment of an absolute URL on `origin`, or null.
export function inAppPathOf(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return null;
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return isInAppPath(path) ? path : null;
  } catch {
    return null;
  }
}

const externalProtocols = new Set(["https:", "http:", "mailto:"]);
const MAX_EXTERNAL_URL = 8192;

// What may be passed to shell.openExternal. Other schemes (file:, smb:,
// custom handlers of installed applications) can run code on this computer,
// so a page can never open them, whatever it links to.
export function isSafeExternalUrl(url: string): boolean {
  if (url.length > MAX_EXTERNAL_URL || controlCharacters.test(url))
    return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!externalProtocols.has(parsed.protocol)) return false;
  if (parsed.protocol === "mailto:") return true;
  if (!parsed.hostname || parsed.username || parsed.password) return false;
  return true;
}
