// Which web permissions a server's page receives. Only the server's own
// top-level page asks; identity provider pages and embedded frames get
// nothing.
//
// - notifications and writing to the clipboard: granted;
// - camera and microphone: asked of the person each time a page requests
//   them (and remembered until the app quits), never granted by a check;
// - everything else (location, MIDI, USB, serial, HID, screen capture,
//   fullscreen, reading the clipboard, opening other applications…): denied.

export type PermissionDecision = "allow" | "ask" | "deny";

export type PermissionRequest = {
  permission: string;
  requestingOrigin: string | null;
  serverOrigin: string;
  isMainFrame: boolean;
};

const granted = new Set(["notifications", "clipboard-sanitized-write"]);

export function decidePermission(
  request: PermissionRequest,
): PermissionDecision {
  if (request.requestingOrigin !== request.serverOrigin || !request.isMainFrame)
    return "deny";
  if (granted.has(request.permission)) return "allow";
  if (request.permission === "media") return "ask";
  return "deny";
}

// Permission checks (navigator.permissions.query and friends) answer from
// the same rule, but media only once the person allowed it in this run.
export function checkPermission(
  request: Omit<PermissionRequest, "isMainFrame">,
  mediaAllowed: boolean,
): boolean {
  if (request.requestingOrigin !== request.serverOrigin) return false;
  if (granted.has(request.permission)) return true;
  return request.permission === "media" && mediaAllowed;
}

export type MediaKind = "audio" | "video";

// The sentence the person answers before a page may use the camera or
// microphone.
export function mediaPrompt(host: string, kinds: readonly MediaKind[]) {
  const wanted =
    kinds.includes("audio") && kinds.includes("video")
      ? "your camera and microphone"
      : kinds.includes("video")
        ? "your camera"
        : "your microphone";
  return `${host} wants to use ${wanted}.`;
}
