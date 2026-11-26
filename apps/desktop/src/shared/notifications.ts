import { isInAppPath } from "./urls";

// Native notifications requested by a server's page through the desktop
// bridge. The page is not trusted to be well-behaved: what it sends is
// validated, shortened and rate limited before the operating system sees it.

export type NativeNotification = {
  title: string;
  body: string;
  path: string | null;
  tag: string | null;
};

const MAX_TITLE = 120;
const MAX_BODY = 400;
const MAX_TAG = 200;

function clip(value: string, max: number) {
  const text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeNotification(
  input: unknown,
): NativeNotification | null {
  if (!isRecord(input) || typeof input.title !== "string") return null;
  const title = clip(input.title, MAX_TITLE);
  if (!title) return null;
  return {
    title,
    body: typeof input.body === "string" ? clip(input.body, MAX_BODY) : "",
    path: isInAppPath(input.path) ? input.path : null,
    tag:
      typeof input.tag === "string" && input.tag
        ? input.tag.slice(0, MAX_TAG)
        : null,
  };
}

// The page a notification opens, without its query and fragment: a thread
// or tab of the page the person is on counts as that page.
function pageOf(path: string | null) {
  return path ? (path.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "") : null;
}

// A notification is shown unless the person turned them off or is already
// looking at what it is about: the window focused on that server's page that
// the notification opens. Working on something else in the app, even on
// the same server, is exactly when a review request or a mention should
// interrupt (only the Inbox count and the badge would change otherwise).
export function shouldShowNotification(state: {
  enabled: boolean;
  windowFocused: boolean;
  activeServerId: string | null;
  serverId: string;
  // The in-app path of the active server's page, and the notification's.
  activePath: string | null;
  path: string | null;
}) {
  if (!state.enabled) return false;
  if (!state.windowFocused || state.activeServerId !== state.serverId)
    return true;
  const target = pageOf(state.path);
  return target === null || target !== pageOf(state.activePath);
}

// At most `limit` notifications per server in any `windowMs`.
export function createRateLimiter(limit = 6, windowMs = 60_000) {
  const sent = new Map<string, number[]>();
  return (key: string, now: number) => {
    const recent = (sent.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      sent.set(key, recent);
      return false;
    }
    recent.push(now);
    sent.set(key, recent);
    return true;
  };
}
